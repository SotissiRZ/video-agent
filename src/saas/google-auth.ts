/**
 * "Continuer avec Google": OpenID Connect authorization code flow with PKCE (S256) and a nonce.
 *
 * Nobody is signed in yet, so the flow state (state, PKCE verifier, nonce, intent) lives in a
 * short-lived HttpOnly cookie signed with APP_SECRET instead of the database: the callback is only
 * accepted in the browser that started the flow (login CSRF protection), and a tampered cookie is
 * rejected. The ID token comes straight from Google's token endpoint over TLS with our client
 * secret, so its claims are checked (issuer, audience, expiry, nonce, verified e-mail) without
 * fetching Google's signing keys (OpenID Connect Core 1.0, § 3.1.3.7).
 */
import crypto from 'node:crypto';
import type { AppConfig } from '../config/config';
import { VideoAgentError } from '../core/errors';
import { randomToken } from './crypto';

export const GOOGLE_FLOW_COOKIE = 'va_google';
export const GOOGLE_FLOW_PATH = '/api/auth/google';
const FLOW_TTL_MS = 10 * 60_000;
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export interface GoogleClient {
  id: string;
  secret: string;
}

/** Google sign-in is offered only when a Web OAuth client is configured. */
export const googleClient = (config: AppConfig): GoogleClient | undefined => {
  const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = config.env;
  return id && secret ? { id, secret } : undefined;
};

export const googleRedirectUri = (baseUrl: string) => `${baseUrl}${GOOGLE_FLOW_PATH}/callback`;

export interface GoogleFlow {
  state: string;
  verifier: string;
  nonce: string;
  intent: 'login' | 'signup';
  /** The "18 or older, terms accepted" box was ticked before leaving for Google. */
  terms: boolean;
  locale: 'fr' | 'en';
  plan?: string;
  /** Creation time (ms), for expiry. */
  at: number;
}

const b64url = (buf: Buffer) => buf.toString('base64url');
const hmac = (secret: string, data: string) => b64url(crypto.createHmac('sha256', `google-flow:${secret}`).update(data).digest());

export const sealFlow = (flow: GoogleFlow, secret: string): string => {
  const body = b64url(Buffer.from(JSON.stringify(flow)));
  return `${body}.${hmac(secret, body)}`;
};

/** The flow from the cookie, or undefined when missing, tampered with or expired. */
export const openFlow = (value: string | undefined, secret: string, now = Date.now()): GoogleFlow | undefined => {
  if (!value || value.length > 2000) return undefined;
  const [body, mac] = value.split('.');
  if (!body || !mac) return undefined;
  const expected = Buffer.from(hmac(secret, body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return undefined;
  try {
    const flow = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as GoogleFlow;
    return typeof flow.at === 'number' && now - flow.at <= FLOW_TTL_MS && now >= flow.at - 60_000 ? flow : undefined;
  } catch {
    return undefined;
  }
};

export const flowCookie = (value: string, secure: boolean): string =>
  `${GOOGLE_FLOW_COOKIE}=${value}; Path=${GOOGLE_FLOW_PATH}; HttpOnly; SameSite=Lax; Max-Age=${value ? FLOW_TTL_MS / 1000 : 0}${secure ? '; Secure' : ''}`;

/** First leg: a fresh flow and Google's consent URL. */
export const startGoogleFlow = (
  client: GoogleClient,
  redirectUri: string,
  input: { intent: 'login' | 'signup'; terms: boolean; locale: 'fr' | 'en'; plan?: string },
  now = Date.now(),
): { flow: GoogleFlow; url: string } => {
  const flow: GoogleFlow = { state: randomToken(24), verifier: randomToken(48), nonce: randomToken(24), ...input, at: now };
  const challenge = b64url(crypto.createHash('sha256').update(flow.verifier).digest());
  const params = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { flow, url: `${AUTHORIZE_URL}?${params}` };
};

/** Error with a stable code the sign-in page translates (auth.google.<code>). */
export class GoogleAuthError extends VideoAgentError {
  constructor(
    readonly code: 'cancelled' | 'expired' | 'failed' | 'unverified',
    message: string,
  ) {
    super(message);
  }
}

/** Code → tokens. Injectable for tests. */
export type GoogleTokenExchange = (request: { code: string; verifier: string; redirectUri: string; client: GoogleClient }) => Promise<{ id_token?: string }>;

export const defaultGoogleExchange: GoogleTokenExchange = async ({ code, verifier, redirectUri, client }) => {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, code_verifier: verifier, client_id: client.id, client_secret: client.secret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok) throw new GoogleAuthError('failed', `Google token endpoint: HTTP ${res.status} ${body.error ?? ''} ${body.error_description ?? ''}`.trim());
  return body;
};

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
}

/** Claims of an ID token received from the token endpoint (see the header comment). */
export const verifyIdToken = (idToken: string | undefined, clientId: string, nonce: string, now = Date.now()): GoogleProfile => {
  const payload = idToken?.split('.')[1];
  if (!payload) throw new GoogleAuthError('failed', 'Google n’a pas renvoyé de jeton d’identité');
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new GoogleAuthError('failed', 'Jeton d’identité Google illisible');
  }
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!ISSUERS.has(String(claims.iss))) throw new GoogleAuthError('failed', `Émetteur inattendu : ${String(claims.iss)}`);
  if (!audiences.includes(clientId)) throw new GoogleAuthError('failed', 'Jeton d’identité destiné à une autre application');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - 60_000) throw new GoogleAuthError('expired', 'Jeton d’identité expiré');
  if (claims.nonce !== nonce) throw new GoogleAuthError('failed', 'Nonce invalide');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new GoogleAuthError('failed', 'Identifiant Google manquant');
  const email = typeof claims.email === 'string' ? claims.email : '';
  // Only an address Google has verified may open (or be linked to) an account.
  if (!email || (claims.email_verified !== true && claims.email_verified !== 'true')) throw new GoogleAuthError('unverified', 'Adresse e-mail Google non vérifiée');
  const name = typeof claims.name === 'string' ? claims.name : '';
  return { sub: claims.sub, email, name };
};
