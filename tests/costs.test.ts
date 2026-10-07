import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UsageMeter } from '../src/core/usage';
import type { LLMProvider } from '../src/llm/types';
import { COMMERCE_DEFAULTS, getCommerceSettings, PROVIDER_DEFAULTS, saveCommerceSettings } from '../src/saas/commerce';
import { costReport, priceLine, priceUsage } from '../src/saas/costs';
import { connectPglite, migrate, type Db } from '../src/saas/db';
import { planConfig, planLLM } from '../src/saas/plan-providers';
import { testConfig } from './helpers';

const answering = (id: string, model: string): LLMProvider => ({
  id,
  model,
  async generate() {
    return { text: '{}', provider: id, model, usage: { inputTokens: 1000, outputTokens: 500 } };
  },
});

describe('usage meter and prices', () => {
  it('records what each wrapped provider really used, summed per model', async () => {
    const meter = new UsageMeter();
    const llm = meter.llm(answering('anthropic', 'claude-haiku-4-5-20251001'));
    await llm.generate({ messages: [{ role: 'user', content: 'a' }] });
    await llm.generate({ messages: [{ role: 'user', content: 'b' }] });
    const voice = meter.voice({ id: 'elevenlabs', synthesize: async ({ outFile }) => ({ file: outFile, durationSec: 2 }) }, 'eleven_flash_v2_5');
    await voice.synthesize({ text: 'x'.repeat(2000), language: 'fr', outFile: 'v.wav' });
    const music = meter.music({ id: 'elevenlabs', maxDurationSec: 120, generate: async () => ({ audio: Buffer.from(''), extension: 'mp3', durationSec: 60 }) });
    await music.generate({ prompt: 'p', durationSec: 62 });

    expect(meter.lines).toEqual([
      { kind: 'llm', provider: 'anthropic', model: 'claude-haiku-4-5-20251001', calls: 2, inputTokens: 2000, outputTokens: 1000 },
      { kind: 'voice', provider: 'elevenlabs', model: 'eleven_flash_v2_5', calls: 1, characters: 2000, seconds: 2 },
      { kind: 'music', provider: 'elevenlabs', calls: 1, seconds: 60 },
    ]);
    const priced = priceUsage(meter.lines);
    // Haiku: 2,000 × $1/M + 1,000 × $5/M = $0.007 · Flash voice: 2 × $0.05 · music: 60 s × $0.15/min.
    expect(priced.lines.map((line) => +line.usd.toFixed(4))).toEqual([0.007, 0.1, 0.15]);
    expect(priced.usd).toBeCloseTo(0.257, 6);
  });

  it('prices the most specific model, treats local services as free and flags unknown ones', () => {
    expect(priceLine({ kind: 'llm', provider: 'anthropic', model: 'claude-opus-5-5', calls: 1, inputTokens: 1_000_000, outputTokens: 0 }).usd).toBe(4);
    expect(priceLine({ kind: 'llm', provider: 'anthropic', model: 'claude-opus-5', calls: 1, inputTokens: 1_000_000, outputTokens: 0 }).usd).toBe(5);
    expect(priceLine({ kind: 'voice', provider: 'piper', calls: 1, characters: 99_999 }).usd).toBe(0);
    expect(priceLine({ kind: 'llm', provider: 'ollama', model: 'qwen', calls: 1, inputTokens: 5, outputTokens: 5 }).usd).toBe(0);
    expect(priceLine({ kind: 'image', provider: 'mystery', calls: 1, images: 3 })).toMatchObject({ usd: 0, unpriced: true });
  });
});

describe('services per plan', () => {
  it('overrides models and providers, keeping .env when a service is not configured here', () => {
    const config = testConfig({ VIDEO_AGENT_VOICE_PROVIDER: 'none', ANTHROPIC_MODEL: 'claude-opus-5-5' });
    const warnings: string[] = [];
    const free = planConfig(config, { ...PROVIDER_DEFAULTS.free, voice: 'elevenlabs', music: 'none' }, (m) => warnings.push(m));
    expect(free.env.ANTHROPIC_MODEL).toBe('claude-haiku-4-5');
    expect(free.env.VIDEO_AGENT_MUSIC_PROVIDER).toBe('none');
    // No ElevenLabs key on this server: the .env voice stays.
    expect(free.env.VIDEO_AGENT_VOICE_PROVIDER).toBe('none');
    expect(warnings.join()).toContain('voice "elevenlabs"');
    expect(config.env.ANTHROPIC_MODEL).toBe('claude-opus-5-5');
  });

  it('puts the chosen LLM first and the configured ones behind it', () => {
    const config = testConfig({ GROQ_API_KEY: 'gsk_test', ANTHROPIC_API_KEY: 'sk-ant-test' });
    const llm = planLLM(planConfig(config, PROVIDER_DEFAULTS.free), PROVIDER_DEFAULTS.free);
    expect(llm?.id).toBe('groq');
    expect((llm as unknown as { chain: string[] }).chain).toEqual(['groq', 'anthropic']);
    const noKeys = testConfig({ VIDEO_AGENT_LLM_PROVIDER: 'local' });
    expect(planLLM(noKeys, PROVIDER_DEFAULTS.free)).toBeNull();
  });
});

