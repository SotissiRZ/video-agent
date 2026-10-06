/**
 * SaaS web server: marketing page, web app, JSON API (accounts, videos, publishing, billing,
 * admin). Multi-tenant: every query on user data is scoped to the signed-in user.
 */
import { LANGUAGE_CODES } from '../core/languages';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { z } from 'zod';
import type { AgentDependencies } from '../agent/orchestrator';
import { providerStatus } from '../agent/doctor';
import { loadConfig, type AppConfig } from '../config/config';
import { saveSettings, settingsView } from '../config/settings';
import { errorMessage, VideoAgentError } from '../core/errors';
import { OUTPUT_FORMATS, SUPPORTED_FPS } from '../core/formats';
import { createLogger, type Logger } from '../core/logger';
import { resolveLLM } from '../llm/registry';
import { ElevenLabsSongProvider } from '../providers/music/elevenlabs-song';
import { ensureCaptions, loadJob, publishJob, saveCaptions } from '../publish/service';
import { PLATFORM_IDS, type Captions, type PlatformId } from '../publish/types';
import { STYLES } from '../remotion/contract/styles';
import { listTemplates } from '../templates/registry';
import { AuthError, changePassword, consumeEmailToken, createEmailToken, createSession, destroySession, findUserByEmail, getUser, login, markEmailVerified, parseCookies, RateLimiter, resetPassword, SESSION_COOKIE, sessionCookie, signup, userForSession, type User } from './auth';
import { buildEmail, createMailer, type Mailer } from './mail';
import { createPayment, CURRENCY, enabledProviders, handleGeniusPayWebhook, handleYouCanPayWebhook, listPayments, localPrices, PAYMENT_PROVIDERS, publicPayment, refreshPayment } from './payments';
import { billingEnabled, createCheckout, createPortal, handleStripeEvent, stripeClient, verifyStripeSignature, type StripeFetch } from './billing';
import {
  defaultExchanger,
  deleteConnection,
  finishConnection,
  isProvider,
  listConnections,
  providerAvailable,
  PROVIDERS,
  publicConnection,
  publishablePlatforms,
  startConnection,
  updateConnectionSettings,
  type CodeExchanger,
} from './connections';
import { resolveAppSecret, verifyPassword, Vault } from './crypto';
import { connectDatabase, type Db } from './db';
import { clientIp, HttpError, json, readBuffer, readJson, readRaw, redirect, sendFile, SECURITY_HEADERS } from './http';
import { deleteLogo, getBrandKit, MAX_LOGO_BYTES, publicBrandKit, saveBrandKit, saveLogo } from './brand';
import { createJob, deleteJob, getJob, JOB_ID, listJobs, publicJob, queuePosition, requestCancel, userJobsDir, type JobRow } from './jobs';
import { checkQuota, checkSongQuota, getPlan, getUsage, listPlans, PLAN_IDS, planOfUser } from './plans';
import { cancelPublication, createPublication, listPublications, publicPublication } from './publications';
import { Worker } from './worker';
import { createSongDraft, getSong, listSongs, publicSong, SONG_ID, songDirectory, updateSongLyrics, type SongRow } from './songs';

export const CreateJobSchema = z.object({
  prompt: z.string().trim().min(3).max(4000),
  format: z.string().max(20).optional(),
  width: z.number().int().min(16).max(3840).optional(),
  height: z.number().int().min(16).max(3840).optional(),
  durationSec: z.number().int().min(3).max(600).optional(),
  fps: z.number().int().min(1).max(60).optional(),
  style: z.string().max(30).optional(),
  template: z.string().max(40).optional(),
  language: z.enum(['auto', ...LANGUAGE_CODES] as [string, ...string[]]).optional(),
  outputFormat: z.enum(OUTPUT_FORMATS).optional(),
  voice: z.boolean().optional(),
  music: z.boolean().optional(),
  subtitles: z.boolean().optional(),
  offline: z.boolean().optional(),
  stock: z.boolean().optional(),
  mediaCoverage: z.enum(['all', 'visual', 'none']).optional(),
  /** Apply the customer's brand kit (default: yes when one exists). */
  brandKit: z.boolean().optional(),
});

const CaptionSchema = z.object({ title: z.string().max(300), caption: z.string().max(6000), hashtags: z.array(z.string().max(100)).max(30) });
export const PublishSchema = z.object({
  platforms: z.array(z.enum(PLATFORM_IDS)).min(1),
  at: z.string().datetime({ offset: true }).optional(),
  captions: z.record(z.enum(PLATFORM_IDS), CaptionSchema).optional(),
  dryRun: z.boolean().optional(),
});
const SignupSchema = z.object({ email: z.string().max(254), password: z.string().max(200), name: z.string().max(100).optional(), locale: z.enum(['fr', 'en']).optional() });
const LoginSchema = z.object({ email: z.string().max(254), password: z.string().max(200) });
const ProfileSchema = z.object({ name: z.string().max(100).optional(), locale: z.enum(['fr', 'en']).optional() });
const PasswordSchema = z.object({ current: z.string().max(200), next: z.string().max(200) });
const ConnectionPatchSchema = z.object({ privacy: z.enum(['public', 'unlisted', 'private']).optional(), mode: z.enum(['draft', 'direct']).optional(), pageId: z.string().max(100).optional() });
const SongDraftSchema = z.object({
  prompt: z.string().trim().min(3).max(2000),
  style: z.string().trim().min(2).max(80),
  mood: z.string().trim().min(2).max(80),
  durationSec: z.number().int().min(30).max(120).default(90),
});
const SongLyricsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  lyrics: z.string().trim().min(1).max(6000),
});
const SongUpdateSchema = SongLyricsSchema;

const parse = <T>(schema: z.ZodType<T>, data: unknown): T => {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 'invalid_request');
  return r.data;
};

const JOB_FILES = ['storyboard.json', 'script.md', 'subtitles.srt', 'subtitles.vtt', 'credits.md', 'captions.json'];

export interface SaasOptions {
  webRoot: string;
  db?: Db;
  deps?: AgentDependencies;
  logger?: Logger;
  /** .env file edited by the admin Settings page. */
  envFile?: string;
  reloadConfig?: () => AppConfig;
  /** Run a render worker in this process (default: VIDEO_AGENT_EMBEDDED_WORKER). */
  embeddedWorker?: boolean;
  /** Test seams. */
  stripe?: StripeFetch;
  exchanger?: CodeExchanger;
  mailer?: Mailer;
  /** fetch used for GeniusPay / YouCan Pay calls. */
  paymentFetch?: typeof fetch;
  /** Test seam for the standalone song provider. */
  songGenerator?: (request: { lyrics: string; style: string; mood: string; durationSec: number }) => Promise<Buffer>;
  /** Test seam for song lyric drafting. */
  songLyricsGenerator?: (request: { prompt: string; style: string; mood: string }) => Promise<{ title: string; lyrics: string }>;
  workerOptions?: Partial<ConstructorParameters<typeof Worker>[0]>;
}

export interface SaasApp {
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
  db: Db;
  worker?: Worker;
  close: () => Promise<void>;
}

const userView = (user: User) => ({ id: user.id, email: user.email, emailVerified: Boolean(user.email_verified_at), name: user.name, role: user.role, locale: user.locale, plan: user.plan, subscriptionStatus: user.subscription_status ?? undefined, currentPeriodEnd: user.current_period_end ? new Date(user.current_period_end).toISOString() : undefined });

