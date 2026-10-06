/**
 * Database access for the SaaS: PostgreSQL in production (DATABASE_URL), embedded PGlite
 * (a real PostgreSQL compiled to WebAssembly) for local use and tests. Same SQL for both.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/config';

export interface Db {
  readonly kind: 'postgres' | 'pglite';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Run fn in a transaction (rolled back if it throws). */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type Querier = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;

const wrap = (kind: Db['kind'], q: Querier, tx: Db['tx'], close: () => Promise<void>): Db => ({
  kind,
  query: async <T>(sql: string, params?: unknown[]) => (await q(sql, params)).rows as T[],
  one: async <T>(sql: string, params?: unknown[]) => (await q(sql, params)).rows[0] as T | undefined,
  tx,
  close,
});

export const connectPostgres = async (url: string): Promise<Db> => {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const tx = async <T>(fn: (db: Db) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inner = wrap('postgres', (s, p) => client.query(s, p as unknown[]), () => Promise.reject(new Error('nested transaction')), async () => undefined);
      const result = await fn(inner);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  };
  return wrap('postgres', (s, p) => pool.query(s, p as unknown[]), tx, () => pool.end());
};

/** Embedded database. dir = undefined → in memory (tests). */
export const connectPglite = async (dir?: string): Promise<Db> => {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir);
  const tx = <T>(fn: (inner: Db) => Promise<T>): Promise<T> =>
    db.transaction((t) => fn(wrap('pglite', (s, p) => t.query(s, p), () => Promise.reject(new Error('nested transaction')), async () => undefined)));
  return wrap('pglite', (s, p) => db.query(s, p), tx, () => db.close());
};

export const connectDatabase = async (config: AppConfig): Promise<Db> => {
  const db = config.env.DATABASE_URL ? await connectPostgres(config.env.DATABASE_URL) : await connectPglite(path.join(config.paths.data, 'db'));
  await migrate(db);
  return db;
};

/** Ordered migrations; never edit a released one, append a new one. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    name text NOT NULL DEFAULT '',
    role text NOT NULL DEFAULT 'user',
    locale text NOT NULL DEFAULT 'fr',
    plan text NOT NULL DEFAULT 'free',
    stripe_customer_id text UNIQUE,
    stripe_subscription_id text,
    subscription_status text,
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    user_agent text
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE jobs (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt text NOT NULL,
    options jsonb NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'queued',
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz,
    heartbeat_at timestamptz,
    worker_id text,
    cancel_requested boolean NOT NULL DEFAULT false,
    overall real NOT NULL DEFAULT 0,
    step text,
    message text,
    steps jsonb NOT NULL DEFAULT '{}',
    title text,
    warnings jsonb NOT NULL DEFAULT '[]',
    error text,
    providers jsonb,
    dir text NOT NULL,
    video_file text,
    poster_file text,
    duration_sec real,
    credits integer NOT NULL DEFAULT 0
  );
  CREATE INDEX jobs_user ON jobs(user_id, created_at DESC);
  CREATE INDEX jobs_queue ON jobs(status, created_at);
  CREATE TABLE connections (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform text NOT NULL,
    account_name text NOT NULL DEFAULT '',
    data text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, platform)
  );
  CREATE TABLE publications (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    platforms jsonb NOT NULL,
    at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    outcomes jsonb,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz
  );
  CREATE INDEX publications_due ON publications(status, at);
  CREATE INDEX publications_user ON publications(user_id, at DESC);
  CREATE TABLE oauth_states (
    state text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform text NOT NULL,
    verifier text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE stripe_events (
    id text PRIMARY KEY,
    received_at timestamptz NOT NULL DEFAULT now()
  );
  `,
  // 2 — e-mail verification, password reset, brand kits
  `
  ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
  CREATE TABLE email_tokens (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX email_tokens_user ON email_tokens(user_id, kind);
  CREATE TABLE brand_kits (
    user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL DEFAULT '',
    colors jsonb NOT NULL DEFAULT '[]',
    logo_file text,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  `,
  // 3 — one-off payments (prepaid passes through GeniusPay / YouCan Pay)
  `
  CREATE TABLE payments (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL,
    plan text NOT NULL,
    months integer NOT NULL DEFAULT 1,
    amount bigint NOT NULL,
    currency text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    provider_ref text,
    checkout_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    paid_at timestamptz,
    raw jsonb
  );
  CREATE UNIQUE INDEX payments_provider_ref ON payments(provider, provider_ref);
  CREATE INDEX payments_user ON payments(user_id, created_at DESC);
  `,
  // 4. Extra-video credits, and pass expiry reminders.
  `
  ALTER TABLE users ADD COLUMN credits integer NOT NULL DEFAULT 0;
  ALTER TABLE jobs ADD COLUMN paid_with_credit boolean NOT NULL DEFAULT false;
  ALTER TABLE jobs ADD COLUMN credit_refunded boolean NOT NULL DEFAULT false;
  ALTER TABLE payments ADD COLUMN credits integer;
  CREATE TABLE reminders (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    period_end timestamptz NOT NULL,
    sent_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind, period_end)
  );
  `,
  // 5. Standalone songs, separate from video jobs and quotas.
  `
  CREATE TABLE songs (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt text NOT NULL,
    title text NOT NULL,
    lyrics text NOT NULL,
    style text NOT NULL,
    mood text NOT NULL,
    duration_sec integer NOT NULL DEFAULT 90,
    status text NOT NULL DEFAULT 'draft',
    error text,
    audio_file text,
    heartbeat_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
  );
  CREATE INDEX songs_user ON songs(user_id, created_at DESC);
  CREATE INDEX songs_usage ON songs(user_id, created_at) WHERE status IN ('queued', 'running', 'completed');
  `,
];

/** Apply pending migrations (serialized with an advisory lock: several containers may start together). */
export const migrate = async (db: Db): Promise<void> => {
  await db.tx(async (t) => {
    await t.query('SELECT pg_advisory_xact_lock(7270431)');
    await t.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await t.query<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => Number(r.version)));
    for (let i = 0; i < MIGRATIONS.length; i++) {
      if (done.has(i + 1)) continue;
      await execMany(t, MIGRATIONS[i]!);
      await t.query('INSERT INTO schema_migrations (version) VALUES ($1)', [i + 1]);
    }
  });
};

/** Prepared statements accept a single command: split the migration on top-level semicolons. */
const execMany = async (db: Db, sql: string) => {
  for (const statement of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await db.query(statement);
};
