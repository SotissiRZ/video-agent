/**
 * AI director: the model reads the customer's whole request, the way a video editor would, and turns
 * it into a shooting plan (scenes in the customer's order, their texts word for word, the voice-over
 * scene by scene, what each scene must show and what to avoid). The rest of the pipeline renders that
 * plan. Production notes ("IMPORTANT…", "La vidéo doit…") are followed, never shown or read aloud.
 * The rule-based parsers stay as the fallback when no model is available.
 */
import { z } from 'zod';
import { getLanguage, LANGUAGE_CODES } from '../core/languages';
import type { PlannedScene, VideoBrief, VideoConcept } from '../core/types';
import { generateJson } from '../llm/json';
import type { LLMProvider } from '../llm/types';
import { SCENE_KINDS } from '../remotion/contract/storyboard';
import { STYLES } from '../remotion/contract/styles';

/** Tolerant reading: a list where a text is expected is joined, a number written as text is read. */
const text = (fallback = '') => z.preprocess((v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'number' ? String(v) : v ?? fallback), z.string()).catch(fallback);
const texts = () => z.preprocess((v) => (typeof v === 'string' ? v.split(/\s*[•,;]\s*/).filter(Boolean) : v ?? []), z.array(z.string())).catch([]);
const number = (fallback: number, min: number, max: number) => z.preprocess((v) => (typeof v === 'string' ? Number.parseFloat(v) : v), z.number().min(min).max(max)).catch(fallback);

const DirectionSceneSchema = z.object({
  role: text('scene'),
  kind: z.enum(SCENE_KINDS).catch('text'),
  seconds: number(5, 1, 120),
  headline: text(),
  subheadline: text(),
  body: text(),
  items: texts(),
  statValue: text(),
  statLabel: text(),
  narration: text(),
  /** What the scene must show, in the customer's terms (kept for corrections and logs). */
  visual: text(),
  /** Complete English stock searches, most specific first. */
  visualQueries: texts(),
  /** English prompt for an AI image when stock has nothing suitable. */
  visualPrompt: text(),
  productPhoto: z.preprocess((v) => (typeof v === 'string' ? Number.parseInt(v, 10) : v), z.number().int().min(0)).catch(0),
});

export const DirectionSchema = z.object({
  title: z.preprocess((v) => (Array.isArray(v) ? v.join(' ') : v), z.string().min(1).transform((t) => t.slice(0, 120))),
  idea: text(),
  tone: text(),
  keyMessage: text(),
  callToAction: text(),
  tagline: text(),
  /** Language code of the texts and voice-over ("fr", "en", "wo"…), "" when unclear. */
  language: text(),
  /** Duration the request asks for, 0 when it does not say. */
  durationSec: number(0, 0, 600),
  style: text(),
  brand: text(),
  audience: text(),
  location: text(),
  /** English subjects the pictures must not show ("robot", "alcohol"…). */
  avoid: texts(),
  scenes: z.array(DirectionSceneSchema).min(1).max(16),
});
export type Direction = z.infer<typeof DirectionSchema>;

const str = { type: 'string' } as const;
const strArray = { type: 'array', items: str } as const;
const DIRECTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'idea', 'tone', 'keyMessage', 'callToAction', 'tagline', 'language', 'durationSec', 'style', 'brand', 'audience', 'location', 'avoid', 'scenes'],
  properties: {
    title: str, idea: str, tone: str, keyMessage: str, callToAction: str, tagline: str, language: str,
    durationSec: { type: 'number' }, style: str, brand: str, audience: str, location: str, avoid: strArray,
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'kind', 'seconds', 'headline', 'subheadline', 'body', 'items', 'statValue', 'statLabel', 'narration', 'visual', 'visualQueries', 'visualPrompt', 'productPhoto'],
        properties: {
          role: str, kind: { type: 'string', enum: [...SCENE_KINDS] }, seconds: { type: 'number' }, headline: str, subheadline: str, body: str,
          items: strArray, statValue: str, statLabel: str, narration: str, visual: str, visualQueries: strArray, visualPrompt: str, productPhoto: { type: 'integer' },
        },
      },
    },
  },
};

