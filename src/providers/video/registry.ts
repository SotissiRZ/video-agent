import type { AppConfig } from '../../config/config';
import { ConfigError } from '../../core/errors';
import { OpenRouterVideoProvider } from './openrouter';
import { ReplicateVideoProvider } from './replicate';
import type { VideoProvider } from './types';

type Factory = (config: AppConfig) => VideoProvider | null;
const factories = new Map<string, Factory>();
export const registerVideoProvider = (id: string, factory: Factory) => factories.set(id, factory);

registerVideoProvider('replicate', ({ env }) =>
  env.REPLICATE_API_TOKEN ? new ReplicateVideoProvider({ token: env.REPLICATE_API_TOKEN, model: env.REPLICATE_VIDEO_MODEL }) : null,
);

/** The OpenRouter key: its own, else the OpenAI-compatible LLM key when that one is an OpenRouter key. */
export const openRouterKey = (env: AppConfig['env']): string | undefined =>
  env.OPENROUTER_API_KEY || (env.OPENAI_COMPATIBLE_BASE_URL?.includes('openrouter.ai') ? env.OPENAI_COMPATIBLE_API_KEY : undefined) || undefined;

registerVideoProvider('openrouter', ({ env }) => {
  const apiKey = openRouterKey(env);
  return apiKey ? new OpenRouterVideoProvider({ apiKey, model: env.OPENROUTER_VIDEO_MODEL, resolution: env.OPENROUTER_VIDEO_RESOLUTION }) : null;
});

export const resolveVideoProvider = (config: AppConfig, requested?: string): VideoProvider | null => {
  const id = requested ?? config.env.VIDEO_AGENT_VIDEO_PROVIDER;
  if (id === 'none') return null;
  // auto: the first configured provider, none when no key is set (never an error).
  if (id === 'auto') {
    for (const factory of factories.values()) {
      const provider = factory(config);
      if (provider) return provider;
    }
    return null;
  }
  const factory = factories.get(id);
  if (!factory) throw new ConfigError(`Unknown video provider "${id}"`, `Available: none, ${[...factories.keys()].join(', ')}`);
  const provider = factory(config);
  if (!provider) throw new ConfigError(`Video provider "${id}" is not configured`, id === 'openrouter' ? 'Set OPENROUTER_API_KEY in .env.' : 'Set REPLICATE_API_TOKEN in .env.');
  return provider;
};

export const listVideoProviders = () => [...factories.keys()];
