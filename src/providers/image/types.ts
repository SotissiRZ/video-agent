export interface ImageRequest {
  prompt: string;
  width: number;
  height: number;
  /** Absolute output path without extension; the provider picks the extension. */
  outFileBase: string;
  signal?: AbortSignal;
}

export interface ImageProvider {
  readonly id: string;
  generate(request: ImageRequest): Promise<{ file: string }>;
}

/** Closest supported aspect ratio label. */
export const aspectRatio = (width: number, height: number): '16:9' | '9:16' | '1:1' | '4:5' | '3:2' | '2:3' => {
  const r = width / height;
  const options: Array<[ReturnType<typeof aspectRatio>, number]> = [['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1], ['4:5', 4 / 5], ['3:2', 3 / 2], ['2:3', 2 / 3]];
  return options.reduce((best, cur) => (Math.abs(cur[1] - r) < Math.abs(best[1] - r) ? cur : best))[0];
};
