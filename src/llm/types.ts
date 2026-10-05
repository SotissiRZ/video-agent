/** Provider-agnostic LLM interface. */
export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
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
}

export interface LLMProvider {
  /** Stable id: "anthropic", "openai", "groq", "openai-compatible"... */
  readonly id: string;
  readonly model: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
}
