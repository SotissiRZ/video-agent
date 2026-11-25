/**
 * Picture on the voice, like an editor cuts it: a bullet appears when the narration says it, the
 * highlighted word draws its marker when it is spoken. Word timings come from the voice provider
 * (ElevenLabs alignment) or, failing that, from a syllable-based estimate. Browser-safe.
 */
import { createContext } from 'react';
import type { Scene } from '../contract/storyboard';
import { transitionLength, voiceLeadIn } from '../contract/timeline';
import { REVEAL_START } from '../utils';

/** A spoken word, in frames from the start of the scene's voice-over file. */
export interface SpokenWord {
  text: string;
  from: number;
  to: number;
}

export const normalizeWord = (word: string): string =>
  word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Vowel groups: a good-enough syllable count across French, English and most Latin-script languages. */
const syllables = (word: string): number => Math.max(1, (normalizeWord(word).match(/[aeiouy]+/g) ?? []).length);

/**
 * Word timings without an aligner: each word takes time in proportion to its syllables, and
 * punctuation adds the pause a speaker makes (comma short, full stop longer).
 */
export const estimateWordTimings = (text: string, durationSec: number, fps: number): SpokenWord[] => {
  const tokens = text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t));
  if (!tokens.length || durationSec <= 0) return [];
  const pauseAfter = (t: string) => (/[.!?…]$/.test(t) ? 2.5 : /[,;:]$/.test(t) ? 1.2 : 0);
  const units = tokens.map((t) => ({ speak: syllables(t), pause: pauseAfter(t) }));
  const total = units.reduce((n, u) => n + u.speak + u.pause, 0) - units[units.length - 1]!.pause;
  const perUnit = (durationSec * fps) / total;
  let cursor = 0;
  return tokens.map((text, i) => {
    const from = Math.round(cursor);
    cursor += units[i]!.speak * perUnit;
    const to = Math.round(cursor);
    cursor += units[i]!.pause * perUnit;
    return { text, from, to: Math.max(from + 1, to) };
  });
};

/** Words from character timings (ElevenLabs alignment), shifted by the silence trimmed at the start. */
export const wordsFromAlignment = (
  alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] },
  fps: number,
  shiftSec = 0,
): SpokenWord[] => {
  const words: SpokenWord[] = [];
  let text = '';
  let start = 0;
  let end = 0;
  const flush = () => {
    if (/[\p{L}\p{N}]/u.test(text)) words.push({ text, from: Math.max(0, Math.round((start - shiftSec) * fps)), to: Math.max(0, Math.round((end - shiftSec) * fps)) });
    text = '';
  };
  alignment.characters.forEach((c, i) => {
    if (/\s/.test(c)) return flush();
    if (!text) start = alignment.character_start_times_seconds[i] ?? 0;
    text += c;
    end = alignment.character_end_times_seconds[i] ?? end;
  });
  flush();
  return words;
};

/** Frame, within the scene, where its voice-over starts (half-way through the incoming cut). */
export const voiceOffsetInScene = (scenes: Pick<Scene, 'transitionOut' | 'durationInFrames'>[], index: number): number =>
  voiceLeadIn(index > 0 ? transitionLength(scenes, index - 1) : 0);

/**
 * Index of the first spoken word (at or after `after`) that says this phrase: its first meaningful
 * word, compared on 5-letter stems ("accessible" ↔ "accessibles", "rapide" ↔ "rapidement").
 */
export const findSpoken = (words: Pick<SpokenWord, 'text'>[], phrase: string, after = 0): number => {
  const wanted = phrase.split(/\s+/).map(normalizeWord).filter((w) => w.length >= 3);
  if (!wanted.length) return -1;
  const stem = (w: string) => w.slice(0, 5);
  const targets = new Set(wanted.slice(0, 2).map(stem));
  for (let i = after; i < words.length; i++) if (targets.has(stem(normalizeWord(words[i]!.text)))) return i;
  return -1;
};

/** Frame (within the scene) at which a phrase is spoken, or undefined when the narration never says it. */
export const spokenFrame = (scene: Pick<Scene, 'voiceover'>, offset: number, phrase: string): number | undefined => {
  const words = scene.voiceover?.words;
  if (!words?.length) return undefined;
  const i = findSpoken(words, phrase);
  return i < 0 ? undefined : offset + words[i]!.from;
};

/**
 * When each list item (bullet, step) appears: on the word that says it — a few frames early, as an
 * editor anticipates the voice — else on the regular spacing. Always in order, at least 6 frames
 * apart, and early enough to be read before the scene ends.
 */
export const itemRevealFrames = (
  scene: Pick<Scene, 'voiceover' | 'durationInFrames'>,
  offset: number,
  items: string[],
  spacing: number,
): number[] => {
  const words = scene.voiceover?.words ?? [];
  const latest = scene.durationInFrames - 20;
  let cursor = 0;
  let previous = -Infinity;
  return items.map((item, k) => {
    const regular = REVEAL_START + k * spacing;
    const i = words.length ? findSpoken(words, item, cursor) : -1;
    let frame = regular;
    if (i >= 0) {
      cursor = i + 1;
      frame = offset + words[i]!.from - 4;
    }
    frame = Math.min(latest, Math.max(REVEAL_START, previous + 6, frame));
    previous = frame;
    return frame;
  });
};

/**
 * Where each shot of a scene starts. An editor cuts on the voice, at the start of a new sentence or
 * clause, not mid-phrase: each even split point snaps to the nearest phrase start (a word following
 * , ; : . ! ?) within 40 % of a shot's length, and no shot gets shorter than `minFrames`.
 */
export const shotStarts = (durationInFrames: number, count: number, minFrames: number, words: SpokenWord[] = [], offset = 0): number[] => {
  const even = Math.ceil(durationInFrames / Math.max(1, count));
  const starts = Array.from({ length: count }, (_, k) => k * even);
  if (count < 2 || !words.length) return starts;
  const phraseStarts = words.flatMap((w, i) => (i > 0 && /[,;:.!?…]$/.test(words[i - 1]!.text) ? [offset + w.from] : []));
  // Where every cut would like to go, first; then accepted in order, so a cut is checked against
  // where the next one will really land, not its even position.
  const wanted = starts.map((target, k) => {
    if (k === 0) return 0;
    const nearest = phraseStarts.reduce<number | undefined>((best, at) => (best === undefined || Math.abs(at - target) < Math.abs(best - target) ? at : best), undefined);
    return nearest !== undefined && Math.abs(nearest - target) <= even * 0.4 ? nearest : target;
  });
  for (let k = 1; k < count; k++) {
    const next = k + 1 < count ? wanted[k + 1]! : durationInFrames;
    // Never squeeze the previous shot nor the next one.
    const fits = (at: number) => at - starts[k - 1]! >= minFrames && next - at >= minFrames;
    starts[k] = fits(wanted[k]!) ? wanted[k]! : starts[k]!;
    if (starts[k] !== wanted[k]) wanted[k] = starts[k]!;
  }
  return starts;
};

/** The current scene's spoken words and where its voice starts (provided by SceneRenderer). */
export const VoiceSyncContext = createContext<{ words: SpokenWord[]; offset: number }>({ words: [], offset: 0 });
