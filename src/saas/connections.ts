/**
 * Social accounts connected by each customer (OAuth in the browser). The operator's developer
 * apps (client id/secret) come from the environment; the customer's tokens are stored encrypted.
 */
import type { AppConfig } from '../config/config';
import { ConfigError, VideoAgentError } from '../core/errors';
import {
  linkedinAuthorizeUrl,
  linkedinExchange,
  metaAccounts,
  metaAuthorizeUrl,
  metaExchangeCode,
  pkce,
  tiktokAuthorizeUrl,
  tiktokExchange,
  youtubeAuthorizeUrl,
  youtubeChannelTitle,
  youtubeExchange,
  type MetaAccount,
} from '../publish/auth';
import { defaultLinkedInVersion, LinkedInPublisher } from '../publish/platforms/linkedin';
import { FacebookPublisher, InstagramPublisher } from '../publish/platforms/meta';
import { TikTokPublisher } from '../publish/platforms/tiktok';
import { YouTubePublisher } from '../publish/platforms/youtube';
import { TokenStore, type StoredToken } from '../publish/tokens';
import type { PlatformId, Publisher } from '../publish/types';
import { newId, randomToken, type Vault } from './crypto';
import type { Db } from './db';

export const PROVIDERS = ['youtube', 'tiktok', 'linkedin', 'meta'] as const;
export type ConnectionProvider = (typeof PROVIDERS)[number];
export const isProvider = (v: string): v is ConnectionProvider => (PROVIDERS as readonly string[]).includes(v);

/** Publishing platform → account that publishes it. */
export const providerFor = (platform: PlatformId): ConnectionProvider => (platform === 'facebook' || platform === 'instagram' ? 'meta' : platform);

export interface ConnectionData {
  /** Rotating access/refresh tokens (refreshed by the publishers). */
  token?: StoredToken;
  // YouTube
  privacy?: 'public' | 'unlisted' | 'private';
  // TikTok
  openId?: string;
  mode?: 'draft' | 'direct';
  // LinkedIn
  authorUrn?: string;
  // Meta
  pages?: MetaAccount[];
  pageId?: string;
}

export interface ConnectionRow {
  id: string;
  user_id: string;
  platform: ConnectionProvider;
  account_name: string;
  data: string;
  created_at: Date | string;
  updated_at: Date | string;
}

/** Is the operator's developer app configured for this provider? */
export const providerAvailable = (config: AppConfig, provider: ConnectionProvider): boolean => {
  const e = config.env;
  switch (provider) {
    case 'youtube':
      return Boolean(e.YOUTUBE_CLIENT_ID && e.YOUTUBE_CLIENT_SECRET);
    case 'tiktok':
      return Boolean(e.TIKTOK_CLIENT_KEY && e.TIKTOK_CLIENT_SECRET);
    case 'linkedin':
      return Boolean(e.LINKEDIN_CLIENT_ID && e.LINKEDIN_CLIENT_SECRET);
    case 'meta':
      return Boolean(e.META_APP_ID && e.META_APP_SECRET);
  }
};

export const redirectUri = (baseUrl: string, provider: ConnectionProvider) => `${baseUrl}/api/connections/${provider}/callback`;

/** First leg: remember a one-time state (and PKCE verifier) and return the provider's consent URL. */
export const startConnection = async (db: Db, config: AppConfig, userId: string, provider: ConnectionProvider, baseUrl: string): Promise<string> => {
  if (!providerAvailable(config, provider)) throw new ConfigError(`${provider} n'est pas disponible sur cette instance`);
  const state = randomToken(24);
  const { verifier, challenge } = pkce();
  await db.query("DELETE FROM oauth_states WHERE created_at < now() - interval '1 hour'");
  await db.query('INSERT INTO oauth_states (state, user_id, platform, verifier) VALUES ($1, $2, $3, $4)', [state, userId, provider, verifier]);
  const e = config.env;
  const uri = redirectUri(baseUrl, provider);
  switch (provider) {
    case 'youtube':
      return youtubeAuthorizeUrl(e.YOUTUBE_CLIENT_ID!, uri, state);
    case 'tiktok':
      return tiktokAuthorizeUrl(e.TIKTOK_CLIENT_KEY!, uri, state, challenge, e.TIKTOK_MODE);
    case 'linkedin':
      return linkedinAuthorizeUrl(e.LINKEDIN_CLIENT_ID!, uri, state);
    case 'meta':
      return metaAuthorizeUrl(e.META_APP_ID!, e.META_GRAPH_VERSION, uri, state);
  }
};

export interface ExchangeResult {
  accountName: string;
  data: ConnectionData;
}

export type CodeExchanger = (provider: ConnectionProvider, code: string, redirect: string, verifier: string) => Promise<ExchangeResult>;

