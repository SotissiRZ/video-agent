import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/core/logger';
import { connectPglite, migrate, type Db } from '../src/saas/db';
import type { MailMessage } from '../src/saas/mail';
import { startSaasServer } from '../src/saas/server';
import { fakeRenderer, testConfig } from './helpers';

class Client {
  cookie = '';
  constructor(private readonly base: string) {}
  async json(method: string, p: string, body?: unknown) {
    const res = await fetch(this.base + p, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    return { status: res.status, location: res.headers.get('location'), body: await res.json().catch(() => ({})) };
  }
}

const mails: MailMessage[] = [];
let base: string;
let db: Db;
let close: () => Promise<void>;
const lastLink = (to: string) => {
  const mail = [...mails].reverse().find((m) => m.to === to)!;
  return /(https?:\/\/\S+)/.exec(mail.text)![1]!;
};

beforeAll(async () => {
  db = await connectPglite();
  await migrate(db);
  const started = await startSaasServer(testConfig({ APP_SECRET: 'y'.repeat(40), REQUIRE_EMAIL_VERIFICATION: 'true', COMPANY_NAME: 'ZSR-TechNum' }), {
    port: 0,
    host: '127.0.0.1',
    webRoot: path.resolve('web'),
    db,
    embeddedWorker: false,
    logger: createLogger('silent'),
    deps: { renderer: fakeRenderer, logger: createLogger('silent'), llm: null, voice: null, stock: [] },
    mailer: { kind: 'smtp', send: async (m) => void mails.push(m) },
  });
  base = started.url;
  close = started.close;
}, 60_000);
afterAll(async () => {
  await close?.();
  await db?.close();
});

describe('e-mail verification', () => {
  it('sends a confirmation link at sign-up and blocks videos until confirmed', async () => {
    const c = new Client(base);
    const s = await c.json('POST', '/api/auth/signup', { email: 'awa@example.com', password: 'motdepasse1', locale: 'fr' });
    expect(s.body.user.emailVerified).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(mails.at(-1)).toMatchObject({ to: 'awa@example.com', subject: 'Confirmez votre adresse e-mail — ZSR-TechNum' });
    expect(mails.at(-1)!.html).toContain('Confirmer mon adresse');
    expect((await c.json('POST', '/api/jobs', { prompt: 'Une vidéo pour mon café' })).body.code).toBe('email_unverified');

    const link = new URL(lastLink('awa@example.com'));
    expect((await c.json('GET', `${link.pathname}?token=forged`)).location).toBe('/app#account?verified=0');
    expect((await c.json('GET', link.pathname + link.search)).location).toBe('/app#create?verified=1');
    expect((await c.json('GET', link.pathname + link.search)).location).toBe('/app#account?verified=0'); // single use
    expect((await c.json('GET', '/api/me')).body.user.emailVerified).toBe(true);
    expect((await c.json('POST', '/api/jobs', { prompt: 'Une vidéo pour mon café' })).status).toBe(201);
  });
});

describe('password reset', () => {
  it('sends a one-time link without revealing which addresses exist', async () => {
    const owner = new Client(base);
    await owner.json('POST', '/api/auth/signup', { email: 'bob@example.com', password: 'ancienmotdepasse', locale: 'en' });
    const before = mails.length;
    const anon = new Client(base);
    expect((await anon.json('POST', '/api/auth/forgot', { email: 'nobody@example.com' })).body).toEqual({ ok: true });
    expect((await anon.json('POST', '/api/auth/forgot', { email: 'BOB@example.com' })).body).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(mails.length).toBe(before + 1);
    expect(mails.at(-1)!.subject).toBe('Reset your password — ZSR-TechNum');
    const token = new URL(lastLink('bob@example.com').replace('#reset?', '?')).searchParams.get('token')!;

    expect((await anon.json('POST', '/api/auth/reset', { token, password: 'court' })).body.code).toBe('weak_password');
    const ok = await anon.json('POST', '/api/auth/reset', { token, password: 'nouveaumotdepasse' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.emailVerified).toBe(true);
    expect((await anon.json('POST', '/api/auth/reset', { token, password: 'encoreunautre' })).body.code).toBe('invalid_token');
    // Old sessions are closed, the old password no longer works.
    expect((await owner.json('GET', '/api/me')).status).toBe(401);
    expect((await new Client(base).json('POST', '/api/auth/login', { email: 'bob@example.com', password: 'ancienmotdepasse' })).status).toBe(400);
    expect((await new Client(base).json('POST', '/api/auth/login', { email: 'bob@example.com', password: 'nouveaumotdepasse' })).status).toBe(200);
  });
});
