/** Small fetch helpers shared by all HTTP providers (no SDK dependency required). */
import { ProviderError } from '../core/errors';

export const withTimeout = (timeoutMs: number, signal?: AbortSignal): AbortSignal => {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
};

export interface HttpOptions {
  provider: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const request = async (url: string, opts: HttpOptions): Promise<Response> => {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: { ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: withTimeout(opts.timeoutMs ?? 120_000, opts.signal),
    });
  } catch (err) {
    throw new ProviderError(opts.provider, `request to ${new URL(url).host} failed: ${(err as Error).message}`, 'Check your network connection and the provider base URL.', { cause: err });
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 500);
    const hint =
      res.status === 401 || res.status === 403
        ? 'The API key is missing, invalid or lacks permissions.'
        : res.status === 429
          ? 'Rate limit or quota reached; retry later.'
          : undefined;
    throw new ProviderError(opts.provider, `HTTP ${res.status}: ${text}`, hint);
  }
  return res;
};

export const httpJson = async <T>(url: string, opts: HttpOptions): Promise<T> => (await request(url, opts)).json() as Promise<T>;

export const httpBuffer = async (url: string, opts: HttpOptions): Promise<Buffer> =>
  Buffer.from(await (await request(url, opts)).arrayBuffer());

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });
