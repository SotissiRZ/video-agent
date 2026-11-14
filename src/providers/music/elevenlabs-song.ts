/** ElevenLabs Music composition-plan generation for songs with user-provided lyrics. */
import { ProviderError } from '../../core/errors';
import { httpBufferWithHeaders } from '../http';
import { lyricSections, lyricsProblem, MAX_SECTION_LINES, type LyricSection } from './lyrics';

export interface SongGenerationRequest {
  lyrics: string;
  style: string;
  mood: string;
  durationSec: number;
  /** Same seed for every version of a song, so a lyrics correction keeps its sound (best effort). */
  seed?: number;
  /** ElevenLabs id of the previous version: the new one is conditioned on it (same style). */
  previousSongId?: string;
  previousDurationSec?: number;
  signal?: AbortSignal;
}

export interface ComposedSong {
  audio: Buffer;
  /** ElevenLabs song id, read from the response headers when present. */
  songId?: string;
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
    return (await this.compose(request)).audio;
  }

  /**
   * Composition plan, one chunk per lyric section. With a previous version, the first chunk is
   * conditioned on it ("the first chunk influences all the following ones") and the seed is reused.
   * Those two options are best effort: if ElevenLabs refuses them (HTTP 400/422), the song is composed
   * again without them rather than failing.
   */
  async compose(request: SongGenerationRequest): Promise<ComposedSong> {
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
    const chunks = compositionChunks(lyricSections(request.lyrics), durationSec, styles);
    const reference = request.previousSongId
      ? { song_id: request.previousSongId, range: { start_ms: 0, end_ms: Math.max(3000, Math.min(30_000, Math.round((request.previousDurationSec ?? 30) * 1000))) } }
      : undefined;
    const attempts = [
      { seed: request.seed, reference },
      { seed: request.seed, reference: undefined },
      { seed: undefined, reference: undefined },
    ].filter((a, i, all) => all.findIndex((b) => b.seed === a.seed && b.reference === a.reference) === i);
    let lastError: unknown;
    for (const attempt of attempts) {
      const plan = chunks.map((chunk, i) => (i === 0 && attempt.reference ? { ...chunk, conditioning_ref: attempt.reference, condition_strength: 'high' } : chunk));
      try {
        const { body, headers } = await httpBufferWithHeaders('https://api.elevenlabs.io/v1/music', {
          provider: 'elevenlabs-music',
          headers: { 'xi-api-key': this.apiKey, accept: 'audio/mpeg' },
          body: { model_id: 'music_v2_5', composition_plan: { chunks: plan }, ...(attempt.seed !== undefined ? { seed: attempt.seed } : {}) },
          signal: request.signal,
          timeoutMs: 300_000,
        });
        if (!body.length) throw new ProviderError('elevenlabs-music', 'The provider returned an empty audio file.');
        let songId: string | undefined;
        headers.forEach((value, name) => {
          if (!songId && /song[-_]?id/i.test(name) && value) songId = value;
        });
        return { audio: body, songId };
      } catch (err) {
        lastError = err;
        // Only an option ElevenLabs refuses is worth another try; anything else (quota, network) is final.
        if (!(err instanceof ProviderError) || !/HTTP 4(00|22)/.test(err.message)) throw err;
      }
    }
    throw lastError;
  }
}