describe('commerce settings and cost report', () => {
  let db: Db;
  beforeAll(async () => {
    db = await connectPglite();
    await migrate(db);
  }, 60_000);
  afterAll(async () => db?.close());

  it('moves an existing install from the old quotas to the profitable ones', async () => {
    // Migration 6 stored the old values; migration 10 replaces the ones nobody changed.
    expect(await getCommerceSettings(db)).toMatchObject({
      creatorMinutesPerMonth: 30, creatorSongsPerMonth: 8, creatorMaxDurationSec: 120,
      proVideosPerMonth: 80, proMinutesPerMonth: 60, proSongsPerMonth: 20, proMaxDurationSec: 300,
      songPreviewSec: 30, freeSongMaxSec: 60, freeVideosPerMonth: 3, videoPriceXof: 1000,
    });
  });

  it('deletes songs past the retention period, unless a payment is pending', async () => {
    const { purgeOldSongs } = await import('../src/saas/songs');
    await db.query("INSERT INTO users (id, email, password_hash) VALUES ('u-old', 'old@b.c', 'x')");
    await db.query(
      `INSERT INTO songs (id, user_id, prompt, title, lyrics, style, mood, duration_sec, status, created_at) VALUES
       ('old-song', 'u-old', 'p', 't', 'l', 's', 'm', 60, 'completed', now() - interval '200 days'),
       ('paying-song', 'u-old', 'p', 't', 'l', 's', 'm', 60, 'completed', now() - interval '200 days'),
       ('new-song', 'u-old', 'p', 't', 'l', 's', 'm', 60, 'completed', now())`,
    );
    await db.query("INSERT INTO payments (id, user_id, provider, plan, amount, currency, target_id) VALUES ('pay-pending', 'u-old', 'geniuspay', 'export_song', 1500, 'XOF', 'paying-song')");
    expect((await purgeOldSongs(db, 180)).map((s) => s.id)).toEqual(['old-song']);
  });

  it('saves one section without resetting the others', async () => {
    expect((await getCommerceSettings(db)).providers).toEqual(PROVIDER_DEFAULTS);
    await saveCommerceSettings(db, { providers: { pro: { ...PROVIDER_DEFAULTS.pro, music: 'elevenlabs' } } });
    const numbers = await saveCommerceSettings(db, { ...COMMERCE_DEFAULTS, videoPriceXof: 1200 });
    expect(numbers.videoPriceXof).toBe(1200);
    expect(numbers.providers.pro.music).toBe('elevenlabs');
    expect(numbers.providers.free).toEqual(PROVIDER_DEFAULTS.free);
  });

  it('compares what generations cost with what customers paid', async () => {
    await db.query("INSERT INTO users (id, email, password_hash, plan) VALUES ('u1', 'a@b.c', 'x', 'creator'), ('u2', 'd@e.f', 'x', 'free')");
    const opus = JSON.stringify([{ kind: 'llm', provider: 'anthropic', model: 'claude-opus-5-5', calls: 2, inputTokens: 10_000, outputTokens: 10_000 }]);
    await db.query(
      `INSERT INTO jobs (id, user_id, prompt, options, dir, status, duration_sec, usage, plan) VALUES
       ('j1', 'u1', 'p', '{}', '/tmp/j1', 'completed', 60, $1, 'creator'),
       ('j2', 'u2', 'p', '{}', '/tmp/j2', 'failed', NULL, $1, 'free')`,
      [opus],
    );
    await db.query(
      "INSERT INTO songs (id, user_id, prompt, title, lyrics, style, mood, duration_sec, status, usage, plan) VALUES ('s1', 'u2', 'p', 't', 'l', 's', 'm', 60, 'completed', $1, 'free')",
      [JSON.stringify([{ kind: 'music', provider: 'elevenlabs', model: 'music', calls: 1, seconds: 60 }])],
    );
    await db.query("INSERT INTO payments (id, user_id, provider, plan, amount, currency, status, paid_at) VALUES ('p1', 'u1', 'geniuspay', 'creator', 6000, 'XOF', 'paid', now())");

    const report = await costReport(db, 30, { XOF: 600, MAD: 10 });
    // Opus: 10k × $4/M + 10k × $20/M = $0.24 per job; song: 60 s × $0.15/min = $0.15.
    expect(report.totals).toEqual({ costUsd: 0.63, revenueUsd: 10, marginUsd: 9.37 });
    expect(report.byPlan.find((p) => p.plan === 'creator')).toMatchObject({ videos: 1, minutes: 1, costUsd: 0.24, costPerVideoUsd: 0.24, costPerMinuteUsd: 0.24 });
    // A failed generation still costs money.
    expect(report.byPlan.find((p) => p.plan === 'free')).toMatchObject({ videos: 0, songs: 1, costUsd: 0.39, costPerSongUsd: 0.15 });
    expect(report.topUsers[0]).toMatchObject({ email: 'd@e.f', costUsd: 0.39, revenueUsd: 0, marginUsd: -0.39 });
    expect(report.byService.map((s) => s.kind)).toEqual(['llm', 'music']);
  });
});
