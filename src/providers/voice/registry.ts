import type { AppConfig } from '../../config/config';
import { ConfigError } from '../../core/errors';
import { ElevenLabsVoiceProvider } from './elevenlabs';
import { OpenAIVoiceProvider } from './openai';
import path from 'node:path';
import { findPiperBinary, PiperVoiceProvider } from './piper';
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

const piperDataDir = (config: AppConfig) => path.resolve(config.paths.root, config.env.PIPER_DATA_DIR);

registerVoiceProvider('piper', (config) => {
  const { env } = config;
  // Explicitly requested: may download Piper on first use. In "auto" only if already installed.
  return new PiperVoiceProvider({
    dataDir: piperDataDir(config),
    binary: env.PIPER_BINARY,
    voices: { fr: env.PIPER_VOICE_FR, en: env.PIPER_VOICE_EN },
    lengthScale: env.PIPER_LENGTH_SCALE,
    autoDownload: env.PIPER_AUTO_DOWNLOAD,
  });
});

/** Piper is used by "auto" when it is installed (always the case in the Docker image). */
export const isPiperInstalled = (config: AppConfig): boolean => Boolean(findPiperBinary(piperDataDir(config), config.env.PIPER_BINARY));

/** "auto": cloud voices first, then free Piper if installed. System voices are robotic: opt in explicitly. */
const AUTO_ORDER = ['elevenlabs', 'openai', 'piper'];

export const resolveVoiceProvider = (config: AppConfig, requested?: string): VoiceProvider | null => {
  const id = requested ?? config.env.VIDEO_AGENT_VOICE_PROVIDER;
  if (id === 'none') return null;
  if (id === 'auto') {
    for (const candidate of AUTO_ORDER) {
      if (candidate === 'piper' && !isPiperInstalled(config)) continue;
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
