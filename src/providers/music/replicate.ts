/** Meta MusicGen on Replicate (pay per second of GPU, a few cents per track). */
import { downloadTo, runReplicate } from '../replicate';
import type { MusicProvider, MusicRequest, MusicResult } from './types';

export class ReplicateMusicProvider implements MusicProvider {
  readonly id = 'replicate';
  readonly maxDurationSec = 30;
  constructor(private readonly opts: { token: string; model: string }) {}

  async generate(req: MusicRequest): Promise<MusicResult> {
    const durationSec = Math.max(5, Math.min(this.maxDurationSec, Math.round(req.durationSec)));
    const url = await runReplicate(
      this.opts.token,
      this.opts.model,
      { prompt: req.prompt, duration: durationSec, model_version: 'stereo-large', output_format: 'mp3', normalization_strategy: 'peak' },
      { timeoutMs: 300_000, signal: req.signal, provider: 'replicate-music' },
    );
    return { audio: await downloadTo(url, 'replicate-music', req.signal), extension: 'mp3', durationSec };
  }
}
