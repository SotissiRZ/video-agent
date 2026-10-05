/**
 * Stripe billing through the REST API (no SDK): Checkout for subscriptions, the Customer Portal
 * for changes/cancellation, and webhooks (signature checked) to keep each user's plan in sync.
 */
import crypto from 'node:crypto';
import type { AppConfig } from '../config/config';
import { ConfigError, VideoAgentError } from '../core/errors';
import type { Db } from './db';
import { getPlan, planForPrice, type PlanId } from './plans';

const STRIPE_API = 'https://api.stripe.com/v1';

export const billingEnabled = (config: AppConfig): boolean => Boolean(config.env.STRIPE_SECRET_KEY);

/** Stripe expects form encoding with bracket notation for nested fields. */
export const stripeForm = (data: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(data).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v.flatMap((item, i) => (typeof item === 'object' ? stripeForm(item as Record<string, unknown>, `${key}[${i}]`) : [`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`]));
    if (typeof v === 'object') return stripeForm(v as Record<string, unknown>, key);
    return [`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`];
  });

export type StripeFetch = (path: string, init: { method: 'GET' | 'POST'; body?: Record<string, unknown> }) => Promise<Record<string, unknown>>;

export const stripeClient = (config: AppConfig, fetchImpl: typeof fetch = fetch): StripeFetch => async (path, init) => {
  const key = config.env.STRIPE_SECRET_KEY;
  if (!key) throw new ConfigError('Paiement non configuré (STRIPE_SECRET_KEY manquant)');
  const res = await fetchImpl(`${STRIPE_API}${path}`, {
    method: init.method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded', 'stripe-version': '2024-06-20' },
    body: init.body ? stripeForm(init.body).join('&') : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new VideoAgentError(`Stripe : ${body.error?.message ?? `HTTP ${res.status}`}`);
  return body;
};

interface BillingUser {
  id: string;
  email: string;
  stripe_customer_id: string | null;
}

export const createCheckout = async (config: AppConfig, stripe: StripeFetch, user: BillingUser, planId: PlanId, baseUrl: string): Promise<string> => {
  const plan = getPlan(config, planId);
  if (!plan.stripePriceId) throw new ConfigError(`Aucun prix Stripe pour l'offre ${plan.name}`, `Ajoutez STRIPE_PRICE_${plan.id.toUpperCase()} dans .env.`);
  const session = await stripe('/checkout/sessions', {
    method: 'POST',
    body: {
      mode: 'subscription',
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${baseUrl}/app#billing?checkout=success`,
      cancel_url: `${baseUrl}/app#billing?checkout=cancel`,
      client_reference_id: user.id,
      ...(user.stripe_customer_id ? { customer: user.stripe_customer_id } : { customer_email: user.email }),
      allow_promotion_codes: true,
      subscription_data: { metadata: { user_id: user.id } },
      metadata: { user_id: user.id },
    },
  });
  return String(session.url);
};

export const createPortal = async (stripe: StripeFetch, user: BillingUser, baseUrl: string): Promise<string> => {
  if (!user.stripe_customer_id) throw new VideoAgentError('Aucun abonnement à gérer');
  const session = await stripe('/billing_portal/sessions', { method: 'POST', body: { customer: user.stripe_customer_id, return_url: `${baseUrl}/app#billing` } });
  return String(session.url);
};

/** Check the Stripe-Signature header (HMAC-SHA256 of "timestamp.payload"). */
export const verifyStripeSignature = (payload: string, header: string | undefined, secret: string, toleranceSec = 300, now = Date.now()): boolean => {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !signatures.length || Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest();
  return signatures.some((s) => {
    const given = Buffer.from(s, 'hex');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
};

/** Build a valid signature header (tests, local webhook replays). */
export const signStripePayload = (payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string =>
  `t=${timestamp},v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  metadata?: { user_id?: string };
  current_period_end?: number;
  items?: { data?: Array<{ price?: { id?: string }; current_period_end?: number }> };
}

const ACTIVE = new Set(['active', 'trialing', 'past_due']);

const applySubscription = async (db: Db, config: AppConfig, sub: StripeSubscription, deleted = false) => {
  const item = sub.items?.data?.[0];
  const plan = !deleted && ACTIVE.has(sub.status) ? (planForPrice(config, item?.price?.id) ?? 'free') : 'free';
  const periodEnd = item?.current_period_end ?? sub.current_period_end;
  await db.query(
    `UPDATE users SET plan = $1, subscription_status = $2, stripe_subscription_id = $3, current_period_end = $4, stripe_customer_id = coalesce(stripe_customer_id, $5)
     WHERE stripe_customer_id = $5 OR id = $6`,
    [plan, deleted ? 'canceled' : sub.status, deleted ? null : sub.id, periodEnd ? new Date(periodEnd * 1000).toISOString() : null, sub.customer, sub.metadata?.user_id ?? ''],
  );
};

/** Process one verified webhook event. Duplicates (Stripe retries) are ignored. */
export const handleStripeEvent = async (db: Db, config: AppConfig, stripe: StripeFetch, event: { id: string; type: string; data: { object: Record<string, unknown> } }): Promise<void> => {
  const fresh = await db.query('INSERT INTO stripe_events (id) VALUES ($1) ON CONFLICT (id) DO NOTHING RETURNING id', [event.id]);
  if (!fresh.length) return;
  const object = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = String(object.client_reference_id ?? '');
      const customer = String(object.customer ?? '');
      if (userId && customer) await db.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2 AND (stripe_customer_id IS NULL OR stripe_customer_id = $1)', [customer, userId]);
      if (object.subscription) {
        const sub = (await stripe(`/subscriptions/${encodeURIComponent(String(object.subscription))}`, { method: 'GET' })) as unknown as StripeSubscription;
        await applySubscription(db, config, { ...sub, metadata: { user_id: userId, ...sub.metadata } });
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await applySubscription(db, config, object as unknown as StripeSubscription);
      break;
    case 'customer.subscription.deleted':
      await applySubscription(db, config, object as unknown as StripeSubscription, true);
      break;
    default:
      break;
  }
};