export const defaultExchanger = (config: AppConfig): CodeExchanger => async (provider, code, redirect, verifier) => {
  const e = config.env;
  switch (provider) {
    case 'youtube': {
      const t = await youtubeExchange({ clientId: e.YOUTUBE_CLIENT_ID!, clientSecret: e.YOUTUBE_CLIENT_SECRET!, code, redirectUri: redirect });
      const title = await youtubeChannelTitle(t.accessToken);
      return { accountName: title ?? 'YouTube', data: { token: { refreshToken: t.refreshToken, accessToken: t.accessToken, expiresAt: Date.now() + t.expiresIn * 1000 }, privacy: e.YOUTUBE_PRIVACY } };
    }
    case 'tiktok': {
      const t = await tiktokExchange({ clientKey: e.TIKTOK_CLIENT_KEY!, clientSecret: e.TIKTOK_CLIENT_SECRET!, code, redirectUri: redirect, verifier });
      return { accountName: t.name || 'TikTok', data: { token: { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Date.now() + t.expiresIn * 1000 }, openId: t.openId, mode: e.TIKTOK_MODE } };
    }
    case 'linkedin': {
      const t = await linkedinExchange({ clientId: e.LINKEDIN_CLIENT_ID!, clientSecret: e.LINKEDIN_CLIENT_SECRET!, code, redirectUri: redirect });
      return { accountName: t.name || 'LinkedIn', data: { token: { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Date.now() + t.expiresIn * 1000 }, authorUrn: t.authorUrn } };
    }
    case 'meta': {
      const short = await metaExchangeCode({ appId: e.META_APP_ID!, appSecret: e.META_APP_SECRET!, graphVersion: e.META_GRAPH_VERSION, code, redirectUri: redirect });
      const pages = await metaAccounts({ appId: e.META_APP_ID!, appSecret: e.META_APP_SECRET!, graphVersion: e.META_GRAPH_VERSION, shortLivedToken: short });
      if (!pages.length) throw new VideoAgentError('Aucune Page Facebook trouvée sur ce compte', 'Créez une Page (et liez-y un compte Instagram professionnel) puis reconnectez-vous.');
      return { accountName: pages[0]!.pageName, data: { pages, pageId: pages[0]!.pageId } };
    }
  }
};

/** Second leg (callback): validate the state, exchange the code, store the encrypted connection. */
export const finishConnection = async (
  db: Db,
  vault: Vault,
  provider: ConnectionProvider,
  params: { code?: string | null; state?: string | null; error?: string | null },
  baseUrl: string,
  exchange: CodeExchanger,
): Promise<{ userId: string; accountName: string }> => {
  if (!params.state) throw new VideoAgentError('Paramètre state manquant');
  const row = await db.one<{ user_id: string; platform: string; verifier: string; created_at: Date | string }>('DELETE FROM oauth_states WHERE state = $1 RETURNING user_id, platform, verifier, created_at', [params.state]);
  if (!row || row.platform !== provider || Date.now() - new Date(row.created_at).getTime() > 15 * 60_000) throw new VideoAgentError('Lien de connexion expiré ou invalide. Recommencez.');
  if (params.error) throw new VideoAgentError(`Autorisation refusée (${params.error})`);
  if (!params.code) throw new VideoAgentError('Code d’autorisation manquant');
  const result = await exchange(provider, params.code, redirectUri(baseUrl, provider), row.verifier);
  await saveConnection(db, vault, row.user_id, provider, result.accountName, result.data);
  return { userId: row.user_id, accountName: result.accountName };
};

export const saveConnection = (db: Db, vault: Vault, userId: string, provider: ConnectionProvider, accountName: string, data: ConnectionData) =>
  db.query(
    `INSERT INTO connections (id, user_id, platform, account_name, data) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, platform) DO UPDATE SET account_name = excluded.account_name, data = excluded.data, updated_at = now()`,
    [newId(), userId, provider, accountName.slice(0, 200), vault.encrypt(data)],
  );

export const listConnections = (db: Db, userId: string) => db.query<ConnectionRow>('SELECT * FROM connections WHERE user_id = $1 ORDER BY platform', [userId]);

export const getConnection = (db: Db, userId: string, provider: ConnectionProvider) => db.one<ConnectionRow>('SELECT * FROM connections WHERE user_id = $1 AND platform = $2', [userId, provider]);

export const deleteConnection = (db: Db, userId: string, provider: ConnectionProvider) => db.query('DELETE FROM connections WHERE user_id = $1 AND platform = $2 RETURNING id', [userId, provider]);

/** Settings the customer can change on a connection (no secrets). */
export const updateConnectionSettings = async (db: Db, vault: Vault, userId: string, provider: ConnectionProvider, patch: { privacy?: ConnectionData['privacy']; mode?: ConnectionData['mode']; pageId?: string }) => {
  const row = await getConnection(db, userId, provider);
  if (!row) throw new VideoAgentError('Compte non connecté');
  const data = vault.decrypt<ConnectionData>(row.data);
  if (patch.privacy) data.privacy = patch.privacy;
  if (patch.mode) data.mode = patch.mode;
  let name = row.account_name;
  if (patch.pageId) {
    const page = data.pages?.find((p) => p.pageId === patch.pageId);
    if (!page) throw new VideoAgentError('Page inconnue');
    data.pageId = page.pageId;
    name = page.pageName;
  }
  await saveConnection(db, vault, userId, provider, name, data);
};

