import type { AppConfig } from '../config/config';
import { ConfigError } from '../core/errors';
import { getLanguage } from '../core/languages';
import { normalizeResolution, resolveFormat } from '../core/formats';
import type { ParsedPrompt, VideoBrief, VideoOptions } from '../core/types';
import { DEFAULT_STYLE_ID, STYLES } from '../remotion/contract/styles';
import { selectTemplate } from '../templates/selector';

export const WHATSAPP_STATUS_MAX_SEC = 60;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Merge, in order of priority: explicit options > what the prompt says > template defaults > configuration.
 */
export const buildBrief = (parsed: ParsedPrompt, options: VideoOptions, config: AppConfig): { brief: VideoBrief; notes: string[] } => {
  const notes: string[] = [];
  const { env } = config;
  const { template, reason } = selectTemplate(parsed.raw, options.template);
  notes.push(`template "${template.id}" (${reason})`);

  // Format / resolution
  let resolution = options.width && options.height ? { id: 'custom', width: options.width, height: options.height } : undefined;
  if (!resolution && options.format) {
    resolution = resolveFormat(options.format);
    if (!resolution) throw new ConfigError(`Unknown format "${options.format}"`, 'Use landscape, vertical, square, portrait or WIDTHxHEIGHT (e.g. 1920x1080).');
  }
  resolution ??= parsed.format ?? resolveFormat(template.defaultFormat) ?? resolveFormat(env.VIDEO_AGENT_DEFAULT_FORMAT) ?? resolveFormat('landscape')!;
  const { width, height } = normalizeResolution(resolution);

  // WhatsApp Status plays videos of up to 60 seconds.
  const whatsapp = parsed.platform === 'whatsapp' || /^(whatsapp|statut|status)$/i.test(options.format ?? '');
  const maxSec = Math.min(600, options.maxDurationSec ?? 600, whatsapp ? WHATSAPP_STATUS_MAX_SEC : 600);
  const wanted = Math.round(options.durationSec ?? parsed.durationSec ?? env.VIDEO_AGENT_DEFAULT_DURATION ?? template.defaultDurationSec);
  if (whatsapp && wanted > maxSec) notes.push(`WhatsApp Status: duration limited to ${maxSec} s`);
  const durationSec = clamp(wanted, 3, maxSec);
  const fps = clamp(Math.round(options.fps ?? parsed.fps ?? env.VIDEO_AGENT_DEFAULT_FPS), 1, 120);

  // Style
  let styleId = options.style && options.style !== 'auto' ? options.style : undefined;
  if (styleId && !STYLES[styleId]) throw new ConfigError(`Unknown style "${styleId}"`, `Available: ${Object.keys(STYLES).join(', ')}`);
  styleId ??= parsed.styleHints[0] ?? template.defaultStyle ?? DEFAULT_STYLE_ID;

  const configuredLanguage = env.VIDEO_AGENT_LANGUAGE === 'auto' ? undefined : env.VIDEO_AGENT_LANGUAGE;
  const requested = (options.language && options.language !== 'auto' ? options.language : undefined) ?? parsed.locale ?? configuredLanguage ?? parsed.language;
  const info = getLanguage(requested);
  if (!info) notes.push(`unknown language "${requested}"; using ${parsed.language}`);
  const locale = info?.code ?? parsed.language;
  // The offline copywriter and captions use French or English; the LLM writes in the requested language.
  const base = info?.base ?? parsed.language;
  if (locale !== base) notes.push(`language ${info!.name}: written by the LLM`);

  const brief: VideoBrief = {
    prompt: parsed.raw,
    language: base,
    locale,
    durationSec,
    fps,
    width,
    height,
    formatId: resolution.id,
    outputFormat: options.outputFormat ?? env.VIDEO_AGENT_DEFAULT_OUTPUT_FORMAT,
    templateId: template.id,
    styleId,
    brand: parsed.brand ?? '',
    audience: parsed.audience ?? '',
    location: parsed.location ?? '',
    locationPhrase: parsed.locationPhrase ?? '',
    topic: parsed.topic,
    keywords: parsed.keywords,
    voice: options.voice ?? parsed.wantsVoice ?? true,
    music: options.music ?? parsed.wantsMusic ?? env.VIDEO_AGENT_MUSIC !== 'none',
    subtitles: options.subtitles ?? parsed.wantsSubtitles ?? env.VIDEO_AGENT_SUBTITLES,
    badge: options.badge,
    parsed,
  };
  return { brief, notes };
};
