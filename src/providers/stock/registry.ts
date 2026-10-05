import type { AppConfig } from '../../config/config';
import { ConfigError } from '../../core/errors';
import { PexelsProvider } from './pexels';
import { PixabayProvider } from './pixabay';
import type { StockProvider } from './types';
import { UnsplashProvider } from './unsplash';

type Factory = (config: AppConfig) => StockProvider | null;
const factories = new Map<string, Factory>();
export const registerStockProvider = (id: string, factory: Factory) => factories.set(id, factory);

registerStockProvider('pexels', ({ env }) => (env.PEXELS_API_KEY ? new PexelsProvider(env.PEXELS_API_KEY) : null));
registerStockProvider('pixabay', ({ env }) => (env.PIXABAY_API_KEY ? new PixabayProvider(env.PIXABAY_API_KEY) : null));
registerStockProvider('unsplash', ({ env }) => (env.UNSPLASH_ACCESS_KEY ? new UnsplashProvider(env.UNSPLASH_ACCESS_KEY) : null));

export const listStockProviders = () => [...factories.keys()];

/**
 * Configured stock libraries, in priority order.
 * "auto" = every library with a key (pexels, pixabay, unsplash); "none" = disabled.
 */
export const resolveStockProviders = (config: AppConfig): StockProvider[] => {
  const setting = config.env.VIDEO_AGENT_STOCK_PROVIDERS;
  if (setting === 'none') return [];
  const ids = setting === 'auto' ? listStockProviders() : setting.split(',').map((s) => s.trim()).filter(Boolean);
  const providers: StockProvider[] = [];
  for (const id of ids) {
    const factory = factories.get(id);
    if (!factory) throw new ConfigError(`Unknown stock provider "${id}"`, `Available: auto, none, ${listStockProviders().join(', ')}`);
    const provider = factory(config);
    if (provider) providers.push(provider);
    else if (setting !== 'auto') throw new ConfigError(`Stock provider "${id}" is not configured`, 'Set its API key in .env (PEXELS_API_KEY, PIXABAY_API_KEY or UNSPLASH_ACCESS_KEY).');
  }
  return providers;
};
