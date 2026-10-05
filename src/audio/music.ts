/**
 * Procedural background music: a small deterministic synthesizer producing a loop-free
 * track (pads, bass, arpeggio, light drums) that matches the video's mood. Fully offline.
 */
import { encodeWav } from './wav';

export type MusicMood = 'calm' | 'normal' | 'energetic';

export interface MusicOptions {
  durationSec: number;
  mood: MusicMood;
  /** Minor progressions sound more dramatic/elegant. */
  minor?: boolean;
  seed?: number;
  sampleRate?: number;
}

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// Progressions as semitone offsets of chord roots from the key, with chord quality.
const MAJOR: Array<[number, 'maj' | 'min']> = [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']]; // I V vi IV
const MINOR: Array<[number, 'maj' | 'min']> = [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']]; // i VI III VII

export const synthesizeMusic = (options: MusicOptions): Buffer => {
  const sampleRate = options.sampleRate ?? 44100;
  const total = Math.ceil((options.durationSec + 1) * sampleRate);
  const out = new Float32Array(total);
  const bpm = options.mood === 'energetic' ? 112 : options.mood === 'calm' ? 76 : 96;
  const beat = 60 / bpm;
  const bar = beat * 4;
  const key = 57 + ((options.seed ?? 0) % 5); // A3..C#4 area
  const progression = options.minor ? MINOR : MAJOR;
  let noiseState = (options.seed ?? 1) * 9301 + 49297;
  const noise = () => {
    noiseState = (noiseState * 9301 + 49297) % 233280;
    return noiseState / 233280 * 2 - 1;
  };

  const add = (startSec: number, durSec: number, fn: (t: number, i: number) => number) => {
    const start = Math.floor(startSec * sampleRate);
    const len = Math.floor(durSec * sampleRate);
    for (let i = 0; i < len && start + i < total; i++) out[start + i]! += fn(i / sampleRate, i);
  };

  const bars = Math.ceil(options.durationSec / bar) + 1;
  for (let b = 0; b < bars; b++) {
    const [offset, quality] = progression[b % progression.length]!;
    const root = key + offset;
    const third = root + (quality === 'maj' ? 4 : 3);
    const fifth = root + 7;
    const t0 = b * bar;

    // Pad: three detuned sines with slow attack/release.
    for (const note of [root, third, fifth, root + 12]) {
      const f = midiToHz(note);
      add(t0, bar * 1.05, (t) => {
        const env = Math.min(1, t / 0.6) * Math.min(1, (bar * 1.05 - t) / 0.5);
        return 0.045 * env * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 1.003 * t));
      });
    }

    // Bass on each beat (half notes when calm).
    const bassStep = options.mood === 'calm' ? beat * 2 : beat;
    for (let s = 0; s < bar - 1e-6; s += bassStep) {
      const f = midiToHz(root - 24);
      add(t0 + s, bassStep, (t) => 0.16 * Math.exp(-t * 3.2) * Math.sin(2 * Math.PI * f * t));
    }

    // Arpeggio in eighths (sixteenths when energetic).
    if (options.mood !== 'calm' || b % 2 === 1) {
      const step = options.mood === 'energetic' ? beat / 4 : beat / 2;
      const notes = [root + 12, third + 12, fifth + 12, third + 12];
      let k = 0;
      for (let s = 0; s < bar - 1e-6; s += step, k++) {
        const f = midiToHz(notes[k % notes.length]!);
        add(t0 + s, step * 1.5, (t) => 0.05 * Math.exp(-t * 9) * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)));
      }
    }

    // Drums.
    if (options.mood !== 'calm') {
      for (let q = 0; q < 4; q++) {
        if (options.mood === 'energetic' || q % 2 === 0) {
          add(t0 + q * beat, 0.3, (t) => 0.32 * Math.exp(-t * 14) * Math.sin(2 * Math.PI * (48 + 90 * Math.exp(-t * 30)) * t));
        }
        add(t0 + q * beat + beat / 2, 0.06, (t) => 0.035 * Math.exp(-t * 60) * noise());
      }
    }
  }

  // Master: one-pole low-pass, soft clip, normalise, fades.
  let lp = 0;
  let peak = 0;
  for (let i = 0; i < total; i++) {
    lp += 0.35 * (out[i]! - lp);
    out[i] = Math.tanh(lp * 1.4);
    peak = Math.max(peak, Math.abs(out[i]!));
  }
  const gain = peak > 0 ? 0.7 / peak : 1;
  const fade = Math.floor(1.5 * sampleRate);
  for (let i = 0; i < total; i++) {
    const fin = Math.min(1, i / fade);
    const fout = Math.min(1, (total - i) / fade);
    out[i] = out[i]! * gain * fin * fout;
  }
  return encodeWav(out, sampleRate);
};
