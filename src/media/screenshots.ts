/**
 * Captures of the web pages named in a request ("montre notre plateforme https://…"): the page is
 * opened in the headless Chrome used for rendering and shown in the video inside a browser window
 * or a phone that scrolls down the page.
 */
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ensureBrowser } from '@remotion/renderer';
import { findFfmpeg } from '../audio/ffmpeg';
import type { PlannedScene } from '../core/types';
import { normalize } from '../prompt/parser';
import type { Media, Scene } from '../remotion/contract/storyboard';
import { resolveBrowser } from '../render/browser';

export type ScreenDevice = 'desktop' | 'mobile';

/** At most this many pages per video: each capture takes 10 to 20 seconds. */
export const MAX_SCREENS = 3;

/** Web addresses written in the request, in order, without duplicates ("www.site.com" → https://www.site.com/). */
export const findUrls = (text: string, max = MAX_SCREENS): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s«»"'<>()[\]{}]+/gi)) {
    const raw = match[0].replace(/[.,;:!?…]+$/, '');
    let url: URL;
    try {
      url = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`);
    } catch {
      continue;
    }
    const key = `${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, '')}${url.search}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url.href);
    if (out.length >= max) break;
  }
  return out;
};

/** Loopback, private, link-local, carrier-grade NAT, multicast and reserved addresses. */
export const isPrivateAddress = (address: string): boolean => {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPrivateAddress(mapped[1]!);
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = address.toLowerCase();
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6);
};

/**
 * Only public web pages: the server opens them for its customers, so an address pointing inside
 * its own network (localhost, 192.168.x.x, cloud metadata…) is refused.
 */
export const assertPublicUrl = async (href: string): Promise<URL> => {
  const url = new URL(href);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`unsupported address: ${href}`);
  if (url.username || url.password) throw new Error('addresses with a login are not captured');
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error(`port ${url.port} is not allowed`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.(?:localhost|local|internal|lan|home)$/i.test(host)) throw new Error(`${host} is not a public site`);
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new Error(`${host} is not a public site`);
  return url;
};

/** Browser window size and pixel density of each device. */
const DEVICES: Record<ScreenDevice, { width: number; height: number; viewport: number; scale: number; userAgent?: string }> = {
  // Two screens of a desktop page: enough to scroll through during a scene.
  desktop: { width: 1440, height: 2700, viewport: 900, scale: 1 },
  mobile: {
    width: 390,
    height: 2400,
    viewport: 844,
    scale: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  },
};

const browserExecutable = async (configured?: string): Promise<string> => {
  const resolved = resolveBrowser(configured);
  if (resolved.executable) return resolved.executable;
  const status = await ensureBrowser();
  if (status.type === 'local-puppeteer-browser' || status.type === 'user-defined-path') return status.path;
  throw new Error('no headless browser available for the captures');
};

