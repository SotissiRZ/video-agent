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
  /**
   * The scenes already have the durations the customer asked for ("SCÈNE 3 (12–20 s)"): they are
   * kept as far as the voice allows without a silence longer than `maxSilenceSec` (default 0.6 s),
   * and none when the sentence goes on in the next scene: a long silence in the middle of a sentence
   * sounds like a glitch. Time still missing goes to the closing scene, where a pause on the logo
   * with music is natural.
   */
  keepDurations?: boolean;
  maxSilenceSec?: number;
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
  const requested = scenes.map((s) => (opts.keepDurations ? s.durationInFrames : 0));
  const maxSilence = Math.round((opts.maxSilenceSec ?? 0.6) * fps);
  // Transition lengths depend on scene lengths: two passes settle them.
  for (let pass = 0; pass < 2; pass++) {
    scenes.forEach((scene, i) => {
      if (!scene.voiceover) return;
      const voiced = voicedLength(scenes, i, pad);
      // A sentence that goes on in the next scene ("Du web à l'IA," → "de l'automatisation…") gets no extra pause.
      const continues = i < scenes.length - 1 && !/[.!?…»"”]\s*$/.test(scene.narration.replace(/\*/g, '').trim());
      scene.durationInFrames = Math.max(minFrames, Math.min(requested[i]!, voiced + (continues ? 0 : maxSilence)), voiced);
    });
  }
  if (opts.targetFrames) {
    const floor = Math.round(opts.targetFrames * (opts.minFill ?? 0.85));
    const deficit = floor - computeTotalDuration(scenes);
    if (deficit > 0 && opts.keepDurations) {
      // The closing scene holds a little longer on the logo and the music; beyond that the video is
      // shorter than asked rather than full of silences: the customer's voice-over sets the length.
      scenes[scenes.length - 1]!.durationInFrames += Math.min(deficit, 4 * fps);
    } else if (deficit > 0) {
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
