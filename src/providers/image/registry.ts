import type { AppConfig } from '../../config/config';
import { ConfigError } from '../../core/errors';
import { OpenAIImageProvider } from './openai';
import { ReplicateImageProvider } from './replicate';
import { StabilityImageProvider } from './stability';
import { CloudflareImageProvider } from './cloudflare';
import { HuggingFaceImageProvider } from './huggingface';
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

registerImageProvider('cloudflare', ({ env }) =>
  env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN ? new CloudflareImageProvider({ accountId: env.CLOUDFLARE_ACCOUNT_ID, apiToken: env.CLOUDFLARE_API_TOKEN, model: env.CLOUDFLARE_IMAGE_MODEL }) : null,
);
registerImageProvider('huggingface', ({ env }) => (env.HF_TOKEN ? new HuggingFaceImageProvider({ token: env.HF_TOKEN, model: env.HF_IMAGE_MODEL }) : null));

/** "auto": first configured — free tiers first, then paid ones from cheapest. */
export const IMAGE_AUTO_ORDER = ['cloudflare', 'huggingface', 'replicate', 'stability', 'openai'];

export const resolveImageProvider = (config: AppConfig, requested?: string): ImageProvider | null => {
  const id = requested ?? config.env.VIDEO_AGENT_IMAGE_PROVIDER;
  if (id === 'none') return null;
  if (id === 'auto') {
    const chain = IMAGE_AUTO_ORDER.map((candidate) => factories.get(candidate)?.(config)).filter((p): p is ImageProvider => Boolean(p));
    if (chain.length <= 1) return chain[0] ?? null;
    return new FallbackImageProvider(chain);
  }
  const factory = factories.get(id);
  if (!factory) throw new ConfigError(`Unknown image provider "${id}"`, `Available: auto, none, ${[...factories.keys()].join(', ')}`);
  const provider = factory(config);
  if (!provider) throw new ConfigError(`Image provider "${id}" is not configured`, 'Set its API key in .env.');
  return provider;
};

export const listImageProviders = () => [...factories.keys()];

/**
 * "auto" with several configured services: the next one takes over when one fails (wrong account id,
 * free quota used up). A service that failed is skipped for the rest of the video.
 */
export class FallbackImageProvider implements ImageProvider {
  private readonly failed = new Set<string>();

  constructor(private readonly providers: ImageProvider[]) {}

  get id(): string {
    return this.providers.find((p) => !this.failed.has(p.id))?.id ?? this.providers[0]!.id;
  }

  async generate(request: Parameters<ImageProvider['generate']>[0]): Promise<{ file: string }> {
    const errors: string[] = [];
    for (const provider of this.providers) {
      if (this.failed.has(provider.id)) continue;
      try {
        return await provider.generate(request);
      } catch (err) {
        if (request.signal?.aborted) throw err;
        this.failed.add(provider.id);
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    throw new Error(errors.join(' | ') || 'no image service left');
  }
}
