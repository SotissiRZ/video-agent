import type { AppConfig } from '../../config/config';
import { ConfigError } from '../../core/errors';
import { OpenAIImageProvider } from './openai';
import { ReplicateImageProvider } from './replicate';
import { StabilityImageProvider } from './stability';
import type { ImageProvider } from './types';

type Factory = (config: AppConfig) => ImageProvider | null;
const factories = new Map<string, Factory>();
export const registerImageProvider = (id: string, factory: Factory) => factories.set(id, factory);

registerImageProvider('openai', ({ env }) =>
  env.OPENAI_API_KEY ? new OpenAIImageProvider({ apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL, model: env.OPENAI_IMAGE_MODEL }) : null,
);
registerImageProvider('replicate', ({ env }) =>
  env.REPLICATE_API_TOKEN ? new ReplicateImageProvider({ token: env.REPLICATE_API_TOKEN, model: env.REPLICATE_IMAGE_MODEL }) : null,
);

registerImageProvider('stability', ({ env }) =>
  env.STABILITY_API_KEY ? new StabilityImageProvider({ apiKey: env.STABILITY_API_KEY, model: env.STABILITY_MODEL }) : null,
);

/** "auto": first configured, cheapest first. */
const AUTO_ORDER = ['replicate', 'stability', 'openai'];

export const resolveImageProvider = (config: AppConfig, requested?: string): ImageProvider | null => {
  const id = requested ?? config.env.VIDEO_AGENT_IMAGE_PROVIDER;
  if (id === 'none') return null;
  if (id === 'auto') {
    for (const candidate of AUTO_ORDER) {
      const p = factories.get(candidate)?.(config);
      if (p) return p;
    }
    return null;
  }
  const factory = factories.get(id);
  if (!factory) throw new ConfigError(`Unknown image provider "${id}"`, `Available: auto, none, ${[...factories.keys()].join(', ')}`);
  const provider = factory(config);
  if (!provider) throw new ConfigError(`Image provider "${id}" is not configured`, 'Set its API key in .env.');
  return provider;
};

export const listImageProviders = () => [...factories.keys()];
