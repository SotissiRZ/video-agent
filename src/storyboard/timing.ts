/** Duration adjustments once audio is known. */
import type { Storyboard } from '../remotion/contract/storyboard';
import { computeTotalDuration, transitionLength, VOICE_OFFSET_FRAMES } from '../remotion/contract/timeline';

/**
 * Extend scenes whose voice-over would not fit between their transitions.
 * Returns a new storyboard with an updated total duration.
 */
export const fitScenesToVoiceover = (storyboard: Storyboard, paddingSec = 0.35): Storyboard => {
  const pad = Math.round(paddingSec * storyboard.format.fps);
  const scenes = storyboard.scenes.map((s) => ({ ...s }));
  scenes.forEach((scene, i) => {
    if (!scene.voiceover) return;
    const incoming = i > 0 ? transitionLength(scenes, i - 1) : 0;
    const outgoing = transitionLength(scenes, i);
    const needed = incoming + VOICE_OFFSET_FRAMES + scene.voiceover.durationInFrames + pad + outgoing;
    if (scene.durationInFrames < needed) scene.durationInFrames = needed;
  });
  return { ...storyboard, scenes, format: { ...storyboard.format, durationInFrames: computeTotalDuration(scenes) } };
};

export const recomputeDuration = (storyboard: Storyboard): Storyboard => ({
  ...storyboard,
  format: { ...storyboard.format, durationInFrames: computeTotalDuration(storyboard.scenes) },
});

/** Nudge the longest scene so the total duration matches `targetFrames` exactly (before audio fitting). */
export const matchTargetDuration = (storyboard: Storyboard, targetFrames: number): Storyboard => {
  const total = computeTotalDuration(storyboard.scenes);
  const diff = targetFrames - total;
  if (diff === 0) return recomputeDuration(storyboard);
  const scenes = storyboard.scenes.map((s) => ({ ...s }));
  const longest = scenes.reduce((best, s, i) => (s.durationInFrames > scenes[best]!.durationInFrames ? i : best), 0);
  const minFrames = storyboard.format.fps;
  scenes[longest]!.durationInFrames = Math.max(minFrames, scenes[longest]!.durationInFrames + diff);
  return recomputeDuration({ ...storyboard, scenes });
};
