/** Subtitle cue generation (timed on scenes/voice-over) and SRT/WebVTT export. */
import type { Storyboard, SubtitleCue } from '../remotion/contract/storyboard';
import { computeTimeline, VOICE_OFFSET_FRAMES } from '../remotion/contract/timeline';

/**
 * Split `words` into exactly `k` consecutive chunks, minimising the length deviation
 * (balanced lines), penalising overflow and rewarding breaks after punctuation.
 */
const balancedSplit = (words: string[], k: number, maxChars: number): string[] => {
  const n = words.length;
  const total = words.join(' ').length;
  const target = total / k;
  const len = (i: number, j: number) => words.slice(i, j).join(' ').length;
  const cost = (i: number, j: number) => {
    const l = len(i, j);
    let c = (l - target) ** 2;
    if (l > maxChars) c += (l - maxChars) * 400;
    if (j < n && /[,;:]$/.test(words[j - 1]!)) c -= target * 2;
    return c;
  };
  // best[p][j] = min cost to split words[0..j) into p chunks.
  const best: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
  const prev: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(-1));
  best[0]![0] = 0;
  for (let p = 1; p <= k; p++) {
    for (let j = p; j <= n; j++) {
      for (let i = p - 1; i < j; i++) {
        const c = best[p - 1]![i]! + cost(i, j);
        if (c < best[p]![j]!) {
          best[p]![j] = c;
          prev[p]![j] = i;
        }
      }
    }
  }
  const chunks: string[] = [];
  let j = n;
  for (let p = k; p > 0; p--) {
    const i = prev[p]![j]!;
    chunks.unshift(words.slice(i, j).join(' '));
    j = i;
  }
  return chunks;
};

/** Split narration into readable, balanced chunks of at most ~maxChars. */
export const chunkText = (text: string, maxChars = 42): string[] => {
  const clean = text.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  for (const sentence of clean.split(/(?<=[.!?…])\s+/)) {
    if (sentence.length <= maxChars) {
      chunks.push(sentence);
      continue;
    }
    const words = sentence.split(' ');
    let k = Math.min(words.length, Math.ceil(sentence.length / maxChars));
    let split = balancedSplit(words, k, maxChars);
    while (split.some((c) => c.length > maxChars * 1.1) && k < words.length) {
      k++;
      split = balancedSplit(words, k, maxChars);
    }
    chunks.push(...split);
  }
  return chunks;
};

/**
 * Build cues for every scene's narration. With a voice-over, cues follow its duration;
 * otherwise they spread over the scene's "solo" window (outside transitions).
 * Durations are proportional to the number of characters in each chunk.
 */
export const buildSubtitleCues = (storyboard: Storyboard, maxChars?: number): SubtitleCue[] => {
  const { fps } = storyboard.format;
  const timeline = computeTimeline(storyboard.scenes);
  const cues: SubtitleCue[] = [];
  const portrait = storyboard.format.height > storyboard.format.width;
  const limit = maxChars ?? (portrait ? 32 : 42);

  storyboard.scenes.forEach((scene, i) => {
    const window = timeline[i]!;
    const chunks = chunkText(scene.narration, limit);
    if (!chunks.length) return;
    let start = window.soloFrom + (scene.voiceover ? VOICE_OFFSET_FRAMES : Math.round(fps * 0.2));
    const end = scene.voiceover ? Math.min(window.soloTo, start + scene.voiceover.durationInFrames) : window.soloTo - Math.round(fps * 0.1);
    const available = end - start;
    if (available < chunks.length * 6) return;
    const totalChars = chunks.reduce((s, c) => s + c.length, 0);
    chunks.forEach((text, j) => {
      const share = Math.round((available * text.length) / totalChars);
      const cueEnd = j === chunks.length - 1 ? end : Math.min(end, start + Math.max(6, share));
      cues.push({ startFrame: start, endFrame: cueEnd, text });
      start = cueEnd;
    });
  });

  // Guarantee monotonic, non-overlapping cues.
  for (let i = 1; i < cues.length; i++) {
    if (cues[i]!.startFrame < cues[i - 1]!.endFrame) cues[i]!.startFrame = cues[i - 1]!.endFrame;
  }
  return cues.filter((c) => c.endFrame > c.startFrame);
};

const timestamp = (frame: number, fps: number, separator: ',' | '.'): string => {
  const ms = Math.round((frame / fps) * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(rest, 3)}`;
};

export const toSrt = (cues: SubtitleCue[], fps: number): string =>
  cues.map((c, i) => `${i + 1}\n${timestamp(c.startFrame, fps, ',')} --> ${timestamp(c.endFrame, fps, ',')}\n${c.text}\n`).join('\n');

export const toVtt = (cues: SubtitleCue[], fps: number): string =>
  `WEBVTT\n\n${cues.map((c) => `${timestamp(c.startFrame, fps, '.')} --> ${timestamp(c.endFrame, fps, '.')}\n${c.text}\n`).join('\n')}`;
