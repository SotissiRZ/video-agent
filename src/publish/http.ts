/** HTTP helper for publishing APIs: raw bodies (video bytes), response headers, form data. */
import { ProviderError } from '../core/errors';
import { withTimeout } from '../providers/http';

export interface RawRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | Buffer | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export const request = async (provider: string, url: string, init: RawRequest = {}): Promise<Response> => {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: init.headers,
      body: init.body as BodyInit | null | undefined,
      signal: withTimeout(init.timeoutMs ?? 120_000, init.signal),
    });
  } catch (err) {
    throw new ProviderError(provider, `request to ${new URL(url).host} failed: ${(err as Error).message}`, 'Check your network connection.', { cause: err });
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 800);
    const hint =
      res.status === 401
        ? 'The access token is invalid or expired: run "video-agent auth <platform>" again.'
        : res.status === 403
          ? 'Missing permission/scope or app not approved for this action.'
          : res.status === 429
            ? 'Rate limit reached; retry later.'
            : undefined;
    throw new ProviderError(provider, `HTTP ${res.status} ${url.split('?')[0]}: ${text}`, hint);
  }
  return res;
};

export const requestJson = async <T>(provider: string, url: string, init: RawRequest = {}): Promise<T> => {
  const res = await request(provider, url, init);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
};

export const jsonBody = (data: unknown) => ({ headers: { 'content-type': 'application/json; charset=UTF-8' }, body: JSON.stringify(data) });

export const formBody = (data: Record<string, string | number | boolean | undefined>) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) if (v !== undefined) params.set(k, String(v));
  return { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() };
};

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

/** Poll `fn` until it returns a value (not undefined), with a timeout. */
export const poll = async <T>(fn: () => Promise<T | undefined>, opts: { intervalMs: number; timeoutMs: number; signal?: AbortSignal; what: string; provider: string }): Promise<T> => {
  const deadline = Date.now() + opts.timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new ProviderError(opts.provider, `timed out waiting for ${opts.what}`);
    await sleep(opts.intervalMs, opts.signal);
  }
};
