/**
 * Local asset library. Users drop files in the assets directory (optionally with a manifest.json
 * describing tags); the agent picks the best match for each scene by keyword overlap.
 *
 * assets/
 *   logo.png                 → used as brand logo (name contains "logo")
 *   images/market-ouaga.jpg  → tags from the file name: market, ouaga
 *   music/upbeat.mp3         → background music candidates
 *   manifest.json            → optional: [{ "file": "images/x.jpg", "tags": ["taxi", "driver"], "brand": "Sirago" }]
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalize } from '../prompt/parser';

export type AssetType = 'image' | 'video' | 'audio' | 'logo';

export interface Asset {
  /** Absolute path. */
  file: string;
  /** Path relative to the assets root. */
  relative: string;
  type: AssetType;
  tags: string[];
  brand?: string;
}

const EXTENSIONS: Record<string, AssetType> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.svg': 'image', '.avif': 'image',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.m4v': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.aac': 'audio', '.ogg': 'audio',
};

interface ManifestEntry {
  file: string;
  tags?: string[];
  type?: AssetType;
  brand?: string;
}

/** Light stemming so that plurals match ("chauffeurs" ↔ "chauffeur", "images" ↔ "image"). */
const stem = (w: string): string => (w.length > 4 ? w.replace(/(?:es|s|x)$/, '') : w);

const tokenize = (s: string): string[] =>
  normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2)
    .map(stem);

const walk = (dir: string, out: string[] = []): string[] => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

export class AssetLibrary {
  private constructor(
    readonly root: string,
    readonly assets: Asset[],
  ) {}

  static load(root: string): AssetLibrary {
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = new Map<string, ManifestEntry>();
    if (fs.existsSync(manifestPath)) {
      try {
        const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ManifestEntry[];
        for (const e of entries) manifest.set(path.normalize(e.file), e);
      } catch (err) {
        throw new Error(`Invalid ${manifestPath}: ${(err as Error).message}`);
      }
    }
    const assets: Asset[] = [];
    for (const file of walk(root)) {
      const ext = path.extname(file).toLowerCase();
      const baseType = EXTENSIONS[ext];
      if (!baseType) continue;
      const relative = path.relative(root, file);
      const meta = manifest.get(path.normalize(relative));
      const nameTags = tokenize(relative.replace(ext, ''));
      const isLogo = nameTags.includes('logo') || meta?.type === 'logo';
      assets.push({
        file,
        relative,
        type: meta?.type ?? (isLogo && baseType === 'image' ? 'logo' : baseType),
        tags: [...new Set([...nameTags, ...(meta?.tags ?? []).flatMap(tokenize)])],
        brand: meta?.brand,
      });
    }
    return new AssetLibrary(root, assets);
  }

  get size(): number {
    return this.assets.length;
  }

  /** Brand logo: prefer one whose name/brand matches the brand. */
  findLogo(brand: string): Asset | undefined {
    const logos = this.assets.filter((a) => a.type === 'logo');
    const b = tokenize(brand);
    return logos.find((a) => (a.brand && normalize(a.brand) === normalize(brand)) || b.some((t) => a.tags.includes(t))) ?? (b.length ? undefined : logos[0]);
  }

  /** Score assets of the given types by tag overlap; returns the best above `minScore`. */
  findBest(types: AssetType[], keywords: string[], exclude: Set<string> = new Set(), minScore = 1): Asset | undefined {
    const words = new Set(keywords.flatMap(tokenize));
    let best: { asset: Asset; score: number } | undefined;
    for (const asset of this.assets) {
      if (!types.includes(asset.type) || exclude.has(asset.file)) continue;
      const score = asset.tags.reduce((s, t) => s + (words.has(t) ? 1 : 0), 0);
      if (score >= minScore && (!best || score > best.score)) best = { asset, score };
    }
    return best?.asset;
  }

  music(keywords: string[]): Asset | undefined {
    const tracks = this.assets.filter((a) => a.type === 'audio' && (a.tags.includes('music') || a.tags.includes('musique') || a.relative.startsWith('music')));
    if (!tracks.length) return undefined;
    return this.findBest(['audio'], keywords, new Set(), 1) ?? tracks[0];
  }
}

/** Copy an asset into the job public dir; returns the public-relative path. */
export const importAsset = (source: string, publicDir: string, subdir: string): string => {
  const name = `${path.basename(source, path.extname(source)).replace(/[^\w.-]+/g, '-')}${path.extname(source).toLowerCase()}`;
  const relative = path.posix.join(subdir, name);
  const target = path.join(publicDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return relative;
};
