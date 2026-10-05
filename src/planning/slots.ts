import type { SceneBlueprint, TemplateDefinition } from '../templates/types';

export interface SceneSlot extends SceneBlueprint {
  /** 0 for the first occurrence of a role, 1 for its first repetition... */
  repetition: number;
}

/** Comfortable on-screen time per scene, in seconds. */
export const MIN_SCENE_SEC = 2.5;
export const TARGET_SCENE_SEC = 4.5;
export const MAX_SCENE_SEC = 9;

/**
 * Choose which blueprint scenes to use for a given duration:
 * required scenes always; optional ones while time allows; repeatable ones duplicated for long videos.
 */
export const selectSlots = (template: TemplateDefinition, durationSec: number): SceneSlot[] => {
  const maxScenes = Math.max(1, Math.floor(durationSec / MIN_SCENE_SEC));
  const idealScenes = Math.max(1, Math.round(durationSec / TARGET_SCENE_SEC));
  const required = template.scenes.filter((s) => !s.optional);
  let chosen = new Set<SceneBlueprint>(required);

  for (const scene of template.scenes) {
    if (chosen.size >= Math.min(idealScenes, maxScenes)) break;
    if (scene.optional) chosen.add(scene);
  }
  // Very short videos: keep the first and last required scenes, then fill in order.
  if (chosen.size > maxScenes) {
    const first = required[0]!;
    const last = required[required.length - 1]!;
    const middle = required.slice(1, -1).slice(0, Math.max(0, maxScenes - 2));
    chosen = new Set([first, ...middle, ...(maxScenes > 1 && last !== first ? [last] : [])]);
  }

  let slots: SceneSlot[] = template.scenes.filter((s) => chosen.has(s)).map((s) => ({ ...s, repetition: 0 }));

  // Long videos: repeat repeatable scenes until the average scene length is reasonable.
  const repeatables = template.scenes.filter((s) => s.repeatable && chosen.has(s));
  let guard = 0;
  while (repeatables.length && durationSec / slots.length > MAX_SCENE_SEC * 0.8 && guard++ < 40) {
    const blueprint = repeatables[guard % repeatables.length]!;
    const count = slots.filter((s) => s.role === blueprint.role).length;
    const lastIndex = slots.map((s) => s.role).lastIndexOf(blueprint.role);
    slots = [...slots.slice(0, lastIndex + 1), { ...blueprint, repetition: count }, ...slots.slice(lastIndex + 1)];
  }
  return slots;
};