export const createSaasApp = async (initialConfig: AppConfig, options: SaasOptions): Promise<SaasApp> => {
  let config = initialConfig;
  const logger = options.logger ?? createLogger(config.logLevel);
  const db = options.db ?? (await connectDatabase(config));
  const vault = new Vault(resolveAppSecret(config));
  const envFile = options.envFile ?? path.join(process.cwd(), '.env');
  const reloadConfig = options.reloadConfig ?? (() => loadConfig({ packageRoot: initialConfig.paths.root }));
  const webRoot = path.resolve(options.webRoot);
  const stripe = () => options.stripe ?? stripeClient(config);
  const exchanger = () => options.exchanger ?? defaultExchanger(config);
  const loginLimiter = new RateLimiter(10, 15 * 60_000);
  const signupLimiter = new RateLimiter(20, 60 * 60_000);
  const mailLimiter = new RateLimiter(5, 60 * 60_000);
  const songDraftLimiter = new RateLimiter(5, 60 * 60_000);
  const mailer = options.mailer ?? createMailer(config, logger);
  /** E-mails are sent in the background: a slow SMTP server must not delay the response. */
  const sendMail = (kind: 'verify' | 'reset', user: Pick<User, 'id' | 'email' | 'locale'>, link: string) =>
    void mailer.send(buildEmail(kind, user.locale, link, config.env.COMPANY_NAME, user.email)).catch((err) => logger.warn(`e-mail ${kind} to ${user.email} failed: ${errorMessage(err)}`));
  const sendVerification = async (req: http.IncomingMessage, user: User) => {
    const token = await createEmailToken(db, user.id, 'verify');
    sendMail('verify', user, `${baseUrl(req)}/api/auth/verify?token=${encodeURIComponent(token)}`);
  };

  const runWorker = options.embeddedWorker ?? (config.env.VIDEO_AGENT_EMBEDDED_WORKER === 'auto' ? db.kind === 'pglite' : config.env.VIDEO_AGENT_EMBEDDED_WORKER === 'true');
  const worker = runWorker ? new Worker({ db, vault, config: () => config, logger, deps: options.deps, ...options.workerOptions }) : undefined;
  worker?.start();
  const songTasks = new Set<Promise<void>>();
  await db.query(
    `UPDATE songs SET status = 'failed', error = 'La génération a été interrompue par un redémarrage du serveur. Relancez la chanson.', finished_at = now(), updated_at = now()
     WHERE status = 'running' AND heartbeat_at < now() - interval '3 minutes'`,
  );

  const llm = () => {
    if (options.deps?.llm !== undefined) return options.deps.llm;
    try {
      return resolveLLM(config);
    } catch {
      return null;
    }
  };
  const baseUrl = (req: http.IncomingMessage) => {
    if (config.env.PUBLIC_URL) return config.env.PUBLIC_URL.replace(/\/$/, '');
    const proto = config.env.VIDEO_AGENT_TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    return `${proto}://${req.headers.host ?? 'localhost'}`;
  };

  const currentUser = async (req: http.IncomingMessage): Promise<User | undefined> => userForSession(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  const requireUser = async (req: http.IncomingMessage): Promise<User> => {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, 'Connexion requise', 'unauthorized');
    return user;
  };
  const requireAdmin = async (req: http.IncomingMessage): Promise<User> => {
    const user = await requireUser(req);
    if (user.role !== 'admin') throw new HttpError(403, 'Réservé aux administrateurs', 'forbidden');
    return user;
  };
  const startSession = async (req: http.IncomingMessage, res: http.ServerResponse, user: User) => {
    const { token, maxAgeSec } = await createSession(db, user.id, req.headers['user-agent']);
    json(res, 200, { user: userView(user) }, { 'set-cookie': sessionCookie(token, maxAgeSec, baseUrl(req).startsWith('https://')) });
  };

  const accountSummary = async (user: User) => {
    const plan = planOfUser(config, user);
    const usage = await getUsage(db, user.id);
    return { user: userView(user), plan, usage, billing: billingEnabled(config), paymentProviders: enabledProviders(config).map((p) => ({ id: p, currency: CURRENCY[p] })), requireVerification: config.env.REQUIRE_EMAIL_VERIFICATION, mail: mailer.kind };
  };

  const capabilities = () => {
    const status = providerStatus(config);
    return {
      llm: !status.llm.startsWith('procedural') && !status.llm.startsWith('error'),
      voice: status.voice !== 'none' && !status.voice.startsWith('error'),
      stock: status.stock !== 'none' && !status.stock.startsWith('error'),
      images: status.image !== 'none' && !status.image.startsWith('error'),
    };
  };

  /** Job event stream: the worker writes progress to the database, polled here every second. */
  const streamJob = (req: http.IncomingMessage, res: http.ServerResponse, userId: string, jobId: string) => {
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    let last = '';
    let closed = false;
    const tick = async () => {
      if (closed) return;
      const job = await getJob(db, userId, jobId).catch(() => undefined);
      if (!job) return void res.end();
      const payload = JSON.stringify({ ...publicJob(job), queuePosition: await queuePosition(db, job) });
      if (payload !== last) {
        last = payload;
        res.write(`data: ${payload}\n\n`);
      }
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return void res.end();
      timer = setTimeout(() => void tick(), 1000);
    };
    let timer = setTimeout(() => void tick(), 0);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(keepAlive);
    });
  };

  const jobFor = async (user: User, id: string): Promise<JobRow> => {
    if (!JOB_ID.test(id)) throw new HttpError(400, 'invalid job id');
    const job = await getJob(db, user.id, id);
    if (!job) throw new HttpError(404, 'Vidéo introuvable', 'not_found');
    return job;
  };

  const songFor = async (user: User, id: string): Promise<SongRow> => {
    if (!SONG_ID.test(id)) throw new HttpError(400, 'Identifiant de chanson invalide', 'invalid_song_id');
    const song = await getSong(db, user.id, id);
    if (!song) throw new HttpError(404, 'Chanson introuvable', 'not_found');
    return song;
  };

  const generateSong = async (song: SongRow): Promise<void> => {
    const currentConfig = config;
    const generate = options.songGenerator ?? (currentConfig.env.ELEVENLABS_API_KEY
      ? (input: { lyrics: string; style: string; mood: string; durationSec: number }) =>
          new ElevenLabsSongProvider(currentConfig.env.ELEVENLABS_API_KEY!).generate(input)
      : undefined);
    if (!generate) {
      await db.query("UPDATE songs SET status = 'failed', error = $2, finished_at = now(), updated_at = now() WHERE id = $1", [song.id, 'La clé ElevenLabs Music n’est pas configurée.']);
      return;
    }
    const dir = songDirectory(currentConfig, song.user_id, song.id);
    const audioFile = path.join(dir, 'song.mp3');
    const temporaryFile = `${audioFile}.tmp`;
    const heartbeat = setInterval(() => {
      void db.query("UPDATE songs SET heartbeat_at = now() WHERE id = $1 AND status = 'running'", [song.id]).catch((err) => logger.warn(`song ${song.id} heartbeat failed: ${errorMessage(err)}`));
    }, 30_000);
    try {
      const audio = await generate({ lyrics: song.lyrics, style: song.style, mood: song.mood, durationSec: song.duration_sec });
      if (!audio.length) throw new Error('ElevenLabs a renvoyé un fichier audio vide.');
      fs.mkdirSync(dir, { recursive: true });
      fs.rmSync(temporaryFile, { force: true });
      fs.writeFileSync(temporaryFile, audio, { flag: 'wx' });
      fs.renameSync(temporaryFile, audioFile);
      const saved = await db.query<{ id: string }>(
        "UPDATE songs SET status = 'completed', audio_file = $2, error = NULL, finished_at = now(), updated_at = now() WHERE id = $1 RETURNING id",
        [song.id, audioFile],
      );
      if (!saved.length) fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      fs.rmSync(temporaryFile, { force: true });
      fs.rmSync(audioFile, { force: true });
      const message = errorMessage(err);
      await db.query("UPDATE songs SET status = 'failed', error = $2, finished_at = now(), updated_at = now() WHERE id = $1", [song.id, message]);
      logger.warn(`song ${song.id} failed: ${message}`);
    } finally {
      clearInterval(heartbeat);
    }
  };

  const api = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL, parts: string[]): Promise<void> => {
    const method = req.method ?? 'GET';
    const [, resource, id, sub, extra] = parts;

    // ---- public -------------------------------------------------------------------------
    if (resource === 'health' && method === 'GET') return json(res, 200, { ok: true, db: db.kind });
    if (resource === 'public' && id === 'config' && method === 'GET') {
      const users = Number((await db.one<{ n: string | number }>('SELECT count(*) AS n FROM users'))?.n ?? 0);
      return json(res, 200, {
        signupOpen: config.env.SIGNUP_MODE === 'open' || users === 0,
        firstUser: users === 0,
        billing: billingEnabled(config),
        company: { name: config.env.COMPANY_NAME, address: config.env.COMPANY_ADDRESS, email: config.env.CONTACT_EMAIL, url: config.env.PUBLIC_URL ?? '' },
        retentionDays: config.env.VIDEO_AGENT_RETENTION_DAYS,
        plans: listPlans(config).map(({ stripePriceId, ...p }) => ({ ...p, purchasable: Boolean(stripePriceId) || (p.id !== 'free' && enabledProviders(config).length > 0), localPrices: p.id === 'free' ? {} : localPrices(config, p.id) })),
        paymentProviders: enabledProviders(config).map((p) => ({ id: p, currency: CURRENCY[p] })),
      });
    }
    // Local gateways: signed webhooks, each payment confirmed with the gateway before activation.
    if (resource === 'payments' && sub === 'webhook' && method === 'POST' && (id === 'geniuspay' || id === 'youcanpay')) {
      const raw = await readRaw(req, 256 * 1024);
      const result =
        id === 'geniuspay'
          ? await handleGeniusPayWebhook(db, config, raw, req.headers['x-geniuspay-signature'] as string | undefined, options.paymentFetch)
          : await handleYouCanPayWebhook(db, config, raw, req.headers['x-youcanpay-signature'] as string | undefined, options.paymentFetch);
      return json(res, 200, { received: true, ...result });
    }
    if (resource === 'stripe' && id === 'webhook' && method === 'POST') {
      const raw = await readRaw(req, 1024 * 1024);
      const secret = config.env.STRIPE_WEBHOOK_SECRET;
      if (!secret || !verifyStripeSignature(raw, req.headers['stripe-signature'] as string | undefined, secret)) return json(res, 400, { error: 'invalid signature' });
      await handleStripeEvent(db, config, stripe(), JSON.parse(raw));
      return json(res, 200, { received: true });
    }
    if (resource === 'auth') {
      const ip = clientIp(req, config.env.VIDEO_AGENT_TRUST_PROXY);
      if (id === 'signup' && method === 'POST') {
        if (!signupLimiter.take(ip)) throw new AuthError('too_many_attempts', 'Trop de tentatives, réessayez plus tard');
        const body = parse(SignupSchema, await readJson(req));
        const user = await signup(db, config, body);
        await sendVerification(req, user).catch((err) => logger.warn(`verification e-mail: ${errorMessage(err)}`));
        return startSession(req, res, user);
      }
      // Always the same answer: the form must not reveal which addresses have an account.
      if (id === 'forgot' && method === 'POST') {
        const body = parse(z.object({ email: z.string().max(254) }), await readJson(req));
        if (!mailLimiter.take(`${ip}|forgot`)) throw new AuthError('too_many_attempts', 'Trop de demandes, réessayez plus tard');
        const user = await findUserByEmail(db, body.email);
        if (user) {
          const token = await createEmailToken(db, user.id, 'reset');
          sendMail('reset', user, `${baseUrl(req)}/app#reset?token=${encodeURIComponent(token)}`);
        }
        return json(res, 200, { ok: true });
      }
      if (id === 'reset' && method === 'POST') {
        const body = parse(z.object({ token: z.string().max(200), password: z.string().max(200) }), await readJson(req));
        const userId = await resetPassword(db, body.token, body.password);
        return startSession(req, res, (await getUser(db, userId))!);
      }
      // Link from the verification e-mail (top-level navigation).
      if (id === 'verify' && method === 'GET') {
        try {
          await markEmailVerified(db, await consumeEmailToken(db, url.searchParams.get('token') ?? '', 'verify'));
          return redirect(res, '/app#create?verified=1');
        } catch {
          return redirect(res, '/app#account?verified=0');
        }
      }
      if (id === 'login' && method === 'POST') {
        const body = parse(LoginSchema, await readJson(req));
        const key = `${ip}|${body.email.toLowerCase()}`;
        if (!loginLimiter.take(key)) throw new AuthError('too_many_attempts', 'Trop de tentatives, réessayez dans 15 minutes');
        const user = await login(db, body.email, body.password);
        loginLimiter.reset(key);
        return startSession(req, res, user);
      }
      if (id === 'logout' && method === 'POST') {
        await destroySession(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
        return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0, baseUrl(req).startsWith('https://')) });
      }
    }
    // OAuth callbacks come back as top-level navigations: answer with a redirect into the app.
    if (resource === 'connections' && id && isProvider(id) && sub === 'callback' && method === 'GET') {
      try {
        await finishConnection(db, vault, id, { code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.get('error') }, baseUrl(req), exchanger());
        return redirect(res, `/app#connections?connected=${id}`);
      } catch (err) {
        logger.warn(`OAuth ${id}: ${errorMessage(err)}`);
        return redirect(res, `/app#connections?error=${encodeURIComponent(errorMessage(err).slice(0, 200))}`);
      }
    }

    // ---- signed-in user -------------------------------------------------------------------
    const user = await requireUser(req);

    if (resource === 'me') {
      if (!id && method === 'GET') return json(res, 200, await accountSummary(user));
      if (!id && method === 'PATCH') {
        const body = parse(ProfileSchema, await readJson(req));
        await db.query('UPDATE users SET name = coalesce($2, name), locale = coalesce($3, locale) WHERE id = $1', [user.id, body.name?.trim() ?? null, body.locale ?? null]);
        return json(res, 200, await accountSummary((await getUser(db, user.id))!));
      }
      if (id === 'verify' && method === 'POST') {
        if (user.email_verified_at) return json(res, 200, { ok: true, alreadyVerified: true });
        if (!mailLimiter.take(`${user.id}|verify`)) throw new AuthError('too_many_attempts', 'Trop de demandes, réessayez plus tard');
        await sendVerification(req, user);
        return json(res, 200, { ok: true });
      }
      if (id === 'password' && method === 'POST') {
        const body = parse(PasswordSchema, await readJson(req));
        await changePassword(db, user.id, body.current, body.next);
        const { token, maxAgeSec } = await createSession(db, user.id, req.headers['user-agent']);
        return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie(token, maxAgeSec, baseUrl(req).startsWith('https://')) });
      }
      if (!id && method === 'DELETE') {
        const body = parse(z.object({ password: z.string().max(200) }), await readJson(req));
        const row = await db.one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
        if (!row || !(await verifyPassword(body.password, row.password_hash))) throw new AuthError('invalid_credentials', 'Mot de passe incorrect');
        if (user.role === 'admin' && Number((await db.one<{ n: string | number }>("SELECT count(*) AS n FROM users WHERE role = 'admin'"))?.n ?? 0) <= 1) {
          throw new HttpError(409, 'Le dernier administrateur ne peut pas supprimer son compte', 'last_admin');
        }
        await db.query('DELETE FROM users WHERE id = $1', [user.id]);
        fs.rmSync(userJobsDir(config, user.id), { recursive: true, force: true });
        return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie('', 0, baseUrl(req).startsWith('https://')) });
      }
    }

    if (resource === 'options' && method === 'GET') {
      const plan = planOfUser(config, user);
      return json(res, 200, {
        templates: listTemplates().map(({ id: tid, name, description }) => ({ id: tid, name, description })),
        styles: Object.values(STYLES).map(({ id: sid, label, description, theme }) => ({ id: sid, label, description, colors: [theme.palette.background, theme.palette.primary, theme.palette.accent] })),
        outputFormats: OUTPUT_FORMATS,
        fps: SUPPORTED_FPS.filter((f) => f <= 60),
        defaults: { fps: config.env.VIDEO_AGENT_DEFAULT_FPS, outputFormat: config.env.VIDEO_AGENT_DEFAULT_OUTPUT_FORMAT },
        maxDurationSec: plan.maxDurationSec,
        capabilities: capabilities(),
      });
    }

    if (resource === 'songs') {
      if (!id && method === 'GET') return json(res, 200, (await listSongs(db, user.id)).map(publicSong));
      if (!id && method === 'POST') {
        if (config.env.REQUIRE_EMAIL_VERIFICATION && !user.email_verified_at) throw new HttpError(403, 'Confirmez votre adresse e-mail pour créer des chansons', 'email_unverified');
        const body = parse(SongDraftSchema, await readJson(req));
        const lyricProvider = llm();
        if (!options.songLyricsGenerator && !lyricProvider) throw new HttpError(503, 'Configurez un fournisseur de rédaction IA pour créer les paroles.', 'song_lyrics_unavailable');
        if (!songDraftLimiter.take(user.id)) throw new HttpError(429, 'Trop de brouillons de chanson, réessayez plus tard', 'too_many_song_drafts');
        let lyrics: z.infer<typeof SongLyricsSchema>;
        if (options.songLyricsGenerator) {
          try {
            lyrics = SongLyricsSchema.parse(await options.songLyricsGenerator(body));
          } catch (err) {
            if (!(err instanceof z.ZodError)) throw err;
            throw new HttpError(502, 'Le fournisseur IA a renvoyé des paroles invalides. Réessayez.', 'song_lyrics_invalid');
          }
        } else {
          const generated = await lyricProvider!.generate({
            system: 'You are a professional songwriter. Write original, singable lyrics based only on the user brief. Return valid JSON with title and lyrics. Use clear section labels such as [Verse 1], [Chorus], [Verse 2], [Bridge]. Keep the lyrics in the language requested or used by the user. Do not mention that these are AI-generated.',
            messages: [{ role: 'user', content: `Brief: ${body.prompt}\nMusical style: ${body.style}\nMood: ${body.mood}` }],
            maxTokens: 1600,
            temperature: 0.8,
            json: { name: 'song_lyrics', schema: { type: 'object', properties: { title: { type: 'string' }, lyrics: { type: 'string' } }, required: ['title', 'lyrics'], additionalProperties: false } },
          });
          try {
            lyrics = SongLyricsSchema.parse(JSON.parse(generated.text.replace(/^```(?:json)?\s*|\s*```$/g, '')));
          } catch (err) {
            logger.warn(`song lyric response from ${generated.provider} was invalid: ${errorMessage(err)}`);
            throw new HttpError(502, 'Le fournisseur IA a renvoyé des paroles invalides. Réessayez.', 'song_lyrics_invalid');
          }
        }
        const song = await createSongDraft(db, config, user.id, { ...body, ...lyrics, durationSec: body.durationSec ?? 90 });
        return json(res, 201, publicSong(song));
      }
      if (!id) throw new HttpError(405, 'method not allowed');
      const song = await songFor(user, id);
      if (!sub && method === 'GET') return json(res, 200, publicSong(song));
      if (sub === 'lyrics' && method === 'PUT') {
        const body = parse(SongUpdateSchema, await readJson(req));
        const updated = await updateSongLyrics(db, user.id, song.id, body.title, body.lyrics);
        if (!updated) throw new HttpError(409, 'Les paroles ne peuvent plus être modifiées pendant ou après la génération.', 'song_not_editable');
        return json(res, 200, publicSong(updated));
      }
      if (sub === 'generate' && method === 'POST') {
        if (config.env.REQUIRE_EMAIL_VERIFICATION && !user.email_verified_at) throw new HttpError(403, 'Confirmez votre adresse e-mail pour générer des chansons', 'email_unverified');
        if (!options.songGenerator && !config.env.ELEVENLABS_API_KEY) throw new HttpError(503, 'La génération de chansons ElevenLabs n’est pas configurée.', 'song_provider_unavailable');
        if (song.lyrics.split(/\r?\n/).filter((line) => line.trim()).length > 30 || song.lyrics.split(/\r?\n/).some((line) => line.length > 200)) {
          throw new HttpError(400, 'ElevenLabs accepte au maximum 30 lignes de 200 caractères par chanson.', 'song_lyrics_too_long');
        }
        const updated = await db.tx(async (tx) => {
          await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.id]);
          const quota = checkSongQuota(planOfUser(config, user), await getUsage(tx, user.id));
          if (quota) throw new HttpError(402, 'Quota mensuel de chansons atteint', 'quota_songs', { limit: quota.limit, plan: planOfUser(config, user).id });
          return tx.one<SongRow>(
            `UPDATE songs SET status = 'running', error = NULL, finished_at = NULL, heartbeat_at = now(), updated_at = now()
             WHERE id = $1 AND user_id = $2 AND status IN ('draft', 'failed') RETURNING *`,
            [song.id, user.id],
          );
        });
        if (!updated) throw new HttpError(409, 'Cette chanson est déjà en cours ou a déjà été générée.', 'song_not_ready');
        const task = generateSong(updated).catch((err) => logger.error(`song ${updated.id} background task failed: ${errorMessage(err)}`)).finally(() => songTasks.delete(task));
        songTasks.add(task);
        return json(res, 202, publicSong(updated));
      }
      if (sub === 'audio' && song.audio_file && method === 'GET') return sendFile(req, res, song.audio_file, { download: url.searchParams.get('download') === '1', cache: 'private, max-age=3600' });
      throw new HttpError(404, 'not found', 'not_found');
    }

    if (resource === 'jobs') {
      if (!id && method === 'GET') return json(res, 200, (await listJobs(db, user.id)).map(publicJob));
      if (!id && method === 'POST') {
        if (config.env.REQUIRE_EMAIL_VERIFICATION && !user.email_verified_at) throw new HttpError(403, 'Confirmez votre adresse e-mail pour créer des vidéos', 'email_unverified');
        const body = parse(CreateJobSchema, await readJson(req));
        const plan = planOfUser(config, user);
        const quota = checkQuota(plan, await getUsage(db, user.id), body.durationSec);
        if (quota) throw new HttpError(402, 'Quota atteint', `quota_${quota.code}`, { limit: quota.limit, plan: plan.id });
        const { prompt, ...rest } = body;
        const job = await createJob(db, config, user.id, prompt, { ...rest, style: rest.style === 'auto' ? undefined : rest.style, template: rest.template === 'auto' ? undefined : rest.template });
        worker?.poke();
        return json(res, 201, publicJob(job));
      }
      if (!id) throw new HttpError(405, 'method not allowed');
      const job = await jobFor(user, id);
      if (!sub && method === 'GET') return json(res, 200, { ...publicJob(job), queuePosition: await queuePosition(db, job) });
      if (!sub && method === 'DELETE') {
        if (url.searchParams.get('remove') === '1') {
          const removed = await deleteJob(db, user.id, job.id);
          if (!removed.length) throw new HttpError(409, 'Une vidéo en cours ne peut pas être supprimée', 'job_running');
          fs.rmSync(job.dir, { recursive: true, force: true });
          return json(res, 200, { removed: true });
        }
        return json(res, 200, { cancelled: await requestCancel(db, user.id, job.id) });
      }
      if (sub === 'events' && method === 'GET') return streamJob(req, res, user.id, job.id);
      if (sub === 'video' && job.video_file) return sendFile(req, res, job.video_file, { download: url.searchParams.get('download') === '1' });
      if (sub === 'poster' && job.poster_file) return sendFile(req, res, job.poster_file, { cache: 'private, max-age=3600' });
      if (sub === 'files' && extra && JOB_FILES.includes(extra)) return sendFile(req, res, path.join(job.dir, extra), { download: url.searchParams.get('download') === '1' });
      if (sub === 'captions' && method === 'GET') {
        if (job.status !== 'completed') throw new HttpError(409, 'La vidéo n’est pas terminée', 'job_not_completed');
        const platforms = (url.searchParams.get('platforms') ?? PLATFORM_IDS.join(',')).split(',').filter((p): p is PlatformId => (PLATFORM_IDS as readonly string[]).includes(p));
        return json(res, 200, await ensureCaptions(config, loadJob(job.dir), platforms, { llm: llm() }));
      }
      if (sub === 'publications' && method === 'GET') return json(res, 200, (await listPublications(db, user.id, job.id)).map(publicPublication));
      if (sub === 'publish' && method === 'POST') {
        if (job.status !== 'completed' || !job.video_file) throw new HttpError(409, 'La vidéo doit être générée avant publication', 'job_not_completed');
        const plan = planOfUser(config, user);
        if (!plan.publish) throw new HttpError(402, 'La publication est disponible avec une offre payante', 'plan_publish');
        const body = parse(PublishSchema, await readJson(req));
        const allowed = new Set(publishablePlatforms(vault, await listConnections(db, user.id)));
        const missing = body.platforms.filter((p) => !allowed.has(p));
        if (missing.length) throw new HttpError(400, `Compte non connecté : ${missing.join(', ')}`, 'not_connected', { platforms: missing });
        if (body.captions) {
          const current: Captions = await ensureCaptions(config, loadJob(job.dir), body.platforms, { llm: llm() });
          saveCaptions(job.dir, { ...current, ...body.captions });
        }
        if (body.dryRun) return json(res, 200, await publishJob(config, job.dir, { platforms: body.platforms, llm: llm(), dryRun: true }));
        const at = body.at ? new Date(body.at) : new Date();
        if (at.getTime() > Date.now() + 90 * 24 * 3600_000) throw new HttpError(400, 'Date trop lointaine (90 jours maximum)');
        const publication = await createPublication(db, user.id, job.id, body.platforms, at);
        worker?.poke();
        return json(res, 202, publicPublication(publication));
      }
    }

    if (resource === 'brand') {
      if (!id && method === 'GET') return json(res, 200, publicBrandKit(await getBrandKit(db, user.id)));
      if (!id && method === 'PUT') {
        const body = parse(z.object({ name: z.string().max(80).optional(), colors: z.array(z.string().max(9)).max(4).optional() }), await readJson(req));
        await saveBrandKit(db, user.id, body);
        return json(res, 200, publicBrandKit(await getBrandKit(db, user.id)));
      }
      if (id === 'logo' && method === 'PUT') {
        await saveLogo(db, config, user.id, await readBuffer(req, MAX_LOGO_BYTES + 1));
        return json(res, 200, publicBrandKit(await getBrandKit(db, user.id)));
      }
      if (id === 'logo' && method === 'DELETE') {
        await deleteLogo(db, user.id);
        return json(res, 200, publicBrandKit(await getBrandKit(db, user.id)));
      }
      if (id === 'logo' && method === 'GET') {
        const kit = await getBrandKit(db, user.id);
        if (!kit?.logoFile) throw new HttpError(404, 'not found', 'not_found');
        return sendFile(req, res, kit.logoFile, { cache: 'private, max-age=300' });
      }
    }

    if (resource === 'publications') {
      if (!id && method === 'GET') return json(res, 200, (await listPublications(db, user.id)).map(publicPublication));
      if (id && method === 'DELETE') return json(res, 200, { cancelled: await cancelPublication(db, user.id, id) });
    }

    if (resource === 'connections') {
      if (!id && method === 'GET') {
        const rows = await listConnections(db, user.id);
        return json(res, 200, {
          providers: PROVIDERS.map((p) => ({ id: p, available: providerAvailable(config, p) })),
          connections: rows.map((r) => publicConnection(vault, r)),
          platforms: publishablePlatforms(vault, rows),
        });
      }
      if (id && isProvider(id)) {
        if (sub === 'start' && method === 'POST') {
          if (!planOfUser(config, user).publish) throw new HttpError(402, 'La publication est disponible avec une offre payante', 'plan_publish');
          return json(res, 200, { url: await startConnection(db, config, user.id, id, baseUrl(req)) });
        }
        if (!sub && method === 'PATCH') {
          await updateConnectionSettings(db, vault, user.id, id, parse(ConnectionPatchSchema, await readJson(req)));
          return json(res, 200, { ok: true });
        }
        if (!sub && method === 'DELETE') return json(res, 200, { removed: (await deleteConnection(db, user.id, id)).length > 0 });
      }
    }

    if (resource === 'billing') {
      if (!id && method === 'GET') return json(res, 200, await accountSummary(user));
      if (id === 'checkout' && method === 'POST') {
        const body = parse(z.object({ plan: z.enum(PLAN_IDS) }), await readJson(req));
        if (body.plan === 'free') throw new HttpError(400, 'Offre gratuite : rien à payer');
        const full = await db.one<{ id: string; email: string; stripe_customer_id: string | null }>('SELECT id, email, stripe_customer_id FROM users WHERE id = $1', [user.id]);
        return json(res, 200, { url: await createCheckout(config, stripe(), full!, body.plan, baseUrl(req)) });
      }
      if (id === 'pay' && method === 'POST') {
        const body = parse(z.object({ plan: z.enum(PLAN_IDS), provider: z.enum(PAYMENT_PROVIDERS), months: z.number().int().min(1).max(12).optional() }), await readJson(req));
        const payment = await createPayment(
          db,
          config,
          { user, plan: body.plan, provider: body.provider, months: body.months, baseUrl: baseUrl(req), clientIp: clientIp(req, config.env.VIDEO_AGENT_TRUST_PROXY) },
          options.paymentFetch,
        );
        return json(res, 200, payment);
      }
      if (id === 'payments' && !sub && method === 'GET') return json(res, 200, (await listPayments(db, user.id)).map(publicPayment));
      if (id === 'payments' && sub && extra === 'refresh' && method === 'POST') {
        const payment = await refreshPayment(db, config, user.id, sub, options.paymentFetch);
        if (!payment) throw new HttpError(404, 'Paiement introuvable', 'not_found');
        return json(res, 200, { payment: publicPayment(payment), account: await accountSummary((await getUser(db, user.id))!) });
      }
      if (id === 'portal' && method === 'POST') {
        const full = await db.one<{ id: string; email: string; stripe_customer_id: string | null }>('SELECT id, email, stripe_customer_id FROM users WHERE id = $1', [user.id]);
        return json(res, 200, { url: await createPortal(stripe(), full!, baseUrl(req)) });
      }
    }

    // ---- admin -------------------------------------------------------------------------
    if (resource === 'admin') {
      await requireAdmin(req);
      if (id === 'settings') {
        if (!config.env.VIDEO_AGENT_SETTINGS_UI) throw new HttpError(403, 'Réglages désactivés (VIDEO_AGENT_SETTINGS_UI=false)');
        if (method === 'GET') return json(res, 200, { envFile, groups: settingsView(config), providers: (({ secrets: _s, ...rest }) => rest)(providerStatus(config)) });
        if (method === 'PUT') {
          const body = parse(z.record(z.string(), z.string().max(2000).nullable()), await readJson(req));
          config = saveSettings(envFile, body, reloadConfig);
          return json(res, 200, { groups: settingsView(config), providers: (({ secrets: _s, ...rest }) => rest)(providerStatus(config)) });
        }
      }
      if (id === 'users' && !sub && method === 'GET') {
        const rows = await db.query<User & { videos: string | number }>(
          `SELECT u.id, u.email, u.name, u.role, u.plan, u.subscription_status, u.created_at, count(j.id) AS videos
           FROM users u LEFT JOIN jobs j ON j.user_id = u.id AND j.created_at >= date_trunc('month', now())
           GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500`,
        );
        return json(res, 200, rows.map((r) => ({ id: r.id, email: r.email, name: r.name, role: r.role, plan: r.plan, subscriptionStatus: r.subscription_status, createdAt: new Date(r.created_at).toISOString(), videosThisMonth: Number(r.videos) })));
      }
      if (id === 'users' && sub && method === 'PATCH') {
        const body = parse(z.object({ plan: z.enum(PLAN_IDS).optional(), role: z.enum(['user', 'admin']).optional() }), await readJson(req));
        await db.query('UPDATE users SET plan = coalesce($2, plan), role = coalesce($3, role) WHERE id = $1', [sub, body.plan ?? null, body.role ?? null]);
        return json(res, 200, { ok: true });
      }
      if (id === 'payments' && method === 'GET') return json(res, 200, (await listPayments(db, undefined, 200)).map(publicPayment));
      if (id === 'stats' && method === 'GET') {
        const row = await db.one<Record<string, string | number>>(
          `SELECT (SELECT count(*) FROM users) AS users,
                  (SELECT count(*) FROM users WHERE plan <> 'free' AND (subscription_status IS DISTINCT FROM 'prepaid' OR current_period_end > now())) AS paying,
                  (SELECT coalesce(sum(amount), 0) FROM payments WHERE status = 'paid' AND currency = 'XOF' AND paid_at >= date_trunc('month', now())) AS revenue_xof,
                  (SELECT coalesce(sum(amount), 0) FROM payments WHERE status = 'paid' AND currency = 'MAD' AND paid_at >= date_trunc('month', now())) AS revenue_mad,
                  (SELECT count(*) FROM jobs WHERE created_at >= date_trunc('month', now())) AS videos_month,
                  (SELECT count(*) FROM jobs WHERE status = 'queued') AS queued,
                  (SELECT count(*) FROM jobs WHERE status = 'running') AS running`,
        );
        return json(res, 200, Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, Number(v)])));
      }
    }
    throw new HttpError(404, 'not found', 'not_found');
  };

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      const isWebhook = url.pathname === '/api/stripe/webhook' || /^\/api\/payments\/(geniuspay|youcanpay)\/webhook$/.test(url.pathname);
      // Staging gate (optional): HTTP Basic password in front of everything.
      const password = config.env.VIDEO_AGENT_WEB_PASSWORD;
      if (password && url.pathname !== '/api/health' && !isWebhook && !checkBasic(req.headers.authorization, password)) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="Video Agent", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8' });
        return void res.end('Authentification requise');
      }
      // CSRF: state-changing requests must come from our own pages (the webhook is server-to-server).
      if (req.method !== 'GET' && req.method !== 'HEAD' && !isWebhook) {
        const origin = req.headers.origin;
        let originHost = '';
        try {
          originHost = origin ? new URL(origin).host : '';
        } catch {
          /* invalid origin */
        }
        if (origin && originHost !== req.headers.host && originHost !== new URL(baseUrl(req)).host) return json(res, 403, { error: 'cross-origin request refused' });
      }
      if (parts[0] === 'api') return await api(req, res, url, parts);

      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
      const pages: Record<string, string> = { '/': 'index.html', '/app': 'app.html', '/app/': 'app.html', '/legal': 'legal.html', '/legal/': 'legal.html' };
      const page = pages[url.pathname] ?? decodeURIComponent(url.pathname.slice(1));
      const file = path.resolve(webRoot, page);
      if (!file.startsWith(webRoot + path.sep)) return json(res, 403, { error: 'forbidden' });
      return sendFile(req, res, file, { cache: /\.(css|js|svg|woff2|png|jpg|webp)$/.test(file) ? 'public, max-age=300' : 'no-cache' });
    } catch (err) {
      if (res.headersSent) return void res.end();
      if (err instanceof HttpError) return json(res, err.status, { error: err.message, code: err.code, ...err.extra });
      if (err instanceof AuthError) return json(res, err.code === 'too_many_attempts' ? 429 : err.code === 'unauthorized' ? 401 : 400, { error: err.message, code: err.code });
      if (err instanceof VideoAgentError) return json(res, 400, { error: err.message, hint: err.hint });
      logger.error(`${req.method} ${url.pathname}: ${errorMessage(err)}`);
      return json(res, 500, { error: 'Erreur interne' });
    }
  };

  return {
    handler,
    db,
    worker,
    close: async () => {
      await Promise.allSettled([...songTasks]);
      await worker?.stop();
      if (!options.db) await db.close();
    },
  };
};

/** HTTP Basic auth check (any user name, constant-time comparison). */
export const checkBasic = (header: string | undefined, password: string): boolean => {
  const match = /^Basic\s+(.+)$/i.exec(header ?? '');
  if (!match) return false;
  const decoded = Buffer.from(match[1]!, 'base64').toString('utf8');
  const given = decoded.slice(decoded.indexOf(':') + 1);
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(given).digest(), crypto.createHash('sha256').update(password).digest());
};

export const startSaasServer = async (config: AppConfig, options: SaasOptions & { port?: number; host?: string }) => {
  const app = await createSaasApp(config, options);
  const server = http.createServer((req, res) => void app.handler(req, res));
  const host = options.host ?? config.env.VIDEO_AGENT_HOST;
  const port = options.port ?? config.env.VIDEO_AGENT_PORT;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`,
    server,
    app,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await app.close();
    },
  };
};
