/**
 * Prepaid 30-day passes paid through local gateways:
 *  - GeniusPay (Côte d'Ivoire): Wave, Orange Money, MTN, Moov, cards — amounts in XOF;
 *  - YouCan Pay (Morocco): cards, CashPlus — amounts in MAD (sent in centimes).
 * Mobile money has no recurring billing: each payment buys N months of a plan, or packs of extra videos.
 * A payment is activated only after a signed webhook AND a confirmation read back from the gateway.
 */
import crypto from 'node:crypto';
import type { AppConfig } from '../config/config';
import { ConfigError, VideoAgentError } from '../core/errors';
import { newId } from './crypto';
import type { Db } from './db';
import { HttpError } from './http';
import { getPlan, PREPAID, type PlanId } from './plans';

export const PAYMENT_PROVIDERS = ['geniuspay', 'youcanpay'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

const GENIUSPAY_API = 'https://geniuspay.ci/api/v1/merchant';
const YOUCANPAY = 'https://youcanpay.com';
const PASS_DAYS = 30;
/** `plan` value of a payment that buys extra-video credits. */
export const CREDITS = 'credits';

export interface PaymentRow {
  id: string;
  user_id: string;
  provider: PaymentProvider;
  plan: PlanId | typeof CREDITS;
  months: number;
  amount: string | number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  provider_ref: string | null;
  checkout_url: string | null;
  created_at: Date | string;
  paid_at: Date | string | null;
  /** Extra videos bought (credit packs); null for passes. */
  credits: number | null;
}

export const providerEnabled = (config: AppConfig, provider: PaymentProvider): boolean =>
  provider === 'geniuspay' ? Boolean(config.env.GENIUSPAY_API_KEY) : Boolean(config.env.YOUCANPAY_PRIVATE_KEY);

export const enabledProviders = (config: AppConfig): PaymentProvider[] => PAYMENT_PROVIDERS.filter((p) => providerEnabled(config, p));

export const CURRENCY: Record<PaymentProvider, 'XOF' | 'MAD'> = { geniuspay: 'XOF', youcanpay: 'MAD' };

/** Price of a pass in whole units of the currency. */
export const passPrice = (config: AppConfig, plan: PlanId, currency: 'XOF' | 'MAD'): number | undefined => {
  const e = config.env;
  if (plan === 'creator') return currency === 'XOF' ? e.PLAN_CREATOR_PRICE_XOF : e.PLAN_CREATOR_PRICE_MAD;
  if (plan === 'pro') return currency === 'XOF' ? e.PLAN_PRO_PRICE_XOF : e.PLAN_PRO_PRICE_MAD;
  return undefined;
};

/** Price of one pack of extra videos. */
export const packPrice = (config: AppConfig, currency: 'XOF' | 'MAD'): number => (currency === 'XOF' ? config.env.CREDIT_PACK_PRICE_XOF : config.env.CREDIT_PACK_PRICE_MAD);

export const creditPack = (config: AppConfig) => ({
  videos: config.env.CREDIT_PACK_VIDEOS,
  prices: Object.fromEntries(enabledProviders(config).map((p) => [CURRENCY[p], packPrice(config, CURRENCY[p])])) as Partial<Record<'XOF' | 'MAD', number>>,
});

export const localPrices = (config: AppConfig, plan: PlanId) =>
  Object.fromEntries(enabledProviders(config).map((p) => [CURRENCY[p], passPrice(config, plan, CURRENCY[p])]).filter(([, v]) => v !== undefined)) as Partial<Record<'XOF' | 'MAD', number>>;

const youcanSandbox = (config: AppConfig) => config.env.YOUCANPAY_SANDBOX || /^pri_sandbox/i.test(config.env.YOUCANPAY_PRIVATE_KEY ?? '');
const youcanApi = (config: AppConfig) => `${YOUCANPAY}/${youcanSandbox(config) ? 'sandbox/' : ''}api`;

const hmacHex = (secret: string, raw: string | Buffer) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
const safeEqualHex = (a: string, b: string) => {
  const x = Buffer.from(a.trim().toLowerCase());
  const y = Buffer.from(b.trim().toLowerCase());
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const readJson = async (res: Response) => (await res.json().catch(() => ({}))) as Record<string, unknown>;

// ---- Creating a payment -------------------------------------------------------------------

export interface CreatePaymentInput {
  user: { id: string; email: string; name: string; locale: string };
  /** A pass of this plan... */
  plan?: PlanId;
  /** ...or this number of packs of extra videos. */
  packs?: number;
  provider: PaymentProvider;
  months?: number;
  baseUrl: string;
  clientIp: string;
}

export const createPayment = async (db: Db, config: AppConfig, input: CreatePaymentInput, fetchImpl: typeof fetch = fetch): Promise<{ id: string; url: string }> => {
  const { provider, user } = input;
  if (!providerEnabled(config, provider)) throw new ConfigError(`${provider} n'est pas configuré sur cette instance`);
  const currency = CURRENCY[provider];
  const packs = input.packs ? Math.max(1, Math.min(10, Math.round(input.packs))) : 0;
  const plan = packs ? CREDITS : input.plan;
  if (!plan || plan === 'free') throw new HttpError(400, 'Offre gratuite : rien à payer');
  const months = packs || Math.max(1, Math.min(12, Math.round(input.months ?? 1)));
  const credits = packs ? packs * config.env.CREDIT_PACK_VIDEOS : null;
  const amount = (packs ? packPrice(config, currency) : passPrice(config, plan as PlanId, currency)!) * months;
  const id = `pay_${newId().replace(/-/g, '')}`;
  await db.query('INSERT INTO payments (id, user_id, provider, plan, months, amount, currency, credits) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [id, user.id, provider, plan, months, amount, currency, credits]);
  const returnUrl = (status: string) => `${input.baseUrl}/app#billing?payment=${status}&ref=${id}`;
  const description = credits ? `SOVID AI — ${credits} vidéos supplémentaires` : `SOVID AI — ${getPlan(config, plan).name} (${months * PASS_DAYS} jours)`;

  try {
    if (provider === 'geniuspay') {
      const res = await fetchImpl(`${GENIUSPAY_API}/payments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...geniusHeaders(config) },
        // Always send the currency: GeniusPay silently converts other currencies.
        body: JSON.stringify({
          amount,
          currency: 'XOF',
          description,
          customer: { name: user.name || user.email, email: user.email },
          success_url: returnUrl('success'),
          error_url: returnUrl('error'),
          metadata: { payment_id: id, user_id: user.id, plan, months },
        }),
      });
      const body = await readJson(res);
      const data = body.data as { reference?: string; checkout_url?: string; payment_url?: string } | undefined;
      const url = data?.checkout_url ?? data?.payment_url;
      if (!res.ok || !data?.reference || !url) throw new VideoAgentError(`GeniusPay : ${String((body as { message?: string }).message ?? `HTTP ${res.status}`)}`);
      await db.query('UPDATE payments SET provider_ref = $2, checkout_url = $3 WHERE id = $1', [id, data.reference, url]);
      return { id, url };
    }

    // YouCan Pay: tokenize, then send the customer to the hosted payment form.
    const form = new FormData();
    form.append('pri_key', config.env.YOUCANPAY_PRIVATE_KEY!);
    form.append('order_id', id);
    form.append('amount', String(amount * 100)); // centimes
    form.append('currency', 'MAD');
    form.append('customer_ip', input.clientIp);
    form.append('success_url', returnUrl('success'));
    form.append('error_url', returnUrl('error'));
    form.append('customer[name]', user.name || user.email);
    form.append('customer[email]', user.email);
    form.append('metadata[payment_id]', id);
    form.append('metadata[plan]', plan);
    const res = await fetchImpl(`${youcanApi(config)}/tokenize`, { method: 'POST', headers: { accept: 'application/json' }, body: form });
    const body = await readJson(res);
    const token = typeof body.token === 'string' ? body.token : (body.token as { id?: string } | undefined)?.id;
    if (!res.ok || !token) throw new VideoAgentError(`YouCan Pay : ${String((body as { message?: string }).message ?? `HTTP ${res.status}`)}`);
    const url = `${YOUCANPAY}/${youcanSandbox(config) ? 'sandbox/' : ''}payment-form/${encodeURIComponent(token)}?lang=${user.locale === 'en' ? 'en' : 'fr'}`;
    await db.query('UPDATE payments SET provider_ref = $2, checkout_url = $3 WHERE id = $1', [id, token, url]);
    return { id, url };
  } catch (err) {
    await db.query("UPDATE payments SET status = 'failed' WHERE id = $1", [id]);
    throw err;
  }
};

const geniusHeaders = (config: AppConfig): Record<string, string> => ({
  'X-API-Key': config.env.GENIUSPAY_API_KEY!,
  ...(config.env.GENIUSPAY_API_SECRET ? { 'X-API-Secret': config.env.GENIUSPAY_API_SECRET } : {}),
});

// ---- Activation --------------------------------------------------------------------------

/**
 * Mark a payment paid (once) and extend the user's pass: a pass of the same plan still running
 * is extended from its end date, otherwise the new period starts now.
 */
export const activatePayment = async (db: Db, paymentId: string, raw?: unknown): Promise<boolean> =>
  db.tx(async (t) => {
    const p = await t.one<PaymentRow>("UPDATE payments SET status = 'paid', paid_at = now(), raw = $2 WHERE id = $1 AND status <> 'paid' RETURNING *", [paymentId, raw === undefined ? null : JSON.stringify(raw)]);
    if (!p) return false;
    if (p.credits) {
      await t.query('UPDATE users SET credits = credits + $2 WHERE id = $1', [p.user_id, p.credits]);
      return true;
    }
    const user = await t.one<{ plan: string; subscription_status: string | null; current_period_end: Date | string | null }>('SELECT plan, subscription_status, current_period_end FROM users WHERE id = $1 FOR UPDATE', [p.user_id]);
    const end = user?.current_period_end ? new Date(user.current_period_end).getTime() : 0;
    const base = user?.subscription_status === PREPAID && user.plan === p.plan && end > Date.now() ? end : Date.now();
    const until = new Date(base + p.months * PASS_DAYS * 86_400_000);
    await t.query('UPDATE users SET plan = $2, subscription_status = $3, current_period_end = $4 WHERE id = $1', [p.user_id, p.plan, PREPAID, until.toISOString()]);
    return true;
  });

/** The gateway's amount covers the price (in the same unit). */
const paidEnough = (expected: number, amount: unknown) => Number.isFinite(Number(amount)) && Number(amount) >= expected;

// ---- GeniusPay --------------------------------------------------------------------------------

export const getGeniusPayment = async (config: AppConfig, reference: string, fetchImpl: typeof fetch = fetch) => {
  const res = await fetchImpl(`${GENIUSPAY_API}/payments/${encodeURIComponent(reference)}`, { headers: { accept: 'application/json', ...geniusHeaders(config) } });
  const body = await readJson(res);
  if (!res.ok) throw new VideoAgentError(`GeniusPay : HTTP ${res.status}`);
  return body.data as { reference: string; status: string; amount: number; currency: string } | undefined;
};

/** Read the payment back from GeniusPay and activate it when completed. */
const confirmGenius = async (db: Db, config: AppConfig, payment: PaymentRow, fetchImpl: typeof fetch) => {
  const remote = await getGeniusPayment(config, payment.provider_ref!, fetchImpl);
  if (remote?.status === 'completed' && remote.currency === 'XOF' && paidEnough(Number(payment.amount), remote.amount)) return activatePayment(db, payment.id, remote);
  if (remote && ['failed', 'cancelled'].includes(remote.status)) await db.query("UPDATE payments SET status = $2 WHERE id = $1 AND status = 'pending'", [payment.id, remote.status]);
  return false;
};

export const handleGeniusPayWebhook = async (db: Db, config: AppConfig, raw: string, signature: string | undefined, fetchImpl: typeof fetch = fetch): Promise<{ applied: boolean }> => {
  const secret = config.env.GENIUSPAY_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, 'GENIUSPAY_WEBHOOK_SECRET manquant');
  if (!signature || !safeEqualHex(signature, hmacHex(secret, raw))) throw new HttpError(401, 'invalid signature');
  const event = JSON.parse(raw) as { event?: string; data?: { transaction?: { reference?: string; metadata?: { payment_id?: string } } } };
  const reference = event.data?.transaction?.reference;
  if (!reference) return { applied: false };
  const payment = await db.one<PaymentRow>("SELECT * FROM payments WHERE provider = 'geniuspay' AND provider_ref = $1", [reference]);
  if (!payment) return { applied: false };
  // The webhook only triggers a check: the status is read back from GeniusPay itself.
  return { applied: await confirmGenius(db, config, payment, fetchImpl) };
};

// ---- YouCan Pay -------------------------------------------------------------------------------

export const handleYouCanPayWebhook = async (db: Db, config: AppConfig, raw: string, signature: string | undefined, fetchImpl: typeof fetch = fetch): Promise<{ applied: boolean }> => {
  const key = config.env.YOUCANPAY_PRIVATE_KEY;
  if (!key) throw new HttpError(503, 'YOUCANPAY_PRIVATE_KEY manquant');
  if (!signature || !safeEqualHex(signature, hmacHex(key, raw))) throw new HttpError(401, 'invalid signature');
  const event = JSON.parse(raw) as { event_name?: string; payload?: { transaction?: { id?: string; order_id?: string; amount?: number | string; currency?: string } } };
  const tx = event.payload?.transaction;
  if (event.event_name !== 'transaction.paid' || !tx?.order_id) return { applied: false };
  const payment = await db.one<PaymentRow>("SELECT * FROM payments WHERE provider = 'youcanpay' AND id = $1", [tx.order_id]);
  if (!payment) return { applied: false };
  let confirmed: { order_id?: string; amount?: number | string; currency?: string; status?: number | string } = tx;
  // Live mode: read the transaction back from YouCan Pay (the sandbox has no lookup endpoint).
  if (!youcanSandbox(config) && tx.id) {
    const res = await fetchImpl(`${youcanApi(config)}/transactions/${encodeURIComponent(tx.id)}?pri_key=${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new HttpError(502, `YouCan Pay : HTTP ${res.status}`);
    confirmed = (await readJson(res)) as typeof confirmed;
    if (String(confirmed.order_id ?? '') !== payment.id) throw new HttpError(400, 'transaction mismatch');
  }
  // Amounts are in centimes.
  if (confirmed.currency && confirmed.currency !== 'MAD') return { applied: false };
  if (confirmed.amount !== undefined && !paidEnough(Number(payment.amount) * 100, confirmed.amount)) return { applied: false };
  return { applied: await activatePayment(db, payment.id, confirmed) };
};

// ---- After the redirect ---------------------------------------------------------------------------

/** "I have paid" / return page: ask GeniusPay directly, useful when webhooks are late or not configured. */
export const refreshPayment = async (db: Db, config: AppConfig, userId: string, paymentId: string, fetchImpl: typeof fetch = fetch): Promise<PaymentRow | undefined> => {
  const payment = await db.one<PaymentRow>('SELECT * FROM payments WHERE id = $1 AND user_id = $2', [paymentId, userId]);
  if (!payment) return undefined;
  if (payment.status === 'pending' && payment.provider === 'geniuspay' && payment.provider_ref) await confirmGenius(db, config, payment, fetchImpl).catch(() => false);
  return db.one<PaymentRow>('SELECT * FROM payments WHERE id = $1', [paymentId]);
};

export const listPayments = (db: Db, userId?: string, limit = 50) =>
  userId
    ? db.query<PaymentRow>('SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, limit])
    : db.query<PaymentRow & { email: string }>('SELECT p.*, u.email FROM payments p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT $1', [limit]);

export const publicPayment = (p: PaymentRow & { email?: string }) => ({
  id: p.id,
  provider: p.provider,
  plan: p.plan,
  months: p.months,
  credits: p.credits ?? undefined,
  amount: Number(p.amount),
  currency: p.currency,
  status: p.status,
  createdAt: new Date(p.created_at).toISOString(),
  paidAt: p.paid_at ? new Date(p.paid_at).toISOString() : undefined,
  email: p.email,
});
