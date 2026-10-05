/**
 * Helpers to obtain publishing credentials:
 *  - YouTube, LinkedIn, TikTok: OAuth 2.0 authorization-code flow with a local callback server
 *    (or manual mode: paste the redirected URL);
 *  - Meta (Facebook + Instagram): exchange a short-lived user token for a long-lived one and
 *    list the Pages / Instagram professional accounts with their (non-expiring) Page tokens.
 * Results can be written into .env with --save.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AppConfig } from '../config/config';
import { ConfigError, VideoAgentError } from '../core/errors';
import { formBody, requestJson } from './http';

export interface OAuthFlowOptions {
  authorizeUrl: (redirectUri: string, state: string) => string;
  redirectUri: string;
  /** Open the URL / print instructions. */
  prompt: (url: string) => void;
  /** Manual mode: ask the user to paste the URL they were redirected to. */
  readRedirect?: () => Promise<string>;
  timeoutMs?: number;
  /** Interface the local callback server listens on (0.0.0.0 inside Docker). Default: redirect host. */
  bindHost?: string;
}

const extractCode = (redirected: string, state: string): string => {
  const url = new URL(redirected);
  const error = url.searchParams.get('error');
  if (error) throw new VideoAgentError(`Autorisation refusée : ${error} ${url.searchParams.get('error_description') ?? ''}`.trim());
  if (url.searchParams.get('state') !== state) throw new VideoAgentError('Paramètre state invalide (tentative de connexion obsolète ou falsifiée).');
  const code = url.searchParams.get('code');
  if (!code) throw new VideoAgentError('Aucun code d’autorisation dans l’URL de retour.');
  return code;
};

/** Run the authorization-code flow and return the code. */
export const runOAuthFlow = async (opts: OAuthFlowOptions): Promise<string> => {
  const state = randomBytes(16).toString('hex');
  const url = opts.authorizeUrl(opts.redirectUri, state);
  if (opts.readRedirect) {
    opts.prompt(url);
    return extractCode(await opts.readRedirect(), state);
  }
  const redirect = new URL(opts.redirectUri);
  if (!['localhost', '127.0.0.1'].includes(redirect.hostname)) {
    throw new ConfigError(`Le serveur de retour local nécessite une redirect URI sur localhost (reçu ${opts.redirectUri})`, 'Utilisez --manual pour coller l’URL de retour.');
  }
  return new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const full = new URL(req.url ?? '/', opts.redirectUri);
      if (full.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      try {
        const code = extractCode(full.toString(), state);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<h1>✅ Video Agent est autorisé.</h1><p>Vous pouvez fermer cet onglet et revenir au terminal.</p>');
        finish(null, code);
      } catch (err) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(`<h1>❌ ${(err as Error).message}</h1>`);
        finish(err as Error);
      }
    });
    const timer = setTimeout(() => finish(new VideoAgentError('Délai dépassé : aucune autorisation reçue.')), opts.timeoutMs ?? 5 * 60_000);
    const finish = (err: Error | null, code?: string) => {
      clearTimeout(timer);
      server.close();
      if (err) reject(err);
      else resolve(code!);
    };
    server.on('error', reject);
    server.listen(Number(redirect.port || 80), opts.bindHost ?? redirect.hostname, () => opts.prompt(url));
  });
};

