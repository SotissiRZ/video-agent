/**
 * Captions, titles and hashtags for each platform — written by the LLM when available,
 * otherwise generated from the concept. Saved as captions.json in the job (editable).
 */
import { getLanguage } from '../core/languages';
import { z } from 'zod';
import type { VideoBrief, VideoConcept } from '../core/types';
import { errorMessage, summarizeError } from '../core/errors';
import { generateJson } from '../llm/json';
import type { LLMProvider } from '../llm/types';
import type { MediaCredit } from '../media/director';
import { normalize } from '../prompt/parser';
import { PLATFORM_CONSTRAINTS } from './constraints';
import { PLATFORM_IDS, type Captions, type PlatformId, type PostContent } from './types';

const toHashtag = (s: string): string => {
  const words = normalize(s)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  // Keep the original capitalisation of proper nouns when possible ("Burkina Faso" → BurkinaFaso).
  const original = s.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const camel = original.length === words.length ? original.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') : words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return `#${camel.normalize('NFD').replace(/[̀-ͯ]/g, '')}`;
};

const PLATFORM_TAGS: Partial<Record<PlatformId, string[]>> = {
  tiktok: ['#fyp'],
  instagram: ['#reels'],
};

const TEMPLATE_TAGS: Record<string, { fr: string[]; en: string[] }> = {
  advertisement: { fr: ['#nouveau'], en: ['#new'] },
  'product-presentation': { fr: ['#innovation'], en: ['#innovation'] },
  tutorial: { fr: ['#tuto', '#astuce'], en: ['#tutorial', '#howto'] },
  announcement: { fr: ['#annonce'], en: ['#announcement'] },
  'social-media': { fr: [], en: [] },
  'app-demo': { fr: ['#application', '#tech'], en: ['#app', '#tech'] },
  storytelling: { fr: ['#histoire', '#inspiration'], en: ['#story', '#inspiration'] },
};

const HASHTAG_COUNT: Record<PlatformId, number> = { tiktok: 5, instagram: 8, facebook: 3, youtube: 3, linkedin: 4 };

export const formatCredits = (credits: MediaCredit[], language: string): string => {
  if (!credits.length) return '';
  const unique = [...new Map(credits.map((c) => [`${c.provider}:${c.author}`, c])).values()];
  const label = language === 'fr' ? 'Images et vidéos' : 'Photos and videos';
  return `${label} : ${unique.map((c) => `${c.author} (${c.provider})`).join(', ')}`;
};

export interface CaptionContext {
  brief: VideoBrief;
  concept: VideoConcept;
  durationSec: number;
  credits: MediaCredit[];
  includeCredits: boolean;
}

/** Deterministic captions (no LLM). */
export const proceduralCaptions = (ctx: CaptionContext, platforms: readonly PlatformId[] = PLATFORM_IDS): Captions => {
  const { brief, concept } = ctx;
  const fr = brief.language === 'fr';
  const baseTags = [brief.brand, brief.location, brief.audience].filter(Boolean).map(toHashtag).filter(Boolean);
  const templateTags = TEMPLATE_TAGS[brief.templateId]?.[fr ? 'fr' : 'en'] ?? [];
  const isShort = brief.height > brief.width && ctx.durationSec <= 180;
  const credits = ctx.includeCredits ? formatCredits(ctx.credits, brief.language) : '';
  const out: Captions = {};
  for (const platform of platforms) {
    const limits = PLATFORM_CONSTRAINTS[platform];
    const tags = [...new Set([...(platform === 'youtube' && isShort ? ['#Shorts'] : []), ...baseTags, ...templateTags, ...(PLATFORM_TAGS[platform] ?? [])])].slice(0, Math.min(HASHTAG_COUNT[platform], limits.maxHashtags));
    const lines: string[] = [];
    if (platform === 'linkedin') {
      lines.push(concept.idea, '', concept.keyMessage, '', `👉 ${concept.callToAction}`);
    } else if (platform === 'youtube') {
      lines.push(concept.keyMessage, '', concept.idea, '', `👉 ${concept.callToAction}`);
    } else {
      lines.push(`${concept.keyMessage}`, `👉 ${concept.callToAction}`);
    }
    if (credits && (platform === 'youtube' || platform === 'facebook' || platform === 'linkedin')) lines.push('', credits);
    const title = (platform === 'youtube' && isShort ? `${concept.title} #Shorts` : concept.title).slice(0, limits.maxTitle ?? 100);
    out[platform] = { title, caption: lines.join('\n').trim(), hashtags: tags };
  }
  return out;
};

