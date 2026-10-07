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
import { placeProductPhotos, type ProductPhoto } from '../media/product-photos';
import type { AppConfig } from '../config/config';
import { errorMessage, StoryboardValidationError, VideoAgentError } from '../core/errors';
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
import type { UsageMeter } from '../core/usage';
import type { LLMProvider } from '../llm/types';
import { Planner } from '../planning/planner';
import { buildBrief } from '../planning/brief';
import { selectSlots } from '../planning/slots';
import { parsePrompt } from '../prompt/parser';
import { resolveImageProvider } from '../providers/image/registry';
import type { ImageProvider } from '../providers/image/types';
import { resolveVideoProvider } from '../providers/video/registry';
import type { VideoProvider } from '../providers/video/types';
import { isPiperInstalled, resolveVoiceProvider } from '../providers/voice/registry';
import { applyPronunciations, mentionsAny, type Pronunciation } from '../core/pronunciation';
import { resolveStockProviders } from '../providers/stock/registry';
import type { StockProvider } from '../providers/stock/types';
import { MediaDirector, wantsMedia, type MediaCredit } from '../media/director';
import type { VoiceGender, VoiceProvider } from '../providers/voice/types';
import { renderStoryboard, type RenderOptions, type RenderResult } from '../render/renderer';
import { StoryboardSchema, type Storyboard } from '../remotion/contract/storyboard';
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
import { applyRevision, planRevision, RevisionNotApplicable } from './revise';

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
  /** Records the paid services used (tokens, voice characters, music seconds, images) for cost tracking. */
  meter?: UsageMeter;
  /** Voice used when the chosen one fails. `undefined` = Piper or MMS when available. */
  voiceFallback?: VoiceProvider | null;
}

export interface RevisionRequest {
  /** Job directory of the rendered video to correct. */
  sourceDir: string;
  /** Directory of the corrected copy. */
  outDir: string;
  instruction: string;
  productImages?: VideoRequest['productImages'];
  /** Corner badge of the account's current plan. */
  badge?: string;
  voiceGender?: VoiceGender;
  voiceId?: string;
  pronunciations?: Pronunciation[];
}

export interface VoiceoverOptions {
  /** Only record these scenes (targeted correction); the others keep their voice-over. */
  only?: Set<string>;
  gender?: VoiceGender;
  /** Customer's cloned voice. */
  voiceId?: string;
  pronunciations?: Pronunciation[];
  fallback?: VoiceProvider | null;
  onSwitch?: (voice: VoiceProvider) => void;
}

export interface RevoiceRequest {
  sourceDir: string;
  outDir: string;
  /** The words just fixed: the scenes saying them are recorded again. */
  changed: Pronunciation[];
  /** The customer's whole dictionary (applied to every recorded sentence). */
  pronunciations: Pronunciation[];
  voiceGender?: VoiceGender;
  voiceId?: string;
  badge?: string;
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

  /** Progress bookkeeping shared by run() and revise(): weighted steps reported through onProgress. */
  private stepper(runOptions: RunOptions) {
    const { signal } = runOptions;
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
    return { step, skip, timings };
  }

