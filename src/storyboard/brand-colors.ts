/** Brand colours given in the prompt ("couleurs : #0B1C8C, #3CC8C8") applied to the style's palette. */
import type { Theme } from '../remotion/contract/storyboard';

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;

export const parseHexColors = (text: string): string[] => [...new Set((text.match(HEX) ?? []).map((c) => (c.length === 4 ? `#${[...c.slice(1)].map((x) => x + x).join('')}` : c).toUpperCase()))].slice(0, 4);

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
/** WCAG relative luminance. */
export const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const mix = (hex: string, target: string, amount: number) => {
  const a = rgb(hex);
  const b = rgb(target);
  return `#${a.map((c, i) => Math.round((c + (b[i]! - c) * amount) * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
};

/**
 * Dark brand colours become the background, bright ones the primary/accent colours.
 * Text colour follows the background so that it stays readable.
 */
export const applyBrandColors = (theme: Theme, colors: string[]): Theme => {
  if (!colors.length) return theme;
  const sorted = [...colors].sort((a, b) => luminance(a) - luminance(b));
  const darkest = sorted[0]!;
  const brights = sorted.filter((c) => luminance(c) > 0.18);
  const palette = { ...theme.palette };
  if (luminance(darkest) < 0.08) {
    palette.background = darkest;
    palette.backgroundAlt = mix(darkest, '#000000', 0.45);
    palette.text = '#FFFFFF';
    palette.mutedText = 'rgba(255,255,255,0.75)';
    palette.surface = 'rgba(255,255,255,0.08)';
  }
  const primary = brights[brights.length - 1] ?? (darkest === sorted[sorted.length - 1] ? palette.primary : sorted[sorted.length - 1]!);
  palette.primary = primary;
  palette.accent = brights.length > 1 ? brights[brights.length - 2]! : primary;
  palette.secondary = palette.accent;
  palette.onPrimary = luminance(primary) > 0.4 ? '#0B1020' : '#FFFFFF';
  return { ...theme, palette };
};
