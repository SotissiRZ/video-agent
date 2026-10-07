/** Stock media libraries (real photos and video clips, free licences). */

export type StockKind = 'photo' | 'video';
export type Orientation = 'landscape' | 'portrait' | 'square';

export interface StockQuery {
  query: string;
  kind: StockKind;
  orientation: Orientation;
  /** ISO 639-1 language of the query ("fr", "en"). */
  language: string;
  /** Minimum size of the shortest side, in pixels. */
  minShortSide: number;
  perPage?: number;
  signal?: AbortSignal;
}

export interface StockResult {
  provider: string;
  /** Provider-specific id, used to avoid reusing the same media twice. */
  id: string;
  kind: StockKind;
  /** Direct download URL of the chosen rendition. */
  downloadUrl: string;
  width: number;
  height: number;
  durationSec?: number;
  author: string;
  /** Page of the media on the provider site (attribution link). */
  pageUrl: string;
  /** File extension of the rendition, without dot. */
  extension: string;
  /** What the media shows (alt text, tags or page slug), used to reject off-topic results. */
  description?: string;
}

export interface StockProvider {
  readonly id: string;
  readonly supports: readonly StockKind[];
  search(query: StockQuery): Promise<StockResult[]>;
  /** Called when a result is actually used (Unsplash requires download tracking). */
  trackUse?(result: StockResult, signal?: AbortSignal): Promise<void>;
}

export const orientationFor = (width: number, height: number): Orientation =>
  width > height * 1.15 ? 'landscape' : height > width * 1.15 ? 'portrait' : 'square';

/** Pick the smallest rendition whose short side is large enough, else the largest. */
export const pickRendition = <T extends { width: number; height: number }>(items: T[], minShortSide: number): T | undefined => {
  const valid = items.filter((i) => i.width > 0 && i.height > 0);
  if (!valid.length) return undefined;
  const short = (i: T) => Math.min(i.width, i.height);
  const bigEnough = valid.filter((i) => short(i) >= minShortSide * 0.9).sort((a, b) => short(a) - short(b));
  return bigEnough[0] ?? valid.sort((a, b) => short(b) - short(a))[0];
};
