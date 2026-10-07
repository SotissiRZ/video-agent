/** Provider-agnostic LLM interface. */
export interface LLMImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Base64-encoded bytes. */
  data: string;
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Pictures shown to the model with this message (vision-capable models only). */
  images?: LLMImage[];
}

export interface LLMRequest {
  system?: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Ask for a JSON object. Providers that support it enforce the schema natively. */
  json?: { name: string; schema: Record<string, unknown> };
  signal?: AbortSignal;
}

export interface LLMResponse {
  text: string;
  provider: string;
  model: string;
  /** Billed tokens, when the provider reports them (cost tracking). */
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  /** Stable id: "anthropic", "openai", "groq", "openai-compatible"... */
  readonly id: string;
  readonly model: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
}
