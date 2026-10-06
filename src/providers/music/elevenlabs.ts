/** ElevenLabs Music (10 s to 5 min, studio quality, paid plans). */
import { httpBuffer } from '../http';
import type { MusicProvider, MusicRequest, MusicResult } from './types';

export class ElevenLabsMusicProvider implements MusicProvider {
  readonly id = 'elevenlabs';
  readonly maxDurationSec = 300;
  constructor(private readonly opts: { apiKey: string }) {}

  async generate(req: MusicRequest): Promise<MusicResult> {
    const durationSec = Math.max(10, Math.min(this.maxDurationSec, Math.ceil(req.durationSec)));
    const audio = await httpBuffer('https://api.elevenlabs.io/v1/music', {
      provider: 'elevenlabs-music',
      headers: { 'xi-api-key': this.opts.apiKey, accept: 'audio/mpeg' },
      body: { prompt: req.prompt, music_length_ms: durationSec * 1000, model_id: 'music_v1', force_instrumental: true },
      signal: req.signal,
      timeoutMs: 300_000,
    });
    return { audio, extension: 'mp3', durationSec };
  }
}