const run = (bin: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], signal, timeout: timeoutMs, env: { ...process.env, LD_LIBRARY_PATH: [path.dirname(bin), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${path.basename(bin)} exited with ${code}: ${err.slice(-300)}`))));
  });

/**
 * Height of the content of a capture: the rows below the last one that differs from the bottom row
 * are the empty end of a short page. Read on a 32-pixel-wide grey copy made by ffmpeg (through
 * image2pipe: Remotion's ffmpeg has the rawvideo encoder but not the rawvideo muxer).
 */
export const contentRows = (gray: Buffer, width: number): { rows: number; content: number; blank: boolean } => {
  const rows = Math.floor(gray.length / width);
  const differs = (y: number, ref: number) => {
    for (let x = 0; x < width; x++) if (Math.abs(gray[y * width + x]! - gray[ref * width + x]!) > 10) return true;
    return false;
  };
  let last = rows - 1;
  while (last > 0 && !differs(last, rows - 1)) last--;
  const blank = !Array.from({ length: rows }, (_, y) => y).some((y) => differs(y, 0));
  return { rows, content: last + 1, blank };
};

export interface Capture {
  /** Absolute path of the PNG. */
  file: string;
  width: number;
  height: number;
}

/** Open the page in headless Chrome and save a PNG, without the empty end of a short page. */
export const captureScreen = async (
  href: string,
  outFile: string,
  opts: { device: ScreenDevice; browser?: string; language?: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<Capture> => {
  const url = await assertPublicUrl(href);
  const device = DEVICES[opts.device];
  const bin = await browserExecutable(opts.browser);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sovid-screen-'));
  const raw = `${outFile}.raw.png`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  try {
    await run(
      bin,
      [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--mute-audio',
        '--no-first-run',
        '--disable-extensions',
        ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []),
        `--user-data-dir=${profile}`,
        `--lang=${opts.language ?? 'fr'}`,
        `--window-size=${device.width},${device.height}`,
        `--force-device-scale-factor=${device.scale}`,
        ...(device.userAgent ? [`--user-agent=${device.userAgent}`] : []),
        // Time for scripts, fonts and lazy images to load.
        '--virtual-time-budget=8000',
        `--screenshot=${raw}`,
        url.href,
      ],
      opts.timeoutMs ?? 60_000,
      opts.signal,
    );
    if (!fs.existsSync(raw)) throw new Error(`no capture of ${url.hostname}`);
    const width = device.width * device.scale;
    const height = device.height * device.scale;
    const ffmpeg = findFfmpeg();
    const gray = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', raw, '-vf', 'scale=32:-1', '-pix_fmt', 'gray', '-c:v', 'rawvideo', '-f', 'image2pipe', 'pipe:1'], 30_000, opts.signal);
    const { rows, content, blank } = contentRows(gray, 32);
    if (blank) throw new Error(`${url.hostname} shows an empty page`);
    // Keep at least one screen, plus a small margin under the content.
    const keep = Math.min(height, Math.max(device.viewport * device.scale, Math.ceil(((content + 1) / rows) * height)));
    if (keep < height) {
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-vf', `crop=${width}:${keep}:0:0`, outFile], 30_000, opts.signal);
    } else {
      fs.copyFileSync(raw, outFile);
    }
    return { file: outFile, width, height: keep };
  } finally {
    fs.rmSync(raw, { force: true });
    // Chrome's helper processes may still hold files of the profile for a moment (Windows): cleaning
    // up is best effort and never costs the capture.
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* left in the temp folder */
    }
  }
};

// ---- Where the captures go -------------------------------------------------------------

const PRODUCT_WORDS = /\b(site|sites|web|plateforme|platform|application|app|apps|appli|dashboard|tableau de bord|interface|saas|logiciel|software|outil|tool|portail|portal|boutique en ligne|e-?shop|store)\b/;
const MOBILE_WORDS = /\b(mobile|smartphone|telephone|phone|iphone|android|appli mobile|application mobile)\b/;
const DESKTOP_WORDS = /\b(ordinateur|desktop|pc|laptop|portable|dashboard|tableau de bord|ecran large)\b/;

const sceneText = (scene: Scene, plan: PlannedScene | undefined): string =>
  normalize([scene.headline, scene.body, scene.narration, ...scene.items, plan?.visualPrompt ?? '', ...(plan?.visualKeywords ?? [])].join(' ').replace(/\*/g, ''));

/**
 * The scene each address is shown in (-1: none). In order of preference: the scene that names the
 * site, then a scene about a site / platform / application, then a free middle scene. The opening
 * title and the closing call to action keep their own visuals.
 */
export const chooseScreenScenes = (urls: string[], scenes: Scene[], planned: Array<PlannedScene | undefined>): number[] => {
  const n = scenes.length;
  const texts = scenes.map((scene, i) => sceneText(scene, planned[i]));
  const middle = scenes.map((_, i) => i).filter((i) => !(n > 2 && i === 0 && scenes[i]!.kind === 'title') && scenes[i]!.kind !== 'cta');
  // Scenes that keep their text when they become a picture scene come first.
  const byKind = (list: number[]) => [...list].sort((a, b) => Number(!['image', 'text'].includes(scenes[a]!.kind)) - Number(!['image', 'text'].includes(scenes[b]!.kind)));
  const taken = new Set<number>();
  return urls.map((href) => {
    const host = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
    const named = middle.find((i) => !taken.has(i) && texts[i]!.includes(host));
    const product = byKind(middle.filter((i) => !taken.has(i) && PRODUCT_WORDS.test(texts[i]!)))[0];
    const free = byKind(middle.filter((i) => !taken.has(i)))[0];
    const chosen = named ?? product ?? free ?? -1;
    if (chosen >= 0) taken.add(chosen);
    return chosen;
  });
};

/** Phone frame in a vertical video unless the scene talks about a computer, and the other way round. */
export const deviceFor = (scene: Scene, portrait: boolean): ScreenDevice => {
  // What the scene shows and says only: the English stock searches ("person using a laptop") would
  // put a desktop page, unreadable at that size, in most vertical videos.
  const text = normalize([scene.headline, scene.body, scene.narration, ...scene.items].join(' '));
  if (MOBILE_WORDS.test(text) && !DESKTOP_WORDS.test(text)) return 'mobile';
  if (DESKTOP_WORDS.test(text) && !MOBILE_WORDS.test(text)) return 'desktop';
  return portrait ? 'mobile' : 'desktop';
};

/** The scene shows the capture: it becomes a picture scene, its headline and text under the screen. */
export const showScreen = (scene: Scene, media: Media): Scene => {
  const body = scene.body || (scene.items.length ? scene.items.join(' · ') : scene.stat ? `${scene.stat.value} ${scene.stat.label}` : '');
  return { ...scene, kind: 'image', body, media, shots: undefined };
};