/** What the browser may see about a connection: never tokens. */
export const publicConnection = (vault: Vault, row: ConnectionRow) => {
  const data = vault.decrypt<ConnectionData>(row.data);
  const page = data.pages?.find((p) => p.pageId === data.pageId);
  return {
    platform: row.platform,
    accountName: row.account_name,
    connectedAt: new Date(row.created_at).toISOString(),
    privacy: data.privacy,
    mode: data.mode,
    pages: data.pages?.map((p) => ({ id: p.pageId, name: p.pageName, instagram: p.instagramUsername ?? (p.instagramUserId ? 'Instagram' : undefined) })),
    pageId: data.pageId,
    instagram: page?.instagramUsername ?? (page?.instagramUserId ? 'Instagram' : undefined),
  };
};

/** Platforms a user can publish to with their connections. */
export const publishablePlatforms = (vault: Vault, rows: ConnectionRow[]): PlatformId[] => {
  const out: PlatformId[] = [];
  for (const row of rows) {
    if (row.platform === 'meta') {
      const data = vault.decrypt<ConnectionData>(row.data);
      const page = data.pages?.find((p) => p.pageId === data.pageId);
      if (page) out.push('facebook');
      if (page?.instagramUserId) out.push('instagram');
    } else out.push(row.platform);
  }
  return out;
};

/** In-memory token store seeded from a connection; changes are saved back after publishing. */
class ConnectionTokenStore extends TokenStore {
  dirty = false;
  private readonly tokens = new Map<string, StoredToken>();

  constructor(key: string, token?: StoredToken) {
    super('');
    if (token) this.tokens.set(key, token);
  }

  override get(key: string): StoredToken | undefined {
    return this.tokens.get(key);
  }

  override set(key: string, token: StoredToken): void {
    this.tokens.set(key, { ...this.tokens.get(key), ...token });
    this.dirty = true;
  }
}

/**
 * Publisher acting on behalf of a customer. `persist` saves rotated tokens (TikTok and LinkedIn
 * refresh tokens change on use): call it after publishing, even when publishing failed.
 */
export const createConnectionPublisher = (config: AppConfig, platform: PlatformId, data: ConnectionData): { publisher: Publisher; persist: () => ConnectionData | undefined } => {
  const e = config.env;
  const provider = providerFor(platform);
  const store = new ConnectionTokenStore(provider, data.token);
  const persist = () => (store.dirty ? { ...data, token: store.get(provider) } : undefined);
  const token = data.token ?? {};
  switch (platform) {
    case 'youtube':
      if (!token.refreshToken) throw new VideoAgentError('Reconnectez votre compte YouTube');
      return { publisher: new YouTubePublisher({ clientId: e.YOUTUBE_CLIENT_ID!, clientSecret: e.YOUTUBE_CLIENT_SECRET!, refreshToken: token.refreshToken, privacy: data.privacy ?? e.YOUTUBE_PRIVACY, categoryId: e.YOUTUBE_CATEGORY_ID, store }), persist };
    case 'tiktok':
      return { publisher: new TikTokPublisher({ clientKey: e.TIKTOK_CLIENT_KEY!, clientSecret: e.TIKTOK_CLIENT_SECRET!, refreshToken: token.refreshToken, accessToken: token.accessToken, mode: data.mode ?? e.TIKTOK_MODE, privacy: e.TIKTOK_PRIVACY, store }), persist };
    case 'linkedin':
      if (!data.authorUrn) throw new VideoAgentError('Reconnectez votre compte LinkedIn');
      return {
        publisher: new LinkedInPublisher({ accessToken: token.accessToken, refreshToken: token.refreshToken, clientId: e.LINKEDIN_CLIENT_ID, clientSecret: e.LINKEDIN_CLIENT_SECRET, authorUrn: data.authorUrn, version: e.LINKEDIN_API_VERSION ?? defaultLinkedInVersion(), visibility: e.LINKEDIN_VISIBILITY, store }),
        persist,
      };
    case 'facebook':
    case 'instagram': {
      const page = data.pages?.find((p) => p.pageId === data.pageId);
      if (!page) throw new VideoAgentError('Choisissez une Page Facebook dans Comptes connectés');
      if (platform === 'facebook') return { publisher: new FacebookPublisher({ graphVersion: e.META_GRAPH_VERSION, pageId: page.pageId, pageToken: page.pageToken }), persist };
      if (!page.instagramUserId) throw new VideoAgentError('Aucun compte Instagram professionnel lié à cette Page');
      return { publisher: new InstagramPublisher({ graphVersion: e.META_GRAPH_VERSION, instagramUserId: page.instagramUserId, instagramToken: page.pageToken }), persist };
    }
  }
};
