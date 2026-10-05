/**
 * MediaDirector — finds a real visual for each scene.
 *
 * For every scene that wants media, sources are tried in the configured order
 * (default: local assets → stock libraries → AI generation). Stock libraries are queried
 * with progressively broader queries; a media is never used twice in the same video.
 * If nothing is found, the scene keeps its procedural (animated) background.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AssetLibrary } from '../assets/manager';
import { importAsset } from '../assets/manager';
import type { JobPaths } from '../agent/job';
import { errorMessage, ProviderError } from '../core/errors';
import type { Logger } from '../core/logger';
import type { PlannedScene, VideoBrief } from '../core/types';
import { BUSINESS, detectDomain, type Domain } from './domains';
import { normalize } from '../prompt/parser';
import { httpBuffer } from '../providers/http';
import type { ImageProvider } from '../providers/image/types';
import { orientationFor, type StockKind, type StockProvider, type StockResult } from '../providers/stock/types';
import type { VideoProvider } from '../providers/video/types';
import type { Media, Scene, Storyboard } from '../remotion/contract/storyboard';

export type MediaSource = 'assets' | 'stock' | 'ai';
export type MediaCoverage = 'all' | 'visual' | 'none';

export interface MediaCredit {
  sceneId: string;
  provider: string;
  author: string;
  url: string;
}

export interface MediaDirectorOptions {
  sources: MediaSource[];
  coverage: MediaCoverage;
  stockVideos: boolean;
  maxGeneratedImages: number;
  maxGeneratedClips: number;
  /** Language of the planned visual keywords (LLM keywords are English). */
  keywordLanguage: string;
}

export interface MediaDirectorDeps {
  library?: AssetLibrary;
  stock: StockProvider[];
  image: ImageProvider | null;
  video: VideoProvider | null;
  logger: Logger;
}

/** Generic English visual ideas per narrative role, used when keywords give nothing. */
export const ROLE_VISUAL_HINTS: Record<string, string> = {
  hook: 'city street people',
  problem: 'stressed professional',
  solution: 'person using smartphone',
  benefits: 'satisfied customer',
  proof: 'business team success',
  intro: 'modern city skyline',
  overview: 'modern workspace',
  features: 'technology product',
  highlight: 'product detail',
  how: 'hands using smartphone',
  steps: 'hands working laptop',
  tip: 'idea notebook desk',
  recap: 'team thumbs up office',
  teaser: 'event stage lights',
  reveal: 'event stage audience',
  details: 'event venue',
  point: 'professional working',
  list: 'modern lifestyle adults',
  setting: 'landscape sunrise',
  challenge: 'determined worker',
  'turning-point': 'new beginning sunrise',
  resolution: 'confident entrepreneur',
  message: 'community adults',
  outro: 'sunset city',
  cta: 'adult using smartphone',
};

const ROLE_WORDS = new Set(Object.keys(ROLE_VISUAL_HINTS));

/** Build search queries from the most specific to the most generic. */
export const buildStockQueries = (
  scene: Pick<Scene, 'role'>,
  plan: Pick<PlannedScene, 'visualKeywords'> | undefined,
  brief: Pick<VideoBrief, 'brand' | 'audience' | 'location' | 'keywords'>,
  keywordLanguage: string,
  /** Industry searches for this scene (see detectDomain), in English. */
  domainQueries: string[] = [],
): Array<{ query: string; language: string }> => {
  const brandWords = new Set(normalize(brief.brand).split(/\s+/).filter(Boolean));
  const clean = (words: string[]) => {
    const seen = new Set<string>();
    return words
      .flatMap((w) => w.split(/\s+/))
      .map((w) => w.trim())
      .filter((w) => w.length > 2 && !brandWords.has(normalize(w)) && !ROLE_WORDS.has(normalize(w)) && !/^\d+$/.test(w))
      .filter((w) => (seen.has(normalize(w)) ? false : (seen.add(normalize(w)), true)));
  };
  const planned = clean(plan?.visualKeywords ?? []);
  const context = clean([brief.audience, brief.location].filter(Boolean));
  const queries: Array<{ query: string; language: string }> = [];
  const push = (words: string[], language: string) => {
    const query = words.join(' ').trim();
    if (query && !queries.some((q) => q.query === query)) queries.push({ query, language });
  };
  if (keywordLanguage === 'en') {
    // LLM keywords are specific to the scene: they come first, the industry searches back them up.
    push(planned.slice(0, 3), 'en');
    push(planned.slice(0, 2), 'en');
    domainQueries.forEach((q) => push(q.split(' '), 'en'));
  } else {
    // Offline keywords are the prompt's own words: the industry searches are more reliable.
    domainQueries.forEach((q) => push(q.split(' '), 'en'));
    push(planned.slice(0, 2), keywordLanguage);
  }
  push(context, keywordLanguage);
  const hint = ROLE_VISUAL_HINTS[scene.role];
  if (hint) push(hint.split(' '), 'en');
  return queries.slice(0, 6);
};

