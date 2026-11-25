import fs from 'node:fs';
import { ProviderError } from '../../core/errors';
import { httpJson } from '../http';
import type { ImageProvider, ImageRequest } from './types';

/**
 * Models that take the picture's size. FLUX.1 schnell does not (prompt and steps only): it returns a
 * 1024 px square that a 1080×1920 vertical video has to blow up ~1.9× and crop, which looks soft.
 */
const SIZED_MODELS: Record<string, number> = {
  '@cf/leonardo/lucid-origin': 2500,
  '@cf/leonardo/phoenix-1.0': 2048,
};

/** Exact frame size when the model allows it (multiple of 8, within the model's maximum, same ratio). */
export const cloudflareSize = (model: string, width: number, height: number): { width: number; height: number } | undefined => {
  const max = SIZED_MODELS[model];
  if (!max) return undefined;
  const scale = Math.min(1, max / Math.max(width, height));
  const round8 = (n: number) => Math.max(256, Math.round((n * scale) / 8) * 8);
  return { width: round8(width), height: round8(height) };
};

/**
 * Cloudflare Workers AI — free daily allowance. Default model: Leonardo Lucid Origin, generated at
 * the video's own size (sharp in vertical); FLUX.1 schnell stays available (cheaper, square only).
 * Needs an account id and an API token with the "Workers AI" permission.
 */
export class CloudflareImageProvider implements ImageProvider {
  readonly id = 'cloudflare';
  constructor(private readonly o: { accountId: string; apiToken: string; model: string }) {}

  async generate(req: ImageRequest): Promise<{ file: string }> {
    const size = cloudflareSize(this.o.model, req.width, req.height);
    // FLUX.1 schnell: 8 steps (its maximum) instead of 4 for finer detail.
    const body = size ? { prompt: req.prompt, width: size.width, height: size.height } : { prompt: req.prompt, steps: 8 };
    const res = await httpJson<{ success?: boolean; result?: { image?: string }; errors?: Array<{ message: string }> }>(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.o.accountId)}/ai/run/${this.o.model}`,
      { provider: this.id, headers: { authorization: `Bearer ${this.o.apiToken}` }, body, timeoutMs: 180_000, signal: req.signal },
    );
    const b64 = res.result?.image;
    if (!b64) throw new ProviderError(this.id, `no image returned${res.errors?.length ? `: ${res.errors.map((e) => e.message).join('; ')}` : ''}`);
    const file = `${req.outFileBase}.jpg`;
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return { file };
  }
}
