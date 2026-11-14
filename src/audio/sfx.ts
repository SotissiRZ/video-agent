/**
 * Sound design synthesised offline (no sample library, no API): the whoosh under a cut, the impact
 * when a title lands, the tick of a bullet. Deterministic, mono 16-bit WAV.
 */
import { encodeWav } from './wav';

export type SfxKind = 'whoosh' | 'impact' | 'tick';

const RATE = 44100;

/** Small deterministic noise source (same sound on every render). */
const noise = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
};

const normalize = (out: Float32Array, peak: number): Float32Array => {
  let max = 0;
  for (const v of out) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i]! / max) * peak;
  return out;
};

/** Air rushing past: noise through a band-pass whose centre sweeps up then down, swelling to a peak. */
export const whoosh = (seconds = 0.6, peakAt = 0.55): Float32Array => {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  const rnd = noise(7);
  let low = 0;
  let band = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    // Swell: slow rise to the peak, quicker fall (the cut happens at the peak).
    const env = t < peakAt ? Math.pow(t / peakAt, 2.2) : Math.pow(1 - (t - peakAt) / (1 - peakAt), 1.6);
    const centre = 350 + 2600 * Math.sin(Math.PI * Math.min(1, t / (peakAt * 1.6)));
    // State-variable filter (Chamberlin), band-pass output.
    const f = 2 * Math.sin((Math.PI * centre) / RATE);
    const q = 0.55;
    low += f * band;
    const high = rnd() - low - q * band;
    band += f * high;
    out[i] = band * env;
  }
  return normalize(out, 0.85);
};

/** A deep hit: a sub sine dropping in pitch, a short noise transient, soft saturation. */
export const impact = (seconds = 0.9): Float32Array => {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  const rnd = noise(11);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const freq = 42 + 78 * Math.exp(-t / 0.07);
    phase += (2 * Math.PI * freq) / RATE;
    const body = Math.sin(phase) * Math.exp(-t / 0.28);
    lp += 0.25 * (rnd() - lp);
    const click = lp * Math.exp(-t / 0.012) * 0.9;
    out[i] = Math.tanh((body + click) * 1.6);
  }
  return normalize(out, 0.9);
};

/** A short, bright tick for a list item appearing. */
export const tick = (seconds = 0.12): Float32Array => {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = Math.exp(-t / 0.022);
    out[i] = (Math.sin(2 * Math.PI * 1750 * t) * 0.7 + Math.sin(2 * Math.PI * 3500 * t) * 0.3) * env;
  }
  return normalize(out, 0.7);
};

/** The three effects as WAV files, keyed by kind. */
export const synthesizeSfx = (): Record<SfxKind, Buffer> => ({
  whoosh: encodeWav(whoosh(), RATE),
  impact: encodeWav(impact(), RATE),
  tick: encodeWav(tick(), RATE),
});

/** Where the cut sits inside the whoosh file (its peak), so the composition can start it early. */
export const WHOOSH_PEAK_SECONDS = 0.6 * 0.55;
