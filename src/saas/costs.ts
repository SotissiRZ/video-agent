/**
 * Price list of the paid services (USD), applied to the recorded usage. Prices are looked up when
 * the dashboard is read, so updating this table re-prices past generations too.
 * Checked in October 2026; entries marked `estimate` should be confirmed on the provider's pricing page.
 */
import { UsageMeter, type UsageLine } from '../core/usage';
import type { Db } from './db';

interface LlmPrice { prefix: string; input: number; output: number; estimate?: boolean }

/** Per million tokens. Longest prefix wins (model ids may carry a date suffix). */
const LLM_PRICES: Record<string, LlmPrice[]> = {
  anthropic: [
    { prefix: 'claude-fable-5', input: 10, output: 50 },
    { prefix: 'claude-opus-5-5', input: 4, output: 20 },
    { prefix: 'claude-opus-5', input: 5, output: 25 },
    { prefix: 'claude-opus-4', input: 5, output: 25 },
    { prefix: 'claude-sonnet-5', input: 2, output: 10 },
    { prefix: 'claude-sonnet-4', input: 3, output: 15 },
    { prefix: 'claude-haiku-4-5', input: 1, output: 5 },
  ],
  groq: [{ prefix: 'llama-3.3-70b', input: 0.59, output: 0.79, estimate: true }],
  openai: [
    { prefix: 'gpt-4.1-mini', input: 0.4, output: 1.6, estimate: true },
    { prefix: 'gpt-4.1', input: 2, output: 8, estimate: true },
  ],
};
/** Self-hosted models cost nothing per call. */
const FREE_LLM = new Set(['ollama', 'openai-compatible', 'local']);

/** Text-to-speech, per 1,000 characters. */
const VOICE_PER_1K_CHARS: Record<string, { default: number; models?: Record<string, number>; estimate?: boolean }> = {
  elevenlabs: { default: 0.1, models: { eleven_flash_v2_5: 0.05, eleven_turbo_v2_5: 0.05 } },
  openai: { default: 0.015, estimate: true },
};
const FREE_VOICES = new Set(['piper', 'system', 'mms']);

/** Generated music, per second. */
const MUSIC_PER_SECOND: Record<string, { price: number; estimate?: boolean }> = {
  elevenlabs: { price: 0.15 / 60 },
  stability: { price: 0.002, estimate: true },
  replicate: { price: 0.0015, estimate: true },
};

/** Generated images, per image. Cloudflare and Hugging Face are counted within their free tiers. */
const IMAGE_PRICES: Record<string, { price: number; estimate?: boolean }> = {
  cloudflare: { price: 0 },
  huggingface: { price: 0 },
  replicate: { price: 0.003, estimate: true },
  stability: { price: 0.03, estimate: true },
  openai: { price: 0.04, estimate: true },
};

export interface PricedLine extends UsageLine {
  usd: number;
  /** No price known: counted as 0. */
  unpriced?: boolean;
  estimate?: boolean;
}

