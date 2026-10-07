/**
 * VideoAgent: orchestrates the full pipeline, from a natural-language brief to a rendered video.
 *
 *  1 analyze → 2 concept → 3 script → 4 storyboard → 5 scenes → 6 assets → 7 animations
 *  → 8 subtitles → 9 audio → 10 Remotion project → 11 render → 12 final output
 *
 * Every external capability (LLM, images, voice, video clips, renderer) is injected and optional.
 */
import fs from 'node:fs';
import path from 'node:path';
import { synthesizeMusic } from '../audio/music';
import { getLanguage } from '../core/languages';
import { buildMusicPrompt } from '../providers/music/prompt';
import { resolveMusicProvider } from '../providers/music/registry';
import type { MusicProvider } from '../providers/music/types';
import { AssetLibrary, importAsset } from '../assets/manager';
import type { AppConfig } from '../config/config';
import { errorMessage, StoryboardValidationError } from '../core/errors';
import { createLogger, type Logger } from '../core/logger';
import {
  PIPELINE_STEPS,
  type PlannedScene,
  type ProgressListener,
  type StepId,
  type VideoBrief,
  type VideoConcept,
  type VideoRequest,
} from '../core/types';
import { resolveLLM } from '../llm/registry';
import type { LLMProvider } from '../llm/types';
import { Planner } from '../planning/planner';
import { buildBrief } from '../planning/brief';
import { selectSlots } from '../planning/slots';
import { parsePrompt } from '../prompt/parser';
import { resolveImageProvider } from '../providers/image/registry';
import type { ImageProvider } from '../providers/image/types';
import { resolveVideoProvider } from '../providers/video/registry';
import type { VideoProvider } from '../providers/video/types';
import { resolveVoiceProvider } from '../providers/voice/registry';
import { resolveStockProviders } from '../providers/stock/registry';
import type { StockProvider } from '../providers/stock/types';
import { MediaDirector, wantsMedia, type MediaCredit } from '../media/director';
import type { VoiceProvider } from '../providers/voice/types';
import { renderStoryboard, type RenderOptions, type RenderResult } from '../render/renderer';
import type { Storyboard } from '../remotion/contract/storyboard';
import { getStyle } from '../remotion/contract/styles';
import { applyAnimations } from '../storyboard/animations';
import { buildStoryboard } from '../storyboard/builder';
import { refineScenes } from '../storyboard/scenes';
import { matchTargetDuration, paceScenesToVoiceover, recomputeDuration } from '../storyboard/timing';
import { trimWavSilence, wavDurationSec } from '../audio/wav';
import { parseStructuredPrompt, plannedFromStructured, type StructuredScript } from '../prompt/structured';
import { applyBrandColors, parseHexColors } from '../storyboard/brand-colors';
import { validateStoryboard } from '../storyboard/validator';
import { buildSubtitleCues, toSrt, toVtt } from '../subtitles/subtitles';
import { getTemplate } from '../templates/registry';
import { ensureJobDirs, jobPaths, newJobId, writeJson, type JobPaths } from './job';
import { jobReadme, scriptMarkdown } from './project';

export interface AgentDependencies {
  /** `null` forces procedural planning. `undefined` = resolve from configuration. */
  llm?: LLMProvider | null;
  voice?: VoiceProvider | null;
  /** AI music. `undefined` = from VIDEO_AGENT_MUSIC_PROVIDER. */
  music?: MusicProvider | null;
  image?: ImageProvider | null;
  video?: VideoProvider | null;
  stock?: StockProvider[];
  renderer?: (options: RenderOptions) => Promise<RenderResult>;
  logger?: Logger;
}

export interface RunOptions {
  onProgress?: ProgressListener;
  signal?: AbortSignal;
}

export interface VideoResult {
  jobId: string;
  jobDir: string;
  videoFile?: string;
  posterFile?: string;
  storyboardFile: string;
  storyboard: Storyboard;
  brief: VideoBrief;
  concept: VideoConcept;
  warnings: string[];
  providers: { planner: string; voice: string; image: string; stock: string; video: string; music: string };
  /** Attribution of stock media used in the video. */
  credits: MediaCredit[];
  timingsMs: Partial<Record<StepId, number>>;
}

/** Relative cost of each step for the overall progress bar. */
const STEP_WEIGHTS: Record<StepId, number> = {
  analyze: 1, concept: 4, script: 6, storyboard: 1, scenes: 1, assets: 3, animations: 1, subtitles: 1, audio: 5, project: 1, render: 30, output: 1,
};
const TOTAL_WEIGHT = Object.values(STEP_WEIGHTS).reduce((a, b) => a + b, 0);

