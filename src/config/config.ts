/**
 * Application configuration, read exclusively from environment variables (and an optional .env file).
 * API keys are never read from anywhere else and never written to disk by the agent.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { ConfigError } from '../core/errors';
import { OUTPUT_FORMATS } from '../core/formats';
import type { LogLevel } from '../core/logger';

export const LLM_PROVIDER_IDS = ['auto', 'anthropic', 'openai', 'groq', 'openai-compatible', 'ollama', 'local'] as const;
export const IMAGE_PROVIDER_IDS = ['auto', 'none', 'cloudflare', 'huggingface', 'openai', 'replicate', 'stability'] as const;
export const VOICE_PROVIDER_IDS = ['auto', 'none', 'openai', 'elevenlabs', 'piper', 'system'] as const;
export const VIDEO_PROVIDER_IDS = ['none', 'replicate'] as const;
export const MUSIC_MODES = ['auto', 'procedural', 'assets', 'none'] as const;
export const MUSIC_PROVIDER_IDS = ['none', 'auto', 'elevenlabs', 'stability', 'replicate'] as const;

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().trim().optional());
const bool = (def: boolean) =>
  z.preprocess((v) => {
    const s = emptyToUndefined(v);
    if (s === undefined) return def;
    if (typeof s === 'boolean') return s;
    return ['1', 'true', 'yes', 'on', 'oui'].includes(String(s).toLowerCase());
  }, z.boolean());
const int = (def: number, min: number, max: number) =>
  z.preprocess((v) => (emptyToUndefined(v) === undefined ? def : Number(v)), z.number().int().min(min).max(max));
const enumWithDefault = <T extends readonly [string, ...string[]]>(values: T, def: T[number]) =>
  z.preprocess((v) => {
    if (emptyToUndefined(v) === undefined) return def;
    const normalized = String(v).toLowerCase();
    return values.find((value) => value.toLowerCase() === normalized) ?? normalized;
  }, z.enum(values));

const EnvSchema = z.object({
  // --- LLM -------------------------------------------------------------
  VIDEO_AGENT_LLM_PROVIDER: enumWithDefault(LLM_PROVIDER_IDS, 'auto'),
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.preprocess(emptyToUndefined, z.string().default('claude-opus-5-5')),
  ANTHROPIC_EFFORT: enumWithDefault(['low', 'medium', 'high', 'xhigh', 'max'] as const, 'medium'),
  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default('https://api.openai.com/v1')),
  OPENAI_MODEL: z.preprocess(emptyToUndefined, z.string().default('gpt-4.1-mini')),
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: z.preprocess(emptyToUndefined, z.string().default('llama-3.3-70b-versatile')),
  OPENAI_COMPATIBLE_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  OPENAI_COMPATIBLE_API_KEY: optionalString,
  OPENAI_COMPATIBLE_MODEL: optionalString,
  /** Free local LLM. In Docker: http://ollama:11434 (profile "ollama"). */
  OLLAMA_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  OLLAMA_MODEL: z.preprocess(emptyToUndefined, z.string().default('qwen2.5:3b')),
  VIDEO_AGENT_LLM_TIMEOUT_MS: int(120_000, 1_000, 900_000),
  VIDEO_AGENT_LLM_TEMPERATURE: z.preprocess((v) => (emptyToUndefined(v) === undefined ? 0.7 : Number(v)), z.number().min(0).max(2)),

  // --- Images ----------------------------------------------------------
  VIDEO_AGENT_IMAGE_PROVIDER: enumWithDefault(IMAGE_PROVIDER_IDS, 'auto'),
  OPENAI_IMAGE_MODEL: z.preprocess(emptyToUndefined, z.string().default('gpt-image-1')),
  REPLICATE_API_TOKEN: optionalString,
  REPLICATE_IMAGE_MODEL: z.preprocess(emptyToUndefined, z.string().default('black-forest-labs/flux-schnell')),
  VIDEO_AGENT_MAX_GENERATED_IMAGES: int(4, 0, 50),
  CLOUDFLARE_ACCOUNT_ID: optionalString,
  CLOUDFLARE_API_TOKEN: optionalString,
  CLOUDFLARE_IMAGE_MODEL: z.preprocess(emptyToUndefined, z.string().default('@cf/black-forest-labs/flux-1-schnell')),
  HF_TOKEN: optionalString,
  HF_IMAGE_MODEL: z.preprocess(emptyToUndefined, z.string().default('black-forest-labs/FLUX.1-schnell')),
  STABILITY_API_KEY: optionalString,
  STABILITY_MODEL: enumWithDefault(['core', 'ultra', 'sd3'] as const, 'core'),

  // --- Stock media & media strategy -----------------------------------
  PEXELS_API_KEY: optionalString,
  PIXABAY_API_KEY: optionalString,
  UNSPLASH_ACCESS_KEY: optionalString,
  /** auto (all configured) | none | comma-separated list in priority order. */
  VIDEO_AGENT_STOCK_PROVIDERS: z.preprocess(emptyToUndefined, z.string().regex(/^[a-z,\s-]+$/).default('auto')),
  VIDEO_AGENT_STOCK_VIDEOS: bool(true),
  /** Visuals per scene: long scenes show up to this many photos/clips in a row (1 = one per scene). */
  VIDEO_AGENT_SHOTS_PER_SCENE: int(3, 1, 4),
  /** Order in which media sources are tried for each scene. */
  VIDEO_AGENT_MEDIA_SOURCES: z.preprocess(
    emptyToUndefined,
    z.string().default('assets,stock,ai').transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.enum(['assets', 'stock', 'ai'])).min(1)),
  ),
  /** all = every scene gets a photo/clip when possible; visual = only visual scenes; none. */
  VIDEO_AGENT_MEDIA_COVERAGE: enumWithDefault(['all', 'visual', 'none'] as const, 'all'),

  // --- Voice -----------------------------------------------------------
  VIDEO_AGENT_VOICE_PROVIDER: enumWithDefault(VOICE_PROVIDER_IDS, 'auto'),
  OPENAI_TTS_MODEL: z.preprocess(emptyToUndefined, z.string().default('gpt-4o-mini-tts')),
  OPENAI_TTS_VOICE: z.preprocess(emptyToUndefined, z.string().default('alloy')),
  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_VOICE_ID: z.preprocess(emptyToUndefined, z.string().default('21m00Tcm4TlvDq8ikWAM')),
  ELEVENLABS_MODEL: z.preprocess(emptyToUndefined, z.string().default('eleven_multilingual_v2')),
  VIDEO_AGENT_SYSTEM_VOICE: optionalString,
  /** Piper (free neural voices). Data dir holds the binary and downloaded voices. */
  PIPER_DATA_DIR: z.preprocess(emptyToUndefined, z.string().default('.video-agent/piper')),
  PIPER_BINARY: optionalString,
  PIPER_VOICE_FR: z.preprocess(emptyToUndefined, z.string().default('fr_FR-siwis-medium')),
  PIPER_VOICE_EN: z.preprocess(emptyToUndefined, z.string().default('en_US-lessac-medium')),
  /** >1 = slower speech. */
  PIPER_LENGTH_SCALE: z.preprocess((v) => (emptyToUndefined(v) === undefined ? 1 : Number(v)), z.number().min(0.5).max(2)),
  PIPER_AUTO_DOWNLOAD: bool(true),

  // --- Video generation ------------------------------------------------
  VIDEO_AGENT_VIDEO_PROVIDER: enumWithDefault(VIDEO_PROVIDER_IDS, 'none'),
  REPLICATE_VIDEO_MODEL: z.preprocess(emptyToUndefined, z.string().default('minimax/video-01')),
  VIDEO_AGENT_MAX_GENERATED_CLIPS: int(2, 0, 20),

  // --- Music -----------------------------------------------------------
  VIDEO_AGENT_MUSIC: enumWithDefault(MUSIC_MODES, 'auto'),
  VIDEO_AGENT_MUSIC_PROVIDER: enumWithDefault(MUSIC_PROVIDER_IDS, 'none'),
  REPLICATE_MUSIC_MODEL: z.preprocess(emptyToUndefined, z.string().default('meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb')),

  // --- Paths & defaults --------------------------------------------------
  VIDEO_AGENT_OUTPUT_DIR: z.preprocess(emptyToUndefined, z.string().default('output')),
  VIDEO_AGENT_ASSETS_DIR: z.preprocess(emptyToUndefined, z.string().default('assets')),
  VIDEO_AGENT_DEFAULT_FORMAT: z.preprocess(emptyToUndefined, z.string().default('landscape')),
  VIDEO_AGENT_DEFAULT_DURATION: z.preprocess(emptyToUndefined, z.coerce.number().int().min(3).max(600).optional()),
  VIDEO_AGENT_DEFAULT_FPS: int(30, 1, 120),
  VIDEO_AGENT_DEFAULT_OUTPUT_FORMAT: enumWithDefault(OUTPUT_FORMATS, 'mp4'),
  VIDEO_AGENT_LANGUAGE: z.preprocess(emptyToUndefined, z.string().default('auto')),
  VIDEO_AGENT_SUBTITLES: bool(true),

  // --- Rendering ---------------------------------------------------------
  VIDEO_AGENT_BROWSER_EXECUTABLE: optionalString,
  REMOTION_BROWSER_EXECUTABLE: optionalString,
  VIDEO_AGENT_RENDER_CONCURRENCY: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(64).optional()),
  VIDEO_AGENT_RENDER_TIMEOUT_MS: int(60_000, 5_000, 600_000),
  VIDEO_AGENT_CRF: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(51).optional()),
  /** H.264 encoder speed: faster presets render quicker, files are slightly larger. */
  VIDEO_AGENT_X264_PRESET: enumWithDefault(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'] as const, 'veryfast'),
  /** Chrome OpenGL backend. auto = Chrome's default (much faster than swangle on CPU-only machines). */
  VIDEO_AGENT_RENDER_GL: enumWithDefault(['auto', 'angle', 'swangle', 'swiftshader', 'egl', 'vulkan', 'angle-egl'] as const, 'auto'),

  // --- Web server ----------------------------------------------------------
  /** Allow editing settings (.env) from the web UI. */
  VIDEO_AGENT_SETTINGS_UI: bool(true),
  VIDEO_AGENT_HOST: z.preprocess(emptyToUndefined, z.string().default('127.0.0.1')),
  VIDEO_AGENT_PORT: int(3210, 1, 65535),
  /** Password protecting the web interface (HTTP Basic auth). Required when exposed on a network. */
  VIDEO_AGENT_WEB_PASSWORD: optionalString,

  // --- Social publishing ---------------------------------------------------
  YOUTUBE_CLIENT_ID: optionalString,
  YOUTUBE_CLIENT_SECRET: optionalString,
  YOUTUBE_REFRESH_TOKEN: optionalString,
  YOUTUBE_PRIVACY: enumWithDefault(['public', 'unlisted', 'private'] as const, 'public'),
  YOUTUBE_CATEGORY_ID: z.preprocess(emptyToUndefined, z.string().default('22')),

  TIKTOK_CLIENT_KEY: optionalString,
  TIKTOK_CLIENT_SECRET: optionalString,
  TIKTOK_REFRESH_TOKEN: optionalString,
  TIKTOK_ACCESS_TOKEN: optionalString,
  TIKTOK_MODE: enumWithDefault(['draft', 'direct'] as const, 'draft'),
  TIKTOK_PRIVACY: enumWithDefault(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'] as const, 'PUBLIC_TO_EVERYONE'),

  META_APP_ID: optionalString,
  META_APP_SECRET: optionalString,
  META_GRAPH_VERSION: z.preprocess(emptyToUndefined, z.string().regex(/^v\d+\.\d+$/).default('v23.0')),
  FACEBOOK_PAGE_ID: optionalString,
  FACEBOOK_PAGE_ACCESS_TOKEN: optionalString,
  INSTAGRAM_USER_ID: optionalString,
  INSTAGRAM_ACCESS_TOKEN: optionalString,

  LINKEDIN_CLIENT_ID: optionalString,
  LINKEDIN_CLIENT_SECRET: optionalString,
  LINKEDIN_ACCESS_TOKEN: optionalString,
  LINKEDIN_REFRESH_TOKEN: optionalString,
  LINKEDIN_AUTHOR_URN: z.preprocess(emptyToUndefined, z.string().regex(/^urn:li:(person|organization):.+$/).optional()),
  LINKEDIN_API_VERSION: z.preprocess(emptyToUndefined, z.string().regex(/^\d{6}$/).optional()),
  LINKEDIN_VISIBILITY: enumWithDefault(['PUBLIC', 'CONNECTIONS'] as const, 'PUBLIC'),

  /** Platforms used by --publish when no list is given (comma separated). */
  VIDEO_AGENT_PUBLISH_PLATFORMS: z.preprocess(emptyToUndefined, z.string().default('')),
  /** Credit stock photographers in YouTube/Facebook/LinkedIn descriptions. */
  VIDEO_AGENT_CAPTION_CREDITS: bool(true),
  /** Run the local publication scheduler inside "video-agent web". */
  VIDEO_AGENT_SCHEDULER: bool(true),

  // --- SaaS ----------------------------------------------------------------
  /** PostgreSQL connection string. Empty = embedded database (PGlite) in VIDEO_AGENT_DATA_DIR. */
  DATABASE_URL: optionalString,
  /** Local data (embedded database, generated secret). */
  VIDEO_AGENT_DATA_DIR: z.preprocess(emptyToUndefined, z.string().default('.video-agent')),
  /** Secret used to sign sessions and encrypt OAuth tokens (32+ chars). Generated locally if empty. */
  APP_SECRET: z.preprocess(emptyToUndefined, z.string().min(32, 'APP_SECRET doit faire au moins 32 caractères').optional()),
  /** Public URL of the app (OAuth redirects, Stripe return URLs, secure cookies when https). */
  PUBLIC_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  /** open = anyone can sign up | closed = only existing accounts (and the first user). */
  SIGNUP_MODE: enumWithDefault(['open', 'closed'] as const, 'open'),
  /** Comma-separated e-mails that get the admin role (the first account is always admin). */
  ADMIN_EMAILS: z.preprocess(emptyToUndefined, z.string().default('')),
  /** Run the render worker inside the web process (auto = only with the embedded database). */
  VIDEO_AGENT_EMBEDDED_WORKER: enumWithDefault(['auto', 'true', 'false'] as const, 'auto'),
  /** Behind a reverse proxy (Caddy in docker-compose): trust X-Forwarded-For / X-Forwarded-Proto. */
  VIDEO_AGENT_TRUST_PROXY: bool(false),
  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_PRICE_CREATOR: optionalString,
  STRIPE_PRICE_PRO: optionalString,
  /** GeniusPay (Côte d'Ivoire): Wave, Orange Money, MTN, Moov, cards — prepaid passes in XOF. */
  GENIUSPAY_API_KEY: optionalString,
  GENIUSPAY_API_SECRET: optionalString,
  /** Secret used to sign the webhooks (set when the webhook is created in GeniusPay). */
  GENIUSPAY_WEBHOOK_SECRET: optionalString,
  /** YouCan Pay (Morocco): cards, CashPlus — prepaid passes in MAD. */
  YOUCANPAY_PRIVATE_KEY: optionalString,
  /** Sandbox mode (also detected from a pri_sandbox… key). */
  YOUCANPAY_SANDBOX: bool(false),
  /** Prices of the 30-day passes (whole units: FCFA, dirhams). */
  PLAN_CREATOR_PRICE_XOF: int(10000, 200, 100_000_000),
  PLAN_PRO_PRICE_XOF: int(25000, 200, 100_000_000),
  PLAN_CREATOR_PRICE_MAD: int(190, 5, 1_000_000),
  PLAN_PRO_PRICE_MAD: int(490, 5, 1_000_000),
  /** Pack of extra videos, beyond the monthly quota (credits never expire). */
  CREDIT_PACK_VIDEOS: int(10, 1, 1000),
  CREDIT_PACK_PRICE_XOF: int(5000, 200, 100_000_000),
  CREDIT_PACK_PRICE_MAD: int(90, 5, 1_000_000),
  /** E-mail reminder this many days before a prepaid pass ends (0 = off). */
  PASS_REMINDER_DAYS: int(3, 0, 30),
  /** Prices shown on the pricing page (Stripe remains the source of truth for billing). */
  PLAN_CREATOR_PRICE: z.preprocess(emptyToUndefined, z.string().default('19 €')),
  PLAN_PRO_PRICE: z.preprocess(emptyToUndefined, z.string().default('49 €')),

  /** Outgoing e-mail (password reset, verification): smtp(s)://user:password@host:port. Empty = links written to the logs. */
  SMTP_URL: optionalString,
  /** Sender, e.g. "SOVID AI <no-reply@example.com>". */
  MAIL_FROM: z.preprocess(emptyToUndefined, z.string().default('SOVID AI <no-reply@localhost>')),
  /** Videos can be created only once the e-mail address is confirmed. */
  REQUIRE_EMAIL_VERIFICATION: bool(false),
  /** Delete videos older than this many days (0 = keep forever). */
  VIDEO_AGENT_RETENTION_DAYS: int(0, 0, 3650),
  /** Legal pages (terms, privacy, legal notice). */
  COMPANY_NAME: z.preprocess(emptyToUndefined, z.string().default('SOVID AI')),
  COMPANY_ADDRESS: z.preprocess(emptyToUndefined, z.string().default('')),
  CONTACT_EMAIL: z.preprocess(emptyToUndefined, z.string().default('')),

  VIDEO_AGENT_LOG_LEVEL: enumWithDefault(['debug', 'info', 'warn', 'error', 'silent'] as const, 'info'),
});

