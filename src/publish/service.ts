/**
 * Publishes a rendered job to social platforms.
 *  - captions.json in the job holds the text for each platform (generated once, editable);
 *  - each platform is validated (format, duration, size) before upload;
 *  - a future date uses native scheduling (YouTube, Facebook) or the local scheduler (others);
 *  - every attempt is appended to publish.json in the job.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/config';
import { errorMessage, VideoAgentError } from '../core/errors';
import type { VideoBrief, VideoConcept } from '../core/types';
import type { LLMProvider } from '../llm/types';
import type { MediaCredit } from '../media/director';
import { StoryboardSchema, type Storyboard } from '../remotion/contract/storyboard';
import { generateCaptions } from './captions';
import { checkVideoForPlatform, PLATFORM_CONSTRAINTS } from './constraints';
import { createPublisher } from './registry';
import { ScheduleStore } from './scheduler';
import { composeText, type Captions, type PlatformId, type PostContent, type Publisher, type PublishResult } from './types';

export interface LoadedJob {
  dir: string;
  videoFile: string;
  posterFile?: string;
  storyboard: Storyboard;
  brief: VideoBrief;
  concept: VideoConcept;
  credits: MediaCredit[];
}

export const loadJob = (jobDir: string): LoadedJob => {
  const dir = path.resolve(jobDir);
  const read = <T>(name: string): T => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) throw new VideoAgentError(`${name} introuvable dans ${dir}`, 'Indiquez le dossier d’une vidéo générée (output/<job>).');
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  };
  const storyboard = StoryboardSchema.parse(read('storyboard.json'));
  const job = fs.existsSync(path.join(dir, 'job.json')) ? read<{ videoFile?: string; posterFile?: string }>('job.json') : {};
  const videoName = job.videoFile ?? fs.readdirSync(dir).find((f) => /^video\.(mp4|mov|webm|gif)$/.test(f));
  if (!videoName || !fs.existsSync(path.join(dir, videoName))) throw new VideoAgentError(`Aucune vidéo rendue dans ${dir}`, 'Lancez "video-agent render <job>" d’abord.');
  const credits = storyboard.scenes.flatMap((s) => (s.media?.credit ? [{ sceneId: s.id, provider: s.media.credit.source, author: s.media.credit.author, url: s.media.credit.url ?? '' }] : []));
  const poster = job.posterFile ?? 'poster.jpg';
  return {
    dir,
    videoFile: path.join(dir, videoName),
    posterFile: fs.existsSync(path.join(dir, poster)) ? path.join(dir, poster) : undefined,
    storyboard,
    brief: read<VideoBrief>('brief.json'),
    concept: read<VideoConcept>('concept.json'),
    credits,
  };
};

const captionsFile = (dir: string) => path.join(dir, 'captions.json');

/** Load captions.json, generating the missing platforms (LLM if available). */
export const ensureCaptions = async (config: AppConfig, job: LoadedJob, platforms: PlatformId[], opts: { llm: LLMProvider | null; regenerate?: boolean; warnings?: string[]; signal?: AbortSignal }): Promise<Captions> => {
  const file = captionsFile(job.dir);
  const existing: Captions = !opts.regenerate && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const missing = platforms.filter((p) => !existing[p]);
  if (missing.length) {
    const { captions } = await generateCaptions(
      { brief: job.brief, concept: job.concept, durationSec: job.storyboard.format.durationInFrames / job.storyboard.format.fps, credits: job.credits, includeCredits: config.env.VIDEO_AGENT_CAPTION_CREDITS },
      missing,
      opts.llm,
      opts.warnings,
      opts.signal,
    );
    Object.assign(existing, captions);
    fs.writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`);
  }
  return existing;
};

export const saveCaptions = (jobDir: string, captions: Captions): void => {
  fs.writeFileSync(captionsFile(jobDir), `${JSON.stringify(captions, null, 2)}\n`);
};

export interface PublishOutcome {
  platform: PlatformId;
  ok: boolean;
  status: PublishResult['status'] | 'scheduled-local' | 'dry-run' | 'failed';
  url?: string;
  id?: string;
  message?: string;
  warnings: string[];
  /** Exact text that is / would be published. */
  text: string;
}

export interface PublishJobOptions {
  platforms: PlatformId[];
  at?: Date;
  dryRun?: boolean;
  regenerateCaptions?: boolean;
  llm?: LLMProvider | null;
  signal?: AbortSignal;
  onProgress?: (platform: PlatformId, message: string) => void;
  /** Test seam. */
  publisherFactory?: (id: PlatformId) => Publisher;
  scheduleStore?: ScheduleStore;
}

export const publishJob = async (config: AppConfig, jobDir: string, opts: PublishJobOptions): Promise<{ outcomes: PublishOutcome[]; warnings: string[] }> => {
  const job = loadJob(jobDir);
  const warnings: string[] = [];
  const platforms = [...new Set(opts.platforms)];
  if (!platforms.length) throw new VideoAgentError('Aucune plateforme indiquée', 'Exemple : --to tiktok,instagram,youtube');
  const captions = await ensureCaptions(config, job, platforms, { llm: opts.llm ?? null, regenerate: opts.regenerateCaptions, warnings, signal: opts.signal });
  const { width, height, fps, durationInFrames } = job.storyboard.format;
  const durationSec = durationInFrames / fps;
  const video = { width, height, durationSec, sizeBytes: fs.statSync(job.videoFile).size, container: path.extname(job.videoFile).slice(1) };
  const future = opts.at && opts.at.getTime() > Date.now() + 60_000 ? opts.at : undefined;
  const outcomes: PublishOutcome[] = [];
  const localSchedule: PlatformId[] = [];

  for (const platform of platforms) {
    const content: PostContent = captions[platform]!;
    const text = composeText(content, PLATFORM_CONSTRAINTS[platform].maxCaption);
    const check = checkVideoForPlatform(platform, video);
    if (check.errors.length) {
      outcomes.push({ platform, ok: false, status: 'failed', message: check.errors.join('; '), warnings: check.warnings, text });
      continue;
    }
    if (opts.dryRun) {
      outcomes.push({ platform, ok: true, status: 'dry-run', message: future ? `serait programmée le ${future.toISOString()}` : 'serait publiée maintenant', warnings: check.warnings, text });
      continue;
    }
    if (future && !PLATFORM_CONSTRAINTS[platform].nativeScheduling) {
      localSchedule.push(platform);
      outcomes.push({ platform, ok: true, status: 'scheduled-local', message: `programmée le ${future.toISOString()} (planificateur local : "video-agent scheduler" ou "video-agent web" doit tourner)`, warnings: check.warnings, text });
      continue;
    }
    try {
      const publisher = opts.publisherFactory ? opts.publisherFactory(platform) : createPublisher(config, platform);
      const result = await publisher.publish({
        videoFile: job.videoFile,
        posterFile: job.posterFile,
        content,
        width,
        height,
        durationSec,
        language: job.brief.language,
        scheduledAt: future,
        signal: opts.signal,
        onProgress: (m) => opts.onProgress?.(platform, m),
      });
      outcomes.push({ platform, ok: true, status: result.status, url: result.url, id: result.id, message: result.message, warnings: check.warnings, text });
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      const hint = err instanceof VideoAgentError && err.hint ? ` — ${err.hint}` : '';
      outcomes.push({ platform, ok: false, status: 'failed', message: `${errorMessage(err)}${hint}`, warnings: check.warnings, text });
    }
  }

  if (localSchedule.length && future) {
    (opts.scheduleStore ?? ScheduleStore.forConfig(config)).add({ jobDir: job.dir, platforms: localSchedule, at: future.toISOString() });
  }
  if (!opts.dryRun) appendHistory(job.dir, outcomes);
  return { outcomes, warnings };
};

const appendHistory = (dir: string, outcomes: PublishOutcome[]) => {
  const file = path.join(dir, 'publish.json');
  const history: unknown[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  history.push({ at: new Date().toISOString(), outcomes: outcomes.map(({ text: _text, ...o }) => o) });
  fs.writeFileSync(file, `${JSON.stringify(history, null, 2)}\n`);
};
