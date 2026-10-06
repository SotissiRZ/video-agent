import crypto from 'node:crypto';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/core/logger';
import { connectPglite, migrate, type Db } from '../src/saas/db';
import { handleYouCanPayWebhook } from '../src/saas/payments';
import { refundCredits } from '../src/saas/jobs';
import { sendPassReminders } from '../src/saas/reminders';
import type { MailMessage } from '../src/saas/mail';
import { getPlan, planOfUser } from '../src/saas/plans';
import { startSaasServer } from '../src/saas/server';
import { fakeRenderer, testConfig } from './helpers';

class Client {
  cookie = '';
  constructor(private readonly base: string) {}
  async json(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(this.base + p, { method, headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
}

const ENV = {
  APP_SECRET: 'z'.repeat(40),
  GENIUSPAY_API_KEY: 'pk_sandbox_test',
  GENIUSPAY_WEBHOOK_SECRET: 'whsec_genius',
  YOUCANPAY_PRIVATE_KEY: 'pri_sandbox_test',
  PLAN_CREATOR_PRICE_XOF: '10000',
  PLAN_CREATOR_PRICE_MAD: '190',
  CREDIT_PACK_VIDEOS: '10',
  CREDIT_PACK_PRICE_XOF: '5000',
};
const sign = (secret: string, raw: string) => crypto.createHmac('sha256', secret).update(raw).digest('hex');

/** Fake gateways: GeniusPay status per reference, YouCan Pay tokens. */
const remote = new Map<string, { status: string; amount: number; currency: string }>();
const calls: Array<{ url: string; init?: RequestInit }> = [];
const gatewayFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  calls.push({ url, init });
  if (url === 'https://geniuspay.ci/api/v1/merchant/payments' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body));
    const reference = `MTX-${remote.size + 1}`;
    remote.set(reference, { status: 'pending', amount: body.amount, currency: body.currency });
    return Response.json({ success: true, data: { reference, checkout_url: `https://geniuspay.ci/checkout/${reference}`, payment_url: `https://geniuspay.ci/checkout/${reference}`, status: 'pending' } }, { status: 201 });
  }
  const m = /merchant\/payments\/([^/?]+)$/.exec(url);
  if (m) return remote.has(m[1]!) ? Response.json({ success: true, data: { reference: m[1], ...remote.get(m[1]!) } }) : Response.json({ success: false }, { status: 404 });
  if (url === 'https://youcanpay.com/sandbox/api/tokenize') return Response.json({ token: { id: 'tok_123' } });
  return new Response('not found', { status: 404 });
};

let base: string;
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  db = await connectPglite();
  await migrate(db);
  const started = await startSaasServer(testConfig(ENV), {
    port: 0,
    host: '127.0.0.1',
    webRoot: path.resolve('web'),
    db,
    embeddedWorker: false,
    reminders: false,
    logger: createLogger('silent'),
    deps: { renderer: fakeRenderer, logger: createLogger('silent'), llm: null, voice: null, stock: [] },
    mailer: { kind: 'log', send: async () => undefined },
    paymentFetch: gatewayFetch,
  });
  base = started.url;
  close = started.close;
}, 60_000);
afterAll(async () => {
  await close?.();
  await db?.close();
});

