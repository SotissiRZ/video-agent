import fs from 'node:fs';
import { ProviderError } from '../../core/errors';
import { withTimeout } from '../http';
import { aspectRatio, type ImageProvider, type ImageRequest } from './types';

/** Stability AI Stable Image (https://platform.stability.ai) — "core" or "ultra" endpoints. */
export class StabilityImageProvider implements ImageProvider {
  readonly id = 'stability';
  constructor(private readonly opts: { apiKey: string; model: 'core' | 'ultra' | 'sd3' }) {}

  async generate(req: ImageRequest): Promise<{ file: string }> {
    const form = new FormData();
    form.set('prompt', req.prompt);
    form.set('aspect_ratio', aspectRatio(req.width, req.height));
    form.set('output_format', 'png');
    let res: Response;
    try {
      res = await fetch(`https://api.stability.ai/v2beta/stable-image/generate/${this.opts.model}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.opts.apiKey}`, accept: 'image/*' },
        body: form,
        signal: withTimeout(180_000, req.signal),
      });
    } catch (err) {
      throw new ProviderError(this.id, `request failed: ${(err as Error).message}`, undefined, { cause: err });
    }
    if (!res.ok) throw new ProviderError(this.id, `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`, res.status === 401 ? 'Check STABILITY_API_KEY.' : undefined);
    const file = `${req.outFileBase}.png`;
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return { file };
  }
}
