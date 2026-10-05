import fs from 'node:fs';
import { httpBuffer } from '../http';
import type { ImageProvider, ImageRequest } from './types';

/** Hugging Face Inference Providers — free monthly credits with a (free) access token. */
export class HuggingFaceImageProvider implements ImageProvider {
  readonly id = 'huggingface';
  constructor(private readonly o: { token: string; model: string }) {}

  async generate(req: ImageRequest): Promise<{ file: string }> {
    // Sizes must be multiples of 16; keep the aspect ratio of the video around 1 megapixel.
    const scale = Math.sqrt((1024 * 1024) / (req.width * req.height));
    const round16 = (n: number) => Math.max(256, Math.round((n * scale) / 16) * 16);
    const image = await httpBuffer(`https://router.huggingface.co/hf-inference/models/${this.o.model}`, {
      provider: this.id,
      headers: { authorization: `Bearer ${this.o.token}`, accept: 'image/png' },
      body: { inputs: req.prompt, parameters: { width: round16(req.width), height: round16(req.height) } },
      timeoutMs: 180_000,
      signal: req.signal,
    });
    const file = `${req.outFileBase}.png`;
    fs.writeFileSync(file, image);
    return { file };
  }
}
