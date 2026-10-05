/** LLM-backed creative planning (concept, then script), constrained by the template blueprint. */
import type { PlannedScene, VideoBrief, VideoConcept } from '../core/types';
import { generateJson } from '../llm/json';
import type { LLMProvider } from '../llm/types';
import type { TemplateDefinition } from '../templates/types';
import { CONCEPT_JSON_SCHEMA, ConceptSchema, SCRIPT_JSON_SCHEMA, ScriptSchema } from './schemas';
import type { SceneSlot } from './slots';

const LANGUAGE_NAMES: Record<string, string> = { fr: 'French', en: 'English' };

const SYSTEM = `You are the creative director and copywriter of an automated video studio.
You write short, high-impact copy for animated motion-design videos rendered with Remotion.
Rules:
- Write every user-facing text in the requested language.
- On-screen text is short: headlines max 8 words, list items max 5 words.
- Wrap 1 to 3 key words of a headline in *asterisks* to highlight them.
- Never invent statistics, prices, dates, phone numbers or URLs that are not in the brief.
- Narration is what a voice-over says; it must fit the scene duration (about 2.3 words per second).
- Reply with a single JSON object and nothing else.`;

const briefSummary = (brief: VideoBrief, template: TemplateDefinition): string =>
  [
    `Brief: "${brief.prompt}"`,
    `Language: ${LANGUAGE_NAMES[brief.language] ?? brief.language}`,
    `Duration: ${brief.durationSec} seconds, format ${brief.width}x${brief.height} (${brief.formatId})`,
    brief.brand && `Brand / product: ${brief.brand}`,
    brief.audience && `Audience: ${brief.audience}`,
    brief.location && `Location: ${brief.location}`,
    `Template: ${template.name} — ${template.description}`,
    `Template guidance: ${template.guidance}`,
    `Visual style: ${brief.styleId}`,
  ]
    .filter(Boolean)
    .join('\n');

export const llmConcept = async (llm: LLMProvider, brief: VideoBrief, template: TemplateDefinition, signal?: AbortSignal): Promise<VideoConcept> =>
  generateJson(
    llm,
    {
      system: SYSTEM,
      signal,
      maxTokens: 4000,
      json: { name: 'video_concept', schema: CONCEPT_JSON_SCHEMA },
      messages: [
        {
          role: 'user',
          content: `${briefSummary(brief, template)}

Define the creative concept of this video. Return JSON with:
title (short video title), idea (one sentence), angle (the creative angle), tone (2-4 adjectives),
keyMessage (the one thing to remember), callToAction (short imperative), tagline (max 6 words).`,
        },
      ],
    },
    ConceptSchema,
  );

export const llmScript = async (
  llm: LLMProvider,
  brief: VideoBrief,
  template: TemplateDefinition,
  concept: VideoConcept,
  slots: SceneSlot[],
  signal?: AbortSignal,
): Promise<PlannedScene[]> => {
  const totalWeight = slots.reduce((s, x) => s + x.weight, 0);
  const plan = slots
    .map((slot, i) => {
      const seconds = (brief.durationSec * slot.weight) / totalWeight;
      return `${i + 1}. role="${slot.role}" kind="${slot.kind}" ~${seconds.toFixed(1)}s, narration max ${Math.max(4, Math.floor(seconds * 2.3))} words — ${slot.purpose}${slot.repetition ? ` (continuation #${slot.repetition + 1}, new content)` : ''}`;
    })
    .join('\n');

  const result = await generateJson(
    llm,
    {
      system: SYSTEM,
      signal,
      maxTokens: 12000,
      json: { name: 'video_script', schema: SCRIPT_JSON_SCHEMA },
      messages: [
        {
          role: 'user',
          content: `${briefSummary(brief, template)}

Concept:
${JSON.stringify(concept, null, 2)}

Write the script and on-screen copy for exactly ${slots.length} scenes, in this order:
${plan}

Scene kinds and the fields they use:
- title: subheadline (small label above), headline, body (optional short line)
- text: headline, body (one or two sentences), subheadline (optional label)
- bullets: headline, items (3 items)
- steps: headline, items (3 steps, imperative)
- stat: headline, statValue (only a number given in the brief), statLabel — otherwise use kind "text"
- image: headline, body (caption); visualPrompt describes the picture to generate
- quote: headline (the quote), subheadline (who says it)
- cta: headline, subheadline (button label, max 3 words), body (optional)
Every scene also needs: narration, visualKeywords (3-6 English keywords to search stock assets), visualPrompt (English, one sentence).
Keep the role names exactly as given. Return {"scenes": [...]}.`,
        },
      ],
    },
    ScriptSchema,
  );

  // Align on the slots: the template structure always wins over the model's output.
  return slots.map((slot, i) => {
    const s = result.scenes.find((sc, j) => sc.role === slot.role && j === i) ?? result.scenes[i] ?? result.scenes.find((sc) => sc.role === slot.role);
    return {
      role: slot.role,
      kind: s?.kind ?? slot.kind,
      headline: s?.headline ?? '',
      subheadline: s?.subheadline ?? '',
      body: s?.body ?? '',
      items: s?.items ?? [],
      statValue: s?.statValue ?? '',
      statLabel: s?.statLabel ?? '',
      narration: s?.narration ?? '',
      visualKeywords: s?.visualKeywords ?? [],
      visualPrompt: s?.visualPrompt ?? '',
      weight: slot.weight,
    };
  });
};
