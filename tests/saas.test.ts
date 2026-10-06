import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config/config';
import { createLogger } from '../src/core/logger';
import { signStripePayload, stripeForm, verifyStripeSignature } from '../src/saas/billing';
import { hashPassword, Vault, verifyPassword } from '../src/saas/crypto';
import { connectPglite, migrate, type Db } from '../src/saas/db';
import { checkQuota, checkSongQuota, getPlan } from '../src/saas/plans';
import { startSaasServer } from '../src/saas/server';
import type { PlatformId } from '../src/publish/types';
import { fakeRenderer, testConfig, tmpDir } from './helpers';

/** fetch with a cookie jar: one instance per signed-in browser. */
class Client {
  cookie = '';
  constructor(private readonly base: string) {}
  async req(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(this.base + p, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    return res;
  }
  async json(method: string, p: string, body?: unknown) {
    const res = await this.req(method, p, body);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
}

const published: Array<{ platform: PlatformId; userId: string }> = [];

let base: string;
let db: Db;
let config: AppConfig;
let close: () => Promise<void>;
let envFile: string;
let failSongLyricsGeneration = false;
let failSongAudioGeneration = false;

const waitFor = async <T>(fn: () => Promise<T | undefined>, timeoutMs = 15_000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
};

beforeAll(async () => {
  const dir = tmpDir();
  envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, '');
  const env = {
    APP_SECRET: 'x'.repeat(40),
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_PRICE_CREATOR: 'price_creator',
    STRIPE_PRICE_PRO: 'price_pro',
    YOUTUBE_CLIENT_ID: 'yt-id',
    YOUTUBE_CLIENT_SECRET: 'yt-secret',
    META_APP_ID: 'meta-id',
    META_APP_SECRET: 'meta-secret',
  };
  config = testConfig(env);
  db = await connectPglite();
  await migrate(db);
  const started = await startSaasServer(config, {
    port: 0,
    host: '127.0.0.1',
    webRoot: path.resolve('web'),
    db,
    envFile,
    reloadConfig: () => testConfig({ ...env, ...Object.fromEntries(fs.readFileSync(envFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split('=') as [string, string])) }),
    embeddedWorker: true,
    deps: { renderer: fakeRenderer, logger: createLogger('silent'), llm: null, voice: null, stock: [] },
    logger: createLogger('silent'),
    workerOptions: {
      pollMs: 30,
      publisherFactory: (platform, userId) => ({
        id: platform,
        label: platform,
        constraints: { maxCaption: 2200, maxHashtags: 30, minDurationSec: 1, maxDurationSec: 600, vertical: false, nativeScheduling: false },
        publish: async () => {
          published.push({ platform, userId });
          return { platform, status: 'published', url: `https://${platform}.test/v` };
        },
      }),
    },
    songLyricsGenerator: async () => {
      if (failSongLyricsGeneration) throw new Error('provider unavailable');
      return { title: 'Joyeux anniversaire', lyrics: '[Verse 1]\nLe soleil se lève pour toi\n[Chorus]\nJoyeux anniversaire Aïcha\n' };
    },
    songGenerator: async () => {
      if (failSongAudioGeneration) throw new Error('[elevenlabs-music] HTTP 402: {"detail":{"status":"paid_plan_required"}}');
      return Buffer.from('fake mp3');
    },
    stripe: async (p) => {
      if (p === '/checkout/sessions') return { url: 'https://checkout.stripe.test/s' };
      if (p.startsWith('/subscriptions/')) return { id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_creator' }, current_period_end: 2_000_000_000 }] } };
      return { url: 'https://billing.stripe.test/p' };
    },
    exchanger: async (provider) =>
      provider === 'meta'
        ? { accountName: 'Ma Page', data: { pages: [{ pageId: 'p1', pageName: 'Ma Page', pageToken: 'PAGE-TOKEN-SECRET', instagramUserId: 'ig1', instagramUsername: 'mapage' }], pageId: 'p1' } }
        : { accountName: 'Ma chaîne', data: { token: { refreshToken: 'REFRESH-SECRET' }, privacy: 'unlisted' } },
  });
  base = started.url;
  close = started.close;
}, 60_000);

afterAll(async () => {
  await close?.();
  await db?.close();
});

describe('crypto', () => {
  it('hashes passwords with scrypt and encrypts tokens with AES-GCM', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).toMatch(/^scrypt\$/);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    const vault = new Vault('s'.repeat(40));
    const sealed = vault.encrypt({ token: 'abc' });
    expect(sealed).not.toContain('abc');
    expect(vault.decrypt(sealed)).toEqual({ token: 'abc' });
    expect(() => new Vault('t'.repeat(40)).decrypt(sealed)).toThrow();
  });
});

