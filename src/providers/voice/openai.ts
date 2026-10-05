import fs from 'node:fs';
import { wavDurationSec } from '../../audio/wav';
import { httpBuffer } from '../http';
import type { VoiceProvider, VoiceRequest, VoiceResult } from './types';

/** OpenAI text-to-speech (/v1/audio/speech), WAV output. */
export class OpenAIVoiceProvider implements VoiceProvider {
  readonly id = 'openai';
  constructor(private readonly opts: { apiKey: string; baseUrl: string; model: string; voice: string }) {}

  async synthesize(req: VoiceRequest): Promise<VoiceResult> {
    const audio = await httpBuffer(`${this.opts.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
      provider: this.id,
      headers: { authorization: `Bearer ${this.opts.apiKey}` },
      body: { model: this.opts.model, voice: this.opts.voice, input: req.text, response_format: 'wav' },
      timeoutMs: 120_000,
      signal: req.signal,
    });
    fs.writeFileSync(req.outFile, audio);
    return { file: req.outFile, durationSec: wavDurationSec(audio) };
  }
}
