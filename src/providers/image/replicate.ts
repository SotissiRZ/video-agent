import fs from 'node:fs';
import { downloadTo, runReplicate } from '../replicate';
import { aspectRatio, type ImageProvider, type ImageRequest } from './types';

/** Any Replicate text-to-image model accepting { prompt, aspect_ratio } (FLUX, SDXL...). */
export class ReplicateImageProvider implements ImageProvider {
  readonly id = 'replicate';
  constructor(private readonly opts: { token: string; model: string }) {}

  async generate(req: ImageRequest): Promise<{ file: string }> {
    const url = await runReplicate(
      this.opts.token,
      this.opts.model,
      { prompt: req.prompt, aspect_ratio: aspectRatio(req.width, req.height), output_format: 'png' },
      { provider: this.id, timeoutMs: 180_000, signal: req.signal },
    );
    const ext = (/\.(png|jpe?g|webp)(?:\?|$)/i.exec(url)?.[1] ?? 'png').toLowerCase();
    const file = `${req.outFileBase}.${ext}`;
    fs.writeFileSync(file, await downloadTo(url, this.id, req.signal));
    return { file };
  }
}
