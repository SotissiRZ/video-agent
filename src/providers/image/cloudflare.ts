import fs from 'node:fs';
import { ProviderError } from '../../core/errors';
import { httpJson } from '../http';
import type { ImageProvider, ImageRequest } from './types';

/**
 * Cloudflare Workers AI — free daily allowance (FLUX.1 schnell by default).
 * Needs an account id and an API token with the "Workers AI" permission.
 */
export class CloudflareImageProvider implements ImageProvider {
  readonly id = 'cloudflare';
  constructor(private readonly o: { accountId: string; apiToken: string; model: string }) {}

  async generate(req: ImageRequest): Promise<{ file: string }> {
    const res = await httpJson<{ success?: boolean; result?: { image?: string }; errors?: Array<{ message: string }> }>(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.o.accountId)}/ai/run/${this.o.model}`,
      { provider: this.id, headers: { authorization: `Bearer ${this.o.apiToken}` }, body: { prompt: req.prompt, steps: 4 }, timeoutMs: 180_000, signal: req.signal },
    );
    const b64 = res.result?.image;
    if (!b64) throw new ProviderError(this.id, `no image returned${res.errors?.length ? `: ${res.errors.map((e) => e.message).join('; ')}` : ''}`);
    const file = `${req.outFileBase}.jpg`;
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return { file };
  }
}
