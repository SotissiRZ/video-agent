/** Video format presets and resolution parsing. */

export interface FormatPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  aspect: string;
  aliases: string[];
}

export const FORMAT_PRESETS: FormatPreset[] = [
  { id: 'landscape', label: 'Paysage 16:9 (1920×1080)', width: 1920, height: 1080, aspect: '16:9', aliases: ['16:9', 'horizontal', 'horizontale', 'paysage', 'youtube', 'hd', '1080p', 'widescreen'] },
  { id: 'vertical', label: 'Vertical 9:16 (1080×1920)', width: 1080, height: 1920, aspect: '9:16', aliases: ['9:16', 'portrait', 'verticale', 'story', 'stories', 'reel', 'reels', 'tiktok', 'shorts'] },
  { id: 'square', label: 'Carré 1:1 (1080×1080)', width: 1080, height: 1080, aspect: '1:1', aliases: ['1:1', 'carre', 'carré', 'carree', 'carrée', 'post'] },
  { id: 'portrait', label: 'Portrait 4:5 (1080×1350)', width: 1080, height: 1350, aspect: '4:5', aliases: ['4:5', 'feed'] },
];

export const DEFAULT_FORMAT_ID = 'landscape';

export interface Resolution {
  width: number;
  height: number;
}

/**
 * Resolve a format string: a preset id/alias ("vertical", "9:16"), or explicit "WIDTHxHEIGHT".
 * Returns undefined when the value is not understood.
 */
export const resolveFormat = (value: string | undefined): (Resolution & { id: string }) | undefined => {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  const explicit = /^(\d{2,5})\s*[x×*:]\s*(\d{2,5})$/.exec(v);
  if (explicit && Number(explicit[1]) >= 16 && Number(explicit[2]) >= 16 && !/^\d{1,2}:\d{1,2}$/.test(v)) {
    const width = Number(explicit[1]);
    const height = Number(explicit[2]);
    const preset = FORMAT_PRESETS.find((p) => p.width === width && p.height === height);
    return { id: preset?.id ?? 'custom', width, height };
  }
  const preset = FORMAT_PRESETS.find((p) => p.id === v || p.aliases.includes(v));
  return preset ? { id: preset.id, width: preset.width, height: preset.height } : undefined;
};

/** H.264 requires even dimensions. */
export const normalizeResolution = ({ width, height }: Resolution): Resolution => ({
  width: Math.max(16, Math.round(width / 2) * 2),
  height: Math.max(16, Math.round(height / 2) * 2),
});

export const OUTPUT_FORMATS = ['mp4', 'webm', 'mov', 'gif'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const isOutputFormat = (v: unknown): v is OutputFormat =>
  typeof v === 'string' && (OUTPUT_FORMATS as readonly string[]).includes(v);

export const SUPPORTED_FPS = [24, 25, 30, 50, 60];