describe('plans', () => {
  it('limits videos, minutes and duration per plan', () => {
    const free = getPlan(config, 'free');
    const usage = { periodStart: '', videos: 0, seconds: 0, songs: 0 };
    expect(checkQuota(free, usage, 30)).toBeNull();
    expect(checkQuota(free, { ...usage, videos: 3 })).toEqual({ code: 'videos', limit: 3 });
    expect(checkQuota(free, usage, 120)).toEqual({ code: 'duration', limit: 60 });
    expect(checkQuota(free, { ...usage, videos: 1, seconds: 170 }, 30)).toEqual({ code: 'minutes', limit: 3 });
    expect(checkSongQuota(free, usage)).toBeNull();
    expect(checkSongQuota(free, { ...usage, songs: 1 })).toEqual({ code: 'songs', limit: 1 });
    expect(getPlan(config, 'creator').songsPerMonth).toBe(10);
    expect(getPlan(config, 'pro').songsPerMonth).toBe(40);
    expect(getPlan(config, 'unknown').id).toBe('free');
  });
});

describe('accounts', () => {
  it('signs up (first user = admin), logs in and out, refuses bad credentials', async () => {
    const pub = await new Client(base).json('GET', '/api/public/config');
    expect(pub.body).toMatchObject({ firstUser: true, signupOpen: true, billing: true });
    expect(pub.body.plans.map((p: { id: string }) => p.id)).toEqual(['free', 'creator', 'pro']);
    expect(JSON.stringify(pub.body)).not.toContain('price_creator');

    const admin = new Client(base);
    const s = await admin.json('POST', '/api/auth/signup', { email: 'Admin@Example.com', password: 'motdepasse1', name: 'Admin' });
    expect(s.status).toBe(200);
    expect(s.body.user).toMatchObject({ email: 'admin@example.com', role: 'admin', plan: 'free' });
    expect(admin.cookie).toMatch(/^va_session=/);
    expect((await admin.json('GET', '/api/me')).body.user.email).toBe('admin@example.com');

    const anon = new Client(base);
    expect((await anon.json('GET', '/api/me')).status).toBe(401);
    expect((await anon.json('POST', '/api/auth/signup', { email: 'admin@example.com', password: 'motdepasse2' })).body.code).toBe('email_taken');
    expect((await anon.json('POST', '/api/auth/signup', { email: 'x@y.z', password: 'court' })).body.code).toBe('weak_password');
    expect((await anon.json('POST', '/api/auth/login', { email: 'admin@example.com', password: 'nope-nope' })).body.code).toBe('invalid_credentials');

    const bob = new Client(base);
    expect((await bob.json('POST', '/api/auth/signup', { email: 'bob@example.com', password: 'motdepasse2', locale: 'en' })).body.user).toMatchObject({ role: 'user', locale: 'en' });
    await bob.json('POST', '/api/auth/logout');
    expect((await bob.json('GET', '/api/me')).status).toBe(401);
    expect((await bob.json('POST', '/api/auth/login', { email: 'BOB@example.com', password: 'motdepasse2' })).status).toBe(200);
    expect((await bob.json('GET', '/api/admin/users')).status).toBe(403);
    expect((await admin.json('GET', '/api/admin/users')).body).toHaveLength(2);
  });

  it('refuses cross-site requests', async () => {
    const c = new Client(base);
    const res = await c.req('POST', '/api/auth/login', { email: 'a@b.c', password: 'x' }, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });
});

describe('videos', () => {
  let alice: Client;
  let jobId: string;

  it('queues, renders (embedded worker) and serves a video, scoped to its owner', async () => {
    alice = new Client(base);
    await alice.json('POST', '/api/auth/signup', { email: 'alice@example.com', password: 'motdepasse3' });
    const created = await alice.json('POST', '/api/jobs', { prompt: 'Crée une vidéo de 2 minutes pour promouvoir un café à Dakar', subtitles: false });
    expect(created.status).toBe(201);
    jobId = created.body.id;
    const done = await waitFor(async () => {
      const j = await alice.json('GET', `/api/jobs/${jobId}`);
      return ['completed', 'failed'].includes(j.body.status) ? j.body : undefined;
    });

    expect(done.error).toBeUndefined();
    expect(done.status).toBe('completed');
    // Free plan: duration capped at 60 s and badge in the video.
    expect(done.durationSec).toBeLessThanOrEqual(61);
    const storyboard = await (await alice.req('GET', `/api/jobs/${jobId}/files/storyboard.json`)).json();
    expect(storyboard.brand.badge).toBe('Made with SOVID AI');
    expect(await (await alice.req('GET', `/api/jobs/${jobId}/video`)).text()).toBe('fake video');

    const mallory = new Client(base);
    await mallory.json('POST', '/api/auth/signup', { email: 'mallory@example.com', password: 'motdepasse4' });
    expect((await mallory.json('GET', `/api/jobs/${jobId}`)).status).toBe(404);
    expect((await mallory.req('GET', `/api/jobs/${jobId}/video`)).status).toBe(404);
    expect((await mallory.json('GET', '/api/jobs')).body).toEqual([]);
    expect((await alice.json('GET', '/api/me')).body.usage.videos).toBe(1);
  }, 30_000);

  it('streams progress with server-sent events', async () => {
    const res = await alice.req('GET', `/api/jobs/${jobId}/events`);
    const text = await res.text();
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toContain('"status":"completed"');
  });

  it('enforces the monthly quota of the free plan', async () => {
    const eve = new Client(base);
    await eve.json('POST', '/api/auth/signup', { email: 'eve@example.com', password: 'motdepasse5' });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await eve.json('POST', '/api/jobs', { prompt: `Vidéo ${i} pour un salon de coiffure`, durationSec: 10 })).body.id);
    const refused = await eve.json('POST', '/api/jobs', { prompt: 'Une de trop', durationSec: 10 });
    expect(refused.status).toBe(402);
    expect(refused.body).toMatchObject({ code: 'quota_videos', limit: 3 });
    expect((await eve.json('POST', '/api/jobs', {})).status).toBe(400);
    await waitFor(async () => ((await eve.json('GET', '/api/jobs')).body as Array<{ status: string }>).every((j) => j.status === 'completed' || j.status === 'failed') || undefined);
  }, 30_000);

  it('retries a failed video as a new owner-scoped job', async () => {
    const owner = new Client(base);
    await owner.json('POST', '/api/auth/signup', { email: 'retry-video@example.com', password: 'motdepasse8' });
    const original = (await owner.json('POST', '/api/jobs', { prompt: 'Une vidéo de 10 secondes pour un café', durationSec: 10 })).body;
    await waitFor(async () => {
      const result = await owner.json('GET', `/api/jobs/${original.id}`);
      return result.body.status === 'completed' ? result.body : undefined;
    });
    expect((await owner.json('POST', `/api/jobs/${original.id}/retry`)).body.code).toBe('job_not_retryable');
    await db.query("UPDATE jobs SET status = 'failed', error = 'test failure', finished_at = now(), video_file = NULL WHERE id = $1", [original.id]);
    const retryResponse = await owner.json('POST', `/api/jobs/${original.id}/retry`);
    expect(retryResponse.status).toBe(201);
    const retry = retryResponse.body;
    expect(retry.id).not.toBe(original.id);
    expect(retry).toMatchObject({ prompt: original.prompt, status: 'queued' });
    const stranger = new Client(base);
    await stranger.json('POST', '/api/auth/signup', { email: 'retry-stranger@example.com', password: 'motdepasse8' });
    expect((await stranger.json('POST', `/api/jobs/${original.id}/retry`)).status).toBe(404);
    const finishedRetry = await waitFor(async () => {
      const result = await owner.json('GET', `/api/jobs/${retry.id}`);
      return ['completed', 'failed'].includes(result.body.status) ? result.body : undefined;
    });
    expect((await owner.json('DELETE', `/api/jobs/${retry.id}?remove=1`)).body.removed).toBe(true);
    expect((await owner.json('GET', `/api/jobs/${retry.id}`)).status).toBe(404);
    if (finishedRetry.status === 'failed') expect(finishedRetry.error).toBeDefined();
    expect((await owner.json('DELETE', `/api/jobs/${original.id}?remove=1`)).body.removed).toBe(true);
  }, 30_000);

  it('publishes on connected accounts with a paid plan (tokens stored encrypted)', async () => {
    // Free plan: no publishing, no connection.
    expect((await alice.json('POST', '/api/connections/youtube/start')).status).toBe(402);
    expect((await alice.json('POST', `/api/jobs/${jobId}/publish`, { platforms: ['youtube'] })).body.code).toBe('plan_publish');

    // Stripe webhook → Creator plan.
    const me = (await alice.json('GET', '/api/me')).body.user;
    const event = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: me.id, customer: 'cus_1', subscription: 'sub_1' } } });
    expect((await new Client(base).req('POST', '/api/stripe/webhook', undefined, { 'stripe-signature': 't=1,v1=00' })).status).toBe(400);
    const ok = await fetch(`${base}/api/stripe/webhook`, { method: 'POST', body: event, headers: { 'stripe-signature': signStripePayload(event, 'whsec_test') } });
    expect(ok.status).toBe(200);
    const account = (await alice.json('GET', '/api/me')).body;
    expect(account.plan.id).toBe('creator');
    expect(account.user.subscriptionStatus).toBe('active');

    // OAuth: start → provider → callback.
    const start = await alice.json('POST', '/api/connections/youtube/start');
    const authorize = new URL(start.body.url);
    expect(authorize.host).toBe('accounts.google.com');
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${base}/api/connections/youtube/callback`);
    const state = authorize.searchParams.get('state')!;
    const forged = await alice.req('GET', `/api/connections/youtube/callback?code=c&state=forged`);
    expect(forged.headers.get('location')).toContain('error=');
    const cb = await alice.req('GET', `/api/connections/youtube/callback?code=c&state=${state}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/app#connections?connected=youtube');
    const metaState = new URL((await alice.json('POST', '/api/connections/meta/start')).body.url).searchParams.get('state');
    await alice.req('GET', `/api/connections/meta/callback?code=c&state=${metaState}`);

    const connections = (await alice.json('GET', '/api/connections')).body;
    expect(connections.platforms.sort()).toEqual(['facebook', 'instagram', 'youtube']);
    expect(JSON.stringify(connections)).not.toMatch(/SECRET/);
    const stored = await db.query<{ data: string }>('SELECT data FROM connections');
    expect(stored.map((r) => r.data).join()).not.toMatch(/SECRET/);

    expect((await alice.json('POST', `/api/jobs/${jobId}/publish`, { platforms: ['linkedin'] })).body.code).toBe('not_connected');
    const pub = await alice.json('POST', `/api/jobs/${jobId}/publish`, { platforms: ['youtube', 'instagram'], captions: { youtube: { title: 'Mon café', caption: 'Venez !', hashtags: ['#cafe'] } } });
    expect(pub.status).toBe(202);
    const finished = await waitFor(async () => {
      const list = (await alice.json('GET', '/api/publications')).body as Array<{ status: string; outcomes: unknown[] }>;
      return list[0] && list[0].status !== 'pending' && list[0].status !== 'running' ? list[0] : undefined;
    });
    expect(finished.status).toBe('done');
    expect(published.map((p) => p.platform).sort()).toEqual(['instagram', 'youtube']);

    // Scheduled publication can be cancelled.
    const later = await alice.json('POST', `/api/jobs/${jobId}/publish`, { platforms: ['facebook'], at: new Date(Date.now() + 3600_000).toISOString() });
    expect((await alice.json('DELETE', `/api/publications/${later.body.id}`)).body.cancelled).toBe(true);
    expect((await alice.json('POST', '/api/billing/checkout', { plan: 'pro' })).body.url).toBe('https://checkout.stripe.test/s');
  }, 30_000);
});

