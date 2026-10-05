/** Shared client for Replicate predictions (images and video models). */
import { ProviderError } from '../core/errors';
import { httpBuffer, httpJson, sleep } from './http';

interface Prediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: unknown;
  error?: string | null;
  urls?: { get?: string };
}

export const runReplicate = async (
  token: string,
  model: string,
  input: Record<string, unknown>,
  opts: { timeoutMs: number; signal?: AbortSignal; provider: string },
): Promise<string> => {
  const [owner, nameAndVersion] = model.split('/');
  if (!owner || !nameAndVersion) throw new ProviderError(opts.provider, `invalid Replicate model "${model}" (expected owner/name or owner/name:version)`);
  const [name, version] = nameAndVersion.split(':');
  const headers = { authorization: `Bearer ${token}`, prefer: 'wait=60' };
  let prediction = version
    ? await httpJson<Prediction>('https://api.replicate.com/v1/predictions', { provider: opts.provider, headers, body: { version, input }, signal: opts.signal, timeoutMs: 90_000 })
    : await httpJson<Prediction>(`https://api.replicate.com/v1/models/${owner}/${name}/predictions`, { provider: opts.provider, headers, body: { input }, signal: opts.signal, timeoutMs: 90_000 });

  const deadline = Date.now() + opts.timeoutMs;
  while (prediction.status === 'starting' || prediction.status === 'processing') {
    if (Date.now() > deadline) throw new ProviderError(opts.provider, `prediction ${prediction.id} timed out`);
    await sleep(3000, opts.signal);
    prediction = await httpJson<Prediction>(prediction.urls?.get ?? `https://api.replicate.com/v1/predictions/${prediction.id}`, {
      provider: opts.provider,
      headers: { authorization: `Bearer ${token}` },
      signal: opts.signal,
    });
  }
  if (prediction.status !== 'succeeded') throw new ProviderError(opts.provider, `prediction ${prediction.status}: ${prediction.error ?? 'unknown error'}`);
  const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (typeof output !== 'string') throw new ProviderError(opts.provider, 'unexpected prediction output');
  return output;
};

export const downloadTo = async (url: string, provider: string, signal?: AbortSignal): Promise<Buffer> =>
  httpBuffer(url, { provider, signal, timeoutMs: 300_000 });
