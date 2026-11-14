import fs from 'node:fs';
import { aspectRatio } from '../image/types';
import { downloadTo, runReplicate } from '../replicate';
import type { VideoClipRequest, VideoProvider } from './types';

/** Veo clips last 4, 6 or 8 seconds: the shortest one covering the shot (it loops when shorter). */
export const veoDuration = (seconds: number): 4 | 6 | 8 => (seconds <= 4 ? 4 : seconds <= 6 ? 6 : 8);

/**
 * Inputs for the model. Google Veo 3.1 (default: veo-3.1-fast): 9:16 or 16:9, 1080p, no audio
 * (SOVID mixes its own voice, music and sound design, and audio costs half as much again).
 * Any other Replicate text-to-video model: { prompt, aspect_ratio }.
 */
export const replicateVideoInput = (model: string, req: VideoClipRequest): { input: Record<string, unknown>; seconds?: number } => {
  if (model.startsWith('google/veo')) {
    const duration = veoDuration(req.durationSec);
    return {
      input: {
        prompt: req.prompt,
        aspect_ratio: req.height > req.width ? '9:16' : '16:9',
        duration,
        resolution: '1080p',
        generate_audio: false,
        negative_prompt: 'text, subtitles, captions, watermark, logo, cartoon, illustration, CGI look, distorted faces, extra fingers, low quality',
      },
      seconds: duration,
    };
  }
  return { input: { prompt: req.prompt, aspect_ratio: aspectRatio(req.width, req.height) } };
};

/** Text-to-video on Replicate (Google Veo 3.1 Fast by default). */
export class ReplicateVideoProvider implements VideoProvider {
  readonly id = 'replicate';
  constructor(private readonly opts: { token: string; model: string }) {}

  get model(): string {
    return this.opts.model;
  }

  async generate(req: VideoClipRequest): Promise<{ file: string; seconds?: number }> {
    const { input, seconds } = replicateVideoInput(this.opts.model, req);
    const url = await runReplicate(this.opts.token, this.opts.model, input, { provider: this.id, timeoutMs: 15 * 60_000, signal: req.signal });
    const file = `${req.outFileBase}.mp4`;
    fs.writeFileSync(file, await downloadTo(url, this.id, req.signal));
    return { file, seconds: seconds ?? req.durationSec };
  }
}
