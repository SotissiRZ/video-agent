import fs from 'node:fs';
import { pcm16ToWav, wavDurationSec } from '../../audio/wav';
import { httpBuffer } from '../http';
import { getLanguage } from '../../core/languages';
import type { VoiceProvider, VoiceRequest, VoiceResult } from './types';

const SAMPLE_RATE = 22050;

/** ElevenLabs text-to-speech, requested as raw PCM and wrapped in WAV. */
export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly id = 'elevenlabs';
  constructor(private readonly opts: { apiKey: string; voiceId: string; maleVoiceId?: string; model: string }) {}

  private voiceFor(req: VoiceRequest): string {
    if (req.voiceId) return req.voiceId;
    return req.gender === 'male' && this.opts.maleVoiceId ? this.opts.maleVoiceId : this.opts.voiceId;
  }

  supports(language: string): boolean {
    const info = getLanguage(language);
    return info ? Boolean(info.elevenlabs) : true;
  }

  async synthesize(req: VoiceRequest): Promise<VoiceResult> {
    const pcm = await httpBuffer(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceFor(req))}?output_format=pcm_${SAMPLE_RATE}`,
      {
        provider: this.id,
        headers: { 'xi-api-key': this.opts.apiKey, accept: 'audio/pcm' },
        body: { text: req.text, model_id: this.opts.model },
        timeoutMs: 120_000,
        signal: req.signal,
      },
    );
    const wav = pcm16ToWav(pcm, SAMPLE_RATE);
    fs.writeFileSync(req.outFile, wav);
    return { file: req.outFile, durationSec: wavDurationSec(wav) };
  }
}
