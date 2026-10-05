import { httpJson } from '../http';
import type { StockProvider, StockQuery, StockResult } from './types';

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  urls: { raw: string; full: string; regular: string };
  links: { html: string; download_location: string };
  user: { name: string };
}

/**
 * Unsplash: free high-quality photos (https://unsplash.com/developers).
 * The API guidelines require triggering the download endpoint when a photo is used
 * and crediting the photographer (done in credits.md and captions).
 */
export class UnsplashProvider implements StockProvider {
  readonly id = 'unsplash';
  readonly supports = ['photo'] as const;
  private readonly downloadLocations = new Map<string, string>();
  constructor(private readonly accessKey: string) {}

  async search(q: StockQuery): Promise<StockResult[]> {
    if (q.kind !== 'photo') return [];
    const params = new URLSearchParams({
      query: q.query,
      orientation: q.orientation === 'square' ? 'squarish' : q.orientation,
      per_page: String(q.perPage ?? 10),
      content_filter: 'high',
      lang: q.language,
    });
    const res = await httpJson<{ results?: UnsplashPhoto[] }>(`https://api.unsplash.com/search/photos?${params}`, {
      provider: this.id,
      headers: { authorization: `Client-ID ${this.accessKey}`, 'accept-version': 'v1' },
      signal: q.signal,
      timeoutMs: 30_000,
    });
    // Ask the image CDN for a rendition sized for the video (imgix parameters).
    const target = Math.max(1080, Math.round(q.minShortSide * 1.8));
    return (res.results ?? []).map((p) => {
      const id = `unsplash-${p.id}`;
      this.downloadLocations.set(id, p.links.download_location);
      const scale = Math.min(1, target / Math.max(p.width, p.height));
      return {
        provider: this.id,
        id,
        kind: 'photo' as const,
        downloadUrl: `${p.urls.raw}&w=${target}&fm=jpg&q=85&fit=max`,
        width: Math.round(p.width * scale),
        height: Math.round(p.height * scale),
        author: p.user.name,
        pageUrl: `${p.links.html}?utm_source=video-agent&utm_medium=referral`,
        extension: 'jpg',
      };
    });
  }

  async trackUse(result: StockResult, signal?: AbortSignal): Promise<void> {
    const location = this.downloadLocations.get(result.id);
    if (!location) return;
    await httpJson(location, { provider: this.id, headers: { authorization: `Client-ID ${this.accessKey}` }, signal, timeoutMs: 15_000 }).catch(() => undefined);
  }
}