export const priceLine = (line: UsageLine): PricedLine => {
  if (line.kind === 'llm') {
    if (FREE_LLM.has(line.provider)) return { ...line, usd: 0 };
    const model = line.model ?? '';
    const price = (LLM_PRICES[line.provider] ?? []).filter((p) => model.startsWith(p.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
    if (!price) return { ...line, usd: 0, unpriced: true };
    return { ...line, usd: ((line.inputTokens ?? 0) * price.input + (line.outputTokens ?? 0) * price.output) / 1_000_000, estimate: price.estimate };
  }
  if (line.kind === 'voice') {
    if (FREE_VOICES.has(line.provider)) return { ...line, usd: 0 };
    const price = VOICE_PER_1K_CHARS[line.provider];
    if (!price) return { ...line, usd: 0, unpriced: true };
    const perK = (line.model ? price.models?.[line.model] : undefined) ?? price.default;
    return { ...line, usd: ((line.characters ?? 0) / 1000) * perK, estimate: price.estimate };
  }
  if (line.kind === 'music') {
    const price = MUSIC_PER_SECOND[line.provider];
    if (!price) return { ...line, usd: 0, unpriced: true };
    return { ...line, usd: (line.seconds ?? 0) * price.price, estimate: price.estimate };
  }
  const price = IMAGE_PRICES[line.provider];
  if (!price) return { ...line, usd: 0, unpriced: true };
  return { ...line, usd: (line.images ?? 0) * price.price, estimate: price.estimate };
};

export const priceUsage = (lines: UsageLine[]): { usd: number; lines: PricedLine[] } => {
  const priced = lines.map(priceLine);
  return { usd: priced.reduce((total, line) => total + line.usd, 0), lines: priced };
};

const toUsage = (value: unknown): UsageLine[] => (typeof value === 'string' ? JSON.parse(value) : Array.isArray(value) ? value : []);

/** Admin dashboard: what generations cost against what customers paid over the last `days`. */
export const costReport = async (db: Db, days: number, rates: { XOF: number; MAD: number }) => {
  const since = new Date(Date.now() - days * 86_400_000);
  const jobs = await db.query<{ user_id: string; plan: string | null; usage: unknown; duration_sec: number | null; status: string }>(
    'SELECT user_id, plan, usage, duration_sec, status FROM jobs WHERE created_at >= $1',
    [since],
  );
  const songs = await db.query<{ user_id: string; plan: string | null; usage: unknown }>('SELECT user_id, plan, usage FROM songs WHERE created_at >= $1', [since]);
  const payments = await db.query<{ user_id: string; amount: string | number; currency: string }>("SELECT user_id, amount, currency FROM payments WHERE status = 'paid' AND paid_at >= $1", [since]);
  const users = await db.query<{ id: string; email: string; plan: string }>('SELECT id, email, plan FROM users');
  const toUsd = (amount: number, currency: string) => (currency === 'XOF' ? amount / rates.XOF : currency === 'MAD' ? amount / rates.MAD : currency === 'USD' ? amount : 0);

  const services = new UsageMeter();
  const plans = new Map<string, { plan: string; users: Set<string>; videos: number; minutes: number; songs: number; videoUsd: number; songUsd: number }>();
  const perUser = new Map<string, { videos: number; songs: number; costUsd: number; revenueUsd: number }>();
  const planRow = (plan: string) => plans.get(plan) ?? plans.set(plan, { plan, users: new Set(), videos: 0, minutes: 0, songs: 0, videoUsd: 0, songUsd: 0 }).get(plan)!;
  const userRow = (id: string) => perUser.get(id) ?? perUser.set(id, { videos: 0, songs: 0, costUsd: 0, revenueUsd: 0 }).get(id)!;

  for (const job of jobs) {
    const usage = toUsage(job.usage);
    usage.forEach((line) => services.record(line));
    const usd = priceUsage(usage).usd;
    const row = planRow(job.plan ?? 'unknown');
    row.users.add(job.user_id);
    row.videoUsd += usd;
    if (job.status === 'completed') {
      row.videos += 1;
      row.minutes += Number(job.duration_sec ?? 0) / 60;
    }
    const user = userRow(job.user_id);
    user.costUsd += usd;
    if (job.status === 'completed') user.videos += 1;
  }
  for (const song of songs) {
    const usage = toUsage(song.usage);
    usage.forEach((line) => services.record(line));
    const usd = priceUsage(usage).usd;
    const row = planRow(song.plan ?? 'unknown');
    row.users.add(song.user_id);
    row.songs += 1;
    row.songUsd += usd;
    const user = userRow(song.user_id);
    user.costUsd += usd;
    user.songs += 1;
  }
  for (const payment of payments) userRow(payment.user_id).revenueUsd += toUsd(Number(payment.amount), payment.currency);

  const round = (n: number) => Math.round(n * 1000) / 1000;
  const costUsd = [...perUser.values()].reduce((total, u) => total + u.costUsd, 0);
  const revenueUsd = [...perUser.values()].reduce((total, u) => total + u.revenueUsd, 0);
  const emails = new Map(users.map((u) => [u.id, u]));
  return {
    days,
    rates,
    totals: { costUsd: round(costUsd), revenueUsd: round(revenueUsd), marginUsd: round(revenueUsd - costUsd) },
    byPlan: [...plans.values()].map((p) => ({
      plan: p.plan,
      activeUsers: p.users.size,
      videos: p.videos,
      minutes: round(p.minutes),
      songs: p.songs,
      costUsd: round(p.videoUsd + p.songUsd),
      costPerVideoUsd: p.videos ? round(p.videoUsd / p.videos) : null,
      costPerMinuteUsd: p.minutes ? round(p.videoUsd / p.minutes) : null,
      costPerSongUsd: p.songs ? round(p.songUsd / p.songs) : null,
    })),
    byService: priceUsage(services.lines).lines.map((line) => ({ ...line, usd: round(line.usd) })).sort((a, b) => b.usd - a.usd),
    topUsers: [...perUser.entries()]
      .map(([id, u]) => ({ email: emails.get(id)?.email ?? id, plan: emails.get(id)?.plan ?? '', videos: u.videos, songs: u.songs, costUsd: round(u.costUsd), revenueUsd: round(u.revenueUsd), marginUsd: round(u.revenueUsd - u.costUsd) }))
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 20),
  };
};
