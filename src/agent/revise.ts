/**
 * Targeted correction of a rendered video: the model edits the existing storyboard (texts, order,
 * photos, colours) instead of planning a new video, so everything the customer did not ask to change
 * stays exactly as it was.
 */
import { z } from 'zod';
import { getLanguage } from '../core/languages';
import type { VideoBrief } from '../core/types';
import { generateJson } from '../llm/json';
import type { LLMProvider } from '../llm/types';
import type { Scene, Storyboard } from '../remotion/contract/storyboard';

/** The correction cannot be made by editing the storyboard: the caller regenerates the video instead. */
export class RevisionNotApplicable extends Error {
  override readonly name = 'RevisionNotApplicable';
}

const RevisedSceneSchema = z.object({
  id: z.string(),
  headline: z.string(),
  subheadline: z.string(),
  body: z.string(),
  items: z.array(z.string()),
  statValue: z.string(),
  statLabel: z.string(),
  narration: z.string(),
  /** "keep", "none" or "photo-N" (customer product photo N). */
  visual: z.string(),
});

export const RevisionSchema = z.object({
  /** false when the request needs a new video (new concept, duration, format, voice, music...). */
  feasible: z.boolean(),
  reason: z.string().default(''),
  scenes: z.array(RevisedSceneSchema),
  /** "#rrggbb" or "" to keep. */
  primaryColor: z.string().default(''),
  accentColor: z.string().default(''),
});
export type Revision = z.infer<typeof RevisionSchema>;

const str = { type: 'string' } as const;
const REVISION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['feasible', 'reason', 'scenes', 'primaryColor', 'accentColor'],
  properties: {
    feasible: { type: 'boolean' },
    reason: str,
    primaryColor: str,
    accentColor: str,
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'headline', 'subheadline', 'body', 'items', 'statValue', 'statLabel', 'narration', 'visual'],
        properties: { id: str, headline: str, subheadline: str, body: str, items: { type: 'array', items: str }, statValue: str, statLabel: str, narration: str, visual: str },
      },
    },
  },
};

const SYSTEM = `You are the editor of an automated video studio. A customer watched their rendered video and asks for one correction.
You edit the existing storyboard; you never rewrite the video from scratch.
Rules:
- Change only what the customer asks. Copy every other field exactly as it is.
- Keep the scene ids. You may reorder or remove scenes only if asked. You cannot add scenes.
- Keep the language of the existing texts. Headlines max 8 words, list items max 5 words, *asterisks* around 1-3 highlighted words.
- Never invent statistics, prices, dates, phone numbers or URLs the customer did not give.
- When narration changes, keep about the same number of words unless asked otherwise.
- Set feasible=false (with a short reason) only if the request cannot be done by editing texts, order, photos or colours:
  e.g. a different duration or format, another voice or music, a completely new concept, new scenes.
- Reply with a single JSON object and nothing else.`;

const visualOf = (scene: Scene, photoSrcs: string[]): string => {
  if (!scene.media) return 'none';
  const photo = photoSrcs.indexOf(scene.media.src);
  if (photo >= 0) return `photo-${photo + 1}`;
  return `${scene.media.type} (${scene.media.origin})`;
};

/** Ask the model for the edited storyboard. */
export const planRevision = async (
  llm: LLMProvider,
  storyboard: Storyboard,
  brief: VideoBrief,
  instruction: string,
  photos: Array<{ src: string; description: string }>,
  signal?: AbortSignal,
): Promise<Revision> => {
  const photoSrcs = photos.map((photo) => photo.src);
  const scenes = storyboard.scenes.map((scene) => ({
    id: scene.id,
    kind: scene.kind,
    role: scene.role,
    seconds: +(scene.durationInFrames / storyboard.format.fps).toFixed(1),
    headline: scene.headline,
    subheadline: scene.subheadline,
    body: scene.body,
    items: scene.items,
    statValue: scene.stat?.value ?? '',
    statLabel: scene.stat?.label ?? '',
    narration: scene.narration,
    visual: visualOf(scene, photoSrcs),
  }));
  return generateJson(
    llm,
    {
      system: SYSTEM,
      signal,
      maxTokens: 12000,
      json: { name: 'video_revision', schema: REVISION_JSON_SCHEMA },
      messages: [
        {
          role: 'user',
          content: `Video: "${storyboard.meta.title}" — language ${getLanguage(brief.locale)?.name ?? brief.locale}, ${storyboard.scenes.length} scenes.
Theme colours: primary ${storyboard.theme.palette.primary}, accent ${storyboard.theme.palette.accent}.
${photos.length ? `Customer product photos:\n${photos.map((photo, i) => `photo-${i + 1}: ${photo.description}`).join('\n')}` : 'No customer product photos.'}

Current scenes:
${JSON.stringify(scenes, null, 2)}

Customer correction: """${instruction}"""

Return {"feasible", "reason", "scenes": [...the scenes in their new order...], "primaryColor", "accentColor"}.
For each scene, "visual" is "keep" (unchanged), "none" (animated background only) or "photo-N" (show customer photo N).
primaryColor / accentColor: a #rrggbb value only if the customer asks for other colours, otherwise "".`,
        },
      ],
    },
    RevisionSchema,
  );
};

const clean = (text: string) => text.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Apply the edit to the storyboard. Returns the ids of the scenes whose narration changed
 * (their voice-over must be recorded again). Throws when the model broke the scene list.
 */
export const applyRevision = (storyboard: Storyboard, revision: Revision, photoSrcs: string[]): { storyboard: Storyboard; narrationChanged: Set<string> } => {
  const byId = new Map(storyboard.scenes.map((scene) => [scene.id, scene]));
  const ids = revision.scenes.map((scene) => scene.id);
  if (!ids.length) throw new Error('the revision removed every scene');
  if (new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) throw new Error('the revision changed the scene ids');
  const narrationChanged = new Set<string>();
  const scenes = revision.scenes.map((edit): Scene => {
    const scene = byId.get(edit.id)!;
    if (clean(edit.narration) !== clean(scene.narration)) narrationChanged.add(scene.id);
    const next: Scene = {
      ...scene,
      headline: edit.headline,
      subheadline: edit.subheadline,
      body: edit.body,
      items: edit.items,
      stat: scene.kind === 'stat' && edit.statValue ? { value: edit.statValue, label: edit.statLabel } : scene.stat,
      narration: edit.narration,
    };
    const photo = /^photo-(\d+)$/.exec(edit.visual.trim());
    if (photo && photoSrcs[Number(photo[1]) - 1]) {
      next.media = { type: 'image', src: photoSrcs[Number(photo[1]) - 1]!, fit: 'cover', origin: 'user:product' };
      next.shots = undefined;
    } else if (edit.visual.trim() === 'none') {
      next.media = undefined;
      next.shots = undefined;
      if (next.background.variant === 'media') next.background = { ...next.background, variant: 'gradient' };
    }
    return next;
  });
  const palette = {
    ...storyboard.theme.palette,
    ...(HEX.test(revision.primaryColor) ? { primary: revision.primaryColor } : {}),
    ...(HEX.test(revision.accentColor) ? { accent: revision.accentColor } : {}),
  };
  return { storyboard: { ...storyboard, theme: { ...storyboard.theme, palette }, scenes }, narrationChanged };
};
