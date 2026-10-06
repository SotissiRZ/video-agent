/** Subscription plans and monthly quotas. Stripe prices map to plans through STRIPE_PRICE_*. */
import type { AppConfig } from '../config/config';
import type { Db } from './db';

export const PLAN_IDS = ['free', 'creator', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  id: PlanId;
  name: string;
  /** Videos per calendar month (UTC). */
  videosPerMonth: number;
  /** Rendered minutes per month. */
  minutesPerMonth: number;
  /** Longest video. */
  maxDurationSec: number;
  /** Publishing to social networks. */
  publish: boolean;
  /** "Made with Video Agent" badge on the video. */
  badge: boolean;
  /** Price shown on the pricing page. */
  price: string;
  stripePriceId?: string;
}

export const listPlans = (config: AppConfig): Plan[] => [
  { id: 'free', name: 'Free', videosPerMonth: 3, minutesPerMonth: 3, maxDurationSec: 60, publish: false, badge: true, price: '0' },
  { id: 'creator', name: 'Creator', videosPerMonth: 30, minutesPerMonth: 60, maxDurationSec: 180, publish: true, badge: false, price: config.env.PLAN_CREATOR_PRICE, stripePriceId: config.env.STRIPE_PRICE_CREATOR },
  { id: 'pro', name: 'Pro', videosPerMonth: 120, minutesPerMonth: 300, maxDurationSec: 600, publish: true, badge: false, price: config.env.PLAN_PRO_PRICE, stripePriceId: config.env.STRIPE_PRICE_PRO },
];

export const getPlan = (config: AppConfig, id: string | null | undefined): Plan => listPlans(config).find((p) => p.id === id) ?? listPlans(config)[0]!;

/** Status of plans bought as prepaid passes (mobile money, cards without recurring billing). */
export const PREPAID = 'prepaid';

/** Plan a user is entitled to now: an expired prepaid pass falls back to the free plan. */
export const planOfUser = (config: AppConfig, user: { plan: string | null; subscription_status?: string | null; current_period_end?: Date | string | null } | undefined, now = new Date()): Plan => {
  if (!user) return getPlan(config, 'free');
  if (user.subscription_status === PREPAID && (!user.current_period_end || new Date(user.current_period_end).getTime() < now.getTime())) return getPlan(config, 'free');
  return getPlan(config, user.plan);
};

export const planForPrice = (config: AppConfig, priceId: string | undefined): PlanId | undefined =>
  priceId ? listPlans(config).find((p) => p.stripePriceId && p.stripePriceId === priceId)?.id : undefined;

/** First day of the current month (UTC): quotas reset monthly. */
export const periodStart = (now = new Date()): Date => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export interface Usage {
  periodStart: string;
  videos: number;
  seconds: number;
}

/** Videos started this month (failed and cancelled ones are not counted) and rendered seconds. */
export const getUsage = async (db: Db, userId: string, now = new Date()): Promise<Usage> => {
  const start = periodStart(now);
  const row = await db.one<{ videos: string | number; seconds: string | number | null }>(
    `SELECT count(*) AS videos, coalesce(sum(duration_sec), 0) AS seconds FROM jobs
     WHERE user_id = $1 AND created_at >= $2 AND status IN ('queued', 'running', 'completed')`,
    [userId, start.toISOString()],
  );
  return { periodStart: start.toISOString(), videos: Number(row?.videos ?? 0), seconds: Math.round(Number(row?.seconds ?? 0)) };
};

export type QuotaError = { code: 'videos' | 'minutes' | 'duration'; limit: number };

/** Can this user start one more video of (about) this duration? */
export const checkQuota = (plan: Plan, usage: Usage, requestedDurationSec?: number): QuotaError | null => {
  if (usage.videos >= plan.videosPerMonth) return { code: 'videos', limit: plan.videosPerMonth };
  if (requestedDurationSec && requestedDurationSec > plan.maxDurationSec) return { code: 'duration', limit: plan.maxDurationSec };
  const expected = Math.min(requestedDurationSec ?? 30, plan.maxDurationSec);
  if (usage.seconds + expected > plan.minutesPerMonth * 60) return { code: 'minutes', limit: plan.minutesPerMonth };
  return null;
};