const pkce = () => {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

const need = (value: string | undefined, name: string): string => {
  if (!value) throw new ConfigError(`${name} manquant`, `Ajoutez ${name} dans .env (voir README, section Publication).`);
  return value;
};

export type Credentials = Record<string, string>;

export const authYouTube = async (config: AppConfig, flow: Omit<OAuthFlowOptions, 'authorizeUrl'>): Promise<Credentials> => {
  const clientId = need(config.env.YOUTUBE_CLIENT_ID, 'YOUTUBE_CLIENT_ID');
  const clientSecret = need(config.env.YOUTUBE_CLIENT_SECRET, 'YOUTUBE_CLIENT_SECRET');
  const code = await runOAuthFlow({
    ...flow,
    authorizeUrl: (redirectUri, state) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.upload', access_type: 'offline', prompt: 'consent', state })}`,
  });
  const t = await requestJson<{ refresh_token?: string }>('youtube', 'https://oauth2.googleapis.com/token', {
    ...formBody({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: flow.redirectUri, grant_type: 'authorization_code' }),
  });
  if (!t.refresh_token) throw new VideoAgentError('Google n’a pas renvoyé de refresh token.', 'Révoquez l’accès de l’application dans votre compte Google puis recommencez.');
  return { YOUTUBE_REFRESH_TOKEN: t.refresh_token };
};

export const authLinkedIn = async (config: AppConfig, flow: Omit<OAuthFlowOptions, 'authorizeUrl'>, organization?: string): Promise<Credentials> => {
  const clientId = need(config.env.LINKEDIN_CLIENT_ID, 'LINKEDIN_CLIENT_ID');
  const clientSecret = need(config.env.LINKEDIN_CLIENT_SECRET, 'LINKEDIN_CLIENT_SECRET');
  const scope = ['openid', 'profile', 'w_member_social', ...(organization ? ['w_organization_social'] : [])].join(' ');
  const code = await runOAuthFlow({
    ...flow,
    authorizeUrl: (redirectUri, state) => `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, scope })}`,
  });
  const t = await requestJson<{ access_token: string; refresh_token?: string; expires_in: number }>('linkedin', 'https://www.linkedin.com/oauth/v2/accessToken', {
    ...formBody({ grant_type: 'authorization_code', code, redirect_uri: flow.redirectUri, client_id: clientId, client_secret: clientSecret }),
  });
  let author = organization ? `urn:li:organization:${organization.replace(/^urn:li:organization:/, '')}` : undefined;
  if (!author) {
    const me = await requestJson<{ sub: string }>('linkedin', 'https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${t.access_token}` } });
    author = `urn:li:person:${me.sub}`;
  }
  return { LINKEDIN_ACCESS_TOKEN: t.access_token, ...(t.refresh_token ? { LINKEDIN_REFRESH_TOKEN: t.refresh_token } : {}), LINKEDIN_AUTHOR_URN: author };
};

export const authTikTok = async (config: AppConfig, flow: Omit<OAuthFlowOptions, 'authorizeUrl'>): Promise<Credentials> => {
  const clientKey = need(config.env.TIKTOK_CLIENT_KEY, 'TIKTOK_CLIENT_KEY');
  const clientSecret = need(config.env.TIKTOK_CLIENT_SECRET, 'TIKTOK_CLIENT_SECRET');
  const { verifier, challenge } = pkce();
  const scope = config.env.TIKTOK_MODE === 'direct' ? 'user.info.basic,video.upload,video.publish' : 'user.info.basic,video.upload';
  const code = await runOAuthFlow({
    ...flow,
    authorizeUrl: (redirectUri, state) =>
      `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({ client_key: clientKey, scope, response_type: 'code', redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256' })}`,
  });
  const t = await requestJson<{ access_token: string; refresh_token: string; open_id: string }>('tiktok', 'https://open.tiktokapis.com/v2/oauth/token/', {
    ...formBody({ client_key: clientKey, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: flow.redirectUri, code_verifier: verifier }),
  });
  return { TIKTOK_REFRESH_TOKEN: t.refresh_token };
};

export interface MetaAccount {
  pageId: string;
  pageName: string;
  pageToken: string;
  instagramUserId?: string;
  instagramUsername?: string;
}

/** Exchange a short-lived user token (Graph API Explorer) and list Pages + Instagram accounts. */
export const authMeta = async (config: AppConfig, shortLivedToken: string): Promise<MetaAccount[]> => {
  const appId = need(config.env.META_APP_ID, 'META_APP_ID');
  const appSecret = need(config.env.META_APP_SECRET, 'META_APP_SECRET');
  const base = `https://graph.facebook.com/${config.env.META_GRAPH_VERSION}`;
  const long = await requestJson<{ access_token: string }>('meta', `${base}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortLivedToken })}`);
  const pages = await requestJson<{ data: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }> }>(
    'meta',
    `${base}/me/accounts?${new URLSearchParams({ fields: 'id,name,access_token,instagram_business_account{id,username}', access_token: long.access_token })}`,
  );
  return pages.data.map((p) => ({ pageId: p.id, pageName: p.name, pageToken: p.access_token, instagramUserId: p.instagram_business_account?.id, instagramUsername: p.instagram_business_account?.username }));
};

/** Insert or replace KEY=value lines in a .env file (other lines are preserved). */
export const updateEnvFile = (file: string, values: Credentials): void => {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const index = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    if (index >= 0) lines[index] = line;
    else lines.push(line);
  }
  fs.writeFileSync(file, `${lines.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
};
