/** Stability AI Stable Audio 2 (up to 190 s, credits per track). */
import { ProviderError } from '../../core/errors';
import { withTimeout } from '../http';
import type { MusicProvider, MusicRequest, MusicResult } from './types';

export class StabilityMusicProvider implements MusicProvider {
  readonly id = 'stability';
  readonly maxDurationSec = 190;
  constructor(private readonly opts: { apiKey: string }) {}

  async generate(req: MusicRequest): Promise<MusicResult> {
    const durationSec = Math.max(5, Math.min(this.maxDurationSec, Math.ceil(req.durationSec)));
    const form = new FormData();
    form.set('prompt', req.prompt);
    form.set('duration', String(durationSec));
    form.set('output_format', 'mp3');
    const res = await fetch('https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.opts.apiKey}`, accept: 'audio/*' },
      body: form,
      signal: withTimeout(300_000, req.signal),
    }).catch((err: Error) => {
      throw new ProviderError('stability-music', `request failed: ${err.message}`);
    });
    if (!res.ok) throw new ProviderError('stability-music', `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    return { audio: Buffer.from(await res.arrayBuffer()), extension: 'mp3', durationSec };
  }
}