export const wantsMedia = (scene: Scene, coverage: MediaCoverage): boolean =>
  coverage === 'all' ? true : coverage === 'visual' ? scene.kind === 'image' : false;

export class MediaDirector {
  private readonly used = new Set<string>();
  private readonly disabledProviders = new Set<string>();
  private generatedImages = 0;
  private domain: Domain = BUSINESS;
  private sceneIndex = 0;
  private generatedClips = 0;
  readonly credits: MediaCredit[] = [];

  constructor(
    private readonly deps: MediaDirectorDeps,
    private readonly options: MediaDirectorOptions,
  ) {}

  async run(
    storyboard: Storyboard,
    planned: PlannedScene[],
    brief: VideoBrief,
    paths: JobPaths,
    warnings: string[],
    progress: (p: number, msg?: string) => void,
    signal?: AbortSignal,
  ): Promise<Storyboard> {
    const sb: Storyboard = { ...storyboard, brand: { ...storyboard.brand }, scenes: storyboard.scenes.map((s) => ({ ...s })) };
    this.domain = detectDomain([brief.prompt, brief.topic, ...brief.keywords].join(' '));
    this.deps.logger.debug(`media domain: ${this.domain.id}`);
    const { library } = this.deps;
    if (library && brief.brand) {
      const logo = library.findLogo(brief.brand);
      if (logo) sb.brand.logo = importAsset(logo.file, paths.publicDir, 'brand');
    }

    for (let i = 0; i < sb.scenes.length; i++) {
      if (signal?.aborted) throw signal.reason;
      const scene = sb.scenes[i]!;
      this.sceneIndex = i;
      if (!wantsMedia(scene, this.options.coverage)) continue;
      progress(i / sb.scenes.length, `Visuel ${i + 1}/${sb.scenes.length}`);
      // Alternate clips and photos: lively but lighter to download and render.
      const preferVideo = this.options.stockVideos && (scene.kind === 'image' || i % 2 === 0);
      const media = await this.findMedia(scene, planned[i], brief, paths, preferVideo, warnings, signal);
      if (media) scene.media = media;
    }

    if (this.credits.length) {
      const lines = ['# Crédits des médias', '', ...this.credits.map((c) => `- ${c.sceneId} : ${c.author} — ${c.provider} — ${c.url}`), ''];
      fs.writeFileSync(path.join(paths.dir, 'credits.md'), lines.join('\n'));
    }
    return sb;
  }

  private async findMedia(scene: Scene, plan: PlannedScene | undefined, brief: VideoBrief, paths: JobPaths, preferVideo: boolean, warnings: string[], signal?: AbortSignal): Promise<Media | undefined> {
    for (const source of this.options.sources) {
      if (source === 'assets') {
        const media = this.fromAssets(scene, plan, brief, paths);
        if (media) return media;
      } else if (source === 'stock') {
        const media = await this.fromStock(scene, plan, brief, paths, preferVideo, warnings, signal);
        if (media) return media;
      } else if (source === 'ai') {
        const media = await this.fromAI(scene, plan, brief, paths, warnings, signal);
        if (media) return media;
      }
    }
    return undefined;
  }

  private fromAssets(scene: Scene, plan: PlannedScene | undefined, brief: VideoBrief, paths: JobPaths): Media | undefined {
    const { library } = this.deps;
    if (!library) return undefined;
    const keywords = [...(plan?.visualKeywords ?? []), brief.audience, brief.location].filter(Boolean);
    const match = library.findBest(['image', 'video'], keywords, this.used, 1);
    if (!match) return undefined;
    this.used.add(match.file);
    return { type: match.type === 'video' ? 'video' : 'image', src: importAsset(match.file, paths.publicDir, 'media'), fit: 'cover', origin: 'asset' };
  }