describe('prepaid passes', () => {
  it('shows local prices and both gateways', async () => {
    const cfg = (await new Client(base).json('GET', '/api/public/config')).body;
    expect(cfg.paymentProviders).toEqual([{ id: 'geniuspay', currency: 'XOF' }, { id: 'youcanpay', currency: 'MAD' }]);
    const creator = cfg.plans.find((p: { id: string }) => p.id === 'creator');
    expect(creator).toMatchObject({ purchasable: true, localPrices: { XOF: 10000, MAD: 190 } });
  });

  it('GeniusPay: checkout, signed webhook, confirmation with the gateway, 30-day pass extended on renewal', async () => {
    const c = new Client(base);
    await c.json('POST', '/api/auth/signup', { email: 'awa@shop.ci', password: 'motdepasse1', name: 'Awa' });
    const pay = await c.json('POST', '/api/billing/pay', { plan: 'creator', provider: 'geniuspay' });
    expect(pay.status).toBe(200);
    expect(pay.body.url).toBe('https://geniuspay.ci/checkout/MTX-1');
    const sent = calls.find((x) => x.url.endsWith('/merchant/payments'))!;
    expect(JSON.parse(String(sent.init!.body))).toMatchObject({ amount: 10000, currency: 'XOF', metadata: { plan: 'creator' } });
    expect((sent.init!.headers as Record<string, string>)['X-API-Key']).toBe('pk_sandbox_test');

    const event = JSON.stringify({ event: 'payment.success', data: { transaction: { reference: 'MTX-1', status: 'completed' } } });
    const hook = (raw: string, signature: string) => new Client(base).json('POST', '/api/payments/geniuspay/webhook', raw, { 'x-geniuspay-signature': signature });
    expect((await hook(event, 'deadbeef')).status).toBe(401);
    // Signed, but GeniusPay still says "pending": nothing is activated (a forged event cannot activate a plan).
    expect((await hook(event, sign('whsec_genius', event))).body.applied).toBe(false);
    remote.get('MTX-1')!.status = 'completed';
    expect((await hook(event, sign('whsec_genius', event))).body.applied).toBe(true);
    expect((await hook(event, sign('whsec_genius', event))).body.applied).toBe(false); // retries are harmless

    const me = (await c.json('GET', '/api/me')).body;
    expect(me.plan.id).toBe('creator');
    expect(me.user.subscriptionStatus).toBe('prepaid');
    const days = (new Date(me.user.currentPeriodEnd).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);

    // Renewal before the end: the new month is added to the remaining time.
    const again = await c.json('POST', '/api/billing/pay', { plan: 'creator', provider: 'geniuspay' });
    remote.get('MTX-2')!.status = 'completed';
    const refreshed = await c.json('POST', `/api/billing/payments/${again.body.id}/refresh`);
    expect(refreshed.body.payment.status).toBe('paid');
    const days2 = (new Date(refreshed.body.account.user.currentPeriodEnd).getTime() - Date.now()) / 86_400_000;
    expect(days2).toBeGreaterThan(59.9);
    const history = (await c.json('GET', '/api/billing/payments')).body;
    expect(history.map((p: { status: string }) => p.status)).toEqual(['paid', 'paid']);
  });

  it('GeniusPay: an underpaid or foreign-currency payment is not activated', async () => {
    const c = new Client(base);
    await c.json('POST', '/api/auth/signup', { email: 'koffi@shop.ci', password: 'motdepasse1' });
    const pay = await c.json('POST', '/api/billing/pay', { plan: 'creator', provider: 'geniuspay' });
    const ref = new URL(pay.body.url).pathname.split('/').pop()!;
    remote.set(ref, { status: 'completed', amount: 200, currency: 'XOF' });
    const event = JSON.stringify({ event: 'payment.success', data: { transaction: { reference: ref } } });
    expect((await new Client(base).json('POST', '/api/payments/geniuspay/webhook', event, { 'x-geniuspay-signature': sign('whsec_genius', event) })).body.applied).toBe(false);
    expect((await c.json('GET', '/api/me')).body.plan.id).toBe('free');
  });

  it('YouCan Pay: hosted payment form, webhook signed with the private key, amounts in centimes', async () => {
    const c = new Client(base);
    await c.json('POST', '/api/auth/signup', { email: 'youssef@shop.ma', password: 'motdepasse1', locale: 'fr' });
    const pay = await c.json('POST', '/api/billing/pay', { plan: 'creator', provider: 'youcanpay', months: 3 });
    expect(pay.body.url).toBe('https://youcanpay.com/sandbox/payment-form/tok_123?lang=fr');
    const form = calls.find((x) => x.url.endsWith('/tokenize'))!.init!.body as FormData;
    expect(form.get('amount')).toBe(String(190 * 3 * 100));
    expect(form.get('currency')).toBe('MAD');
    expect(form.get('order_id')).toBe(pay.body.id);

    const low = JSON.stringify({ id: 'evt_0', event_name: 'transaction.paid', payload: { transaction: { id: 't0', order_id: pay.body.id, amount: 100, currency: 'MAD' } } });
    const hook = (raw: string) => new Client(base).json('POST', '/api/payments/youcanpay/webhook', raw, { 'x-youcanpay-signature': sign('pri_sandbox_test', raw) });
    expect((await hook(low)).body.applied).toBe(false);
    const ok = JSON.stringify({ id: 'evt_1', event_name: 'transaction.paid', payload: { transaction: { id: 't1', order_id: pay.body.id, amount: 57000, currency: 'MAD' } } });
    expect((await new Client(base).json('POST', '/api/payments/youcanpay/webhook', ok, { 'x-youcanpay-signature': sign('wrong', ok) })).status).toBe(401);
    expect((await hook(ok)).body.applied).toBe(true);
    const me = (await c.json('GET', '/api/me')).body;
    expect(me.plan.id).toBe('creator');
    expect((new Date(me.user.currentPeriodEnd).getTime() - Date.now()) / 86_400_000).toBeGreaterThan(89.9);
  });

  it('YouCan Pay live: the transaction is read back before activation', async () => {
    const config = testConfig({ ...ENV, YOUCANPAY_PRIVATE_KEY: 'pri_live_key' });
    const user = await db.one<{ id: string }>("SELECT id FROM users WHERE email = 'koffi@shop.ci'");
    await db.query("INSERT INTO payments (id, user_id, provider, plan, months, amount, currency, provider_ref) VALUES ('pay_live', $1, 'youcanpay', 'pro', 1, 490, 'MAD', 'tok_live')", [user!.id]);
    const raw = JSON.stringify({ event_name: 'transaction.paid', payload: { transaction: { id: 'tx9', order_id: 'pay_live', amount: 49000, currency: 'MAD' } } });
    let looked = '';
    const liveFetch = (async (url: string) => {
      looked = url;
      return Response.json({ order_id: 'someone-else', amount: 49000, currency: 'MAD' });
    }) as unknown as typeof fetch;
    await expect(handleYouCanPayWebhook(db, config, raw, sign('pri_live_key', raw), liveFetch)).rejects.toThrow(/mismatch/);
    expect(looked).toBe('https://youcanpay.com/api/transactions/tx9?pri_key=pri_live_key');
    const goodFetch = (async () => Response.json({ order_id: 'pay_live', amount: 49000, currency: 'MAD' })) as unknown as typeof fetch;
    expect((await handleYouCanPayWebhook(db, config, raw, sign('pri_live_key', raw), goodFetch)).applied).toBe(true);
  });

  it('an expired pass falls back to the free plan', () => {
    const config = testConfig();
    const past = new Date(Date.now() - 1000).toISOString();
    expect(planOfUser(config, { plan: 'pro', subscription_status: 'prepaid', current_period_end: past }).id).toBe('free');
    expect(planOfUser(config, { plan: 'pro', subscription_status: 'prepaid', current_period_end: new Date(Date.now() + 1e6).toISOString() }).id).toBe('pro');
    expect(planOfUser(config, { plan: 'pro', subscription_status: 'active', current_period_end: past }).id).toBe('pro'); // Stripe manages its own state
    expect(getPlan(config, 'creator').id).toBe('creator');
  });

  it('extra-video packs: bought with mobile money, used beyond the quota, refunded when a video fails', async () => {
    const c = new Client(base);
    await c.json('POST', '/api/auth/signup', { email: 'fatou@shop.sn', password: 'motdepasse1' });
    const cfg = (await c.json('GET', '/api/public/config')).body;
    expect(cfg.creditPack).toEqual({ videos: 10, prices: { XOF: 5000, MAD: 90 } });

    const pay = await c.json('POST', '/api/billing/pay', { packs: 2, provider: 'geniuspay' });
    expect(pay.status).toBe(200);
    const sent = calls.filter((x) => x.url.endsWith('/merchant/payments')).at(-1)!;
    expect(JSON.parse(String(sent.init!.body))).toMatchObject({ amount: 10000, currency: 'XOF' });
    const ref = new URL(pay.body.url).pathname.split('/').pop()!;
    remote.get(ref)!.status = 'completed';
    const refreshed = await c.json('POST', `/api/billing/payments/${pay.body.id}/refresh`);
    expect(refreshed.body.payment).toMatchObject({ status: 'paid', credits: 20 });
    expect(refreshed.body.account.user.credits).toBe(20);
    expect(refreshed.body.account.plan.id).toBe('free'); // a pack does not change the plan

    // The free plan's 3 videos, then credits.
    const create = () => c.json('POST', '/api/jobs', { prompt: 'Une vidéo pour ma boutique', durationSec: 10 });
    for (let i = 0; i < 3; i++) expect((await create()).status).toBe(201);
    const extra = await create();
    expect(extra.status).toBe(201);
    expect(extra.body.paidWithCredit).toBe(true);
    let me = (await c.json('GET', '/api/me')).body;
    expect(me.user.credits).toBe(19);
    expect(me.usage.videos).toBe(3); // credit videos are outside the monthly count

    // Cancelled (or failed) video: the credit comes back, once.
    expect((await c.json('DELETE', `/api/jobs/${extra.body.id}`)).body.cancelled).toBe(true);
    await refundCredits(db);
    me = (await c.json('GET', '/api/me')).body;
    expect(me.user.credits).toBe(20);

    // A video longer than the plan allows is refused even with credits.
    const long = await c.json('POST', '/api/jobs', { prompt: 'Une longue vidéo', durationSec: 300 });
    expect(long.status).toBe(402);
    expect(long.body.code).toBe('quota_duration');
    expect((await c.json('GET', '/api/me')).body.user.credits).toBe(20);
    expect((await c.json('POST', '/api/billing/pay', { provider: 'geniuspay' })).status).toBe(400);
  });

  it('e-mails a reminder before a pass ends and when it expires, once each', async () => {
    const config = testConfig(ENV);
    const mails: MailMessage[] = [];
    const mailer = { kind: 'log' as const, send: async (m: MailMessage) => void mails.push(m) };
    const logger = createLogger('silent');
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await db.query("INSERT INTO users (id, email, password_hash, name, locale, plan, subscription_status, current_period_end) VALUES ('u_soon', 'soon@shop.ci', 'x', '', 'fr', 'creator', 'prepaid', $1), ('u_past', 'past@shop.ma', 'x', '', 'en', 'pro', 'prepaid', $2)", [soon, past]);
    expect(await sendPassReminders(db, config, mailer, 'https://app.example.com', logger)).toBe(2);
    expect(await sendPassReminders(db, config, mailer, 'https://app.example.com', logger)).toBe(0);
    const toSoon = mails.find((m) => m.to === 'soon@shop.ci')!;
    expect(toSoon.subject).toMatch(/Votre pass Creator se termine le/);
    expect(toSoon.text).toContain('https://app.example.com/app#billing');
    expect(mails.find((m) => m.to === 'past@shop.ma')!.subject).toMatch(/Your Pro pass has expired/);
    // Renewed: a new period gets its own reminder later.
    await db.query("UPDATE users SET current_period_end = $1 WHERE id = 'u_soon'", [new Date(Date.now() + 2.5 * 86_400_000).toISOString()]);
    expect(await sendPassReminders(db, config, mailer, 'https://app.example.com', logger)).toBe(1);
  });
});
