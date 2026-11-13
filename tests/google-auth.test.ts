import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/core/logger';
import { connectPglite, migrate, type Db } from '../src/saas/db';
import { GoogleAuthError, openFlow, sealFlow, startGoogleFlow, verifyIdToken, type GoogleFlow } from '../src/saas/google-auth';
import { startSaasServer } from '../src/saas/server';
import { testConfig } from './helpers';

const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const SECRET = 'x'.repeat(40);

const idToken = (claims: Record<string, unknown>) =>
  [{ alg: 'RS256', typ: 'JWT' }, claims].map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.') + '.signature';

const claims = (over: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 3600,
  sub: 'google-sub-1',
  email: 'awa@example.com',
  email_verified: true,
  name: 'Awa Traoré',
  nonce: 'n-1',
  ...over,
});

describe('google sign-in: flow cookie and ID token', () => {
  const flow: GoogleFlow = { state: 's', verifier: 'v', nonce: 'n', intent: 'login', terms: false, locale: 'fr', at: Date.now() };

  it('opens only an untampered, fresh flow', () => {
    const sealed = sealFlow(flow, SECRET);
    expect(openFlow(sealed, SECRET)?.state).toBe('s');
    expect(openFlow(sealed, 'another-secret-another-secret-12345')).toBeUndefined();
    const [body] = sealed.split('.');
    const forged = Buffer.from(JSON.stringify({ ...flow, terms: true })).toString('base64url');
    expect(openFlow(`${forged}.${sealed.split('.')[1]}`, SECRET)).toBeUndefined();
    expect(body).not.toBe(forged);
    expect(openFlow(sealed, SECRET, Date.now() + 11 * 60_000)).toBeUndefined();
    expect(openFlow(undefined, SECRET)).toBeUndefined();
  });

  it('builds a PKCE + nonce consent URL', () => {
    const { flow: started, url } = startGoogleFlow({ id: CLIENT_ID, secret: 's' }, 'https://app.test/api/auth/google/callback', { intent: 'signup', terms: true, locale: 'en' });
    const params = new URL(url).searchParams;
    expect(params.get('client_id')).toBe(CLIENT_ID);
    expect(params.get('state')).toBe(started.state);
    expect(params.get('nonce')).toBe(started.nonce);
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).not.toBe(started.verifier);
    expect(params.get('scope')).toBe('openid email profile');
  });

  it('checks issuer, audience, expiry, nonce and verified e-mail', () => {
    expect(verifyIdToken(idToken(claims()), CLIENT_ID, 'n-1')).toEqual({ sub: 'google-sub-1', email: 'awa@example.com', name: 'Awa Traoré' });
    const bad = (over: Record<string, unknown>, nonce = 'n-1') => () => verifyIdToken(idToken(claims(over)), CLIENT_ID, nonce);
    expect(bad({ iss: 'https://evil.example' })).toThrow(GoogleAuthError);
    expect(bad({ aud: 'other-client' })).toThrow(/autre application/);
    expect(bad({ exp: Math.floor(Date.now() / 1000) - 3600 })).toThrow(/expiré/);
    expect(bad({}, 'n-2')).toThrow(/Nonce/);
    expect(bad({ email_verified: false })).toThrow(/non vérifiée/);
    expect(() => verifyIdToken(undefined, CLIENT_ID, 'n-1')).toThrow(GoogleAuthError);
  });
});

