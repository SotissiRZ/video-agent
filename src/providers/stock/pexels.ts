import { httpJson } from '../http';
import { pickRendition, type StockProvider, type StockQuery, type StockResult } from './types';

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  src: { original: string; large2x: string; large: string; portrait: string; landscape: string };
}
interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  url: string;
  duration: number;
  user: { name: string };
  video_files: Array<{ link: string; width: number | null; height: number | null; file_type: string; quality: string | null }>;
}

const LOCALES: Record<string, string> = { fr: 'fr-FR', en: 'en-US', es: 'es-ES', pt: 'pt-BR', de: 'de-DE' };

/** Pexels: free photos and videos (https://www.pexels.com/api/). Free API key. */
export class PexelsProvider implements StockProvider {
  readonly id = 'pexels';
  readonly supports = ['photo', 'video'] as const;
  constructor(private readonly apiKey: string) {}

  async search(q: StockQuery): Promise<StockResult[]> {
    const params = new URLSearchParams({ query: q.query, orientation: q.orientation, per_page: String(q.perPage ?? 10), locale: LOCALES[q.language] ?? 'en-US' });
    const headers = { authorization: this.apiKey };
    if (q.kind === 'photo') {
      const res = await httpJson<{ photos?: PexelsPhoto[] }>(`https://api.pexels.com/v1/search?${params}`, { provider: this.id, headers, signal: q.signal, timeoutMs: 30_000 });
      return (res.photos ?? []).map((p) => ({
        provider: this.id,
        id: `pexels-photo-${p.id}`,
        kind: 'photo',
        // large2x is ~1880px wide: enough for 1080p and much lighter than the original.
        downloadUrl: Math.min(p.width, p.height) > 2200 && q.minShortSide <= 1100 ? p.src.large2x : p.src.original,
        width: p.width,
        height: p.height,
        author: p.photographer,
        pageUrl: p.url,
        extension: 'jpg',
      }));
    }
    const res = await httpJson<{ videos?: PexelsVideo[] }>(`https://api.pexels.com/videos/search?${params}`, { provider: this.id, headers, signal: q.signal, timeoutMs: 30_000 });
    return (res.videos ?? []).flatMap((v) => {
      const files = v.video_files
        .filter((f) => f.file_type === 'video/mp4' && f.width && f.height)
        .map((f) => ({ ...f, width: f.width!, height: f.height! }));
      const file = pickRendition(files, q.minShortSide);
      if (!file) return [];
      return [{ provider: this.id, id: `pexels-video-${v.id}`, kind: 'video' as const, downloadUrl: file.link, width: file.width, height: file.height, durationSec: v.duration, author: v.user.name, pageUrl: v.url, extension: 'mp4' }];
    });
  }
}