  private async fromStock(scene: Scene, plan: PlannedScene | undefined, brief: VideoBrief, paths: JobPaths, preferVideo: boolean, warnings: string[], signal?: AbortSignal): Promise<Media | undefined> {
    const providers = this.deps.stock.filter((p) => !this.disabledProviders.has(p.id));
    if (!providers.length) return undefined;
    const kinds: StockKind[] = preferVideo ? ['video', 'photo'] : ['photo', 'video'];
    const orientation = orientationFor(brief.width, brief.height);
    const minShortSide = Math.min(brief.width, brief.height);
    // Two industry searches per scene, rotating so that scenes get different pictures.
    const n = this.domain.queries.length;
    const domainQueries = [this.domain.queries[(this.sceneIndex * 2) % n]!, this.domain.queries[(this.sceneIndex * 2 + 1) % n]!];
    const queries = buildStockQueries(scene, plan, brief, this.options.keywordLanguage, domainQueries);

    for (const { query, language } of queries) {
      for (const kind of kinds) {
        if (kind === 'video' && !this.options.stockVideos) continue;
        for (const provider of providers) {
          if (!provider.supports.includes(kind) || this.disabledProviders.has(provider.id)) continue;
          let results: StockResult[];
          try {
            results = await provider.search({ query, kind, orientation, language, minShortSide, perPage: 12, signal });
          } catch (err) {
            if (signal?.aborted) throw err;
            this.handleProviderError(provider.id, err, warnings);
            continue;
          }
          const result = results.find((r) => !this.used.has(r.id));
          if (!result) continue;
          try {
            const file = path.join(paths.publicDir, 'media', `${scene.id}-${provider.id}.${result.extension}`);
            fs.writeFileSync(file, await httpBuffer(result.downloadUrl, { provider: provider.id, signal, timeoutMs: 180_000 }));
            this.used.add(result.id);
            await provider.trackUse?.(result, signal);
            this.credits.push({ sceneId: scene.id, provider: provider.id, author: result.author, url: result.pageUrl });
            this.deps.logger.debug(`media ${scene.id}: ${provider.id} ${kind} "${query}"`);
            return {
              type: result.kind === 'video' ? 'video' : 'image',
              src: path.relative(paths.publicDir, file).split(path.sep).join('/'),
              fit: 'cover',
              origin: `stock:${provider.id}`,
              durationInFrames: result.durationSec ? Math.max(1, Math.floor(result.durationSec * brief.fps) - 1) : undefined,
              credit: { author: result.author, source: provider.id, url: result.pageUrl },
            };
          } catch (err) {
            if (signal?.aborted) throw err;
            warnings.push(`download failed (${provider.id}, ${scene.id}): ${errorMessage(err)}`);
          }
        }
      }
    }
    return undefined;
  }

  private async fromAI(scene: Scene, plan: PlannedScene | undefined, brief: VideoBrief, paths: JobPaths, warnings: string[], signal?: AbortSignal): Promise<Media | undefined> {
    const prompt =
      plan?.visualPrompt ||
      [scene.headline.replace(/\*/g, ''), brief.audience, brief.location, 'photorealistic, natural light, no text'].filter(Boolean).join(', ');
    const base = path.join(paths.publicDir, 'media', `${scene.id}-generated`);
    const { video, image } = this.deps;
    if (video && scene.kind === 'image' && this.generatedClips < this.options.maxGeneratedClips) {
      try {
        const { file } = await video.generate({ prompt, width: brief.width, height: brief.height, durationSec: scene.durationInFrames / brief.fps, outFileBase: base, signal });
        this.generatedClips++;
        return { type: 'video', src: path.relative(paths.publicDir, file).split(path.sep).join('/'), fit: 'cover', origin: `ai:${video.id}` };
      } catch (err) {
        if (signal?.aborted) throw err;
        warnings.push(`video generation failed for ${scene.id}: ${errorMessage(err)}`);
      }
    }
    if (image && this.generatedImages < this.options.maxGeneratedImages && !this.disabledProviders.has(`ai:${image.id}`)) {
      try {
        const { file } = await image.generate({ prompt, width: brief.width, height: brief.height, outFileBase: base, signal });
        this.generatedImages++;
        return { type: 'image', src: path.relative(paths.publicDir, file).split(path.sep).join('/'), fit: 'cover', origin: `ai:${image.id}` };
      } catch (err) {
        if (signal?.aborted) throw err;
        this.handleProviderError(`ai:${image.id}`, err, warnings);
      }
    }
    return undefined;
  }

  /** Authentication/quota errors disable the provider for the rest of the video. */
  private handleProviderError(id: string, err: unknown, warnings: string[]): void {
    const message = errorMessage(err);
    if (err instanceof ProviderError && /HTTP (401|403|429)/.test(message)) {
      this.disabledProviders.add(id);
      warnings.push(`${id} disabled for this video: ${message}${err.hint ? ` (${err.hint})` : ''}`);
    } else {
      warnings.push(`${id}: ${message}`);
    }
  }
}
