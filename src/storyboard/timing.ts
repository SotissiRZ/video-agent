/** Duration adjustments once audio is known. */
import type { Storyboard } from '../remotion/contract/storyboard';
import { computeTotalDuration, transitionLength, voiceLeadIn } from '../remotion/contract/timeline';

/** Frames a voiced scene needs: lead-in (half its incoming transition), the voice, a pause, its outgoing transition. */
const voicedLength = (scenes: Storyboard['scenes'], i: number, pad: number): number => {
  const scene = scenes[i]!;
  const incoming = i > 0 ? transitionLength(scenes, i - 1) : 0;
  return voiceLeadIn(incoming) + scene.voiceover!.durationInFrames + pad + transitionLength(scenes, i);
};

/**
 * Extend scenes whose voice-over would not fit between their transitions.
 * Returns a new storyboard with an updated total duration.
 */
export const fitScenesToVoiceover = (storyboard: Storyboard, paddingSec = 0.35): Storyboard => {
  const pad = Math.round(paddingSec * storyboard.format.fps);
  const scenes = storyboard.scenes.map((s) => ({ ...s }));
  scenes.forEach((scene, i) => {
    if (!scene.voiceover) return;
    const needed = voicedLength(scenes, i, pad);
    if (scene.durationInFrames < needed) scene.durationInFrames = needed;
  });
  return { ...storyboard, scenes, format: { ...storyboard.format, durationInFrames: computeTotalDuration(scenes) } };
};

export interface PaceOptions {
  /** Requested total duration: the video is not shortened below `minFill` of it. */
  targetFrames?: number;
  /** Pause after each sentence. */
  pauseSec?: number;
  /** Shortest scene (time to read its text). */
  minSceneSec?: number;
  minFill?: number;
}

/**
 * Pace the video on its voice-over: every voiced scene lasts as long as its sentence plus a short
 * pause, so the narration flows without long silences. When the narration is much shorter than
 * the requested duration, the remaining time is spread evenly over the scenes.
 */
export const paceScenesToVoiceover = (storyboard: Storyboard, opts: PaceOptions = {}): Storyboard => {
  const { fps } = storyboard.format;
  const pad = Math.round((opts.pauseSec ?? 0.3) * fps);
  const minFrames = Math.round((opts.minSceneSec ?? 2.2) * fps);
  const scenes = storyboard.scenes.map((s) => ({ ...s }));
  // Transition lengths depend on scene lengths: two passes settle them.
  for (let pass = 0; pass < 2; pass++) {
    scenes.forEach((scene, i) => {
      if (scene.voiceover) scene.durationInFrames = Math.max(minFrames, voicedLength(scenes, i, pad));
    });
  }
  if (opts.targetFrames) {
    const floor = Math.round(opts.targetFrames * (opts.minFill ?? 0.85));
    const deficit = floor - computeTotalDuration(scenes);
    if (deficit > 0) {
      const share = Math.floor(deficit / scenes.length);
      scenes.forEach((s, i) => (s.durationInFrames += share + (i < deficit % scenes.length ? 1 : 0)));
    }
  }
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
