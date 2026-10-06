export interface MusicRequest {
  /** English description: genre, mood, instruments ("instrumental, no vocals" is added by the caller). */
  prompt: string;
  durationSec: number;
  signal?: AbortSignal;
}

export interface MusicResult {
  /** Encoded audio (mp3 or wav). */
  audio: Buffer;
  extension: 'mp3' | 'wav';
  /** Length actually produced; shorter tracks are looped by the composition. */
  durationSec: number;
}

/** Text-to-music provider. */
export interface MusicProvider {
  readonly id: string;
  /** Longest track the provider generates in one request. */
  readonly maxDurationSec: number;
  generate(request: MusicRequest): Promise<MusicResult>;
}
