import fs from 'node:fs';
import { ProviderError } from '../../core/errors';
import { httpBuffer, httpJson, sleep } from '../http';
import type { VideoClipRequest, VideoProvider } from './types';

export const OPENROUTER_VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'] as const;
export type OpenRouterVideoResolution = (typeof OPENROUTER_VIDEO_RESOLUTIONS)[number];

interface VideoJob {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired';
  error?: string | null;
  unsigned_urls?: string[];
  usage?: { cost?: number | null };
}

/** Shapes the video models take (Wan 3.0: 16:9, 4:3, 1:1, 3:4, 9:16, 21:9). */
export const openRouterAspect = (width: number, height: number): string => {
  const r = width / height;
  const options: Array<[string, number]> = [['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['3:4', 3 / 4], ['9:16', 9 / 16]];
  return options.reduce((best, cur) => (Math.abs(cur[1] - r) < Math.abs(best[1] - r) ? cur : best))[0];
};

/** A whole number of seconds covering the shot, within what the models accept (2–30 s). */
export const openRouterDuration = (seconds: number): number => Math.min(30, Math.max(2, Math.ceil(seconds - 0.05)));

/**
 * Text-to-video through OpenRouter (Wan 3.0 by default; Veo, Kling, Seedance… with the same key).
 * The job is asynchronous: submit, poll until done, then download the clip with the key. No audio:
 * SOVID mixes its own voice, music and sound design.
 */
export class OpenRouterVideoProvider implements VideoProvider {
  readonly id = 'openrouter';
  constructor(private readonly opts: { apiKey: string; model: string; resolution: OpenRouterVideoResolution; baseUrl?: string; pollMs?: number; timeoutMs?: number }) {}

  /** Model and resolution: the price per second depends on both. */
  get model(): string {
    return `${this.opts.model}@${this.opts.resolution}`;
  }

  async generate(req: VideoClipRequest): Promise<{ file: string; seconds?: number }> {
    const base = (this.opts.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    const headers = { authorization: `Bearer ${this.opts.apiKey}` };
    const duration = openRouterDuration(req.durationSec);
    let job = await httpJson<VideoJob>(`${base}/videos`, {
      provider: this.id,
      headers,
      body: { model: this.opts.model, prompt: req.prompt, duration, resolution: this.opts.resolution, aspect_ratio: openRouterAspect(req.width, req.height), generate_audio: false },
      signal: req.signal,
      timeoutMs: 90_000,
    });
    if (!job.id) throw new ProviderError(this.id, 'no job id returned');
    const deadline = Date.now() + (this.opts.timeoutMs ?? 15 * 60_000);
    while (job.status !== 'completed') {
      if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'expired') throw new ProviderError(this.id, `video ${job.status}: ${job.error ?? 'unknown error'}`);
      if (Date.now() > deadline) throw new ProviderError(this.id, `video ${job.id} timed out`);
      await sleep(this.opts.pollMs ?? 10_000, req.signal);
      job = await httpJson<VideoJob>(`${base}/videos/${encodeURIComponent(job.id)}`, { provider: this.id, headers, signal: req.signal, timeoutMs: 60_000 });
    }
    // The download links are not presigned: they take the key too.
    const url = job.unsigned_urls?.[0] ?? `${base}/videos/${encodeURIComponent(job.id)}/content?index=0`;
    const file = `${req.outFileBase}.mp4`;
    fs.writeFileSync(file, await httpBuffer(url, { provider: this.id, headers, signal: req.signal, timeoutMs: 300_000 }));
    return { file, seconds: duration };
  }
}
