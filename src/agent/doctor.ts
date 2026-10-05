/** Environment diagnostics: what works, what is optional, what is missing. */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { AppConfig } from '../config/config';
import { describeSecrets } from '../config/config';
import { errorMessage } from '../core/errors';
import { resolveLLM } from '../llm/registry';
import { resolveImageProvider } from '../providers/image/registry';
import { resolveStockProviders } from '../providers/stock/registry';
import { platformStatus } from '../publish/registry';
import { resolveVideoProvider } from '../providers/video/registry';
import { detectSystemEngine } from '../providers/voice/system';
import { resolveVoiceProvider } from '../providers/voice/registry';
import { resolveBrowser } from '../render/browser';

export interface Check {
  name: string;
  status: 'ok' | 'warn' | 'error' | 'info';
  detail: string;
}

const tryResolve = <T>(fn: () => T): { value?: T; error?: string } => {
  try {
    return { value: fn() };
  } catch (err) {
    return { error: errorMessage(err) };
  }
};

export const providerStatus = (config: AppConfig) => {
  const llm = tryResolve(() => resolveLLM(config));
  const voice = tryResolve(() => resolveVoiceProvider(config));
  const image = tryResolve(() => resolveImageProvider(config));
  const video = tryResolve(() => resolveVideoProvider(config));
  const stock = tryResolve(() => resolveStockProviders(config));
  return {
    stock: stock.error ? `error: ${stock.error}` : stock.value!.map((p) => p.id).join(', ') || 'none',
    platforms: platformStatus(config).filter((p) => p.configured).map((p) => p.id).join(', ') || 'none',
    llm: llm.error ? `error: ${llm.error}` : llm.value ? `${llm.value.id} (${llm.value.model})` : 'procedural (no LLM configured)',
    voice: voice.error ? `error: ${voice.error}` : voice.value?.id ?? 'none',
    image: image.error ? `error: ${image.error}` : image.value?.id ?? 'none',
    video: video.error ? `error: ${video.error}` : video.value?.id ?? 'none',
    music: config.env.VIDEO_AGENT_MUSIC,
    systemVoice: detectSystemEngine() ?? 'not available',
    secrets: describeSecrets(config.env),
  };
};

export const runDoctor = (config: AppConfig): Check[] => {
  const checks: Check[] = [];
  const [major, minor] = process.versions.node.split('.').map(Number) as [number, number];
  checks.push({
    name: 'Node.js',
    status: major > 20 || (major === 20 && minor >= 3) ? 'ok' : 'error',
    detail: `v${process.versions.node} (>= 20.3 required)`,
  });

  const require = createRequire(import.meta.url);
  for (const pkg of ['remotion', '@remotion/renderer', '@remotion/bundler']) {
    const r = tryResolve(() => require(`${pkg}/package.json`).version as string);
    checks.push({ name: pkg, status: r.value ? 'ok' : 'error', detail: r.value ? `v${r.value}` : 'not installed — run npm install' });
  }
  const compositor = `@remotion/compositor-${process.platform}-${process.arch}${process.platform === 'linux' ? '-gnu' : process.platform === 'win32' ? '-msvc' : ''}`;
  const comp = tryResolve(() => require.resolve(`${compositor}/package.json`));
  checks.push({
    name: 'FFmpeg (Remotion compositor)',
    status: comp.value ? 'ok' : 'warn',
    detail: comp.value ? `${compositor} (bundled FFmpeg, no system install needed)` : `${compositor} not found — reinstall dependencies (npm install)`,
  });

  const browser = tryResolve(() => resolveBrowser(config.browserExecutable));
  checks.push({
    name: 'Headless browser',
    status: browser.error ? 'error' : browser.value!.source === 'remotion' ? 'info' : 'ok',
    detail: browser.error ?? (browser.value!.executable ? `${browser.value!.executable} (${browser.value!.source})` : 'Remotion will download Chrome Headless Shell on the first render (internet required once)'),
  });

  for (const [name, dir] of [['Output directory', config.paths.output], ['Assets directory', config.paths.assets]] as const) {
    if (fs.existsSync(dir)) {
      const writable = tryResolve(() => fs.accessSync(dir, fs.constants.W_OK));
      checks.push({ name, status: writable.error ? 'error' : 'ok', detail: `${dir}${writable.error ? ' (not writable)' : ''}` });
    } else {
      checks.push({ name, status: name === 'Output directory' ? 'info' : 'info', detail: `${dir} (will be created / optional)` });
    }
  }

  const providers = providerStatus(config);
  checks.push({ name: 'LLM', status: providers.llm.startsWith('error') ? 'error' : providers.llm.startsWith('procedural') ? 'info' : 'ok', detail: providers.llm });
  checks.push({ name: 'Voice', status: providers.voice.startsWith('error') ? 'warn' : 'info', detail: `${providers.voice} (system engine: ${providers.systemVoice})` });
  checks.push({ name: 'Stock photos/videos', status: providers.stock.startsWith('error') ? 'warn' : providers.stock === 'none' ? 'info' : 'ok', detail: providers.stock === 'none' ? 'none (add PEXELS_API_KEY, PIXABAY_API_KEY or UNSPLASH_ACCESS_KEY — free)' : providers.stock });
  checks.push({ name: 'AI images', status: providers.image.startsWith('error') ? 'warn' : 'info', detail: providers.image });
  checks.push({ name: 'Video clips', status: providers.video.startsWith('error') ? 'warn' : 'info', detail: providers.video });
  checks.push({ name: 'Music', status: 'info', detail: providers.music });
  for (const p of platformStatus(config)) {
    checks.push({ name: `Publication ${p.label}`, status: p.configured ? 'ok' : 'info', detail: p.configured ? p.notes.join(' · ') || 'configured' : `not configured (${p.missing.join(', ')})` });
  }
  return checks;
};
