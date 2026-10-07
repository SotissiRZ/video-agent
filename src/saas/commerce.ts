import { z } from 'zod';
import type { Db } from './db';
import { HttpError } from './http';

export const COMMERCE_DEFAULTS = {
  videoPriceXof: 1000,
  videoPriceMad: 15,
  songPriceXof: 1500,
  songPriceMad: 25,
  freeVideosPerMonth: 3,
  freeMinutesPerMonth: 3,
  freeSongsPerMonth: 1,
  freeMaxDurationSec: 60,
  creatorVideosPerMonth: 30,
  creatorMinutesPerMonth: 60,
  creatorSongsPerMonth: 10,
  creatorMaxDurationSec: 180,
  proVideosPerMonth: 120,
  proMinutesPerMonth: 300,
  proSongsPerMonth: 40,
  proMaxDurationSec: 600,
  correctionsPerVideo: 1,
  correctionsPerSong: 1,
  maxProductImages: 4,
  maxProductImageMb: 5,
} as const;

const CommerceSchema = z.object({
  videoPriceXof: z.number().int().min(0).max(100_000_000),
  videoPriceMad: z.number().int().min(0).max(1_000_000),
  songPriceXof: z.number().int().min(0).max(100_000_000),
  songPriceMad: z.number().int().min(0).max(1_000_000),
  freeVideosPerMonth: z.number().int().min(0).max(1000),
  freeMinutesPerMonth: z.number().int().min(0).max(10_000),
  freeSongsPerMonth: z.number().int().min(0).max(1000),
  freeMaxDurationSec: z.number().int().min(3).max(600),
  creatorVideosPerMonth: z.number().int().min(0).max(10_000),
  creatorMinutesPerMonth: z.number().int().min(0).max(100_000),
  creatorSongsPerMonth: z.number().int().min(0).max(10_000),
  creatorMaxDurationSec: z.number().int().min(3).max(600),
  proVideosPerMonth: z.number().int().min(0).max(10_000),
  proMinutesPerMonth: z.number().int().min(0).max(100_000),
  proSongsPerMonth: z.number().int().min(0).max(10_000),
  proMaxDurationSec: z.number().int().min(3).max(600),
  correctionsPerVideo: z.number().int().min(0).max(5),
  correctionsPerSong: z.number().int().min(0).max(5),
  maxProductImages: z.number().int().min(0).max(20),
  maxProductImageMb: z.number().int().min(1).max(20),
});

export type CommerceSettings = z.infer<typeof CommerceSchema>;

export const parseCommerceSettings = (value: unknown): CommerceSettings => {
  const result = CommerceSchema.safeParse(value);
  if (!result.success) throw new HttpError(400, result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '), 'invalid_commerce_settings');
  return result.data;
};

export const getCommerceSettings = async (db: Db): Promise<CommerceSettings> => {
  const row = await db.one<{ settings: CommerceSettings | string }>('SELECT settings FROM commerce_settings WHERE id = 1');
  if (!row) return { ...COMMERCE_DEFAULTS };
  const stored = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
  return parseCommerceSettings({ ...COMMERCE_DEFAULTS, ...stored });
};

export const saveCommerceSettings = async (db: Db, value: unknown): Promise<CommerceSettings> => {
  const settings = parseCommerceSettings(value);
  await db.query(
    `INSERT INTO commerce_settings (id, settings) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET settings = excluded.settings, updated_at = now()`,
    [JSON.stringify(settings)],
  );
  return settings;
};

export const exportPrice = (settings: CommerceSettings, product: 'video' | 'song', currency: 'XOF' | 'MAD'): number => {
  if (product === 'video') return currency === 'XOF' ? settings.videoPriceXof : settings.videoPriceMad;
  return currency === 'XOF' ? settings.songPriceXof : settings.songPriceMad;
};
