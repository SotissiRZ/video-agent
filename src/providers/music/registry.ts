import type { AppConfig } from '../../config/config';
import { ConfigError } from '../../core/errors';
import { ElevenLabsMusicProvider } from './elevenlabs';
import { ReplicateMusicProvider } from './replicate';
import { StabilityMusicProvider } from './stability';
import type { MusicProvider } from './types';

const factories: Record<string, (config: AppConfig) => MusicProvider | null> = {
  elevenlabs: ({ env }) => (env.ELEVENLABS_API_KEY ? new ElevenLabsMusicProvider({ apiKey: env.ELEVENLABS_API_KEY }) : null),
  stability: ({ env }) => (env.STABILITY_API_KEY ? new StabilityMusicProvider({ apiKey: env.STABILITY_API_KEY }) : null),
  replicate: ({ env }) => (env.REPLICATE_API_TOKEN ? new ReplicateMusicProvider({ token: env.REPLICATE_API_TOKEN, model: env.REPLICATE_MUSIC_MODEL }) : null),
};

/** "auto": the first provider with a key, best quality first. */
const AUTO_ORDER = ['elevenlabs', 'stability', 'replicate'];

/** AI music provider, or null when disabled (VIDEO_AGENT_MUSIC_PROVIDER=none, the default: generation is billed). */
export const resolveMusicProvider = (config: AppConfig): MusicProvider | null => {
  const id = config.env.VIDEO_AGENT_MUSIC_PROVIDER;
  if (id === 'none') return null;
  if (id === 'auto') {
    for (const candidate of AUTO_ORDER) {
      const p = factories[candidate]!(config);
      if (p) return p;
    }
    return null;
  }
  const provider = factories[id]?.(config);
  if (!provider) throw new ConfigError(`Music provider "${id}" is not available`, 'Set its API key in .env.');
  return provider;
};