  async run(request: VideoRequest, runOptions: RunOptions = {}): Promise<VideoResult> {
    const options = request.options ?? {};
    const { signal } = runOptions;
    const warnings: string[] = [];
    const { step, skip, timings } = this.stepper(runOptions);

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
    const productPhotos: ProductPhoto[] = (request.productImages ?? []).map((photo) => (typeof photo === 'string' ? { file: photo } : photo)).filter((photo) => fs.existsSync(photo.file));
    // The script is written knowing what the customer's photos show.
    if (productPhotos.length) brief.productPhotos = productPhotos.map((photo) => photo.description || photo.name || path.basename(photo.file));

    const llm = this.metered(options.offline ? null : this.deps.llm !== undefined ? this.deps.llm : resolveLLM(this.config, options.llmProvider));
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
    const imageProvider = this.meteredImage(options.generateImages === false ? null : this.deps.image !== undefined ? this.deps.image : safeResolve(() => resolveImageProvider(this.config), warnings));
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
        let sb = await director.run(storyboard, planned, brief, paths, warnings, progress, signal);
        if (productPhotos.length) {
          const srcs = productPhotos.map((photo) => importAsset(photo.file, paths.publicDir, 'product'));
          const preferred = sb.scenes.flatMap((scene, i) => (wantsMedia(scene, options.mediaCoverage ?? this.config.env.VIDEO_AGENT_MEDIA_COVERAGE) ? [i] : []));
          sb = { ...sb, scenes: placeProductPhotos(sb.scenes, srcs, planned.map((scene) => scene.productPhoto), preferred) };
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
    voiceProvider = this.meteredVoice(voiceProvider);
    let musicSource = 'none';
    storyboard = await step(
      'audio',
      'Voix-off et musique',
      async (progress) => {
        let sb = storyboard;
        if (voiceProvider) {
          const fallback = this.voiceFallback(voiceProvider, brief.locale, warnings);
          sb = await this.generateVoiceover(sb, brief, paths, voiceProvider, warnings, progress, signal, {
            gender: options.voiceGender,
            voiceId: options.voiceId,
            pronunciations: options.pronunciations,
            fallback,
            onSwitch: (voice) => (voiceProvider = voice),
          });
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
        storyboard = this.writeProject(storyboard, paths, brief, concept, options.skipRender ? undefined : path.basename(paths.videoFile(brief.outputFormat)));
      },
      () => path.relative(process.cwd(), paths.storyboardFile) || paths.storyboardFile,
    );

    // ---- 11. Render ------------------------------------------------------------------
    let render: RenderResult | undefined;
    if (options.skipRender) {
      skip('render', 'Rendu ignoré (--no-render)');
    } else {
      render = await step('render', 'Rendu Remotion', (progress) => this.render(storyboard, paths, brief.outputFormat, progress, signal), (r) => `${path.basename(r.file)} (${r.durationSec.toFixed(1)}s)`);
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

  /**
   * Targeted correction of a rendered video: copy it, let the model edit its storyboard, record the
   * voice-over of the changed sentences only, then render. Throws RevisionNotApplicable when the
   * request needs a brand-new video (the caller then runs the full pipeline).
   */
  async revise(request: RevisionRequest, runOptions: RunOptions = {}): Promise<VideoResult> {
    const { signal } = runOptions;
    const warnings: string[] = [];
    const llm = this.metered(this.deps.llm !== undefined ? this.deps.llm : safeResolve(() => resolveLLM(this.config), warnings));
    if (!llm) throw new RevisionNotApplicable('no LLM available to edit the storyboard');
    const paths = jobPaths(request.outDir);
    const steps = this.stepper(runOptions);
    const { step, skip } = steps;

    const { original, brief, concept, sourceVoice, photos } = await step(
      'analyze',
      'Reprise de la vidéo à corriger',
      () => {
        const loaded = this.copyRendered(request.sourceDir, paths);
        const photos = (request.productImages ?? [])
          .map((photo) => (typeof photo === 'string' ? { file: photo } : photo))
          .filter((photo) => fs.existsSync(photo.file))
          .map((photo) => ({ src: importAsset(photo.file, paths.publicDir, 'product'), description: photo.description || photo.name || path.basename(photo.file) }));
        return { ...loaded, photos };
      },
      ({ original }) => `${original.scenes.length} scènes reprises`,
    );
    for (const id of ['concept', 'storyboard', 'scenes', 'assets', 'animations'] as const) skip(id, 'conservé de la vidéo d’origine');

    const edited = await step(
      'script',
      'Correction du storyboard',
      async () => {
        const revision = await planRevision(llm, original, brief, request.instruction, photos, signal);
        if (!revision.feasible) throw new RevisionNotApplicable(revision.reason || 'the correction needs a new video');
        try {
          return applyRevision(original, revision, photos.map((photo) => photo.src));
        } catch (err) {
          throw new RevisionNotApplicable(errorMessage(err));
        }
      },
      ({ narrationChanged }) => `${narrationChanged.size} narration(s) modifiée(s)`,
    );
    const storyboard: Storyboard = { ...edited.storyboard, brand: { ...edited.storyboard.brand, badge: request.badge } };
    const voiced = await this.revoiceScenes(storyboard, original, brief, paths, edited.narrationChanged, sourceVoice, request, warnings, step, signal);
    return this.finishCorrection({ ...voiced, original, brief, concept, paths, steps, warnings, signal, planner: `${llm.id}:${llm.model}`, info: { correctionOf: path.basename(path.resolve(request.sourceDir)), instruction: request.instruction } });
  }

  /**
   * Pronunciation fix of a rendered video: the scenes whose narration contains one of the words are
   * recorded again with the same voice, everything else (texts, images, music) stays as it is.
   */
  async revoice(request: RevoiceRequest, runOptions: RunOptions = {}): Promise<VideoResult> {
    const { signal } = runOptions;
    const warnings: string[] = [];
    const paths = jobPaths(request.outDir);
    const steps = this.stepper(runOptions);
    const { step, skip } = steps;
    const { original, brief, concept, sourceVoice } = await step('analyze', 'Reprise de la vidéo', () => this.copyRendered(request.sourceDir, paths), ({ original }) => `${original.scenes.length} scènes reprises`);
    for (const id of ['concept', 'script', 'storyboard', 'scenes', 'assets', 'animations'] as const) skip(id, 'conservé de la vidéo d’origine');
    if (!original.scenes.some((scene) => scene.voiceover)) throw new VideoAgentError('Cette vidéo n’a pas de voix-off.', 'Activez la voix-off pour une nouvelle vidéo.');
    const affected = new Set(original.scenes.filter((scene) => mentionsAny(scene.narration.replace(/\*/g, ''), request.changed)).map((scene) => scene.id));
    if (!affected.size) throw new VideoAgentError(`« ${request.changed.map((entry) => entry.word).join(', ')} » n’est pas prononcé dans cette vidéo.`, 'Vérifiez l’orthographe du mot tel qu’il est écrit dans le script.');
    const storyboard: Storyboard = { ...original, brand: { ...original.brand, badge: request.badge } };
    const voiced = await this.revoiceScenes(storyboard, original, brief, paths, affected, sourceVoice, request, warnings, step, signal);
    return this.finishCorrection({ ...voiced, original, brief, concept, paths, steps, warnings, signal, planner: 'none', info: { correctionOf: path.basename(path.resolve(request.sourceDir)), pronunciations: request.changed } });
  }

  /** Copy a rendered job (not its outputs) to a new directory and read what a correction needs. */
  private copyRendered(sourceDir: string, paths: JobPaths) {
    const source = jobPaths(sourceDir);
    const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    const original = StoryboardSchema.parse(readJson(source.storyboardFile));
    const brief = readJson<VideoBrief>(source.briefFile);
    const concept = readJson<VideoConcept>(source.conceptFile);
    const job = fs.existsSync(source.jobFile) ? readJson<{ providers?: { voice?: string } }>(source.jobFile) : {};
    // Everything but the rendered outputs: media, voice-over and music are reused as they are.
    const outputs = /^(video|export)\.|^export\.tmp\.|^poster\.jpg$|^captions\.json$|^job\.json$|^credits\.md$/;
    fs.cpSync(source.dir, paths.dir, { recursive: true, filter: (file) => !(path.dirname(path.resolve(file)) === source.dir && outputs.test(path.basename(file))) });
    ensureJobDirs(paths);
    return { original, brief, concept, sourceVoice: job.providers?.voice && job.providers.voice !== 'none' ? job.providers.voice : undefined };
  }

  /** Record again the narration of some scenes, with the voice the video was made with. */
  private async revoiceScenes(
    storyboard: Storyboard,
    original: Storyboard,
    brief: VideoBrief,
    paths: JobPaths,
    scenes: Set<string>,
    sourceVoice: string | undefined,
    voiceOptions: { voiceGender?: VoiceGender; voiceId?: string; pronunciations?: Pronunciation[] },
    warnings: string[],
    step: ReturnType<VideoAgent['stepper']>['step'],
    signal?: AbortSignal,
  ): Promise<{ storyboard: Storyboard; voiceSource: string }> {
    const voiced = original.scenes.some((scene) => scene.voiceover);
    let voiceSource = voiced ? sourceVoice ?? 'reused' : 'none';
    const result = await step(
      'audio',
      'Voix-off des passages modifiés',
      async (progress) => {
        if (!voiced) return recomputeDuration(storyboard);
        let sb: Storyboard = { ...storyboard, scenes: storyboard.scenes.map((scene) => (scenes.has(scene.id) ? { ...scene, voiceover: undefined } : scene)) };
        if (scenes.size) {
          // The same voice as the rest of the video, so the corrected sentences do not stand out.
          const voice = this.meteredVoice(
            this.deps.voice !== undefined ? this.deps.voice : safeResolve(() => (sourceVoice ? resolveVoiceProvider(this.config, sourceVoice) : resolveVoiceProvider(this.config, undefined, brief.locale)), warnings),
          );
          if (voice) {
            voiceSource = voice.id;
            sb = await this.generateVoiceover(sb, brief, paths, voice, warnings, progress, signal, {
              only: scenes,
              gender: voiceOptions.voiceGender,
              voiceId: voiceOptions.voiceId,
              pronunciations: voiceOptions.pronunciations,
              fallback: this.voiceFallback(voice, brief.locale, warnings),
              onSwitch: (switched) => (voiceSource = switched.id),
            });
          } else warnings.push('no voice available: the corrected sentences have no voice-over');
        }
        return paceScenesToVoiceover(sb, { targetFrames: original.format.durationInFrames });
      },
      () => `voix-off : ${voiced && scenes.size ? `${scenes.size} scène(s) réenregistrée(s)` : 'inchangée'}`,
    );
    return { storyboard: result, voiceSource };
  }

  /** Subtitles, project files, render and job.json of a corrected copy. */
  private async finishCorrection(c: {
    storyboard: Storyboard;
    voiceSource: string;
    original: Storyboard;
    brief: VideoBrief;
    concept: VideoConcept;
    paths: JobPaths;
    steps: ReturnType<VideoAgent['stepper']>;
    warnings: string[];
    signal?: AbortSignal;
    planner: string;
    info: Record<string, unknown>;
  }): Promise<VideoResult> {
    const { paths, brief, concept, warnings, signal } = c;
    const { step, timings } = c.steps;
    let storyboard = await step('subtitles', 'Sous-titres', () => ({ ...c.storyboard, subtitles: { ...c.storyboard.subtitles, cues: c.original.subtitles.cues.length ? buildSubtitleCues(c.storyboard) : [] } }));
    for (const file of [paths.srtFile, paths.vttFile]) fs.rmSync(file, { force: true });
    storyboard = await step('project', 'Mise à jour du projet Remotion', () => this.writeProject(storyboard, paths, brief, concept, path.basename(paths.videoFile(brief.outputFormat))));
    const render = await step('render', 'Rendu Remotion', (progress) => this.render(storyboard, paths, brief.outputFormat, progress, signal), (r) => `${path.basename(r.file)} (${r.durationSec.toFixed(1)}s)`);

    return step(
      'output',
      'Finalisation',
      (): VideoResult => {
        const credits: MediaCredit[] = storyboard.scenes.flatMap((scene) => (scene.media?.credit ? [{ sceneId: scene.id, provider: scene.media.credit.source, author: scene.media.credit.author, url: scene.media.credit.url ?? '' }] : []));
        if (credits.length) fs.writeFileSync(path.join(paths.dir, 'credits.md'), ['# Crédits des médias', '', ...credits.map((cr) => `- ${cr.sceneId} : ${cr.author} — ${cr.provider} — ${cr.url}`), ''].join('\n'));
        const providers = { planner: c.planner, voice: c.voiceSource, image: 'none', stock: 'none', video: 'none', music: 'reused' };
        writeJson(paths.jobFile, {
          id: paths.id,
          ...c.info,
          status: 'completed',
          createdAt: new Date().toISOString(),
          videoFile: path.basename(render.file),
          posterFile: render.posterFile && path.basename(render.posterFile),
          providers,
          warnings,
          timingsMs: timings,
        });
        return { jobId: paths.id, jobDir: paths.dir, videoFile: render.file, posterFile: render.posterFile, storyboardFile: paths.storyboardFile, storyboard, brief, concept, warnings, providers, credits, timingsMs: timings };
      },
      (r) => r.videoFile ?? r.storyboardFile,
    );
  }

  private metered(llm: LLMProvider | null): LLMProvider | null {
    return llm && this.deps.meter ? this.deps.meter.llm(llm) : llm;
  }

  private meteredVoice(voice: VoiceProvider | null): VoiceProvider | null {
    if (!voice || !this.deps.meter) return voice;
    const env = this.config.env;
    return this.deps.meter.voice(voice, voice.id === 'elevenlabs' ? env.ELEVENLABS_MODEL : voice.id === 'openai' ? env.OPENAI_TTS_MODEL : undefined);
  }

  private meteredImage(image: ImageProvider | null): ImageProvider | null {
    if (!image || !this.deps.meter) return image;
    const env = this.config.env;
    const models: Record<string, string | undefined> = { cloudflare: env.CLOUDFLARE_IMAGE_MODEL, huggingface: env.HF_IMAGE_MODEL, openai: env.OPENAI_IMAGE_MODEL, replicate: env.REPLICATE_IMAGE_MODEL, stability: env.STABILITY_MODEL };
    return this.deps.meter.image(image, models[image.id]);
  }

  private render(storyboard: Storyboard, paths: JobPaths, outputFormat: VideoBrief['outputFormat'], progress: (p: number, msg?: string) => void, signal?: AbortSignal): Promise<RenderResult> {
    const renderer = this.deps.renderer ?? renderStoryboard;
    return renderer({
      storyboard,
      publicDir: paths.publicDir,
      outputFile: paths.videoFile(outputFormat),
      outputFormat,
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
    });
  }

  /** Validate the storyboard and write it with the files derived from it (props, script, subtitles, README). */
  private writeProject(storyboard: Storyboard, paths: JobPaths, brief: VideoBrief, concept: VideoConcept, videoName: string | undefined): Storyboard {
    const validation = validateStoryboard(storyboard, { publicDir: paths.publicDir, requireEvenDimensions: brief.outputFormat !== 'gif' });
    validation.warnings.forEach((w) => this.logger.debug(`storyboard: ${w}`));
    if (!validation.valid) throw new StoryboardValidationError(validation.errors);
    const valid = validation.storyboard!;
    writeJson(paths.storyboardFile, valid);
    writeJson(paths.propsFile, { storyboard: valid });
    fs.writeFileSync(paths.scriptFile, scriptMarkdown(brief, concept, valid));
    if (valid.subtitles.cues.length) {
      fs.writeFileSync(paths.srtFile, toSrt(valid.subtitles.cues, valid.format.fps));
      fs.writeFileSync(paths.vttFile, toVtt(valid.subtitles.cues, valid.format.fps));
    }
    fs.writeFileSync(paths.readmeFile, jobReadme(paths.dir, valid, videoName, this.config.paths.root));
    return valid;
  }

  /**
   * Record the narration of every scene. When the voice fails (no credit, a voice the account cannot
   * use, a network error), the whole video is recorded again with the fallback voice: a video always
   * keeps a voice-over, and always a single one.
   */
  private async generateVoiceover(
    storyboard: Storyboard,
    brief: VideoBrief,
    paths: JobPaths,
    provider: VoiceProvider,
    warnings: string[],
    progress: (p: number, msg?: string) => void,
    signal?: AbortSignal,
    opts: VoiceoverOptions = {},
  ): Promise<Storyboard> {
    const fps = storyboard.format.fps;
    let scenes = [...storyboard.scenes];
    let only = opts.only;
    let voice = provider;
    let attempted = 0;
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i]!;
      const text = applyPronunciations(scene.narration.replace(/\*/g, ''), opts.pronunciations).trim();
      if (!text || (only && !only.has(scene.id))) continue;
      attempted++;
      progress(i / scenes.length, `Voix-off ${i + 1}/${scenes.length}`);
      const outFile = path.join(paths.publicDir, 'voice', `${scene.id}.wav`);
      try {
        let { durationSec } = await voice.synthesize({ text, language: brief.locale, outFile, signal, gender: opts.gender, voiceId: voice === provider ? opts.voiceId : undefined });
        // TTS engines pad sentences with silence: trim it so the voice starts right on cue.
        if (fs.existsSync(outFile)) {
          const trimmed = trimWavSilence(fs.readFileSync(outFile));
          fs.writeFileSync(outFile, trimmed);
          durationSec = wavDurationSec(trimmed);
        }
        scenes[i] = { ...scene, voiceover: { src: `voice/${scene.id}.wav`, durationInFrames: Math.max(1, Math.ceil(durationSec * fps)), volume: 1 } };
      } catch (err) {
        if (signal?.aborted) throw err;
        warnings.push(`voice-over failed for ${scene.id} (${voice.id}): ${errorMessage(err)}`);
        if (opts.fallback && voice !== opts.fallback) {
          warnings.push(`voice-over recorded again with ${opts.fallback.id}`);
          voice = opts.fallback;
          opts.onSwitch?.(voice);
          scenes = [...storyboard.scenes];
          only = undefined;
          attempted = 0;
          i = -1;
          continue;
        }
        if (attempted === 1) {
          // Most likely a configuration problem: do not retry for every scene.
          warnings.push('voice-over disabled for this video');
          break;
        }
      }
    }
    return { ...storyboard, scenes };
  }

  /** Free voice used when the chosen one fails: Piper when installed, else the MMS voices. */
  private voiceFallback(primary: VoiceProvider | null, locale: string, warnings: string[]): VoiceProvider | null {
    if (this.deps.voiceFallback !== undefined) return this.meteredVoice(this.deps.voiceFallback);
    if (!primary || this.deps.voice !== undefined) return null;
    for (const id of ['piper', 'mms']) {
      if (id === primary.id || (id === 'piper' && !isPiperInstalled(this.config))) continue;
      const candidate = safeResolve(() => resolveVoiceProvider(this.config, id), warnings);
      if (candidate && candidate.supports?.(locale) !== false) return this.meteredVoice(candidate);
    }
    return null;
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
    const resolved = this.deps.music !== undefined ? this.deps.music : safeResolve(() => resolveMusicProvider(this.config), warnings);
    const ai = resolved && this.deps.meter ? this.deps.meter.music(resolved) : resolved;
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
