/** ElevenLabs Music composition-plan generation for songs with user-provided lyrics. */
import { ProviderError } from '../../core/errors';
import { httpBuffer } from '../http';

export interface SongGenerationRequest {
  lyrics: string;
  style: string;
  mood: string;
  durationSec: number;
  signal?: AbortSignal;
}

export class ElevenLabsSongProvider {
  constructor(private readonly apiKey: string) {}

  async generate(request: SongGenerationRequest): Promise<Buffer> {
    const lines = request.lyrics.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length || lines.length > 30 || lines.some((line) => line.length > 200)) {
      throw new ProviderError('elevenlabs-music', 'Lyrics must contain 1–30 lines, each no longer than 200 characters.');
    }
    const durationSec = Math.max(3, Math.min(120, Math.round(request.durationSec)));
    const styles = [
      `${request.style} music`,
      `${request.mood} mood`,
      'song with vocals',
      'sing the provided lyrics',
      'clear lead vocal',
      'high quality production',
    ];
    return httpBuffer('https://api.elevenlabs.io/v1/music', {
      provider: 'elevenlabs-music',
      headers: { 'xi-api-key': this.apiKey, accept: 'audio/mpeg' },
      body: {
        model_id: 'music_v2_5',
        composition_plan: {
          chunks: [{ text: lines.join('\n'), duration_ms: durationSec * 1000, positive_styles: styles, negative_styles: [] }],
        },
      },
      signal: request.signal,
      timeoutMs: 300_000,
    }).then((audio) => {
      if (!audio.length) throw new ProviderError('elevenlabs-music', 'The provider returned an empty audio file.');
      return audio;
    });
  }
}
