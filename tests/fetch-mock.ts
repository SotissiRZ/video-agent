import { vi } from 'vitest';

export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (call: RecordedCall) => Response | Promise<Response>;

/** Minimal fetch router: first matching route wins. Records every call. */
export const mockFetch = (routes: Array<[method: string, pattern: RegExp, handler: Handler]>) => {
  const calls: RecordedCall[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers as HeadersInit | undefined).forEach((v, k) => (headers[k] = v));
    const call = { method, url, headers, body: init.body };
    calls.push(call);
    for (const [m, pattern, handler] of routes) if (m === method && pattern.test(url)) return handler(call);
    return new Response(`no route for ${method} ${url}`, { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return { calls, restore: () => vi.unstubAllGlobals() };
};

export const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), { status: 200, ...init, headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) } });