const PostSchema = z.object({ title: z.string(), caption: z.string(), hashtags: z.array(z.string()) });

/** LLM-written captions adapted to each platform's tone; falls back to procedural captions. */
export const generateCaptions = async (ctx: CaptionContext, platforms: readonly PlatformId[], llm: LLMProvider | null, warnings: string[] = [], signal?: AbortSignal): Promise<{ captions: Captions; source: string }> => {
  const fallback = proceduralCaptions(ctx, platforms);
  if (!llm) return { captions: fallback, source: 'procedural' };
  const schema = z.object(Object.fromEntries(platforms.map((p) => [p, PostSchema])) as Record<PlatformId, typeof PostSchema>);
  const jsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [...platforms],
    properties: Object.fromEntries(
      platforms.map((p) => [p, { type: 'object', additionalProperties: false, required: ['title', 'caption', 'hashtags'], properties: { title: { type: 'string' }, caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } } } }]),
    ),
  };
  const rules = platforms
    .map((p) => {
      const c = PLATFORM_CONSTRAINTS[p];
      return `- ${p}: caption max ${c.maxCaption - 200} characters, ${HASHTAG_COUNT[p]} hashtags${c.maxTitle ? `, title max ${c.maxTitle} characters` : ''}`;
    })
    .join('\n');
  try {
    const result = await generateJson(
      llm,
      {
        signal,
        maxTokens: 6000,
        json: { name: 'social_captions', schema: jsonSchema },
        system: 'You are a social media manager. You write native, engaging posts for each platform. Never invent facts, prices, dates or links that are not in the brief. Reply with JSON only.',
        messages: [
          {
            role: 'user',
            content: `Write the post that accompanies this video on each platform, in ${brief(ctx)}.

Brief: "${ctx.brief.prompt}"
Concept: ${JSON.stringify(ctx.concept)}
Video: ${ctx.durationSec.toFixed(0)}s, ${ctx.brief.width}x${ctx.brief.height}.

Tone per platform: TikTok and Instagram short, punchy, emojis welcome; Facebook friendly; YouTube a searchable title and a useful description; LinkedIn professional, value-oriented, 2-4 short paragraphs.
Limits:
${rules}
Hashtags: no spaces, start with #, relevant (brand, place, topic). Put them only in "hashtags", not in "caption".
Return {${platforms.map((p) => `"${p}": {"title","caption","hashtags"}`).join(', ')}}.`,
          },
        ],
      },
      schema,
    );
    const credits = ctx.includeCredits ? formatCredits(ctx.credits, ctx.brief.language) : '';
    const captions: Captions = {};
    for (const p of platforms) {
      const c = result[p];
      const limits = PLATFORM_CONSTRAINTS[p];
      const caption = credits && (p === 'youtube' || p === 'facebook' || p === 'linkedin') ? `${c.caption.trim()}\n\n${credits}` : c.caption.trim();
      captions[p] = {
        title: c.title.trim().slice(0, limits.maxTitle ?? 100) || fallback[p]!.title,
        caption,
        hashtags: c.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, '')).slice(0, limits.maxHashtags),
      };
    }
    return { captions, source: `${llm.id}:${llm.model}` };
  } catch (err) {
    if (signal?.aborted) throw err;
    warnings.push(`LLM captions failed, using procedural captions: ${summarizeError(errorMessage(err))}`);
    return { captions: fallback, source: 'procedural' };
  }
};

const brief = (ctx: CaptionContext) => {
  const base = ctx.brief.language === 'fr' ? 'French' : 'English';
  const local = ctx.brief.locale && ctx.brief.locale !== ctx.brief.language ? getLanguage(ctx.brief.locale)?.name : undefined;
  // Local-language videos: the post is in that language, with a short line in the base language for reach.
  return local ? `${local} (end the caption with one short sentence in ${base})` : base;
};

export type { PostContent };
