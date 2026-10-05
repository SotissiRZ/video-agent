import type { AppConfig } from '../../config/config';
import { ConfigError } from '../../core/errors';
import { ElevenLabsVoiceProvider } from './elevenlabs';
import { OpenAIVoiceProvider } from './openai';
import { detectSystemEngine, SystemVoiceProvider } from './system';
import type { VoiceProvider } from './types';

type Factory = (config: AppConfig) => VoiceProvider | null;
const factories = new Map<string, Factory>();

export const registerVoiceProvider = (id: string, factory: Factory) => factories.set(id, factory);

registerVoiceProvider('elevenlabs', ({ env }) =>
  env.ELEVENLABS_API_KEY ? new ElevenLabsVoiceProvider({ apiKey: env.ELEVENLABS_API_KEY, voiceId: env.ELEVENLABS_VOICE_ID, model: env.ELEVENLABS_MODEL }) : null,
);
registerVoiceProvider('openai', ({ env }) =>
  env.OPENAI_API_KEY ? new OpenAIVoiceProvider({ apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL, model: env.OPENAI_TTS_MODEL, voice: env.OPENAI_TTS_VOICE }) : null,
);
registerVoiceProvider('system', ({ env }) => {
  const engine = detectSystemEngine();
  return engine ? new SystemVoiceProvider(engine, env.VIDEO_AGENT_SYSTEM_VOICE) : null;
});

/** "auto" only considers cloud voices (system voices are robotic; opt in explicitly). */
const AUTO_ORDER = ['elevenlabs', 'openai'];

export const resolveVoiceProvider = (config: AppConfig, requested?: string): VoiceProvider | null => {
  const id = requested ?? config.env.VIDEO_AGENT_VOICE_PROVIDER;
  if (id === 'none') return null;
  if (id === 'auto') {
    for (const candidate of AUTO_ORDER) {
      const p = factories.get(candidate)?.(config);
      if (p) return p;
    }
    return null;
  }
  const factory = factories.get(id);
  if (!factory) throw new ConfigError(`Unknown voice provider "${id}"`, `Available: auto, none, ${[...factories.keys()].join(', ')}`);
  const provider = factory(config);
  if (!provider) throw new ConfigError(`Voice provider "${id}" is not available`, id === 'system' ? 'Install espeak-ng (Linux); macOS and Windows have a built-in engine.' : 'Set its API key in .env.');
  return provider;
};

export const listVoiceProviders = () => [...factories.keys()];
