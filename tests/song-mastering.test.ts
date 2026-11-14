import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { audioDurationSec, softenSongEdges, toWav } from '../src/audio/ffmpeg';
import { encodeWav } from '../src/audio/wav';
import { compositionChunks, songEdgesSec } from '../src/providers/music/elevenlabs-song';
import { lyricSections } from '../src/providers/music/lyrics';
import { tmpDir } from './helpers';

const rms = (wav: Buffer, fromSec: number, toSec: number, rate = 22050) => {
  const data = 44;
  let sum = 0;
  let n = 0;
  for (let i = Math.floor(fromSec * rate); i < Math.floor(toSec * rate); i++) {
    const v = wav.readInt16LE(data + i * 2) / 32768;
    sum += v * v;
    n++;
  }
  return Math.sqrt(sum / n);
};

describe('song edges', () => {
  it('reserves an instrumental intro and outro and asks for them', () => {
    expect(songEdgesSec(20)).toEqual({ intro: 0, outro: 0 });
    expect(songEdgesSec(60)).toEqual({ intro: 5, outro: 5 });
    expect(songEdgesSec(120)).toEqual({ intro: 8, outro: 8 });
    const chunks = compositionChunks(lyricSections('[Verse]\nune\ndeux\n[Chorus]\ntrois\nquatre'), 60, ['pop music']);
    // 50 s sung, shared equally, plus 5 s of intro and 5 s of outro.
    expect(chunks.map((c) => c.duration_ms)).toEqual([30_000, 30_000]);
    expect(chunks[0]!.positive_styles.join(' ')).toMatch(/5-second instrumental intro/);
    expect(chunks[1]!.positive_styles.join(' ')).toMatch(/instrumental outro that fades out gently/);
  });

  it('fades the mastered song in briefly and out smoothly', async () => {
    const dir = tmpDir();
    const input = path.join(dir, 'raw.wav');
    const rate = 22050;
    // 8 s of a steady tone: any change of level comes from the mastering.
    const tone = Float32Array.from({ length: rate * 8 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate));
    fs.writeFileSync(input, encodeWav(tone, rate));
    const output = path.join(dir, 'song.mp3');
    await softenSongEdges(input, output, { fadeOutSec: 2 });
    expect(await audioDurationSec(output)).toBeCloseTo(8, 0);
    const wav = await toWav(fs.readFileSync(output));
    const middle = rms(wav, 3, 5);
    expect(middle).toBeGreaterThan(0.15); // mono → stereo → mono costs ~3 dB; the fades are checked against it
    expect(rms(wav, 7.6, 7.9)).toBeLessThan(middle * 0.1); // almost silent at the very end
    expect(rms(wav, 6.2, 6.5)).toBeLessThan(middle); // already fading
    expect(rms(wav, 0, 0.05)).toBeLessThan(middle * 0.5); // no click at the start
  }, 30_000);
});
