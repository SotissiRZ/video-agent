import type { AppConfig } from '../../config/config';
import { ConfigError } from '../../core/errors';
import { ReplicateVideoProvider } from './replicate';
import type { VideoProvider } from './types';

type Factory = (config: AppConfig) => VideoProvider | null;
const factories = new Map<string, Factory>();
export const registerVideoProvider = (id: string, factory: Factory) => factories.set(id, factory);

registerVideoProvider('replicate', ({ env }) =>
  env.REPLICATE_API_TOKEN ? new ReplicateVideoProvider({ token: env.REPLICATE_API_TOKEN, model: env.REPLICATE_VIDEO_MODEL }) : null,
);

export const resolveVideoProvider = (config: AppConfig, requested?: string): VideoProvider | null => {
  const id = requested ?? config.env.VIDEO_AGENT_VIDEO_PROVIDER;
  if (id === 'none') return null;
  const factory = factories.get(id);
  if (!factory) throw new ConfigError(`Unknown video provider "${id}"`, `Available: none, ${[...factories.keys()].join(', ')}`);
  const provider = factory(config);
  if (!provider) throw new ConfigError(`Video provider "${id}" is not configured`, 'Set REPLICATE_API_TOKEN in .env.');
  return provider;
};

export const listVideoProviders = () => [...factories.keys()];