describe('google sign-in: end to end', () => {
  let base: string;
  let db: Db;
  let close: () => Promise<void>;
  /** code → claims returned by the fake token endpoint (the nonce is filled from the flow). */
  const codes = new Map<string, Record<string, unknown>>();
  let lastNonce = '';

  beforeAll(async () => {
    const config = testConfig({ APP_SECRET: SECRET, GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'google-secret' });
    db = await connectPglite();
    await migrate(db);
    const started = await startSaasServer(config, {
      port: 0,
      host: '127.0.0.1',
      webRoot: path.resolve('web'),
      db,
      embeddedWorker: false,
      reminders: false,
      logger: createLogger('silent'),
      deps: { logger: createLogger('silent'), llm: null, voice: null, stock: [] },
      googleExchange: async ({ code, verifier, client }) => {
        expect(verifier.length).toBeGreaterThan(40);
        expect(client.secret).toBe('google-secret');
        const c = codes.get(code);
        if (!c) throw new GoogleAuthError('failed', 'unknown code');
        return { id_token: idToken({ ...c, nonce: c.nonce ?? lastNonce }) };
      },
    });
    base = started.url;
    close = started.close;
  });
  afterAll(async () => {
    await close();
    await db.close();
  });

  const cookiesOf = (res: Response) => Object.fromEntries(res.headers.getSetCookie().map((c) => c.split(';')[0]!.split('=') as [string, string]));

  /** Runs the whole redirect dance like a browser; returns the final redirect and the session cookie. */
  const signIn = async (query: string, code: string, over: Record<string, unknown> = {}, tamper?: (state: string) => string) => {
    const start = await fetch(`${base}/api/auth/google?${query}`, { redirect: 'manual' });
    expect(start.status).toBe(302);
    const consent = new URL(start.headers.get('location')!);
    expect(consent.origin).toBe('https://accounts.google.com');
    lastNonce = consent.searchParams.get('nonce')!;
    codes.set(code, claims({ nonce: undefined, ...over }));
    const flow = cookiesOf(start).va_google!;
    const state = consent.searchParams.get('state')!;
    const back = await fetch(`${base}/api/auth/google/callback?code=${code}&state=${tamper ? tamper(state) : state}`, { redirect: 'manual', headers: { cookie: `va_google=${flow}` } });
    expect(back.status).toBe(302);
    return { location: back.headers.get('location')!, session: cookiesOf(back).va_session };
  };
  const me = async (session: string) => (await fetch(`${base}/api/me`, { headers: { cookie: `va_session=${session}` } })).json();

  it('advertises Google sign-in and Google as a processor', async () => {
    const cfg = await (await fetch(`${base}/api/public/config`)).json();
    expect(cfg.features.googleLogin).toBe(true);
    expect(cfg.processors).toContainEqual({ name: 'Google', purpose: 'auth' });
  });

  it('creates an account (first one is admin, verified, without password) and signs it in', async () => {
    const { location, session } = await signIn('intent=signup&terms=1&lang=en', 'c1');
    expect(location).toBe('/app#create');
    const body = await me(session!);
    expect(body.user).toMatchObject({ email: 'awa@example.com', name: 'Awa Traoré', role: 'admin', locale: 'en', emailVerified: true, hasPassword: false });
    // No password yet: password login fails, and the first password needs no current one.
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'awa@example.com', password: '' }) });
    expect(login.status).toBe(400);
    const set = await fetch(`${base}/api/me/password`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `va_session=${session}` }, body: JSON.stringify({ current: '', next: 'motdepasse-solide' }) });
    expect(set.status).toBe(200);
  });

  it('signs the same Google account in again', async () => {
    const { location, session } = await signIn('intent=login', 'c2');
    expect(location).toBe('/app#create');
    expect((await me(session!)).user.email).toBe('awa@example.com');
  });

  it('refuses a new account without the terms box, back to the sign-up form', async () => {
    const { location, session } = await signIn('intent=login&plan=creator', 'c3', { sub: 'google-sub-2', email: 'moussa@example.com' });
    expect(location).toBe('/app#signup?google=terms_required&plan=creator');
    expect(session).toBeUndefined();
    expect(await db.one('SELECT 1 FROM users WHERE email = $1', ['moussa@example.com'])).toBeUndefined();
  });

  it('links an existing e-mail account and marks it verified; continues to checkout from a paid plan', async () => {
    const signup = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'fatou@example.com', password: 'motdepasse-1', acceptTerms: true }) });
    expect(signup.status).toBe(200);
    const { location, session } = await signIn('intent=login&plan=pro', 'c4', { sub: 'google-sub-3', email: 'Fatou@Example.com' });
    expect(location).toBe('/app#login?plan=pro');
    expect((await me(session!)).user).toMatchObject({ email: 'fatou@example.com', role: 'user', emailVerified: true, hasPassword: true });
    // Another Google identity claiming the same address is not linked.
    const other = await signIn('intent=login', 'c5', { sub: 'google-sub-4', email: 'fatou@example.com' });
    expect(other.location).toBe('/app#login?google=google_mismatch');
    expect(other.session).toBeUndefined();
  });

  it('rejects a forged state, a missing flow cookie and a cancelled consent', async () => {
    const forged = await signIn('intent=login', 'c6', {}, () => 'forged-state');
    expect(forged.location).toBe('/app#login?google=expired');
    expect(forged.session).toBeUndefined();
    const noCookie = await fetch(`${base}/api/auth/google/callback?code=c6&state=x`, { redirect: 'manual' });
    expect(noCookie.headers.get('location')).toBe('/app#login?google=expired');
    const cancelled = await fetch(`${base}/api/auth/google/callback?error=access_denied`, { redirect: 'manual' });
    expect(cancelled.headers.get('location')).toBe('/app#login?google=cancelled');
  });

  it('refuses an unverified Google address', async () => {
    const { location, session } = await signIn('intent=signup&terms=1', 'c7', { sub: 'google-sub-5', email: 'new@example.com', email_verified: false });
    expect(location).toBe('/app#signup?google=unverified');
    expect(session).toBeUndefined();
  });

  it('lets an account without password delete itself by typing its e-mail', async () => {
    const { session } = await signIn('intent=signup&terms=1', 'c8', { sub: 'google-sub-6', email: 'ibrahim@example.com' });
    const headers = { 'content-type': 'application/json', cookie: `va_session=${session}` };
    expect((await fetch(`${base}/api/me`, { method: 'DELETE', headers, body: JSON.stringify({ password: 'wrong@example.com' }) })).status).toBe(400);
    expect((await fetch(`${base}/api/me`, { method: 'DELETE', headers, body: JSON.stringify({ password: 'Ibrahim@example.com' }) })).status).toBe(200);
    expect(await db.one('SELECT 1 FROM users WHERE email = $1', ['ibrahim@example.com'])).toBeUndefined();
  });
});
