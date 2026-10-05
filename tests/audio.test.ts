import { describe, expect, it } from 'vitest';
import { synthesizeMusic } from '../src/audio/music';
import { encodeWav, pcm16ToWav, trimWavSilence, wavDurationSec } from '../src/audio/wav';

describe('audio', () => {
  it('trims the silence around a voice clip, keeping a short margin', () => {
    const rate = 22050;
    const samples = new Float32Array(rate * 2); // 2 s
    for (let i = Math.round(rate * 0.6); i < Math.round(rate * 1.4); i++) samples[i] = Math.sin(i / 5) * 0.5; // speech 0.6 s → 1.4 s
    const trimmed = trimWavSilence(encodeWav(samples, rate));
    expect(wavDurationSec(trimmed)).toBeCloseTo(0.9, 1);
    expect(trimWavSilence(Buffer.from('not a wav'))).toEqual(Buffer.from('not a wav'));
    const silent = encodeWav(new Float32Array(rate), rate);
    expect(trimWavSilence(silent)).toBe(silent);
  });

  it('encodes and measures WAV files', () => {
    const wav = encodeWav(new Float32Array(22050), 11025);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wavDurationSec(wav)).toBeCloseTo(2, 5);
    expect(wavDurationSec(pcm16ToWav(Buffer.alloc(44100), 22050))).toBeCloseTo(1, 5);
    expect(() => wavDurationSec(Buffer.from('nope'))).toThrow();
  });

  it('synthesizes deterministic music covering the video', () => {
    const a = synthesizeMusic({ durationSec: 3, mood: 'energetic', seed: 1, sampleRate: 8000 });
    const b = synthesizeMusic({ durationSec: 3, mood: 'energetic', seed: 1, sampleRate: 8000 });
    expect(a.equals(b)).toBe(true);
    expect(wavDurationSec(a)).toBeGreaterThanOrEqual(3);
    let peak = 0;
    for (let i = 44; i < a.length; i += 2) peak = Math.max(peak, Math.abs(a.readInt16LE(i)));
    expect(peak).toBeGreaterThan(5000);
    expect(peak).toBeLessThan(32767);
    expect(synthesizeMusic({ durationSec: 2, mood: 'calm', minor: true, sampleRate: 8000 }).length).toBeGreaterThan(44);
  });
});
