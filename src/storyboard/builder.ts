/** Turns a plan (concept + scripted scenes) into a Remotion storyboard. */
import type { PlannedScene, VideoBrief, VideoConcept } from '../core/types';
import { StoryboardSchema, type Scene, type SceneKind, type Storyboard } from '../remotion/contract/storyboard';
import type { StyleDefinition } from '../remotion/contract/styles';
import { computeTotalDuration } from '../remotion/contract/timeline';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene';

/** Make sure every scene has the content its kind needs; degrade gracefully otherwise. */
export const sanitizeScene = (scene: PlannedScene, concept: VideoConcept): PlannedScene => {
  let kind: SceneKind = scene.kind;
  const s = { ...scene, items: scene.items.map((i) => i.trim()).filter(Boolean) };
  if ((kind === 'bullets' || kind === 'steps') && s.items.length === 0) kind = 'text';
  if (kind === 'stat' && !/\d/.test(s.statValue)) kind = 'text';
  if (kind === 'quote' && !s.headline) kind = 'text';
  if (!s.headline.trim()) s.headline = s.body || concept.keyMessage || concept.title;
  if (kind === 'cta' && !s.subheadline) s.subheadline = concept.callToAction;
  if (!s.narration.trim()) s.narration = [s.headline, s.body].filter(Boolean).join('. ').replace(/\*/g, '');
  return { ...s, kind };
};

/**
 * Split the requested duration across scenes, proportionally to their weights.
 * Transitions overlap adjacent scenes, so their length is added back to keep the total exact.
 */
export const allocateDurations = (weights: number[], totalFrames: number, transitionFrames: number, fps: number): number[] => {
  const n = weights.length;
  const overlap = transitionFrames * Math.max(0, n - 1);
  const budget = totalFrames + overlap;
  const minFrames = Math.max(Math.round(fps * 1.2), transitionFrames * 2 + 2);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const frames = weights.map((w) => Math.max(minFrames, Math.floor((budget * w) / sum)));
  // Fix rounding so the total is exact (adjust the longest scenes first).
  let diff = budget - frames.reduce((a, b) => a + b, 0);
  const order = frames.map((f, i) => [f, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  let k = 0;
  while (diff !== 0 && k < 10_000) {
    const i = order[k % n]!;
    const step = diff > 0 ? 1 : -1;
    if (step > 0 || frames[i]! - 1 >= minFrames) {
      frames[i]! += step;
      diff -= step;
    }
    k++;
    if (k > n * 2 && diff < 0 && frames.every((f) => f <= minFrames)) break;
  }
  return frames;
};

export interface BuildStoryboardInput {
  brief: VideoBrief;
  concept: VideoConcept;
  scenes: PlannedScene[];
  style: StyleDefinition;
}

export const buildStoryboard = ({ brief, concept, scenes, style }: BuildStoryboardInput): Storyboard => {
  const fps = brief.fps;
  const totalFrames = Math.round(brief.durationSec * fps);
  const transitionFrames = Math.round(style.transitionSeconds * fps);
  const clean = scenes.map((s) => sanitizeScene(s, concept));
  const durations = allocateDurations(clean.map((s) => s.weight), totalFrames, transitionFrames, fps);

  const storyboardScenes: Scene[] = clean.map((s, i) => ({
    id: `${String(i + 1).padStart(2, '0')}-${slug(s.role)}`,
    kind: s.kind,
    role: s.role,
    durationInFrames: durations[i]!,
    headline: s.headline,
    subheadline: s.subheadline,
    body: s.body,
    items: s.items.slice(0, 5),
    stat: s.kind === 'stat' ? { value: s.statValue, label: s.statLabel } : undefined,
    narration: s.narration,
    background: { variant: 'gradient' },
    layout: 'center',
    animation: { entrance: 'rise', stagger: 4, kenBurns: 0.06 },
    transitionOut: { type: 'fade', durationInFrames: transitionFrames, direction: 'from-right' },
  }));

  return StoryboardSchema.parse({
    version: 1,
    meta: { title: concept.title, language: brief.locale, template: brief.templateId, style: style.id, prompt: brief.prompt },
    format: { width: brief.width, height: brief.height, fps, durationInFrames: computeTotalDuration(storyboardScenes) },
    theme: style.theme,
    brand: { name: brief.brand, tagline: concept.tagline, showWatermark: Boolean(brief.brand), ...(brief.badge ? { badge: brief.badge } : {}) },
    scenes: storyboardScenes,
    subtitles: { enabled: brief.subtitles, style: style.subtitleStyle, cues: [] },
    audio: {},
  });
};