describe('songs', () => {
  it('returns an actionable error when lyric providers fail', async () => {
    const singer = new Client(base);
    await singer.json('POST', '/api/auth/signup', { email: 'lyrics-error@example.com', password: 'motdepasse6' });
    failSongLyricsGeneration = true;
    try {
      const response = await singer.json('POST', '/api/songs', { prompt: 'Chanson anniversaire', style: 'Afrobeats', mood: 'Joyful and celebratory' });
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('song_lyrics_provider_failed');
    } finally {
      failSongLyricsGeneration = false;
    }
  });

  it('keeps lyrics editable until explicit generation, isolates audio, and enforces the separate quota', async () => {
    const singer = new Client(base);
    await singer.json('POST', '/api/auth/signup', { email: 'singer@example.com', password: 'motdepasse6' });
    const draft = await singer.json('POST', '/api/songs', { prompt: 'Chanson romantique anniversaire pour Aïcha', style: 'Afrobeats', mood: 'Romantic and tender', durationSec: 90 });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ title: 'Joyeux anniversaire', status: 'draft', lyrics: expect.stringContaining('Aïcha') });
    const edited = await singer.json('PUT', `/api/songs/${draft.body.id}/lyrics`, { title: 'Pour Aïcha', lyrics: '[Verse 1]\nPour toi' });
    expect(edited.body).toMatchObject({ title: 'Pour Aïcha', status: 'draft' });
    const started = await singer.json('POST', `/api/songs/${draft.body.id}/generate`);
    expect(started.status).toBe(202);
    const finished = await waitFor(async () => {
      const result = await singer.json('GET', `/api/songs/${draft.body.id}`);
      return ['completed', 'failed'].includes(result.body.status) ? result.body : undefined;
    });
    expect(finished.status).toBe('completed');
    expect(await (await singer.req('GET', finished.audioUrl)).text()).toBe('fake mp3');
    expect((await singer.json('GET', '/api/me')).body.usage.songs).toBe(1);
    expect((await singer.json('PUT', `/api/songs/${draft.body.id}/lyrics`, { title: 'No', lyrics: 'No' })).status).toBe(409);

    const anotherDraft = await singer.json('POST', '/api/songs', { prompt: 'Another birthday song', style: 'Pop', mood: 'Joyful and celebratory' });
    expect((await singer.json('POST', `/api/songs/${anotherDraft.body.id}/generate`)).body).toMatchObject({ code: 'quota_songs', limit: 1 });
    const other = new Client(base);
    await other.json('POST', '/api/auth/signup', { email: 'another-singer@example.com', password: 'motdepasse7' });
    expect((await other.json('GET', `/api/songs/${draft.body.id}`)).status).toBe(404);
    expect((await other.req('GET', finished.audioUrl)).status).toBe(404);
  }, 30_000);

  it('shows a friendly paid-plan error, retries failed audio, and deletes songs only for their owner', async () => {
    const singer = new Client(base);
    await singer.json('POST', '/api/auth/signup', { email: 'song-retry@example.com', password: 'motdepasse6' });
    const draft = await singer.json('POST', '/api/songs', { prompt: 'Une chanson de fête', style: 'Afrobeats', mood: 'Joyful and celebratory' });

    failSongAudioGeneration = true;
    try {
      await singer.json('POST', `/api/songs/${draft.body.id}/generate`);
      const failed = await waitFor(async () => {
        const result = await singer.json('GET', `/api/songs/${draft.body.id}`);
        return result.body.status === 'failed' ? result.body : undefined;
      });
      expect(failed.error).toBe('paid_plan_required');
      expect(JSON.stringify(failed)).not.toContain('HTTP 402');
      expect(JSON.stringify(failed)).not.toContain('"detail"');
    } finally {
      failSongAudioGeneration = false;
    }

    const retried = await singer.json('POST', `/api/songs/${draft.body.id}/generate`);
    expect(retried.status).toBe(202);
    const completed = await waitFor(async () => {
      const result = await singer.json('GET', `/api/songs/${draft.body.id}`);
      return result.body.status === 'completed' ? result.body : undefined;
    });
    expect(completed.status).toBe('completed');

    const stranger = new Client(base);
    await stranger.json('POST', '/api/auth/signup', { email: 'song-stranger@example.com', password: 'motdepasse6' });
    expect((await stranger.json('DELETE', `/api/songs/${draft.body.id}`)).status).toBe(404);
    expect((await singer.json('DELETE', `/api/songs/${draft.body.id}`)).body.removed).toBe(true);
    expect((await singer.json('GET', `/api/songs/${draft.body.id}`)).status).toBe(404);

    const active = await singer.json('POST', '/api/songs', { prompt: 'Une chanson en cours', style: 'Pop', mood: 'Joyful and celebratory' });
    await db.query("UPDATE songs SET status = 'running' WHERE id = $1", [active.body.id]);
    expect((await singer.json('DELETE', `/api/songs/${active.body.id}`)).body.code).toBe('song_running');
    await db.query("UPDATE songs SET status = 'failed' WHERE id = $1", [active.body.id]);
    expect((await singer.json('DELETE', `/api/songs/${active.body.id}`)).body.removed).toBe(true);
  }, 30_000);
});

