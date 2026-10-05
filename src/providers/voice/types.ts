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
  synthesize(request: VoiceRequest): Promise<VoiceResult>;
}