export class VideoAgent {
  private readonly logger: Logger;

  constructor(
    private readonly config: AppConfig,
    private readonly deps: AgentDependencies = {},
  ) {
    this.logger = deps.logger ?? createLogger(config.logLevel);
  }

  async run(request: VideoRequest, runOptions: RunOptions = {}): Promise<VideoResult> {
    const options = request.options ?? {};
    const { signal } = runOptions;
    const warnings: string[] = [];
    const timings: Partial<Record<StepId, number>> = {};
    let completedWeight = 0;

    const emit = (step: StepId, status: 'started' | 'progress' | 'completed' | 'skipped' | 'failed', message: string, progress?: number) => {
      const stepIndex = PIPELINE_STEPS.findIndex((s) => s.id === step);
      const inStep = status === 'completed' || status === 'skipped' ? 0 : (progress ?? 0) * STEP_WEIGHTS[step];
      runOptions.onProgress?.({
        step,
        stepIndex,
        totalSteps: PIPELINE_STEPS.length,
        status,
        message,
        progress,
        overall: Math.min(1, (completedWeight + inStep) / TOTAL_WEIGHT),
      });
    };

    const step = async <T>(id: StepId, startMessage: string, fn: (progress: (p: number, msg?: string) => void) => Promise<T> | T, doneMessage?: (r: T) => string): Promise<T> => {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted');
      const started = Date.now();
      emit(id, 'started', startMessage, 0);
      this.logger.debug(`${PIPELINE_STEPS.find((s) => s.id === id)!.label}…`);
      try {
        const result = await fn((p, msg) => emit(id, 'progress', msg ?? startMessage, p));
        timings[id] = Date.now() - started;
        completedWeight += STEP_WEIGHTS[id];
        const done = doneMessage ? doneMessage(result) : startMessage;
        this.logger.debug(`  ✓ ${done}`);
        emit(id, 'completed', done, 1);
        return result;
      } catch (err) {
        emit(id, 'failed', errorMessage(err));
        throw err;
      }
    };
    const skip = (id: StepId, message: string) => {
      completedWeight += STEP_WEIGHTS[id];
      emit(id, 'skipped', message);
    };

    // ---- 1. Analyse ------------------------------------------------------------
    const { brief, template, style, structured } = await step(
      'analyze',
      'Analyse de la demande',
      () => {
        if (!request.prompt?.trim()) throw new Error('The prompt is empty.');
        const parsed = parsePrompt(request.prompt);
        // A detailed script ("SCÈNE 1 — … (0–5 s)") sets the duration from its timings.
        const structured = parseStructuredPrompt(request.prompt);
        const timedOptions = structured?.totalSec && !options.durationSec ? { ...options, durationSec: Math.round(structured.totalSec) } : options;
        const built = buildBrief(parsed, timedOptions, this.config);
        const { notes } = built;
        // Brand kit: its name applies when the prompt does not name a brand.
        const brief = !built.brief.brand && options.brandName ? { ...built.brief, brand: options.brandName } : built.brief;
        notes.forEach((n) => this.logger.debug(n));
        const baseStyle = getStyle(brief.styleId);
        // Colours written in the prompt win over the brand kit.
        const promptColors = parseHexColors(request.prompt);
        const colors = promptColors.length ? promptColors : (options.brandColors ?? []);
        const style = colors.length ? { ...baseStyle, theme: applyBrandColors(baseStyle.theme, colors) } : baseStyle;
        return { brief, template: getTemplate(brief.templateId)!, style, structured };
      },
      ({ brief }) =>
        `${brief.templateId} · ${brief.width}×${brief.height} · ${brief.durationSec}s · ${brief.fps} fps · style ${brief.styleId} · ${brief.locale}` +
        (brief.brand ? ` · marque ${brief.brand}` : '') +
        (brief.audience ? ` · cible ${brief.audience}` : ''),
    );
    const script: StructuredScript | undefined = structured;

    const llm = options.offline ? null : this.deps.llm !== undefined ? this.deps.llm : resolveLLM(this.config, options.llmProvider);
    const planner = new Planner(llm, this.logger);
    const paths = jobPaths(options.outDir ?? path.join(this.config.paths.output, newJobId(brief.brand || brief.topic || template.id)));
    ensureJobDirs(paths);
    writeJson(paths.briefFile, brief);

    // ---- 2. Concept ------------------------------------------------------------
    const concept = await step(
      'concept',
      `Concept (${planner.source})`,
      async () => {
        if (script) {
          // The user's script already sets the concept: keep their words.
          const final = script.finalTexts.filter((t) => t !== brief.brand);
          const value = {
            title: brief.brand || script.scenes[0]!.texts[0] || brief.topic,
            idea: script.scenes.map((s) => s.title).join(' · '),
            angle: '',
            tone: '',
            keyMessage: final[0] ?? script.scenes[0]!.texts[1] ?? '',
            callToAction: final[1] ?? '',
            tagline: final[0] ?? '',
          };
          writeJson(paths.conceptFile, { ...value, source: 'script' });
          return value;
        }
        const r = await planner.concept(brief, template, signal);
        if (r.warning) warnings.push(r.warning);
        writeJson(paths.conceptFile, { ...r.value, source: r.source });
        return r.value;
      },
      (c) => `« ${c.title} » — ${c.keyMessage}`,
    );

    // ---- 3. Script -------------------------------------------------------------
    const slots = selectSlots(template, brief.durationSec);
    let scriptSource = 'procedural';
    const planned = await step(
      'script',
      script ? `Script fourni : ${script.scenes.length} scènes` : `Script de ${slots.length} scènes (${planner.source})`,
      async () => {
        if (script) {
          scriptSource = 'script';
          return plannedFromStructured(script, { brand: brief.brand, totalSec: brief.durationSec, language: brief.language });
        }
        const r = await planner.script(brief, template, concept, slots, signal);
        if (r.warning) warnings.push(r.warning);
        scriptSource = r.source;
        if (r.source === 'procedural' && brief.locale !== brief.language) {
          warnings.push(`${getLanguage(brief.locale)?.name ?? brief.locale} needs an AI model (LLM) to write the texts: video written in ${brief.language === 'fr' ? 'French' : 'English'}.`);
          brief.locale = brief.language;
        }
        return r.value;
      },
      (s) => `${s.length} scènes écrites`,
    );

    // ---- 4. Storyboard ---------------------------------------------------------
    let storyboard = await step(
      'storyboard',
      'Construction du storyboard',
      () => buildStoryboard({ brief, concept, scenes: planned, style }),
      (sb) => `${sb.scenes.length} scènes · ${(sb.format.durationInFrames / sb.format.fps).toFixed(1)}s`,
    );

    // ---- 5. Scenes -------------------------------------------------------------
    storyboard = await step('scenes', 'Choix des scènes', () => refineScenes(storyboard), (sb) => sb.scenes.map((s) => s.kind).join(' → '));

    // ---- 6. Assets (local library → stock photos/videos → AI generation) -------------
    const imageProvider = options.generateImages === false ? null : this.deps.image !== undefined ? this.deps.image : safeResolve(() => resolveImageProvider(this.config), warnings);
    const videoProvider = options.generateVideo ? (this.deps.video !== undefined ? this.deps.video : safeResolve(() => resolveVideoProvider(this.config), warnings)) : null;
    const stockProviders = options.stock === false ? [] : this.deps.stock ?? safeResolve(() => resolveStockProviders(this.config), warnings) ?? [];
    let library: AssetLibrary | undefined;
    try {
      library = AssetLibrary.load(this.config.paths.assets);
    } catch (err) {
      warnings.push(`asset library ignored: ${errorMessage(err)}`);
    }
    const director = new MediaDirector(
      { library, stock: stockProviders, image: imageProvider, video: videoProvider, logger: this.logger },
      {
        sources: this.config.env.VIDEO_AGENT_MEDIA_SOURCES,
        coverage: options.mediaCoverage ?? this.config.env.VIDEO_AGENT_MEDIA_COVERAGE,
        stockVideos: this.config.env.VIDEO_AGENT_STOCK_VIDEOS,
        maxGeneratedImages: this.config.env.VIDEO_AGENT_MAX_GENERATED_IMAGES,
        maxGeneratedClips: this.config.env.VIDEO_AGENT_MAX_GENERATED_CLIPS,
        // LLM scripts produce English visual keywords; procedural ones are in the brief's language.
        keywordLanguage: scriptSource === 'procedural' ? brief.language : 'en',
        shotsPerScene: this.config.env.VIDEO_AGENT_SHOTS_PER_SCENE,
      },
    );
    storyboard = await step(
      'assets',
      'Sélection des visuels',
      async (progress) => {
        const sb = await director.run(storyboard, planned, brief, paths, warnings, progress, signal);
        const customerImages = (request.productImages ?? []).filter((file) => fs.existsSync(file));
        const mediaScenes = sb.scenes.filter((scene) => wantsMedia(scene, options.mediaCoverage ?? this.config.env.VIDEO_AGENT_MEDIA_COVERAGE));
        if (mediaScenes.length) {
          customerImages.forEach((file, imageIndex) => {
            const scene = mediaScenes[imageIndex % mediaScenes.length]!;
            scene.media = { type: 'image', src: importAsset(file, paths.publicDir, 'product'), fit: 'cover', origin: 'user:product' };
            scene.shots = undefined;
          });
        }
        // Brand kit logo (uploaded by the customer) wins over the shared assets library.
        if (options.brandLogo && fs.existsSync(options.brandLogo)) {
          return { ...sb, brand: { ...sb.brand, logo: importAsset(options.brandLogo, paths.publicDir, 'brand'), showWatermark: true } };
        }
        return sb;
      },
      (sb) => {
        const media = sb.scenes.filter((s) => s.media);
        if (!media.length) return `aucun visuel trouvé${sb.brand.logo ? ' (logo seul)' : ''} — fonds animés procéduraux`;
        const bySource = new Map<string, number>();
        for (const s of media) bySource.set(s.media!.origin, (bySource.get(s.media!.origin) ?? 0) + 1);
        const extra = sb.scenes.reduce((n, s) => n + (s.shots?.length ?? 0), 0);
        return `${media.length}/${sb.scenes.length} scènes illustrées (${[...bySource].map(([k, v]) => `${k}×${v}`).join(', ')})${extra ? ` + ${extra} plans` : ''}${sb.brand.logo ? ' + logo' : ''}`;
      },
    );
    const credits = director.credits;

    // ---- 7. Animations -----------------------------------------------------------
    storyboard = await step(
      'animations',
      'Animations et transitions',
      () => matchTargetDuration(applyAnimations(storyboard, style), Math.round(brief.durationSec * brief.fps)),
      (sb) => [...new Set(sb.scenes.map((s) => s.transitionOut.type).filter((t) => t !== 'none'))].join(', ') || 'cuts',
    );

    // ---- 8. Texts & subtitles ------------------------------------------------------
    storyboard = await step(
      'subtitles',
      'Textes et sous-titres',
      () => ({ ...storyboard, subtitles: { ...storyboard.subtitles, cues: brief.subtitles ? buildSubtitleCues(storyboard) : [] } }),
      (sb) => (brief.subtitles ? `${sb.subtitles.cues.length} sous-titres` : 'sous-titres désactivés'),
    );

    // ---- 9. Voice-over & music ---------------------------------------------------------
    let voiceProvider: VoiceProvider | null = null;
    if (brief.voice) {
      voiceProvider = this.deps.voice !== undefined ? this.deps.voice : safeResolve(() => resolveVoiceProvider(this.config, undefined, brief.locale), warnings);
      if (voiceProvider?.supports?.(brief.locale) === false) {
        const other = this.deps.voice !== undefined ? null : safeResolve(() => resolveVoiceProvider(this.config, 'auto', brief.locale), warnings);
        const name = getLanguage(brief.locale)?.name ?? brief.locale;
        warnings.push(other ? `voice ${voiceProvider.id} cannot speak ${name}: using ${other.id}` : `no voice available for ${name} (set HF_TOKEN for the experimental MMS voices): video without voice-over`);
        voiceProvider = other;
      }
    }
    let musicSource = 'none';
    storyboard = await step(
      'audio',
      'Voix-off et musique',
      async (progress) => {
        let sb = storyboard;
        if (voiceProvider) {
          sb = await this.generateVoiceover(sb, brief, paths, voiceProvider, warnings, progress, signal);
          // The narration sets the pace: no long silences between sentences.
          // A script with a range ("45 à 60 s") aims at its lower bound, filled exactly.
          const targetSec = script?.minSec && script.minSec <= brief.durationSec ? script.minSec : brief.durationSec;
          if (sb.scenes.some((s) => s.voiceover)) sb = paceScenesToVoiceover(sb, { targetFrames: Math.round(targetSec * sb.format.fps), minFill: script ? 1 : undefined });
        }
        if (brief.music) {
          const music = await this.prepareMusic(sb, brief, paths, style.theme.motion, style.id === 'elegant', warnings, progress, signal);
          if (music) {
            musicSource = music.source;
            sb = { ...sb, audio: { music: { src: music.src, volume: voiceProvider ? 0.3 : 0.45, duckedVolume: 0.1 } } };
          }
        }
        sb = recomputeDuration(sb);
        if (brief.subtitles) sb = { ...sb, subtitles: { ...sb.subtitles, cues: buildSubtitleCues(sb) } };
        return sb;
      },
      (sb) => {
        const voiced = sb.scenes.filter((s) => s.voiceover).length;
        return `voix-off : ${voiced ? `${voiced} scène(s) (${voiceProvider!.id})` : 'aucune'} · musique : ${musicSource}`;
      },
    );

    // ---- 10. Remotion project --------------------------------------------------------
    await step(
      'project',
      'Génération du projet Remotion',
      () => {
        const validation = validateStoryboard(storyboard, { publicDir: paths.publicDir, requireEvenDimensions: brief.outputFormat !== 'gif' });
        validation.warnings.forEach((w) => this.logger.debug(`storyboard: ${w}`));
        if (!validation.valid) throw new StoryboardValidationError(validation.errors);
        storyboard = validation.storyboard!;
        writeJson(paths.storyboardFile, storyboard);
        writeJson(paths.propsFile, { storyboard });
        fs.writeFileSync(paths.scriptFile, scriptMarkdown(brief, concept, storyboard));
        if (storyboard.subtitles.cues.length) {
          fs.writeFileSync(paths.srtFile, toSrt(storyboard.subtitles.cues, storyboard.format.fps));
          fs.writeFileSync(paths.vttFile, toVtt(storyboard.subtitles.cues, storyboard.format.fps));
        }
        fs.writeFileSync(paths.readmeFile, jobReadme(paths.dir, storyboard, options.skipRender ? undefined : path.basename(paths.videoFile(brief.outputFormat)), this.config.paths.root));
      },
      () => path.relative(process.cwd(), paths.storyboardFile) || paths.storyboardFile,
    );

    // ---- 11. Render ------------------------------------------------------------------
    let render: RenderResult | undefined;
    if (options.skipRender) {
      skip('render', 'Rendu ignoré (--no-render)');
    } else {
      const renderer = this.deps.renderer ?? renderStoryboard;
      render = await step(
        'render',
        'Rendu Remotion',
        (progress) =>
          renderer({
            storyboard,
            publicDir: paths.publicDir,
            outputFile: paths.videoFile(brief.outputFormat),
            outputFormat: brief.outputFormat,
            posterFile: paths.posterFile,
            browserExecutable: this.config.browserExecutable,
            concurrency: this.config.env.VIDEO_AGENT_RENDER_CONCURRENCY,
            crf: this.config.env.VIDEO_AGENT_CRF,
            x264Preset: this.config.env.VIDEO_AGENT_X264_PRESET,
            gl: this.config.env.VIDEO_AGENT_RENDER_GL,
            timeoutMs: this.config.env.VIDEO_AGENT_RENDER_TIMEOUT_MS,
            signal,
            onProgress: ({ stage, progress: p }) => {
              const label = { bundle: 'Bundle Remotion', render: 'Rendu des images', encode: 'Encodage', poster: 'Miniature' }[stage];
              const overall = stage === 'bundle' ? p * 0.1 : stage === 'render' ? 0.1 + p * 0.85 : 0.97;
              progress(overall, `${label} ${Math.round(p * 100)}%`);
            },
          }),
        (r) => `${path.basename(r.file)} (${r.durationSec.toFixed(1)}s)`,
      );
    }

    // ---- 12. Output --------------------------------------------------------------------
    const providers = {
      planner: planner.source,
      voice: voiceProvider?.id ?? 'none',
      image: imageProvider?.id ?? 'none',
      stock: stockProviders.map((p) => p.id).join(',') || 'none',
      video: videoProvider?.id ?? 'none',
      music: musicSource,
    };
    const result = await step(
      'output',
      'Finalisation',
      (): VideoResult => {
        const res: VideoResult = {
          jobId: paths.id,
          jobDir: paths.dir,
          videoFile: render?.file,
          posterFile: render?.posterFile,
          storyboardFile: paths.storyboardFile,
          storyboard,
          brief,
          concept,
          warnings,
          providers,
          credits,
          timingsMs: timings,
        };
        writeJson(paths.jobFile, {
          id: res.jobId,
          prompt: request.prompt,
          options,
          status: 'completed',
          createdAt: new Date().toISOString(),
          videoFile: res.videoFile && path.basename(res.videoFile),
          posterFile: res.posterFile && path.basename(res.posterFile),
          providers,
          warnings,
          timingsMs: timings,
        });
        return res;
      },
      (r) => r.videoFile ?? r.storyboardFile,
    );
    return result;
  }

