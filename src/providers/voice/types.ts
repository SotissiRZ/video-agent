export interface VoiceRequest {
  text: string;
  language: string;
  /** Absolute path of the .wav file to write. */
  outFile: string;
  signal?: AbortSignal;
}

export interface VoiceResult {
  file: string;
  durationSec: number;
}

/** Text-to-speech provider. Implementations must write a 16-bit PCM WAV file. */
export interface VoiceProvider {
  readonly id: string;
  /** Can it speak this language (code of core/languages)? Assumed true when absent. */
  supports?(language: string): boolean;
  synthesize(request: VoiceRequest): Promise<VoiceResult>;
}
