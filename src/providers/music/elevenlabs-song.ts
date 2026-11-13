/** ElevenLabs Music composition-plan generation for songs with user-provided lyrics. */
import { ProviderError } from '../../core/errors';
import { httpBuffer } from '../http';
import { lyricSections, lyricsProblem, MAX_SECTION_LINES, type LyricSection } from './lyrics';

export interface SongGenerationRequest {
  lyrics: string;
  style: string;
  mood: string;
  durationSec: number;
  signal?: AbortSignal;
}

const MIN_CHUNK_MS = 3000;
const MAX_CHUNK_MS = 120_000;

/**
 * One chunk per lyric section, the song's length shared by line count (each chunk 3–120 s).
 * Short songs with many small sections: neighbours are merged until every chunk gets its 3 s.
 */
export const compositionChunks = (sections: LyricSection[], durationSec: number, styles: string[]) => {
  const totalMs = Math.round(durationSec * 1000);
  const parts = sections.map((s) => ({ names: [s.name], lines: [...s.lines] }));
  while (parts.length > 1 && parts.length * MIN_CHUNK_MS > totalMs) {
    // Merge the lightest neighbouring pair that still fits in one chunk.
    let best = -1;
    for (let i = 0; i < parts.length - 1; i++) {
      const size = parts[i]!.lines.length + parts[i + 1]!.lines.length;
      if (size <= MAX_SECTION_LINES && (best < 0 || size < parts[best]!.lines.length + parts[best + 1]!.lines.length)) best = i;
    }
    if (best < 0) throw new ProviderError('elevenlabs-music', 'Too many lyric sections for such a short song.');
    const [a, b] = parts.splice(best, 2) as [(typeof parts)[number], (typeof parts)[number]];
    parts.splice(best, 0, { names: [...a.names, ...b.names], lines: [...a.lines, ...b.lines] });
  }
  if (parts.length * MAX_CHUNK_MS < totalMs) throw new ProviderError('elevenlabs-music', 'The song is too long for its lyric sections (120 s per section at most).');
  const weight = parts.reduce((n, p) => n + p.lines.length, 0);
  // Share by line count, then fix rounding so the chunks add up to the exact length.
  const ms = parts.map((p) => Math.min(MAX_CHUNK_MS, Math.max(MIN_CHUNK_MS, Math.round((totalMs * p.lines.length) / weight))));
  let diff = totalMs - ms.reduce((a, b) => a + b, 0);
  for (let i = 0; diff !== 0 && i < ms.length * 4; i++) {
    const k = i % ms.length;
    const step = Math.sign(diff) * Math.min(Math.abs(diff), diff > 0 ? MAX_CHUNK_MS - ms[k]! : ms[k]! - MIN_CHUNK_MS);
    ms[k] = ms[k]! + step;
    diff -= step;
  }
  return parts.map((p, i) => ({
    text: p.lines.join('\n'),
    duration_ms: ms[i]!,
    positive_styles: [...styles, `${p.names.join(' and ')} of the song`],
    negative_styles: [] as string[],
  }));
};

export class ElevenLabsSongProvider {
  constructor(private readonly apiKey: string) {}

  async generate(request: SongGenerationRequest): Promise<Buffer> {
    const problem = lyricsProblem(request.lyrics);
    if (problem) throw new ProviderError('elevenlabs-music', `Invalid lyrics (${problem}): at most ${MAX_SECTION_LINES} lines per section, each no longer than 200 characters.`);
    const durationSec = Math.max(3, Math.min(600, Math.round(request.durationSec)));
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
        composition_plan: { chunks: compositionChunks(lyricSections(request.lyrics), durationSec, styles) },
      },
      signal: request.signal,
      timeoutMs: 300_000,
    }).then((audio) => {
      if (!audio.length) throw new ProviderError('elevenlabs-music', 'The provider returned an empty audio file.');
      return audio;
    });
  }
}