  // ------------------------------------------------------------------------------------

  private async generateVoiceover(
    storyboard: Storyboard,
    brief: VideoBrief,
    paths: JobPaths,
    provider: VoiceProvider,
    warnings: string[],
    progress: (p: number, msg?: string) => void,
    signal?: AbortSignal,
  ): Promise<Storyboard> {
    const fps = storyboard.format.fps;
    const scenes = [...storyboard.scenes];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i]!;
      const text = scene.narration.replace(/\*/g, '').trim();
      if (!text) continue;
      progress(i / scenes.length, `Voix-off ${i + 1}/${scenes.length}`);
      const outFile = path.join(paths.publicDir, 'voice', `${scene.id}.wav`);
      try {
        let { durationSec } = await provider.synthesize({ text, language: brief.locale, outFile, signal });
        // TTS engines pad sentences with silence: trim it so the voice starts right on cue.
        if (fs.existsSync(outFile)) {
          const trimmed = trimWavSilence(fs.readFileSync(outFile));
          fs.writeFileSync(outFile, trimmed);
          durationSec = wavDurationSec(trimmed);
        }
        scenes[i] = { ...scene, voiceover: { src: `voice/${scene.id}.wav`, durationInFrames: Math.max(1, Math.ceil(durationSec * fps)), volume: 1 } };
      } catch (err) {
        if (signal?.aborted) throw err;
        warnings.push(`voice-over failed for ${scene.id}: ${errorMessage(err)}`);
        if (i === 0) {
          // Most likely a configuration problem: do not retry for every scene.
          warnings.push('voice-over disabled for this video');
          break;
        }
      }
    }
    return { ...storyboard, scenes };
  }

  private async prepareMusic(
    storyboard: Storyboard,
    brief: VideoBrief,
    paths: JobPaths,
    mood: 'calm' | 'normal' | 'energetic',
    minor: boolean,
    warnings: string[],
    progress: (p: number, msg?: string) => void,
    signal?: AbortSignal,
  ): Promise<{ src: string; source: string } | undefined> {
    const mode = this.config.env.VIDEO_AGENT_MUSIC;
    if (mode === 'none') return undefined;
    if (mode === 'assets' || mode === 'auto') {
      try {
        const track = AssetLibrary.load(this.config.paths.assets).music([brief.styleId, mood, ...brief.keywords]);
        if (track) return { src: importAsset(track.file, paths.publicDir, 'music'), source: `asset:${track.relative}` };
      } catch {
        /* fall through */
      }
      if (mode === 'assets') return undefined;
    }
    const durationSec = storyboard.format.durationInFrames / storyboard.format.fps;
    // An original track composed for this video; procedural synthesis when unavailable.
    const ai = this.deps.music !== undefined ? this.deps.music : safeResolve(() => resolveMusicProvider(this.config), warnings);
    if (ai) {
      try {
        progress(0.9, `composition de la musique (${ai.id})`);
        const prompt = buildMusicPrompt({ prompt: brief.prompt, mood, minor });
        const track = await ai.generate({ prompt, durationSec: Math.min(ai.maxDurationSec, Math.ceil(durationSec) + 2), signal });
        const file = `music/generated.${track.extension}`;
        fs.writeFileSync(path.join(paths.publicDir, file), track.audio);
        return { src: file, source: `ia:${ai.id}` };
      } catch (err) {
        if (signal?.aborted) throw err;
        warnings.push(`AI music unavailable, using synthesized music: ${errorMessage(err)}`);
      }
    }
    const seed = [...brief.prompt].reduce((s, c) => (s + c.charCodeAt(0)) % 997, 0);
    fs.writeFileSync(path.join(paths.publicDir, 'music', 'procedural.wav'), synthesizeMusic({ durationSec, mood, minor, seed }));
    return { src: 'music/procedural.wav', source: `procedural (${mood})` };
  }
}

const safeResolve = <T>(fn: () => T | null, warnings: string[]): T | null => {
  try {
    return fn();
  } catch (err) {
    warnings.push(errorMessage(err));
    return null;
  }
};
