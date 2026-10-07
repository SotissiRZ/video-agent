import { httpJson } from '../http';
import { pickRendition, type StockProvider, type StockQuery, type StockResult } from './types';

interface PixabayImage {
  id: number;
  pageURL: string;
  user: string;
  imageWidth: number;
  imageHeight: number;
  largeImageURL: string;
  tags?: string;
}
interface PixabayVideo {
  id: number;
  pageURL: string;
  user: string;
  duration: number;
  tags?: string;
  videos: Record<'large' | 'medium' | 'small' | 'tiny', { url: string; width: number; height: number }>;
}

const SUPPORTED_LANGS = new Set(['cs', 'da', 'de', 'en', 'es', 'fr', 'id', 'it', 'hu', 'nl', 'no', 'pl', 'pt', 'ro', 'sk', 'fi', 'sv', 'tr', 'vi', 'th', 'bg', 'ru', 'el', 'ja', 'ko', 'zh']);

/** Pixabay: free photos and videos (https://pixabay.com/api/docs/). Free API key. */
export class PixabayProvider implements StockProvider {
  readonly id = 'pixabay';
  readonly supports = ['photo', 'video'] as const;
  constructor(private readonly apiKey: string) {}

  async search(q: StockQuery): Promise<StockResult[]> {
    const params = new URLSearchParams({
      key: this.apiKey,
      q: q.query.slice(0, 100),
      lang: SUPPORTED_LANGS.has(q.language) ? q.language : 'en',
      per_page: String(Math.max(3, q.perPage ?? 10)),
      safesearch: 'true',
    });
    if (q.kind === 'photo') {
      params.set('image_type', 'photo');
      if (q.orientation !== 'square') params.set('orientation', q.orientation === 'portrait' ? 'vertical' : 'horizontal');
      params.set('min_width', String(Math.round(q.minShortSide * 0.8)));
      const res = await httpJson<{ hits?: PixabayImage[] }>(`https://pixabay.com/api/?${params}`, { provider: this.id, signal: q.signal, timeoutMs: 30_000 });
      return (res.hits ?? []).map((h) => ({
        provider: this.id,
        id: `pixabay-photo-${h.id}`,
        kind: 'photo',
        downloadUrl: h.largeImageURL,
        // largeImageURL is scaled to 1280px max.
        width: h.imageWidth >= h.imageHeight ? 1280 : Math.round((1280 * h.imageWidth) / h.imageHeight),
        height: h.imageHeight > h.imageWidth ? 1280 : Math.round((1280 * h.imageHeight) / h.imageWidth),
        author: h.user,
        pageUrl: h.pageURL,
        extension: 'jpg',
        description: h.tags,
      }));
    }
    const res = await httpJson<{ hits?: PixabayVideo[] }>(`https://pixabay.com/api/videos/?${params}`, { provider: this.id, signal: q.signal, timeoutMs: 30_000 });
    return (res.hits ?? []).flatMap((h) => {
      const file = pickRendition(Object.values(h.videos).filter((v) => v.url), q.minShortSide);
      if (!file) return [];
      return [{ provider: this.id, id: `pixabay-video-${h.id}`, kind: 'video' as const, downloadUrl: file.url, width: file.width, height: file.height, durationSec: h.duration, author: h.user, pageUrl: h.pageURL, extension: 'mp4', description: h.tags }];
    });
  }
}
