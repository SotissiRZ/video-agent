import fs from 'node:fs';
import { aspectRatio } from '../image/types';
import { downloadTo, runReplicate } from '../replicate';
import type { VideoClipRequest, VideoProvider } from './types';

/** Any Replicate text-to-video model accepting { prompt } (+ aspect_ratio when supported). */
export class ReplicateVideoProvider implements VideoProvider {
  readonly id = 'replicate';
  constructor(private readonly opts: { token: string; model: string }) {}

  async generate(req: VideoClipRequest): Promise<{ file: string }> {
    const url = await runReplicate(
      this.opts.token,
      this.opts.model,
      { prompt: req.prompt, aspect_ratio: aspectRatio(req.width, req.height) },
      { provider: this.id, timeoutMs: 15 * 60_000, signal: req.signal },
    );
    const file = `${req.outFileBase}.mp4`;
    fs.writeFileSync(file, await downloadTo(url, this.id, req.signal));
    return { file };
  }
}
