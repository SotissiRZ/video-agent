import type { AppConfig } from '../config/config';
import { ConfigError } from '../core/errors';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import type { LLMProvider } from './types';

export type LLMFactory = (config: AppConfig) => LLMProvider | null;

/**
 * LLM factories by id. Each returns null when its credentials are missing.
 * Add a provider: registerLLMProvider('mistral', (config) => ...).
 */
const factories = new Map<string, LLMFactory>();

export const registerLLMProvider = (id: string, factory: LLMFactory): void => {
  factories.set(id, factory);
};

registerLLMProvider('anthropic', ({ env }) =>
  env.ANTHROPIC_API_KEY
    ? new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL, effort: env.ANTHROPIC_EFFORT, timeoutMs: env.VIDEO_AGENT_LLM_TIMEOUT_MS })
    : null,
);
registerLLMProvider('openai', ({ env }) =>
  env.OPENAI_API_KEY
    ? new OpenAICompatibleProvider({ id: 'openai', baseUrl: env.OPENAI_BASE_URL, apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL, timeoutMs: env.VIDEO_AGENT_LLM_TIMEOUT_MS, temperature: env.VIDEO_AGENT_LLM_TEMPERATURE })
    : null,
);
registerLLMProvider('groq', ({ env }) =>
  env.GROQ_API_KEY
    ? new OpenAICompatibleProvider({ id: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL, timeoutMs: env.VIDEO_AGENT_LLM_TIMEOUT_MS, temperature: env.VIDEO_AGENT_LLM_TEMPERATURE })
    : null,
);
registerLLMProvider('openai-compatible', ({ env }) =>
  env.OPENAI_COMPATIBLE_BASE_URL && env.OPENAI_COMPATIBLE_MODEL
    ? new OpenAICompatibleProvider({ id: 'openai-compatible', baseUrl: env.OPENAI_COMPATIBLE_BASE_URL, apiKey: env.OPENAI_COMPATIBLE_API_KEY, model: env.OPENAI_COMPATIBLE_MODEL, timeoutMs: env.VIDEO_AGENT_LLM_TIMEOUT_MS, temperature: env.VIDEO_AGENT_LLM_TEMPERATURE })
    : null,
);

/** Order used by "auto". */
export const AUTO_ORDER = ['anthropic', 'openai', 'groq', 'openai-compatible'];

export const listLLMProviders = (): string[] => [...factories.keys()];

/**
 * Resolve the LLM to use. Returns null for "local" (procedural planning),
 * or for "auto" when nothing is configured.
 */
export const resolveLLM = (config: AppConfig, requested?: string): LLMProvider | null => {
  const id = requested ?? config.env.VIDEO_AGENT_LLM_PROVIDER;
  if (id === 'local' || id === 'none' || id === 'procedural') return null;
  if (id === 'auto') {
    for (const candidate of AUTO_ORDER) {
      const provider = factories.get(candidate)?.(config);
      if (provider) return provider;
    }
    return null;
  }
  const factory = factories.get(id);
  if (!factory) throw new ConfigError(`Unknown LLM provider "${id}"`, `Available: auto, local, ${listLLMProviders().join(', ')}`);
  const provider = factory(config);
  if (!provider) throw new ConfigError(`LLM provider "${id}" is not configured`, 'Set its API key in .env (see .env.example).');
  return provider;
};
