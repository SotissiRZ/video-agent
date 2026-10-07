import { z } from 'zod';
import type { Db } from './db';
import { HttpError } from './http';

/** "env" keeps the value configured in .env; anything else overrides it for the plan. */
export const PLAN_LLMS = ['env', 'auto', 'anthropic', 'openai', 'groq', 'openai-compatible', 'ollama', 'local'] as const;
export const CLAUDE_MODELS = ['env', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'] as const;
export const PLAN_VOICES = ['env', 'auto', 'elevenlabs', 'openai', 'piper', 'system', 'none'] as const;
export const ELEVENLABS_MODELS = ['env', 'eleven_multilingual_v2', 'eleven_flash_v2_5'] as const;
export const PLAN_MUSIC = ['env', 'none', 'auto', 'elevenlabs', 'stability', 'replicate'] as const;

const PlanProvidersSchema = z.object({
  llm: z.enum(PLAN_LLMS),
  claudeModel: z.enum(CLAUDE_MODELS),
  voice: z.enum(PLAN_VOICES),
  elevenLabsModel: z.enum(ELEVENLABS_MODELS),
  /** AI-composed background music for videos ("none" = music library / synthesis, free). */
  music: z.enum(PLAN_MUSIC),
});
export type PlanProviders = z.infer<typeof PlanProvidersSchema>;

/**
 * Cost-aware defaults: the free plan runs on free or cheap services (Groq then the other LLMs,
 * Haiku when Claude answers, Piper voice, synthesized music); paid plans get Sonnet and ElevenLabs.
 */
export const PROVIDER_DEFAULTS: Record<'free' | 'creator' | 'pro', PlanProviders> = {
  free: { llm: 'groq', claudeModel: 'claude-haiku-4-5', voice: 'piper', elevenLabsModel: 'env', music: 'none' },
  creator: { llm: 'env', claudeModel: 'claude-sonnet-5-5', voice: 'env', elevenLabsModel: 'eleven_flash_v2_5', music: 'none' },
  pro: { llm: 'env', claudeModel: 'claude-sonnet-5-5', voice: 'env', elevenLabsModel: 'env', music: 'none' },
};

/**
 * Default prices and quotas, sized for profitability with the default services per plan
 * (estimates, October 2026: Sonnet ≈ $0.10 per script, ElevenLabs Flash voice ≈ $0.045/min,
 * Multilingual ≈ $0.09/min, rendering ≈ $0.02/min, a 90 s song ≈ $0.25):
 * - Creator (10,000 FCFA ≈ $16 net): at 100 % of its quota ≈ $7 of AI cost (43 %);
 * - Pro (25,000 FCFA ≈ $40 net): at 100 % ≈ $20 (49 %);
 * - Free: ≈ $0.25 per active user per month, the 60 s song being most of it.
 * Check them against the real figures of Admin › Costs and margins.
 */
export const COMMERCE_DEFAULTS = {
  videoPriceXof: 1000,
  videoPriceMad: 15,
  songPriceXof: 1500,
  songPriceMad: 25,
  freeVideosPerMonth: 3,
  freeMinutesPerMonth: 3,
  freeSongsPerMonth: 1,
  freeMaxDurationSec: 60,
  /** Longest free song: the free plan's main cost (ElevenLabs Music is billed per minute). */
  freeSongMaxSec: 60,
  creatorVideosPerMonth: 30,
  creatorMinutesPerMonth: 30,
  creatorSongsPerMonth: 8,
  creatorMaxDurationSec: 120,
  proVideosPerMonth: 80,
  proMinutesPerMonth: 60,
  proSongsPerMonth: 20,
  proMaxDurationSec: 300,
  correctionsPerVideo: 1,
  correctionsPerSong: 1,
  songPreviewSec: 30,
  maxProductImages: 4,
  maxProductImageMb: 5,
  /** Exchange rates used by the cost dashboard (local currency per US dollar). */
  usdRateXof: 600,
  usdRateMad: 10,
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
  freeSongMaxSec: z.number().int().min(30).max(120),
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
  songPreviewSec: z.number().int().min(10).max(120),
  maxProductImages: z.number().int().min(0).max(20),
  maxProductImageMb: z.number().int().min(1).max(20),
  usdRateXof: z.number().min(1).max(10_000),
  usdRateMad: z.number().min(0.1).max(1_000),
  providers: z.object({ free: PlanProvidersSchema, creator: PlanProvidersSchema, pro: PlanProvidersSchema }),
});

export type CommerceSettings = z.infer<typeof CommerceSchema>;

export const parseCommerceSettings = (value: unknown): CommerceSettings => {
  const result = CommerceSchema.safeParse(value);
  if (!result.success) throw new HttpError(400, result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '), 'invalid_commerce_settings');
  return result.data;
};

export const getCommerceSettings = async (db: Db): Promise<CommerceSettings> => {
  const row = await db.one<{ settings: CommerceSettings | string }>('SELECT settings FROM commerce_settings WHERE id = 1');
  if (!row) return parseCommerceSettings(withDefaults({}));
  const stored = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
  return parseCommerceSettings(withDefaults(stored));
};

const withDefaults = (value: Partial<CommerceSettings> | Record<string, unknown>): Record<string, unknown> => {
  const providers = (value as { providers?: Partial<Record<keyof typeof PROVIDER_DEFAULTS, Partial<PlanProviders>>> }).providers ?? {};
  return {
    ...COMMERCE_DEFAULTS,
    ...value,
    providers: Object.fromEntries(Object.entries(PROVIDER_DEFAULTS).map(([plan, defaults]) => [plan, { ...defaults, ...providers[plan as keyof typeof PROVIDER_DEFAULTS] }])),
  };
};

/** Admin forms save one section at a time: the rest is kept as it is. */
export const saveCommerceSettings = async (db: Db, value: unknown): Promise<CommerceSettings> => {
  const current = await getCommerceSettings(db);
  const patch = (value && typeof value === 'object' ? value : {}) as Partial<CommerceSettings>;
  const settings = parseCommerceSettings(withDefaults({ ...current, ...patch, providers: { ...current.providers, ...patch.providers } }));
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

/** What customers may see: limits and prices, not the services or exchange rates behind them. */
export const publicCommerce = ({ providers: _providers, usdRateXof: _xof, usdRateMad: _mad, ...rest }: CommerceSettings) => rest;
