/** Schemas of what the LLM must return (validated with zod, also sent as JSON schema). */
import { z } from 'zod';
import { SCENE_KINDS } from '../remotion/contract/storyboard';

export const ConceptSchema = z.object({
  title: z.string().min(1).max(120),
  idea: z.string().min(1),
  angle: z.string().default(''),
  tone: z.string().default(''),
  keyMessage: z.string().default(''),
  callToAction: z.string().default(''),
  tagline: z.string().default(''),
});

const str = { type: 'string' } as const;
const strArray = { type: 'array', items: { type: 'string' } } as const;

export const CONCEPT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'idea', 'angle', 'tone', 'keyMessage', 'callToAction', 'tagline'],
  properties: { title: str, idea: str, angle: str, tone: str, keyMessage: str, callToAction: str, tagline: str },
};

export const ScriptSceneSchema = z.object({
  role: z.string(),
  kind: z.enum(SCENE_KINDS).catch('text'),
  headline: z.string().default(''),
  subheadline: z.string().default(''),
  body: z.string().default(''),
  items: z.array(z.string()).default([]),
  statValue: z.string().default(''),
  statLabel: z.string().default(''),
  narration: z.string().default(''),
  visualKeywords: z.array(z.string()).default([]),
  visualPrompt: z.string().default(''),
  productPhoto: z.number().int().min(0).catch(0).default(0),
});

export const ScriptSchema = z.object({ scenes: z.array(ScriptSceneSchema).min(1) });

export const SCRIPT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scenes'],
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'kind', 'headline', 'subheadline', 'body', 'items', 'statValue', 'statLabel', 'narration', 'visualKeywords', 'visualPrompt', 'productPhoto'],
        properties: {
          role: str,
          kind: { type: 'string', enum: [...SCENE_KINDS] },
          headline: str,
          subheadline: str,
          body: str,
          items: strArray,
          statValue: str,
          statLabel: str,
          narration: str,
          visualKeywords: strArray,
          visualPrompt: str,
          productPhoto: { type: 'integer' },
        },
      },
    },
  },
};
