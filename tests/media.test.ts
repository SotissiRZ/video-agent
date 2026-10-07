import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureJobDirs, jobPaths } from '../src/agent/job';
import { createLogger } from '../src/core/logger';
import { detectDomain } from '../src/media/domains';
import { parseAvoidTerms } from '../src/prompt/parser';
import { buildStockQueries, isRelevant, ROLE_VISUAL_HINTS, MediaDirector, shotsFor, wantsMedia } from '../src/media/director';
import { visibleShots } from '../src/remotion/components/MediaLayer';
import { PexelsProvider } from '../src/providers/stock/pexels';
import { PixabayProvider } from '../src/providers/stock/pixabay';
import { resolveStockProviders } from '../src/providers/stock/registry';
import { pickRendition, pickStockResult, type StockProvider, type StockQuery, type StockResult } from '../src/providers/stock/types';
import { UnsplashProvider } from '../src/providers/stock/unsplash';
import { StoryboardSchema } from '../src/remotion/contract/storyboard';
import { getStyle } from '../src/remotion/contract/styles';
import { computeTotalDuration } from '../src/remotion/contract/timeline';
import type { PlannedScene, VideoBrief } from '../src/core/types';
import { json, mockFetch } from './fetch-mock';
import { testConfig, tmpDir } from './helpers';

let restore: (() => void) | undefined;
afterEach(() => restore?.());

const brief = { brand: 'Sirago', audience: 'chauffeurs', location: 'Burkina Faso', keywords: ['sirago', 'chauffeurs'], width: 1080, height: 1920, fps: 30, language: 'fr' } as unknown as VideoBrief;

