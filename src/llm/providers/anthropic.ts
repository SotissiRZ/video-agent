import Anthropic from '@anthropic-ai/sdk';
import { ProviderError } from '../../core/errors';
import type { LLMProvider, LLMRequest, LLMResponse } from '../types';

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  timeoutMs: number;
}

/** Models that accept the server-side refusal fallback ("fallbacks": "default"). */
const SUPPORTS_FALLBACKS = /^claude-(opus-5|opus-5-5|fable-5|fable-5-1|sonnet-5-5)$/;
/** Models that accept output_config.effort. */
const SUPPORTS_EFFORT = /^claude-(opus|fable|sonnet-5|mythos)/;

/** Claude, through the official Anthropic SDK. */
export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicOptions) {
    this.model = options.model;
    this.client = new Anthropic({ apiKey: options.apiKey, timeout: options.timeoutMs, maxRetries: 2 });
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const outputConfig: Record<string, unknown> = {};
    if (SUPPORTS_EFFORT.test(this.model)) outputConfig.effort = this.options.effort;
    if (request.json) outputConfig.format = { type: 'json_schema', schema: request.json.schema };
    const fallbacks = SUPPORTS_FALLBACKS.test(this.model);

    const params = {
      model: this.model,
      max_tokens: request.maxTokens ?? 16000,
      ...(request.system ? { system: request.system } : {}),
      messages: request.messages.map(({ role, content, images }) =>
        images?.length
          ? { role, content: [...images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })), { type: 'text', text: content }] }
          : { role, content },
      ),
      ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
      // Re-route automatically if a safety classifier declines the request.
      ...(fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    };

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = (await this.client.beta.messages.create(
        params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming,
        { signal: request.signal },
      )) as Anthropic.Beta.BetaMessage;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new ProviderError(this.id, 'authentication failed', 'Check ANTHROPIC_API_KEY.', { cause: err });
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new ProviderError(this.id, 'rate limited', 'Retry later or lower usage.', { cause: err });
      }
      if (err instanceof Anthropic.APIError) {
        throw new ProviderError(this.id, `API error ${err.status ?? ''}: ${err.message}`, undefined, { cause: err });
      }
      throw new ProviderError(this.id, (err as Error).message, 'Check your network connection.', { cause: err });
    }

    if (message.stop_reason === 'refusal') {
      throw new ProviderError(this.id, 'the model declined this request', 'Rephrase the brief or use another provider.');
    }
    const text = message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();
    if (!text) throw new ProviderError(this.id, `empty response (stop_reason: ${message.stop_reason})`);
    return { text, provider: this.id, model: message.model ?? this.model };
  }
}
