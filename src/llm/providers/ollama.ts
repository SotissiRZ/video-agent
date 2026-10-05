/**
 * Ollama: free LLM running locally (or in the "ollama" Docker service).
 * Uses Ollama's OpenAI-compatible endpoint and pulls the model automatically on first use.
 */
import { ProviderError } from '../../core/errors';
import { httpJson } from '../../providers/http';
import type { LLMProvider, LLMRequest, LLMResponse } from '../types';
import { OpenAICompatibleProvider } from './openai-compatible';

export interface OllamaOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  temperature: number;
}

export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly model: string;
  private readonly inner: OpenAICompatibleProvider;
  private ready: Promise<void> | null = null;

  constructor(private readonly o: OllamaOptions) {
    this.model = o.model;
    this.inner = new OpenAICompatibleProvider({ id: 'ollama', baseUrl: `${this.root}/v1`, model: o.model, timeoutMs: o.timeoutMs, temperature: o.temperature });
  }

  private get root(): string {
    return this.o.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  /** Download the model once if it is not installed yet (can take a few minutes). */
  ensureModel(signal?: AbortSignal): Promise<void> {
    this.ready ??= (async () => {
      let tags: { models?: Array<{ name: string; model?: string }> };
      try {
        tags = await httpJson(`${this.root}/api/tags`, { provider: this.id, timeoutMs: 10_000, signal });
      } catch (err) {
        throw new ProviderError(this.id, `Ollama is not reachable at ${this.root}`, 'Start it: "docker compose --profile ollama up -d" or install Ollama (https://ollama.com).', { cause: err });
      }
      const wanted = this.model.includes(':') ? this.model : `${this.model}:latest`;
      if ((tags.models ?? []).some((m) => m.name === wanted || m.model === wanted || m.name === this.model)) return;
      await httpJson(`${this.root}/api/pull`, { provider: this.id, body: { model: this.model, stream: false }, timeoutMs: 60 * 60_000, signal });
    })().catch((err) => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    await this.ensureModel(request.signal);
    return this.inner.generate(request);
  }
}
