/**
 * Where the sound design goes, frame by frame, from the storyboard alone (browser-safe): a whoosh
 * peaking in the middle of every scene cut and, softer, at every shot change; an impact when a title
 * or a call to action lands; a tick for each bullet or step. Same maths as the scenes themselves.
 */
import type { Storyboard } from '../contract/storyboard';
import { computeTimeline, transitionLength } from '../contract/timeline';
import { MIN_SHOT_SECONDS, visibleShots } from '../components/MediaLayer';
import { bulletSpacing, stepSpacing } from '../utils';
import { itemRevealFrames, shotStarts, voiceOffsetInScene } from './sync';

export type SfxCueKind = 'whoosh' | 'impact' | 'tick';

export interface SfxCue {
  kind: SfxCueKind;
  /** Frame (composition) at which the sound file starts. */
  from: number;
  volume: number;
}

/** Seconds from the start of the whoosh file to its peak (see audio/sfx WHOOSH_PEAK_SECONDS). */
const WHOOSH_PEAK_SECONDS = 0.33;
/** A title "lands" this many frames after the scene starts (AnimatedText delay + spring). */
const TITLE_LANDS = 8;

export const sfxCues = (storyboard: Storyboard): SfxCue[] => {
  if (!storyboard.audio.sfx) return [];
  const { fps } = storyboard.format;
  const level = storyboard.audio.sfx.volume;
  const peak = Math.round(WHOOSH_PEAK_SECONDS * fps);
  const timeline = computeTimeline(storyboard.scenes);
  const cues: SfxCue[] = [];
  storyboard.scenes.forEach((scene, i) => {
    const window = timeline[i]!;
    // Scene cut: the whoosh peaks halfway through the transition.
    const length = transitionLength(storyboard.scenes, i);
    if (length > 0) {
      const cutMiddle = window.from + scene.durationInFrames - length + Math.round(length / 2);
      cues.push({ kind: 'whoosh', from: Math.max(0, cutMiddle - peak), volume: 0.7 * level });
    }
    // Shot changes inside the scene: a softer whoosh at each new picture.
    const media = scene.media ? [scene.media, ...(scene.shots ?? [])] : [];
    const shots = visibleShots(media, scene.durationInFrames, fps);
    if (shots.length > 1) {
      // Same cut points as MediaStack (on the voice).
      const starts = shotStarts(scene.durationInFrames, shots.length, Math.round(MIN_SHOT_SECONDS * fps), scene.voiceover?.words, voiceOffsetInScene(storyboard.scenes, i));
      for (let s = 1; s < shots.length; s++) cues.push({ kind: 'whoosh', from: Math.max(0, window.from + starts[s]! + 6 - peak), volume: 0.45 * level });
    }
    // Titles, key figures and calls to action land with a hit.
    if (scene.kind === 'title' || scene.kind === 'cta' || scene.kind === 'stat') cues.push({ kind: 'impact', from: window.from + TITLE_LANDS, volume: 0.6 * level });
    if (scene.kind === 'bullets') {
      const count = Math.min(6, scene.items.length);
      const spacing = bulletSpacing(scene.durationInFrames, count);
      // Same frames as the scene: on the voice when it says the bullet.
      for (const at of itemRevealFrames(scene, voiceOffsetInScene(storyboard.scenes, i), scene.items.slice(0, count), spacing)) cues.push({ kind: 'tick', from: window.from + at + 3, volume: 0.85 * level });
    }
    if (scene.kind === 'steps') {
      const count = Math.min(5, scene.items.length);
      const spacing = stepSpacing(scene.durationInFrames, count);
      for (const at of itemRevealFrames(scene, voiceOffsetInScene(storyboard.scenes, i), scene.items.slice(0, count), spacing)) cues.push({ kind: 'tick', from: window.from + at + 3, volume: 0.85 * level });
    }
  });
  return cues.sort((a, b) => a.from - b.from);
};
