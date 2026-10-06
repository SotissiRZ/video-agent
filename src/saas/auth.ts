/** Accounts and sessions: e-mail + password (scrypt), opaque session tokens stored hashed. */
import type { AppConfig } from '../config/config';
import { VideoAgentError } from '../core/errors';
import { hashPassword, newId, randomToken, sha256, verifyPassword } from './crypto';
import type { Db } from './db';

export const SESSION_COOKIE = 'va_session';
const SESSION_DAYS = 30;

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  locale: 'fr' | 'en';
  plan: string;
  stripe_customer_id: string | null;
  subscription_status: string | null;
  current_period_end: Date | string | null;
  created_at: Date | string;
  email_verified_at: Date | string | null;
  /** Extra videos available beyond the monthly quota. */
  credits: number;
}

const USER_COLUMNS = 'id, email, name, role, locale, plan, stripe_customer_id, subscription_status, current_period_end, created_at, email_verified_at, credits';

/** Error with a stable code the UI translates. */
export class AuthError extends VideoAgentError {
  constructor(
    readonly code: 'invalid_email' | 'weak_password' | 'email_taken' | 'invalid_credentials' | 'signup_closed' | 'too_many_attempts' | 'unauthorized' | 'invalid_token',
    message: string,
  ) {
    super(message);
  }
}

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isAdminEmail = (config: AppConfig, email: string) =>
  config.env.ADMIN_EMAILS.split(',').map((e) => normalizeEmail(e)).filter(Boolean).includes(email);

export const signup = async (db: Db, config: AppConfig, input: { email: string; password: string; name?: string; locale?: string }): Promise<User> => {
  const email = normalizeEmail(input.email);
  if (!EMAIL.test(email) || email.length > 254) throw new AuthError('invalid_email', 'Adresse e-mail invalide');
  if (input.password.length < 8 || input.password.length > 200) throw new AuthError('weak_password', 'Le mot de passe doit contenir au moins 8 caractères');
  const passwordHash = await hashPassword(input.password);
  return db.tx(async (t) => {
    // Serialize sign-ups so that exactly one "first user" becomes admin.
    await t.query('SELECT pg_advisory_xact_lock(7270432)');
    const count = Number((await t.one<{ n: string | number }>('SELECT count(*) AS n FROM users'))?.n ?? 0);
    if (count > 0 && config.env.SIGNUP_MODE === 'closed' && !isAdminEmail(config, email)) throw new AuthError('signup_closed', 'Les inscriptions sont fermées');
    if (await t.one('SELECT 1 FROM users WHERE email = $1', [email])) throw new AuthError('email_taken', 'Un compte existe déjà avec cette adresse');
    const role = count === 0 || isAdminEmail(config, email) ? 'admin' : 'user';
    const locale = input.locale === 'en' ? 'en' : 'fr';
    const rows = await t.query<User>(
      `INSERT INTO users (id, email, password_hash, name, role, locale) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${USER_COLUMNS}`,
      [newId(), email, passwordHash, (input.name ?? '').trim().slice(0, 100), role, locale],
    );
    return rows[0]!;
  });
};

// Compared against when the e-mail is unknown, so that response time does not reveal accounts.
let dummyHash: Promise<string> | undefined;

