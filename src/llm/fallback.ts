/**
 * "auto" mode with several configured LLMs: try them in order. A provider that fails for a
 * lasting reason (no credit, invalid key) is skipped for a while instead of failing every call.
 */
import { errorMessage } from '../core/errors';
import type { LLMProvider, LLMRequest, LLMResponse } from './types';

const COOL_DOWN_MS = 10 * 60_000;
const disabledUntil = new Map<string, number>();

/** Credit, quota or authentication problems will not fix themselves on the next call. */
export const isLastingFailure = (message: string): boolean =>
  /\b(401|402|403)\b|credit balance|insufficient[_ ]quota|billing|invalid[_ ]api[_ ]key|authentication|permission/i.test(message);

export class FallbackLLM implements LLMProvider {
  readonly id: string;
  readonly model: string;

  constructor(private readonly providers: LLMProvider[]) {
    this.id = providers[0]!.id;
    this.model = providers[0]!.model;
  }

  get chain(): string[] {
    return this.providers.map((p) => p.id);
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const errors: string[] = [];
    const now = Date.now();
    const usable = this.providers.filter((p) => (disabledUntil.get(p.id) ?? 0) <= now);
    for (const provider of usable.length ? usable : this.providers) {
      try {
        return await provider.generate(request);
      } catch (err) {
        if (request.signal?.aborted) throw err;
        const message = errorMessage(err);
        if (isLastingFailure(message)) disabledUntil.set(provider.id, Date.now() + COOL_DOWN_MS);
        errors.push(message);
      }
    }
    throw new Error(errors.join(' | '));
  }
}

/** Test helper. */
export const resetFallbackState = () => disabledUntil.clear();
