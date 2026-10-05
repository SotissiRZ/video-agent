/** Secrets, password hashing, token encryption. Only node:crypto. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/config';
import { ConfigError } from '../core/errors';

/**
 * APP_SECRET signs sessions and encrypts OAuth tokens. Required with PostgreSQL (several containers
 * must share it); generated once and kept in the data directory for the embedded database.
 */
export const resolveAppSecret = (config: AppConfig): string => {
  if (config.env.APP_SECRET) return config.env.APP_SECRET;
  if (config.env.DATABASE_URL) {
    throw new ConfigError('APP_SECRET est obligatoire avec DATABASE_URL', 'Générez-en un : openssl rand -hex 32, puis ajoutez APP_SECRET=… dans .env.');
  }
  const file = path.join(config.paths.data, 'app-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
};

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');
export const newId = (): string => crypto.randomUUID();

// ---- Passwords (scrypt) ---------------------------------------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const scrypt = (password: string, salt: Buffer, opts = SCRYPT): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password.normalize('NFKC'), salt, opts.keylen, { N: opts.N, r: opts.r, p: opts.p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );

export const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [scheme, N, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p), keylen: expected.length });
  return crypto.timingSafeEqual(key, expected);
};

// ---- Encryption of stored credentials (AES-256-GCM) ---------------------------------------
const deriveKey = (secret: string, purpose: string): Buffer => Buffer.from(crypto.hkdfSync('sha256', secret, 'video-agent', purpose, 32));

export class Vault {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = deriveKey(secret, 'oauth-tokens');
  }

  encrypt(value: unknown): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
  }

  decrypt<T>(payload: string): T {
    const [version, iv, tag, data] = payload.split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('invalid encrypted payload');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')) as T;
  }
}
