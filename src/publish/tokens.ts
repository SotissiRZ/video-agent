/**
 * Persistent store for OAuth tokens that rotate (TikTok, LinkedIn refresh tokens).
 * Lives in .video-agent/tokens.json (git-ignored). Values from .env are the initial seed.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface StoredToken {
  accessToken?: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt?: number;
}

export class TokenStore {
  constructor(private readonly file: string) {}

  static default(cwd = process.cwd()): TokenStore {
    return new TokenStore(path.join(cwd, '.video-agent', 'tokens.json'));
  }

  private readAll(): Record<string, StoredToken> {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  get(key: string): StoredToken | undefined {
    return this.readAll()[key];
  }

  set(key: string, token: StoredToken): void {
    const all = this.readAll();
    all[key] = { ...all[key], ...token };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(all, null, 2), { mode: 0o600 });
  }
}

/** A token is reusable if it does not expire within the next minute. */
export const isFresh = (t: StoredToken | undefined): t is StoredToken & { accessToken: string } =>
  Boolean(t?.accessToken && (!t.expiresAt || t.expiresAt - Date.now() > 60_000));
