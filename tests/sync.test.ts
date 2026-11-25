import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElevenLabsVoiceProvider } from '../src/providers/voice/elevenlabs';
import { StoryboardSchema, type StoryboardInput } from '../src/remotion/contract/storyboard';
import { getStyle } from '../src/remotion/contract/styles';
import { estimateWordTimings, findSpoken, itemRevealFrames, shotStarts, voiceOffsetInScene, wordsFromAlignment } from '../src/remotion/motion/sync';
import { buildSubtitleCues } from '../src/subtitles/subtitles';
import { tmpDir } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const alignmentOf = (text: string, secondsPerChar: number, lead = 0) => {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => lead + i * secondsPerChar),
    character_end_times_seconds: characters.map((_, i) => lead + (i + 1) * secondsPerChar),
  };
};

describe('word timings', () => {
  it('estimates by syllables, with pauses on punctuation, filling the voice exactly', () => {
    const words = estimateWordTimings('Rapide, pratique et accessible.', 3, 30);
    expect(words.map((w) => w.text)).toEqual(['Rapide,', 'pratique', 'et', 'accessible.']);
    expect(words[0]!.from).toBe(0);
    expect(words[3]!.to).toBe(90);
    // "accessible" (4 syllables) lasts longer than "et" (1).
    expect(words[3]!.to - words[3]!.from).toBeGreaterThan(3 * (words[2]!.to - words[2]!.from));
    // The comma leaves a gap before "pratique".
    expect(words[1]!.from).toBeGreaterThan(words[0]!.to);
  });

  it('builds words from character timings, shifted by the trimmed leading silence', () => {
    const words = wordsFromAlignment(alignmentOf('Roulez malin !', 0.1, 0.5), 30, 0.5);
    expect(words).toEqual([
      { text: 'Roulez', from: 0, to: 18 },
      { text: 'malin', from: 21, to: 36 },
    ]);
  });

  it('finds a phrase in the voice on 5-letter stems, in order', () => {
    const words = [{ text: 'Un' }, { text: 'trajet' }, { text: 'rapide,' }, { text: 'pratique' }, { text: 'et' }, { text: 'accessibles' }];
    expect(findSpoken(words, 'Rapide')).toBe(2);
    expect(findSpoken(words, 'Accessible')).toBe(5);
    expect(findSpoken(words, 'Rapide', 3)).toBe(-1);
    expect(findSpoken(words, 'Économique')).toBe(-1);
  });
});

describe('picture on the voice', () => {
  const voiceWords = [
    { text: 'Un', from: 0, to: 6 },
    { text: 'trajet', from: 7, to: 20 },
    { text: 'rapide,', from: 21, to: 40 },
    { text: 'pratique', from: 50, to: 70 },
    { text: 'et', from: 71, to: 75 },
    { text: 'accessible.', from: 76, to: 100 },
  ];

  it('reveals each bullet a few frames before the voice says it, in order and spaced', () => {
    const scene = { durationInFrames: 180, voiceover: { src: 'v.wav', durationInFrames: 100, volume: 1, words: voiceWords } };
    expect(itemRevealFrames(scene, 9, ['Rapide', 'Pratique', 'Accessible'], 30)).toEqual([9 + 21 - 4, 9 + 50 - 4, 9 + 76 - 4]);
    // A bullet the voice never says keeps the regular spacing, still after the previous one.
    expect(itemRevealFrames(scene, 9, ['Rapide', 'Économique', 'Accessible'], 30)).toEqual([26, 45, 81]);
    // Without word timings: the regular spacing.
    expect(itemRevealFrames({ durationInFrames: 180 }, 9, ['A', 'B'], 30)).toEqual([15, 45]);
  });

  it('times subtitles on the spoken words', () => {
    const storyboard = StoryboardSchema.parse({
      meta: { title: 'Sirago', template: 'advertisement', style: 'vibrant' },
      theme: getStyle('vibrant').theme,
      format: { width: 1080, height: 1920, fps: 30, durationInFrames: 200 },
      scenes: [
        {
          id: 'b',
          kind: 'bullets',
          role: 'benefits',
          durationInFrames: 200,
          headline: 'Roulez malin',
          items: ['Rapide', 'Pratique', 'Accessible'],
          narration: 'Un trajet rapide, pratique et accessible.',
          voiceover: { src: 'v.wav', durationInFrames: 100, words: voiceWords },
          transitionOut: { type: 'none' },
        },
      ],
    } as StoryboardInput);
    const offset = voiceOffsetInScene(storyboard.scenes, 0);
    const cues = buildSubtitleCues(storyboard, 20);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0]!.startFrame).toBe(offset);
    // Each following line starts exactly when its first word is spoken.
    const second = cues[1]!;
    const firstWord = second.text.split(' ')[0]!;
    const word = voiceWords.find((w) => w.text === firstWord)!;
    expect(second.startFrame).toBe(offset + word.from);
  });
});

describe('ElevenLabs voice with timestamps', () => {
  it('writes the audio and returns its character alignment', async () => {
    const pcm = Buffer.alloc(22050 * 2); // one second of silence
    const alignment = alignmentOf('Bonjour', 0.1);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ audio_base64: pcm.toString('base64'), alignment })));
    vi.stubGlobal('fetch', fetchMock);
    const outFile = path.join(tmpDir(), 'v.wav');
    const result = await new ElevenLabsVoiceProvider({ apiKey: 'k', voiceId: 'voice1', model: 'eleven_multilingual_v2' }).synthesize({ text: 'Bonjour', language: 'fr', outFile });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/text-to-speech/voice1/with-timestamps?output_format=pcm_22050');
    expect(result.durationSec).toBeCloseTo(1, 2);
    expect(result.alignment).toEqual(alignment);
    expect(fs.readFileSync(outFile).toString('ascii', 0, 4)).toBe('RIFF');
  });
});

describe('cuts on the voice', () => {
  // "Réservez en quelques clics. Partez quand vous voulez, payez simplement." over 180 frames.
  const words = [
    { text: 'Réservez', from: 0, to: 15 },
    { text: 'en', from: 16, to: 20 },
    { text: 'quelques', from: 21, to: 35 },
    { text: 'clics.', from: 36, to: 50 },
    { text: 'Partez', from: 66, to: 80 },
    { text: 'quand', from: 81, to: 90 },
    { text: 'vous', from: 91, to: 96 },
    { text: 'voulez,', from: 97, to: 110 },
    { text: 'payez', from: 118, to: 130 },
    { text: 'simplement.', from: 131, to: 160 },
  ];

  it('moves each cut to the nearest sentence or clause start', () => {
    // Even split 0 / 60 / 120; phrase starts (voice 9 frames in): "Partez" at 75, "payez" at 127.
    expect(shotStarts(180, 3, 48, words, 9)).toEqual([0, 75, 127]);
    // Without word timings: the even split.
    expect(shotStarts(180, 3, 48)).toEqual([0, 60, 120]);
  });

  it('keeps the even cut when snapping would make a shot too short', () => {
    // With 55-frame shots at least: 75 then 127 would leave 52 and 53 frames, so both cuts stay even.
    expect(shotStarts(180, 3, 55, words, 9)).toEqual([0, 60, 120]);
    // With 50, the voice-aligned cuts fit (75, 52 and 53 frames).
    expect(shotStarts(180, 3, 50, words, 9)).toEqual([0, 75, 127]);
  });
});