export const login = async (db: Db, emailInput: string, password: string): Promise<User> => {
  const email = normalizeEmail(emailInput);
  const row = await db.one<User & { password_hash: string }>(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`, [email]);
  if (!row) {
    dummyHash ??= hashPassword('dummy-password-for-timing');
    await verifyPassword(password, await dummyHash);
    throw new AuthError('invalid_credentials', 'E-mail ou mot de passe incorrect');
  }
  if (!(await verifyPassword(password, row.password_hash))) throw new AuthError('invalid_credentials', 'E-mail ou mot de passe incorrect');
  const { password_hash: _ph, ...user } = row;
  return user;
};

export const createSession = async (db: Db, userId: string, userAgent?: string): Promise<{ token: string; maxAgeSec: number }> => {
  const token = randomToken();
  const maxAgeSec = SESSION_DAYS * 24 * 3600;
  await db.query('INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)', [sha256(token), userId, new Date(Date.now() + maxAgeSec * 1000).toISOString(), (userAgent ?? '').slice(0, 300)]);
  return { token, maxAgeSec };
};

export const userForSession = async (db: Db, token: string | undefined): Promise<User | undefined> => {
  if (!token || token.length > 200) return undefined;
  return db.one<User>(
    `SELECT ${USER_COLUMNS.split(', ').map((c) => `u.${c}`).join(', ')} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
};

export const destroySession = async (db: Db, token: string | undefined): Promise<void> => {
  if (token) await db.query('DELETE FROM sessions WHERE id = $1', [sha256(token)]);
};

export const changePassword = async (db: Db, userId: string, current: string, next: string): Promise<void> => {
  const row = await db.one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!row || !(await verifyPassword(current, row.password_hash))) throw new AuthError('invalid_credentials', 'Mot de passe actuel incorrect');
  if (next.length < 8 || next.length > 200) throw new AuthError('weak_password', 'Le mot de passe doit contenir au moins 8 caractères');
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(next), userId]);
  // Other devices are signed out.
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
};

export const getUser = (db: Db, id: string): Promise<User | undefined> => db.one<User>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);

/** Fixed-window limiter kept in memory (per web process). */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; reset: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Returns false when the key exceeded its budget. */
  take(key: string, now = Date.now()): boolean {
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
    const entry = this.hits.get(key);
    if (!entry || entry.reset < now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.max;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

export const parseCookies = (header: string | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* malformed cookie */
      }
    }
  }
  return out;
};

export const sessionCookie = (token: string, maxAgeSec: number, secure: boolean): string =>
  `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;

// ---- E-mail tokens (verification, password reset) -------------------------------------------

const TOKEN_TTL = { verify: 48 * 3600_000, reset: 3600_000 } as const;
export type EmailTokenKind = keyof typeof TOKEN_TTL;

/** One-time token (stored hashed); previous tokens of the same kind are revoked. */
export const createEmailToken = async (db: Db, userId: string, kind: EmailTokenKind): Promise<string> => {
  const token = randomToken();
  await db.query('DELETE FROM email_tokens WHERE user_id = $1 AND kind = $2', [userId, kind]);
  await db.query('INSERT INTO email_tokens (id, user_id, kind, expires_at) VALUES ($1, $2, $3, $4)', [sha256(token), userId, kind, new Date(Date.now() + TOKEN_TTL[kind]).toISOString()]);
  return token;
};

/** Consume a token: returns its user, or throws when unknown, used or expired. */
export const consumeEmailToken = async (db: Db, token: string, kind: EmailTokenKind): Promise<string> => {
  const row = token && token.length < 200 ? await db.one<{ user_id: string; expires_at: Date | string }>('DELETE FROM email_tokens WHERE id = $1 AND kind = $2 RETURNING user_id, expires_at', [sha256(token), kind]) : undefined;
  if (!row || new Date(row.expires_at).getTime() < Date.now()) throw new AuthError('invalid_token', 'Lien invalide ou expiré');
  return row.user_id;
};

export const markEmailVerified = (db: Db, userId: string) => db.query('UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1', [userId]);

export const findUserByEmail = (db: Db, email: string) => db.one<User>(`SELECT ${USER_COLUMNS} FROM users WHERE email = $1`, [normalizeEmail(email)]);

/** New password from a reset link; every session is closed. */
export const resetPassword = async (db: Db, token: string, password: string): Promise<string> => {
  if (password.length < 8 || password.length > 200) throw new AuthError('weak_password', 'Le mot de passe doit contenir au moins 8 caractères');
  const userId = await consumeEmailToken(db, token, 'reset');
  await db.query('UPDATE users SET password_hash = $1, email_verified_at = coalesce(email_verified_at, now()) WHERE id = $2', [await hashPassword(password), userId]);
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  return userId;
};
