/** Remotion rendering: bundle the compositions, select the composition with the storyboard, render. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { makeCancelSignal, renderMedia, renderStill, selectComposition, type Codec } from '@remotion/renderer';
import { findPackageRoot } from '../config/config';
import type { OutputFormat } from '../core/formats';
import { COMPOSITION_ID, type Storyboard } from '../remotion/contract/storyboard';
import { resolveBrowser } from './browser';

export interface RenderProgress {
  stage: 'bundle' | 'render' | 'encode' | 'poster';
  /** 0..1 */
  progress: number;
}

export interface RenderOptions {
  storyboard: Storyboard;
  /** Directory served as Remotion's public dir (assets referenced by the storyboard). */
  publicDir: string;
  outputFile: string;
  outputFormat: OutputFormat;
  posterFile?: string;
  browserExecutable?: string;
  concurrency?: number;
  crf?: number;
  /** H.264 encoder preset (default veryfast). */
  x264Preset?: X264Preset;
  /** Chrome OpenGL backend; undefined/'auto' = Chrome's default. */
  gl?: RenderGl;
  timeoutMs?: number;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
  /** Override the Remotion entry point (tests). */
  entryPoint?: string;
}

export type X264Preset = 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';
export type RenderGl = 'auto' | 'angle' | 'swangle' | 'swiftshader' | 'egl' | 'vulkan' | 'angle-egl';

export interface RenderResult {
  file: string;
  posterFile?: string;
  durationSec: number;
  browser: string;
}

const CODECS: Record<OutputFormat, Codec> = { mp4: 'h264', webm: 'vp8', mov: 'prores', gif: 'gif' };

/** Path to src/remotion/index.ts, both from sources (tsx/vitest) and from dist/. */
export const remotionEntryPoint = (): string => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = findPackageRoot(here);
  const entry = path.join(root, 'src', 'remotion', 'index.ts');
  if (!fs.existsSync(entry)) throw new Error(`Remotion entry point not found at ${entry}`);
  return entry;
};

export const renderStoryboard = async (opts: RenderOptions): Promise<RenderResult> => {
  const report = opts.onProgress ?? (() => undefined);
  const { cancelSignal, cancel } = makeCancelSignal();
  opts.signal?.addEventListener('abort', () => cancel());

  report({ stage: 'bundle', progress: 0 });
  const serveUrl = await bundle({
    entryPoint: opts.entryPoint ?? remotionEntryPoint(),
    publicDir: opts.publicDir,
    onProgress: (p) => report({ stage: 'bundle', progress: p / 100 }),
  });
  if (opts.signal?.aborted) throw opts.signal.reason;

  const browser = resolveBrowser(opts.browserExecutable);
  const inputProps = { storyboard: opts.storyboard };
  const common = {
    serveUrl,
    inputProps,
    browserExecutable: browser.executable,
    timeoutInMilliseconds: opts.timeoutMs ?? 60_000,
    logLevel: 'error' as const,
    // Chrome's default GL backend is ~3.5x faster than 'swangle' on CPU-only machines.
    chromiumOptions: { gl: opts.gl && opts.gl !== 'auto' ? opts.gl : null },
  };
  const composition = await selectComposition({ ...common, id: COMPOSITION_ID });

  fs.mkdirSync(path.dirname(opts.outputFile), { recursive: true });
  const codec = CODECS[opts.outputFormat];
  await renderMedia({
    ...common,
    composition,
    codec,
    outputLocation: opts.outputFile,
    concurrency: opts.concurrency ?? null,
    cancelSignal,
    ...(codec === 'h264' || codec === 'vp8' ? { crf: opts.crf ?? null } : {}),
    ...(codec === 'h264' ? { x264Preset: opts.x264Preset ?? 'veryfast' } : {}),
    ...(codec === 'prores' ? { proResProfile: 'hq' as const } : {}),
    ...(codec === 'gif' ? { everyNthFrame: 2, scale: Math.min(1, 540 / Math.min(composition.width, composition.height)) } : {}),
    imageFormat: codec === 'prores' ? 'png' : 'jpeg',
    onProgress: ({ progress, stitchStage }) => report({ stage: stitchStage === 'muxing' ? 'encode' : 'render', progress }),
  });

  let posterFile: string | undefined;
  if (opts.posterFile) {
    report({ stage: 'poster', progress: 0 });
    // A frame from the first scene, after its entrance animation.
    const frame = Math.min(composition.durationInFrames - 1, Math.round(composition.fps * 1.6));
    await renderStill({ ...common, composition, output: opts.posterFile, frame, imageFormat: 'jpeg', jpegQuality: 85 });
    posterFile = opts.posterFile;
  }
  report({ stage: 'encode', progress: 1 });
  return {
    file: opts.outputFile,
    posterFile,
    durationSec: composition.durationInFrames / composition.fps,
    browser: browser.executable ?? 'remotion-managed',
  };
};
