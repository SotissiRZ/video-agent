/**
 * Meta MMS text-to-speech (1,100+ languages: Wolof, Bambara, Hausa, Yoruba, Lingala...)
 * through the Hugging Face inference API. Experimental: quality varies by language and
 * not every model is always deployed.
 */
import fs from 'node:fs';
import { toWav } from '../../audio/ffmpeg';
import { wavDurationSec } from '../../audio/wav';
import { ProviderError } from '../../core/errors';
import { getLanguage } from '../../core/languages';
import { httpBuffer } from '../http';
import type { VoiceProvider, VoiceRequest, VoiceResult } from './types';

export class MmsVoiceProvider implements VoiceProvider {
  readonly id = 'mms';
  constructor(private readonly opts: { token: string }) {}

  supports(language: string): boolean {
    return Boolean(getLanguage(language)?.mms);
  }

  async synthesize(req: VoiceRequest): Promise<VoiceResult> {
    const iso = getLanguage(req.language)?.mms;
    if (!iso) throw new ProviderError(this.id, `no MMS voice for "${req.language}"`);
    const audio = await httpBuffer(`https://router.huggingface.co/hf-inference/models/facebook/mms-tts-${iso}`, {
      provider: this.id,
      headers: { authorization: `Bearer ${this.opts.token}`, accept: 'audio/wav, audio/flac, audio/*' },
      body: { inputs: req.text.replace(/\*/g, '') },
      timeoutMs: 120_000,
      signal: req.signal,
    });
    const wav = await toWav(audio, req.signal).catch((err: Error) => {
      throw new ProviderError(this.id, `cannot decode the audio: ${err.message}`);
    });
    fs.writeFileSync(req.outFile, wav);
    return { file: req.outFile, durationSec: wavDurationSec(wav) };
  }
}