describe('brand kit', () => {
  it('stores a logo and colours and applies them to the videos', async () => {
    const zsr = new Client(base);
    await zsr.json('POST', '/api/auth/signup', { email: 'contact@zsr-technum.com', password: 'motdepasse9' });
    expect((await zsr.json('GET', '/api/brand')).body).toEqual({ name: '', colors: [] });
    expect((await zsr.json('PUT', '/api/brand', { name: 'ZSR-TechNum', colors: ['#0b1c8c', 'red'] })).body.code).toBe('invalid_colors');
    const saved = await zsr.json('PUT', '/api/brand', { name: 'ZSR-TechNum', colors: ['#0b1c8c', '#3cc8c8'] });
    expect(saved.body).toMatchObject({ name: 'ZSR-TechNum', colors: ['#0B1C8C', '#3CC8C8'] });

    const upload = (body: Buffer) => fetch(`${base}/api/brand/logo`, { method: 'PUT', body: new Uint8Array(body), headers: { cookie: zsr.cookie, 'content-type': 'image/png' } });
    const svg = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    expect(svg.status).toBe(400);
    expect((await svg.json()).code).toBe('logo_format');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const ok = await upload(png);
    expect(ok.status).toBe(200);
    const kit = await ok.json();
    expect(kit.logoUrl).toMatch(/^\/api\/brand\/logo/);
    expect((await zsr.req('GET', kit.logoUrl)).status).toBe(200);
    // Another customer never sees this logo.
    const other = new Client(base);
    await other.json('POST', '/api/auth/signup', { email: 'other-brand@example.com', password: 'motdepasse8' });
    expect((await other.req('GET', '/api/brand/logo')).status).toBe(404);

    const job = (await zsr.json('POST', '/api/jobs', { prompt: 'Une vidéo de 10 secondes pour présenter nos services numériques', durationSec: 10 })).body;
    await waitFor(async () => (['completed', 'failed'].includes((await zsr.json('GET', `/api/jobs/${job.id}`)).body.status) ? true : undefined));
    const sb = await (await zsr.req('GET', `/api/jobs/${job.id}/files/storyboard.json`)).json();
    expect(sb.brand).toMatchObject({ name: 'ZSR-TechNum', logo: expect.stringMatching(/^brand\//), showWatermark: true });
    expect(sb.theme.palette.background).toBe('#0B1C8C');

    // Unticked for one video: no kit.
    const plain = (await zsr.json('POST', '/api/jobs', { prompt: 'Une vidéo de 10 secondes pour un salon de thé', durationSec: 10, brandKit: false })).body;
    await waitFor(async () => (['completed', 'failed'].includes((await zsr.json('GET', `/api/jobs/${plain.id}`)).body.status) ? true : undefined));
    const sb2 = await (await zsr.req('GET', `/api/jobs/${plain.id}/files/storyboard.json`)).json();
    expect(sb2.brand.logo).toBeUndefined();
    expect((await zsr.json('DELETE', '/api/brand/logo')).body.logoUrl).toBeUndefined();
  }, 30_000);
});

describe('admin settings', () => {
  it('lets only admins edit the service keys', async () => {
    const admin = new Client(base);
    await admin.json('POST', '/api/auth/login', { email: 'admin@example.com', password: 'motdepasse1' });
    const get = await admin.json('GET', '/api/admin/settings');
    expect(get.body.groups.map((g: { id: string }) => g.id)).toContain('stock');
    const fields = get.body.groups.flatMap((group: { fields: Array<{ key: string; secret?: boolean }> }) => group.fields);
    expect(fields.some((field: { secret?: boolean }) => field.secret)).toBe(false);
    expect(fields.some((field: { key: string }) => field.key === 'OPENAI_COMPATIBLE_BASE_URL')).toBe(true);
    expect(get.body.groups.every((group: { fields: unknown[] }) => group.fields.length > 0)).toBe(true);
    const put = await admin.json('PUT', '/api/admin/settings', { PIXABAY_API_KEY: 'px' });
    expect(put.status).toBe(200);
    expect(put.body.providers.stock).toContain('pixabay');
    expect(put.body.groups.find((group: { id: string }) => group.id === 'stock').configuredFields).toContain('Clé Pixabay');
    expect(fs.readFileSync(envFile, 'utf8')).toContain('PIXABAY_API_KEY=px');
    const settingsJson = JSON.stringify((await admin.json('GET', '/api/admin/settings')).body);
    expect(settingsJson).not.toContain('"px"');
    expect(settingsJson).not.toContain('PIXABAY_API_KEY');
    const bob = new Client(base);
    await bob.json('POST', '/api/auth/login', { email: 'bob@example.com', password: 'motdepasse2' });
    expect((await bob.json('PUT', '/api/admin/settings', { GROQ_API_KEY: 'x' })).status).toBe(403);
    expect((await admin.json('GET', '/api/admin/stats')).body.users).toBeGreaterThanOrEqual(4);
  });
});

describe('Stripe helpers', () => {
  it('encodes nested forms and verifies signatures with a time tolerance', () => {
    expect(stripeForm({ line_items: [{ price: 'p', quantity: 1 }], metadata: { user_id: 'u' } }).join('&')).toBe('line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Buser_id%5D=u');
    const header = signStripePayload('{}', 'sec', 1000);
    expect(verifyStripeSignature('{}', header, 'sec', 300, 1000_000)).toBe(true);
    expect(verifyStripeSignature('{"a":1}', header, 'sec', 300, 1000_000)).toBe(false);
    expect(verifyStripeSignature('{}', header, 'sec', 300, 2000_000)).toBe(false);
  });
});
