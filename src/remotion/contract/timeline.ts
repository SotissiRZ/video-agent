/**
 * Timeline maths for storyboards built on <TransitionSeries>.
 * A transition between scene i and i+1 overlaps both scenes, so it shortens the
 * total duration by its own length. Browser-safe.
 */
import type { Scene } from './storyboard';

/** Small delay added to the voice-over start (see voiceStartFrame). */
export const VOICE_OFFSET_FRAMES = 3;

/** Frames between the first visible frame of a scene and its voice-over: halfway through the incoming transition. */
export const voiceLeadIn = (incomingTransition: number): number => Math.round(incomingTransition / 2) + VOICE_OFFSET_FRAMES;

/** Effective length of the transition after scene `index` (0 for the last scene or 'none'). */
export const transitionLength = (scenes: Pick<Scene, 'transitionOut' | 'durationInFrames'>[], index: number): number => {
  if (index >= scenes.length - 1) return 0;
  const t = scenes[index]!.transitionOut;
  if (!t || t.type === 'none') return 0;
  // A transition can never be longer than either of the scenes it joins.
  const max = Math.min(scenes[index]!.durationInFrames, scenes[index + 1]!.durationInFrames) - 1;
  return Math.max(0, Math.min(t.durationInFrames, max));
};

export interface SceneWindow {
  index: number;
  id: string;
  /** First frame where the scene is visible. */
  from: number;
  durationInFrames: number;
  /** Frame range where the scene is the only one on screen (no transition overlap). */
  soloFrom: number;
  soloTo: number;
}

export const computeTimeline = (
  scenes: Pick<Scene, 'id' | 'transitionOut' | 'durationInFrames'>[],
): SceneWindow[] => {
  const windows: SceneWindow[] = [];
  let cursor = 0;
  scenes.forEach((scene, index) => {
    const incoming = index > 0 ? transitionLength(scenes, index - 1) : 0;
    const outgoing = transitionLength(scenes, index);
    windows.push({
      index,
      id: scene.id,
      from: cursor,
      durationInFrames: scene.durationInFrames,
      soloFrom: cursor + incoming,
      soloTo: cursor + scene.durationInFrames - outgoing,
    });
    cursor += scene.durationInFrames - outgoing;
  });
  return windows;
};

export const computeTotalDuration = (scenes: Pick<Scene, 'id' | 'transitionOut' | 'durationInFrames'>[]): number => {
  const timeline = computeTimeline(scenes);
  const last = timeline[timeline.length - 1];
  return last ? last.from + last.durationInFrames : 0;
};

/** First frame of a scene's voice-over: the new scene is already mostly on screen. */
export const voiceStartFrame = (window: SceneWindow): number => window.from + voiceLeadIn(window.soloFrom - window.from);