export type Env = z.infer<typeof EnvSchema>;

export interface AppConfig {
  env: Env;
  /** Absolute paths. */
  paths: { root: string; output: string; assets: string; data: string };
  logLevel: LogLevel;
  browserExecutable?: string;
}

/** Root of the installed package (where package.json lives). */
export const findPackageRoot = (start: string): string => {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const name = JSON.parse(fs.readFileSync(pkg, 'utf8')).name;
        if (name === 'video-agent' || name === 'sovid-ai') return dir;
      } catch {
        /* keep searching */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
};

export interface LoadConfigOptions {
  /** Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Load a .env file from this directory (default: cwd). Set to false to skip. */
  dotenvDir?: string | false;
  /** Base directory for relative paths (default: cwd). */
  cwd?: string;
  packageRoot?: string;
}

export const loadConfig = (options: LoadConfigOptions = {}): AppConfig => {
  const cwd = options.cwd ?? process.cwd();
  let source: Record<string, string | undefined> = options.env ?? process.env;
  if (options.dotenvDir !== false) {
    const file = path.join(options.dotenvDir ?? cwd, '.env');
    if (fs.existsSync(file)) {
      // Real environment variables win over the .env file.
      source = { ...dotenv.parse(fs.readFileSync(file)), ...source };
    }
  }
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n - ${issues.join('\n - ')}`, 'Check your .env file against .env.example.');
  }
  const env = parsed.data;
  const root = options.packageRoot ?? cwd;
  return {
    env,
    paths: {
      root,
      output: path.resolve(cwd, env.VIDEO_AGENT_OUTPUT_DIR),
      assets: path.resolve(cwd, env.VIDEO_AGENT_ASSETS_DIR),
      data: path.resolve(cwd, env.VIDEO_AGENT_DATA_DIR),
    },
    logLevel: env.VIDEO_AGENT_LOG_LEVEL,
    browserExecutable: env.VIDEO_AGENT_BROWSER_EXECUTABLE ?? env.REMOTION_BROWSER_EXECUTABLE,
  };
};

/** Names of configured secrets (never their values) — for diagnostics. */
export const describeSecrets = (env: Env): Record<string, boolean> => ({
  ANTHROPIC_API_KEY: Boolean(env.ANTHROPIC_API_KEY),
  OPENAI_API_KEY: Boolean(env.OPENAI_API_KEY),
  GROQ_API_KEY: Boolean(env.GROQ_API_KEY),
  OPENAI_COMPATIBLE_BASE_URL: Boolean(env.OPENAI_COMPATIBLE_BASE_URL),
  REPLICATE_API_TOKEN: Boolean(env.REPLICATE_API_TOKEN),
  STABILITY_API_KEY: Boolean(env.STABILITY_API_KEY),
  CLOUDFLARE_API_TOKEN: Boolean(env.CLOUDFLARE_API_TOKEN),
  HF_TOKEN: Boolean(env.HF_TOKEN),
  VIDEO_AGENT_WEB_PASSWORD: Boolean(env.VIDEO_AGENT_WEB_PASSWORD),
  PEXELS_API_KEY: Boolean(env.PEXELS_API_KEY),
  PIXABAY_API_KEY: Boolean(env.PIXABAY_API_KEY),
  UNSPLASH_ACCESS_KEY: Boolean(env.UNSPLASH_ACCESS_KEY),
  ELEVENLABS_API_KEY: Boolean(env.ELEVENLABS_API_KEY),
  APP_SECRET: Boolean(env.APP_SECRET),
  STRIPE_SECRET_KEY: Boolean(env.STRIPE_SECRET_KEY),
  STRIPE_WEBHOOK_SECRET: Boolean(env.STRIPE_WEBHOOK_SECRET),
  GENIUSPAY_API_KEY: Boolean(env.GENIUSPAY_API_KEY),
  YOUCANPAY_PRIVATE_KEY: Boolean(env.YOUCANPAY_PRIVATE_KEY),
  YOUTUBE_REFRESH_TOKEN: Boolean(env.YOUTUBE_REFRESH_TOKEN),
  TIKTOK_REFRESH_TOKEN: Boolean(env.TIKTOK_REFRESH_TOKEN || env.TIKTOK_ACCESS_TOKEN),
  FACEBOOK_PAGE_ACCESS_TOKEN: Boolean(env.FACEBOOK_PAGE_ACCESS_TOKEN),
  INSTAGRAM_ACCESS_TOKEN: Boolean(env.INSTAGRAM_ACCESS_TOKEN || env.FACEBOOK_PAGE_ACCESS_TOKEN),
  LINKEDIN_ACCESS_TOKEN: Boolean(env.LINKEDIN_ACCESS_TOKEN || env.LINKEDIN_REFRESH_TOKEN),
});
