import { ProviderError } from '../../core/errors';
import { httpJson } from '../../providers/http';
import type { LLMProvider, LLMRequest, LLMResponse } from '../types';

export interface OpenAICompatibleOptions {
  id: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  temperature: number;
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
}

/**
 * Any server speaking the OpenAI Chat Completions protocol:
 * OpenAI, Groq, OpenRouter, Mistral, Together, Ollama, LM Studio, vLLM...
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly model: string;
  private jsonModeSupported = true;

  constructor(private readonly options: OpenAICompatibleOptions) {
    this.id = options.id;
    this.model = options.model;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const messages = [
      ...(request.system ? [{ role: 'system', content: request.system }] : []),
      ...request.messages.map(({ role, content, images }) =>
        images?.length
          ? { role, content: [{ type: 'text', text: content }, ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } }))] }
          : { role, content },
      ),
    ];
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: request.temperature ?? this.options.temperature,
    };
    if (request.json && this.jsonModeSupported) body.response_format = { type: 'json_object' };

    let completion: ChatCompletion;
    try {
      completion = await this.call(body, request.signal);
    } catch (err) {
      // Some local servers reject response_format: retry once without it.
      if (body.response_format && err instanceof ProviderError && /HTTP 400/.test(err.message)) {
        this.jsonModeSupported = false;
        delete body.response_format;
        completion = await this.call(body, request.signal);
      } else {
        throw err;
      }
    }
    const choice = completion.choices?.[0];
    if (choice?.message?.refusal) throw new ProviderError(this.id, `refusal: ${choice.message.refusal}`);
    const text = choice?.message?.content?.trim();
    if (!text) throw new ProviderError(this.id, `empty response (finish_reason: ${choice?.finish_reason ?? 'unknown'})`);
    return { text, provider: this.id, model: completion.model ?? this.model };
  }

  private call(body: Record<string, unknown>, signal?: AbortSignal): Promise<ChatCompletion> {
    return httpJson<ChatCompletion>(`${this.options.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      provider: this.id,
      headers: this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {},
      body,
      timeoutMs: this.options.timeoutMs,
      signal,
    });
  }
}
