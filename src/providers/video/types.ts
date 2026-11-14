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
  /** `seconds`: billed length of the clip (for the cost dashboard). */
  generate(request: VideoClipRequest): Promise<{ file: string; seconds?: number }>;
  /** Model id, when the provider runs several. */
  readonly model?: string;
}