describe('stock providers', () => {
  it('picks the smallest rendition that is large enough', () => {
    const files = [{ width: 640, height: 360 }, { width: 1920, height: 1080 }, { width: 3840, height: 2160 }];
    expect(pickRendition(files, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(pickRendition([{ width: 640, height: 360 }], 1080)).toEqual({ width: 640, height: 360 });
  });

  it('prefers stock media close to the output aspect ratio and avoids extreme upscaling', () => {
    const landscape = { width: 1280, height: 720 };
    const portrait720 = { width: 720, height: 1280 };
    const portrait1080 = { width: 1080, height: 1920 };
    expect(pickStockResult([landscape, portrait720, portrait1080], 1080, 1920)).toBe(portrait1080);
    expect(pickStockResult([landscape], 1080, 1920)).toBeUndefined();
    expect(pickStockResult([portrait720], 1080, 1920)).toBe(portrait720);
    expect(pickStockResult([landscape, { width: 1920, height: 1080 }], 1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it('parses Pexels photos and videos', async () => {
    const m = mockFetch([
      ['GET', /api\.pexels\.com\/v1\/search/, () => json({ photos: [{ id: 1, width: 4000, height: 6000, url: 'https://pexels.com/p/1', photographer: 'Awa', src: { original: 'o.jpg', large2x: 'l2.jpg', large: 'l.jpg', portrait: 'p.jpg', landscape: 'ls.jpg' } }] })],
      ['GET', /api\.pexels\.com\/videos\/search/, () => json({ videos: [{ id: 9, width: 1080, height: 1920, url: 'https://pexels.com/v/9', duration: 12, user: { name: 'Issa' }, video_files: [{ link: 'sd.mp4', width: 540, height: 960, file_type: 'video/mp4', quality: 'sd' }, { link: 'hd.mp4', width: 1080, height: 1920, file_type: 'video/mp4', quality: 'hd' }] }] })],
    ]);
    restore = m.restore;
    const p = new PexelsProvider('key');
    const q: StockQuery = { query: 'chauffeurs', kind: 'photo', orientation: 'portrait', language: 'fr', minShortSide: 1080 };
    const photos = await p.search(q);
    expect(photos[0]).toMatchObject({ id: 'pexels-photo-1', downloadUrl: 'l2.jpg', author: 'Awa', kind: 'photo' });
    expect(m.calls[0]!.url).toContain('locale=fr-FR');
    expect(m.calls[0]!.headers.authorization).toBe('key');
    const videos = await p.search({ ...q, kind: 'video' });
    expect(videos[0]).toMatchObject({ downloadUrl: 'hd.mp4', durationSec: 12, author: 'Issa' });
  });

  it('parses Pixabay and Unsplash, and tracks Unsplash downloads', async () => {
    const m = mockFetch([
      ['GET', /pixabay\.com\/api\/\?/, () => json({ hits: [{ id: 5, pageURL: 'https://pixabay.com/5', user: 'Moussa', imageWidth: 2000, imageHeight: 3000, largeImageURL: 'px.jpg' }] })],
      ['GET', /api\.unsplash\.com\/search\/photos/, () => json({ results: [{ id: 'abc', width: 3000, height: 4500, urls: { raw: 'https://images.unsplash.com/x?ixid=1', full: '', regular: '' }, links: { html: 'https://unsplash.com/photos/abc', download_location: 'https://api.unsplash.com/photos/abc/download' }, user: { name: 'Fatou' } }] })],
      ['GET', /api\.unsplash\.com\/photos\/abc\/download/, () => json({ url: 'x' })],
    ]);
    restore = m.restore;
    const pix = await new PixabayProvider('k').search({ query: 'moto', kind: 'photo', orientation: 'portrait', language: 'fr', minShortSide: 1080 });
    expect(pix[0]).toMatchObject({ downloadUrl: 'px.jpg', author: 'Moussa', height: 1280 });
    expect(m.calls[0]!.url).toContain('orientation=vertical');
    const unsplash = new UnsplashProvider('u');
    const [photo] = await unsplash.search({ query: 'taxi', kind: 'photo', orientation: 'portrait', language: 'en', minShortSide: 1080 });
    expect(photo!.downloadUrl).toContain('w=1944');
    expect(m.calls[1]!.headers.authorization).toBe('Client-ID u');
    await unsplash.trackUse(photo!);
    expect(m.calls.at(-1)!.url).toBe('https://api.unsplash.com/photos/abc/download');
    expect(await unsplash.search({ query: 'x', kind: 'video', orientation: 'portrait', language: 'en', minShortSide: 1 })).toEqual([]);
  });

  it('auto-enables the libraries that have a key', () => {
    expect(resolveStockProviders(testConfig())).toEqual([]);
    expect(resolveStockProviders(testConfig({ PEXELS_API_KEY: 'p', UNSPLASH_ACCESS_KEY: 'u' })).map((p) => p.id)).toEqual(['pexels', 'unsplash']);
    expect(resolveStockProviders(testConfig({ PEXELS_API_KEY: 'p', VIDEO_AGENT_STOCK_PROVIDERS: 'none' }))).toEqual([]);
    expect(() => resolveStockProviders(testConfig({ VIDEO_AGENT_STOCK_PROVIDERS: 'pixabay' }))).toThrow(/not configured/);
  });
});

describe('media director', () => {
  it('builds queries from specific to generic, without the brand', () => {
    const queries = buildStockQueries({ role: 'hook' }, { visualKeywords: ['Sirago', 'moto taxi', 'driver', 'hook'] }, brief, 'en');
    expect(queries[0]).toEqual({ query: 'moto taxi driver', language: 'en' });
    expect(queries.some((q) => q.query.toLowerCase().includes('sirago'))).toBe(false);
    expect(queries).toContainEqual({ query: 'chauffeurs Burkina Faso', language: 'en' });
    expect(queries.at(-1)).toEqual({ query: 'city street people', language: 'en' });
  });

  it('uses industry searches: first offline, after the LLM keywords otherwise', () => {
    const domain = detectDomain('Crée une vidéo pour présenter notre plateforme SaaS de cybersécurité pour les PME');
    expect(domain.id).toBe('cybersecurity');
    expect(detectDomain('vidéo tech sur l’IA générative').id).toBe('tech');
    expect(detectDomain('ouverture du restaurant Chez Awa').id).toBe('food');
    expect(detectDomain('prix transparent pour les parents').id).toBe('business');
    const offline = buildStockQueries({ role: 'point' }, { visualKeywords: ['plateforme', 'saas'] }, { brand: '', audience: '', location: '', keywords: [] }, 'fr', domain.queries.slice(0, 2));
    expect(offline[0]).toEqual({ query: domain.queries[0], language: 'en' });
    const llm = buildStockQueries({ role: 'point' }, { visualKeywords: ['security analyst', 'monitors'] }, { brand: '', audience: '', location: '', keywords: [] }, 'en', domain.queries.slice(0, 2));
    expect(llm[0]!.query).toBe('security analyst monitors');
    expect(llm.map((q) => q.query)).toContain(domain.queries[0]);
    // One stray word must not decide the industry: "accompagne" contains "pagne", "transformation" contains "formation".
    expect(detectDomain('ZSR-TechNum vous accompagne dans votre transformation numérique : sites web, IA, automatisation.').id).toBe('tech');
    expect(detectDomain('boutique de pagnes wax à Abidjan').id).toBe('fashion-beauty');
    // Script keywords are complete searches, never merged together.
    const phrases = buildStockQueries({ role: 'x' }, { visualKeywords: ['analytics dashboard laptop', 'hand holding smartphone'] }, { brand: '', audience: '', location: '', keywords: [] }, 'en', ['laptop software dashboard'], true);
    expect(phrases.map((q) => q.query)).toEqual(['analytics dashboard laptop', 'hand holding smartphone', 'laptop software dashboard']);
    // No generic hint that brings children's pictures.
    expect(Object.values(ROLE_VISUAL_HINTS).join(' ')).not.toMatch(/young people|celebration|kids|children/);
  });

  it('rejects off-topic stock results and avoided subjects', () => {
    expect(isRelevant({ description: 'black car steering wheel' }, 'analytics dashboard laptop')).toBe(false);
    expect(isRelevant({ description: 'person using laptop with analytics dashboards' }, 'analytics dashboard laptop')).toBe(true);
    expect(isRelevant({ description: 'robot on a laptop screen' }, 'laptop desk', ['robot'])).toBe(false);
    expect(isRelevant({}, 'laptop desk')).toBe(true);
    expect(parseAvoidTerms('Éviter les robots futuristes, les faux logos. Montrer des ordinateurs.')).toEqual(expect.arrayContaining(['robot', 'logo']));
    expect(parseAvoidTerms('Une vidéo sur le transport et les ordinateurs.')).toEqual([]);
  });

  const makeStoryboard = () => {
    const scenes = StoryboardSchema.shape.scenes.parse(
      ['hook', 'benefits', 'proof', 'cta'].map((role, i) => ({ id: `0${i + 1}-${role}`, kind: role === 'proof' ? 'image' : 'title', role, durationInFrames: 90, headline: role })),
    );
    return StoryboardSchema.parse({
      meta: { title: 't', template: 'advertisement', style: 'modern' },
      format: { width: 1080, height: 1920, fps: 30, durationInFrames: computeTotalDuration(scenes) },
      theme: getStyle('modern').theme,
      scenes,
    });
  };

  it('fills every scene with distinct stock media, records credits and survives provider failures', async () => {
    let n = 0;
    const fake: StockProvider = {
      id: 'fake',
      supports: ['photo', 'video'],
      async search(q): Promise<StockResult[]> {
        n++;
        return [1, 2, 3, 4, 5].map((i) => ({ provider: 'fake', id: `${q.kind}-${i}`, kind: q.kind, downloadUrl: `https://cdn.test/${q.kind}-${i}`, width: 1080, height: 1920, durationSec: q.kind === 'video' ? 10 : undefined, author: `A${i}`, pageUrl: `https://fake/${i}`, extension: q.kind === 'video' ? 'mp4' : 'jpg' }));
      },
    };
    const broken: StockProvider = { id: 'broken', supports: ['photo'], search: async () => { throw new Error('boom'); } };
    const m = mockFetch([['GET', /cdn\.test/, () => new Response('bytes')]]);
    restore = m.restore;
    const paths = jobPaths(path.join(tmpDir(), 'job'));
    ensureJobDirs(paths);
    const warnings: string[] = [];
    const director = new MediaDirector(
      { stock: [broken, fake], image: null, video: null, logger: createLogger('silent') },
      { sources: ['assets', 'stock', 'ai'], coverage: 'all', stockVideos: true, maxGeneratedImages: 0, maxGeneratedClips: 0, keywordLanguage: 'fr' },
    );
    const sb = await director.run(makeStoryboard(), [], brief, paths, warnings, () => undefined);
    const media = sb.scenes.map((s) => s.media!);
    expect(media.every(Boolean)).toBe(true);
    expect(new Set(media.map((m) => m.src)).size).toBe(4);
    expect(media[0]).toMatchObject({ type: 'video', origin: 'stock:fake', durationInFrames: 299, credit: { author: 'A1', source: 'fake' } });
    expect(media[1]!.type).toBe('image');
    expect(fs.existsSync(path.join(paths.publicDir, media[0]!.src))).toBe(true);
    expect(fs.readFileSync(path.join(paths.dir, 'credits.md'), 'utf8')).toContain('A1');
    expect(director.credits).toHaveLength(4);
    expect(warnings.some((w) => w.includes('broken'))).toBe(true);
    expect(n).toBeGreaterThan(0);
  });

  it('prefers sharp pictures, leaves out alcohol nobody asked for, and finds replacements', async () => {
    const photo = (provider: string, id: string, width: number, height: number, description: string): StockResult => ({
      provider, id, kind: 'photo', downloadUrl: `https://cdn.test/${id}`, width, height, author: id, pageUrl: `https://p/${id}`, extension: 'jpg', description,
    });
    const small: StockProvider = {
      id: 'small',
      supports: ['photo'],
      search: async () => [photo('small', 'alcohol', 1080, 1920, 'bottles, alcohol, wine, drinks, bar'), photo('small', 'small-juice', 820, 1280, 'juice, glass, fruit')],
    };
    const sharp: StockProvider = { id: 'sharp', supports: ['photo'], search: async () => [photo('sharp', 'sharp-juice', 1944, 3456, 'fresh hibiscus juice')] };
    const m = mockFetch([['GET', /cdn\.test/, () => new Response('bytes')]]);
    restore = m.restore;
    const paths = jobPaths(path.join(tmpDir(), 'job'));
    ensureJobDirs(paths);
    const director = new MediaDirector(
      { stock: [small, sharp], image: null, video: null, logger: createLogger('silent') },
      { sources: ['stock'], coverage: 'all', stockVideos: false, maxGeneratedImages: 0, maxGeneratedClips: 0, keywordLanguage: 'en' },
    );
    const juiceBrief = { ...brief, prompt: 'Une pub pour mon jus de bissap' } as VideoBrief;
    const juicePlan = makeStoryboard().scenes.map(() => ({ visualKeywords: ['fresh juice'], visualPrompt: 'fresh juice' }) as unknown as PlannedScene);
    const sb = await director.run(makeStoryboard(), juicePlan, juiceBrief, paths, [], () => undefined);
    // The sharp picture beats the smaller one listed first; the alcohol picture is never used.
    expect(sb.scenes[0]!.media).toMatchObject({ alt: 'fresh hibiscus juice', origin: 'stock:sharp' });
    expect(sb.scenes.every((s) => !s.media?.alt?.includes('alcohol'))).toBe(true);

    const fresh = new MediaDirector(
      { stock: [small, sharp], image: null, video: null, logger: createLogger('silent') },
      { sources: ['stock'], coverage: 'all', stockVideos: false, maxGeneratedImages: 0, maxGeneratedClips: 0, keywordLanguage: 'en' },
    );
    // A correction never brings back a picture already in the video.
    const replacement = await fresh.findReplacement(sb.scenes[1]!, ['fresh', 'juice'], juiceBrief, paths, ['https://p/sharp-juice'], []);
    expect(replacement).toMatchObject({ alt: 'juice, glass, fruit' });
    // Asked for: the same picture is allowed.
    const bar = { ...brief, prompt: 'Pub pour mon bar à cocktails' } as VideoBrief;
    const barDirector = new MediaDirector({ stock: [small], image: null, video: null, logger: createLogger('silent') }, { sources: ['stock'], coverage: 'all', stockVideos: false, maxGeneratedImages: 0, maxGeneratedClips: 0, keywordLanguage: 'en' });
    expect(await barDirector.findReplacement(sb.scenes[1]!, ['drinks'], bar, paths, [], [])).toMatchObject({ alt: 'bottles, alcohol, wine, drinks, bar' });
  });

  it('shows several shots in long scenes, reusing the same searches', async () => {
    let searches = 0;
    const fake: StockProvider = {
      id: 'fake',
      supports: ['photo'],
      async search(q): Promise<StockResult[]> {
        searches++;
        return Array.from({ length: 12 }, (_, i) => ({ provider: 'fake', id: `${q.query}-${i}`, kind: 'photo' as const, downloadUrl: `https://cdn.test/${i}`, width: 1080, height: 1920, author: `A${i}`, pageUrl: `https://fake/${i}`, extension: 'jpg' }));
      },
    };
    const m = mockFetch([['GET', /cdn\.test/, () => new Response('bytes')]]);
    restore = m.restore;
    const paths = jobPaths(path.join(tmpDir(), 'job'));
    ensureJobDirs(paths);
    const sb0 = makeStoryboard();
    sb0.scenes[0] = { ...sb0.scenes[0]!, durationInFrames: 8 * 30 }; // 8 s → 3 shots
    const director = new MediaDirector(
      { stock: [fake], image: null, video: null, logger: createLogger('silent') },
      { sources: ['stock'], coverage: 'all', stockVideos: false, maxGeneratedImages: 0, maxGeneratedClips: 0, keywordLanguage: 'en', shotsPerScene: 3 },
    );
    const sb = await director.run(sb0, [], brief, paths, [], () => undefined);
    expect(sb.scenes[0]!.shots).toHaveLength(2);
    expect(sb.scenes[1]!.shots).toBeUndefined(); // 3 s scene: a single shot
    const all = sb.scenes.flatMap((s) => [s.media!, ...(s.shots ?? [])]);
    expect(new Set(all.map((x) => x.src)).size).toBe(all.length);
    expect(all.every((x) => fs.existsSync(path.join(paths.publicDir, x.src)))).toBe(true);
    expect(searches).toBeLessThanOrEqual(sb.scenes.length);
    expect(shotsFor(8, 3)).toBe(3);
    expect(shotsFor(5, 3)).toBe(2);
    expect(shotsFor(2, 3)).toBe(1);
    expect(shotsFor(10, 1)).toBe(1);
    const shot = { type: 'image' as const, src: 'a.jpg', fit: 'cover' as const, origin: 'stock' };
    expect(visibleShots([shot, shot, shot], 90, 30)).toHaveLength(1);
    expect(visibleShots([shot, shot, shot], 300, 30)).toHaveLength(3);
  });

  it('falls back to AI images, respects coverage and disables a provider after a 401', async () => {
    const { ProviderError } = await import('../src/core/errors');
    let calls = 0;
    const unauthorized: StockProvider = { id: 'nokey', supports: ['photo'], search: async () => { calls++; throw new ProviderError('nokey', 'HTTP 401: bad key'); } };
    const paths = jobPaths(path.join(tmpDir(), 'job'));
    ensureJobDirs(paths);
    const image = { id: 'fake-ai', generate: async ({ outFileBase }: { outFileBase: string }) => (fs.writeFileSync(`${outFileBase}.png`, 'png'), { file: `${outFileBase}.png` }) };
    const warnings: string[] = [];
    const director = new MediaDirector(
      { stock: [unauthorized], image, video: null, logger: createLogger('silent') },
      { sources: ['stock', 'ai'], coverage: 'visual', stockVideos: false, maxGeneratedImages: 5, maxGeneratedClips: 0, keywordLanguage: 'fr' },
    );
    const sb = await director.run(makeStoryboard(), [], brief, paths, warnings, () => undefined);
    expect(sb.scenes.filter((s) => s.media).map((s) => s.role)).toEqual(['proof']);
    expect(sb.scenes[2]!.media).toMatchObject({ origin: 'ai:fake-ai', type: 'image' });
    expect(calls).toBe(1);
    expect(warnings.join()).toMatch(/nokey disabled/);
    expect(wantsMedia(sb.scenes[0]!, 'none')).toBe(false);
  });
});
