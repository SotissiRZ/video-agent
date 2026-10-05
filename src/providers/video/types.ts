export interface VideoClipRequest {
  prompt: string;
  width: number;
  height: number;
  durationSec: number;
  outFileBase: string;
  signal?: AbortSignal;
}

/** Text-to-video provider producing a short clip used as scene media. */
export interface VideoProvider {
  readonly id: string;
  generate(request: VideoClipRequest): Promise<{ file: string }>;
}
