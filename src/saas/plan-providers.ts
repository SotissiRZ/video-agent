/** Services used for each plan: the admin trades quality against cost per plan (Settings › Commerce). */
import type { AppConfig } from '../config/config';
import { errorMessage } from '../core/errors';
import { FallbackLLM } from '../llm/fallback';
import { resolveLLM } from '../llm/registry';
import type { LLMProvider } from '../llm/types';
import { resolveMusicProvider } from '../providers/music/registry';
import { resolveVoiceProvider } from '../providers/voice/registry';
import type { PlanProviders } from './commerce';

type Env = AppConfig['env'];

/**
 * The configuration a generation of this plan runs with. A choice that cannot work on this server
 * (missing API key, Piper not installed) keeps the .env value instead, with a warning.
 */
export const planConfig = (config: AppConfig, providers: PlanProviders, warn: (message: string) => void = () => undefined): AppConfig => {
  const env: Env = { ...config.env };
  if (providers.claudeModel !== 'env') env.ANTHROPIC_MODEL = providers.claudeModel;
  if (providers.elevenLabsModel !== 'env') env.ELEVENLABS_MODEL = providers.elevenLabsModel;
  const attempt = (label: string, apply: (e: Env) => void, check: (c: AppConfig) => unknown) => {
    const candidate: Env = { ...env };
    apply(candidate);
    try {
      if (!check({ ...config, env: candidate })) throw new Error('not configured');
      Object.assign(env, candidate);
    } catch (err) {
      warn(`${label}: ${errorMessage(err)} — using the .env setting`);
    }
  };
  if (providers.voice !== 'env') {
    const voice = providers.voice;
    attempt(`voice "${voice}"`, (e) => (e.VIDEO_AGENT_VOICE_PROVIDER = voice), (c) => voice === 'none' || resolveVoiceProvider(c));
  }
  if (providers.music !== 'env') {
    const music = providers.music;
    attempt(`music "${music}"`, (e) => (e.VIDEO_AGENT_MUSIC_PROVIDER = music), (c) => music === 'none' || resolveMusicProvider(c));
  }
  return { ...config, env };
};

/**
 * The plan's LLM. A specific provider comes first and the other configured ones take over if it
 * fails (a free Groq key hits its rate limit quickly), so a generation never loses its writer.
 */
export const planLLM = (config: AppConfig, providers: PlanProviders, warn: (message: string) => void = () => undefined): LLMProvider | null => {
  const auto = (): LLMProvider | null => {
    try {
      return resolveLLM(config);
    } catch {
      return null;
    }
  };
  if (providers.llm === 'env') return auto();
  if (providers.llm === 'local') return null;
  if (providers.llm === 'auto') return resolveLLM(config, 'auto');
  let chosen: LLMProvider | null = null;
  try {
    chosen = resolveLLM(config, providers.llm);
  } catch (err) {
    warn(`LLM "${providers.llm}": ${errorMessage(err)} — using the .env setting`);
  }
  const fallback = resolveLLM(config, 'auto');
  if (!chosen) return fallback ?? auto();
  return fallback ? new FallbackLLM([chosen, fallback]) : chosen;
};
