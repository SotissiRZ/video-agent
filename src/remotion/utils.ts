import { useMemo } from 'react';
import { staticFile, useVideoConfig } from 'remotion';
import type { SpringConfig } from 'remotion';
import type { Theme } from './contract/storyboard';

/** Resolve a storyboard asset path: remote URLs are kept, everything else lives in the public dir. */
export const resolveSrc = (src: string): string =>
  /^(https?:|data:|blob:)/i.test(src) ? src : staticFile(src.replace(/^\/+/, ''));

export const springFor = (motion: Theme['motion']): Partial<SpringConfig> => {
  switch (motion) {
    case 'energetic':
      return { damping: 11, stiffness: 170, mass: 0.6 };
    case 'calm':
      return { damping: 200, stiffness: 70, mass: 1 };
    default:
      return { damping: 16, stiffness: 110, mass: 0.8 };
  }
};

/** Add alpha to a #RRGGBB colour. Other colour formats are returned unchanged. */
export const withAlpha = (color: string, alpha: number): string => {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

export interface Layout {
  width: number;
  height: number;
  /** Shortest side, used as the typographic unit so all formats look balanced. */
  unit: number;
  isPortrait: boolean;
  isSquare: boolean;
  padX: number;
  padY: number;
  contentWidth: number;
}

export const useLayout = (): Layout => {
  const { width, height } = useVideoConfig();
  return useMemo(() => {
    const unit = Math.min(width, height);
    const isPortrait = height > width * 1.15;
    const isSquare = !isPortrait && width < height * 1.15;
    const padX = Math.round(width * (isPortrait ? 0.08 : 0.07));
    // Vertical videos keep clear of the platform UI at top and bottom.
    const padY = Math.round(height * (isPortrait ? 0.12 : 0.09));
    return { width, height, unit, isPortrait, isSquare, padX, padY, contentWidth: width - padX * 2 };
  }, [width, height]);
};

/**
 * Pick a font size so that `text` fits comfortably: shrinks as text grows.
 * `scale` is relative to the layout unit (shortest side). The longest word always fits on
 * one line, so that a name such as "ZSR-TechNum" is never broken at its hyphen.
 */
export const fitFontSize = (text: string, layout: Layout, scale: number, min = 0.035, reference = layout.isPortrait ? 22 : 34): number => {
  const plain = text.replace(/\*/g, '');
  const length = Math.max(1, plain.length);
  const factor = Math.min(1, Math.sqrt(reference / length));
  const longestWord = Math.max(1, ...plain.split(/\s+/).map((w) => w.length));
  // Bold display fonts average ~0.72 em per character (uppercase included).
  const wordFit = layout.contentWidth / (longestWord * 0.72);
  return Math.round(Math.min(wordFit, layout.unit * Math.max(min, scale * factor)));
};

export interface TextSegment {
  text: string;
  emphasis: boolean;
}

/** Split `*emphasis*` markup into segments. */
export const parseEmphasis = (text: string): TextSegment[] => {
  const segments: TextSegment[] = [];
  const re = /\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), emphasis: false });
    segments.push({ text: m[1]!, emphasis: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), emphasis: false });
  return segments;
};

/** Deterministic pseudo random in [0, 1) — renders must be reproducible across frames and machines. */
export const seeded = (seed: number): number => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Font size for paragraphs: readable on phones, shrinks gently for long text. */
export const bodyFontSize = (text: string, layout: Layout): number =>
  fitFontSize(text, layout, layout.isPortrait ? 0.05 : 0.042, layout.isPortrait ? 0.038 : 0.03, layout.isPortrait ? 60 : 90);
