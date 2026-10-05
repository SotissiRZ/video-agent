import fs from 'node:fs';
import { ProviderError } from '../../core/errors';
import { httpJson } from '../http';
import type { ImageProvider, ImageRequest } from './types';

/** OpenAI Images API (gpt-image-1 by default). */
export class OpenAIImageProvider implements ImageProvider {
  readonly id = 'openai';
  constructor(private readonly opts: { apiKey: string; baseUrl: string; model: string }) {}

  async generate(req: ImageRequest): Promise<{ file: string }> {
    const size = req.width > req.height * 1.1 ? '1536x1024' : req.height > req.width * 1.1 ? '1024x1536' : '1024x1024';
    const res = await httpJson<{ data?: Array<{ b64_json?: string }> }>(`${this.opts.baseUrl.replace(/\/+$/, '')}/images/generations`, {
      provider: this.id,
      headers: { authorization: `Bearer ${this.opts.apiKey}` },
      body: { model: this.opts.model, prompt: req.prompt, size, n: 1 },
      timeoutMs: 180_000,
      signal: req.signal,
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError(this.id, 'no image returned');
    const file = `${req.outFileBase}.png`;
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    return { file };
  }
}