const SYSTEM = `You are the director and editor of a video advertising studio for African small businesses and companies.
A customer describes the video they want. Read the WHOLE request carefully and turn it into a precise shooting plan that a
motion-design engine will render with stock photos/clips, AI images, animated text, a voice-over and music.

Follow the customer, not a template:
- If they wrote scenes, keep exactly their scenes, order and timings: seconds = end - start of each scene ("12–20 s" = 8).
  Their on-screen texts are copied WORD FOR WORD: the first text of a scene is the headline, the second is the body;
  a text with "•" separators becomes the items of a bullets scene. Never drop a text the customer wrote.
- If they wrote a voice-over, use their sentences word for word and split them across ALL the scenes, in order, giving each
  scene the sentences that talk about its topic (never put the whole voice-over in one scene).
- If they only described their need, design the best structure yourself (hook, problem or desire, solution, proof, call to action),
  about one scene every 4 to 6 seconds.
- Instructions about the result ("La vidéo doit…", "IMPORTANT", "Éviter…", "Aucun…", style, tone, quality requirements) are
  directions for you: apply them, NEVER put them in on-screen texts or in the narration.
- Everything the customer wants to avoid goes to "avoid" as English nouns a photo description would contain:
  "Éviter l'aspect science-fiction" → "science fiction", "futuristic", "hologram"; "plutôt qu'un robot" → "robot".
  Then never use those words in visualQueries.
- Never invent prices, phone numbers, addresses, statistics, dates or claims the customer did not give. Keep brand names exactly.

Each scene:
- kind: title (opening), text (headline + one sentence), bullets (headline + 3 to 6 short items), steps (numbered actions),
  stat (only with a number the customer gave), image (a strong visual with a caption), quote (a testimonial the customer gave),
  cta (closing call to action; its subheadline is the button label, 1 to 3 words).
- headline max 8 words (wrap 1 to 3 key words in *asterisks*), body one short sentence, items max 5 words each.
- narration: what the voice says during the scene, in the video's language, about 2.3 words per second of the scene.
  Leave it empty only if the customer asked for no voice-over.
- visual: what the scene must SHOW, concretely (people, place, objects, action), faithful to the customer's description.
- visualQueries: 2 to 4 complete English stock-photo searches of 3 to 6 words, most specific first, describing real,
  photographable things (e.g. "african developer coding laptop office", "analytics dashboard on laptop screen").
  Match the location and culture of the business (African people and places when the business is in Africa).
  Only things a photographer can shoot: never abstract words alone ("innovation", "success"), never brand names or logos,
  never "animation", "montage", "collage", "overlay", "illustration", "icons", never sci-fi or "futuristic" unless asked.
  For a closing montage, search the subjects of the previous scenes again.
- visualPrompt: one English sentence for an AI image of the same subject, realistic, no text in the image.
- productPhoto: number of the customer's product photo to show in this scene (1..N), 0 for none; show every photo at least once.

Video level: title, idea (one sentence), tone (2 to 4 adjectives), keyMessage, callToAction, tagline (max 6 words),
language (code of the language the customer wants the texts in), durationSec (what they asked, 0 if nothing),
style (one of the listed style ids, the closest to the customer's wishes; "" if none fits), brand, audience, location.
Reply with a single JSON object and nothing else.`;

export interface DirectionInput {
  prompt: string;
  brief: VideoBrief;
  /** Duration fixed by the form or the plan limit. */
  durationLocked: boolean;
  maxDurationSec?: number;
  styleLocked: boolean;
  languageLocked: boolean;
  /** Fewer scenes than this is an incomplete plan (the customer wrote that many, or the duration needs them). */
  minScenes: number;
}

export const directVideo = async (llm: LLMProvider, input: DirectionInput, signal?: AbortSignal): Promise<Direction> => {
  const { brief } = input;
  const styles = Object.values(STYLES).map((s) => `${s.id}: ${s.description}`).join('\n');
  const languages = LANGUAGE_CODES.map((code) => `${code} (${getLanguage(code)?.name ?? code})`).join(', ');
  const settings = [
    `Format: ${brief.width}x${brief.height} (${brief.width < brief.height ? 'vertical' : brief.width > brief.height ? 'landscape' : 'square'}).`,
    input.durationLocked ? `Duration: exactly ${brief.durationSec} seconds (set by the customer).` : `Duration detected: ${brief.durationSec} seconds (use what the request says if it says otherwise${input.maxDurationSec ? `, at most ${input.maxDurationSec} s` : ''}).`,
    input.styleLocked ? `Style: ${brief.styleId} (chosen by the customer).` : `Style ids you can choose from:\n${styles}`,
    input.languageLocked ? `Language: ${getLanguage(brief.locale)?.name ?? brief.locale} (chosen by the customer).` : `Language codes: ${languages}. Default: the language of the request.`,
    brief.brand && `Brand name: ${brief.brand}.`,
    brief.productPhotos?.length && `Customer product photos (they will appear in the video):\n${brief.productPhotos.map((d, i) => `${i + 1}. ${d}`).join('\n')}`,
  ].filter(Boolean).join('\n');
  const request = {
    system: SYSTEM,
    signal,
    maxTokens: 16000,
    json: { name: 'video_direction', schema: DIRECTION_JSON_SCHEMA },
    messages: [{ role: 'user' as const, content: `${settings}\n\nCustomer request (between the tags):\n<request>\n${input.prompt}\n</request>` }],
  };
  const first = await generateJson(llm, request, DirectionSchema);
  if (first.scenes.length >= input.minScenes) return first;
  // Models sometimes stop early: ask once for the complete plan, keep the longer of the two.
  const second = await generateJson(
    llm,
    {
      ...request,
      messages: [
        ...request.messages,
        { role: 'assistant', content: JSON.stringify(first) },
        { role: 'user', content: `This plan has only ${first.scenes.length} scenes; the request needs at least ${input.minScenes}. Reply with the COMPLETE plan, every scene included.` },
      ],
    },
    DirectionSchema,
  ).catch(() => first);
  return second.scenes.length > first.scenes.length ? second : first;
};

/** The plan as the pipeline's planned scenes and concept. */
export const fromDirection = (direction: Direction): { concept: VideoConcept; scenes: PlannedScene[] } => ({
  concept: {
    title: direction.title,
    idea: direction.idea,
    angle: '',
    tone: direction.tone,
    keyMessage: direction.keyMessage,
    callToAction: direction.callToAction,
    tagline: direction.tagline,
  },
  scenes: direction.scenes.map((scene, i) => ({
    role: scene.role || `scene-${i + 1}`,
    kind: scene.kind,
    headline: scene.headline,
    subheadline: scene.subheadline,
    body: scene.body,
    items: scene.items.slice(0, 6),
    statValue: scene.statValue,
    statLabel: scene.statLabel,
    narration: scene.narration,
    visualKeywords: scene.visualQueries.map((q) => q.trim()).filter(Boolean).slice(0, 4),
    visualPrompt: scene.visualPrompt || scene.visual,
    productPhoto: scene.productPhoto || undefined,
    weight: Math.max(1, scene.seconds),
  })),
});
