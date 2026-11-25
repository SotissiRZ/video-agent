import { describe, expect, it } from 'vitest';
import { impact, synthesizeSfx, tick, whoosh, WHOOSH_PEAK_SECONDS } from '../src/audio/sfx';
import { StoryboardSchema, type StoryboardInput } from '../src/remotion/contract/storyboard';
import { getStyle } from '../src/remotion/contract/styles';
import { sfxCues } from '../src/remotion/motion/sfx';
import { bulletSpacing, REVEAL_START } from '../src/remotion/utils';

const peakIndex = (s: Float32Array) => s.reduce((best, v, i) => (Math.abs(v) > Math.abs(s[best]!) ? i : best), 0);

describe('synthesised sound design', () => {
  it('produces short, non-silent, deterministic sounds', () => {
    for (const [sound, seconds] of [[whoosh(), 0.6], [impact(), 0.9], [tick(), 0.12]] as const) {
      expect(sound.length).toBe(Math.round(seconds * 44100));
      expect(Math.max(...sound.map(Math.abs))).toBeGreaterThan(0.6);
    }
    expect(whoosh()).toEqual(whoosh());
    // The whoosh swells to its peak where the cut is placed.
    expect(peakIndex(whoosh()) / 44100).toBeGreaterThan(WHOOSH_PEAK_SECONDS - 0.12);
    expect(peakIndex(whoosh()) / 44100).toBeLessThan(WHOOSH_PEAK_SECONDS + 0.12);
    // The impact hits at once.
    expect(peakIndex(impact()) / 44100).toBeLessThan(0.05);
    const wavs = synthesizeSfx();
    expect(wavs.whoosh.toString('ascii', 0, 4)).toBe('RIFF');
  });
});

describe('sound cues', () => {
  const storyboard = (sfx: boolean) =>
    StoryboardSchema.parse({
      version: 1,
      meta: { title: 'Sirago', language: 'fr', template: 'advertisement', style: 'vibrant' },
      theme: getStyle('vibrant').theme,
      format: { width: 1080, height: 1920, fps: 30, durationInFrames: 300 },
      scenes: [
        { id: 'a', kind: 'title', role: 'hook', durationInFrames: 100, headline: 'Pressé ?', transitionOut: { type: 'whip', durationInFrames: 12 } },
        { id: 'b', kind: 'bullets', role: 'benefits', durationInFrames: 120, headline: 'Roulez malin', items: ['Rapide', 'Pratique', 'Accessible'], transitionOut: { type: 'zoom', durationInFrames: 10 } },
        { id: 'c', kind: 'cta', role: 'cta', durationInFrames: 102, headline: 'En route !', transitionOut: { type: 'none' } },
      ],
      ...(sfx ? { audio: { sfx: { whoosh: 'sfx/whoosh.wav', impact: 'sfx/impact.wav', tick: 'sfx/tick.wav', volume: 1 } } } : {}),
    } as StoryboardInput);

  it('places whooshes on cuts, impacts on titles and ticks on bullets', () => {
    const cues = sfxCues(storyboard(true));
    const peak = Math.round(0.33 * 30);
    // Cut 1: scene a (100 f) with a 12-frame transition, middle at 100 - 12 + 6 = 94.
    expect(cues).toContainEqual({ kind: 'whoosh', from: 94 - peak, volume: 0.7 });
    // Scene b starts at 88; cut 2 middle at 88 + 120 - 10 + 5 = 203.
    expect(cues).toContainEqual({ kind: 'whoosh', from: 203 - peak, volume: 0.7 });
    expect(cues.filter((c) => c.kind === 'impact').map((c) => c.from)).toEqual([8, 198 + 8]);
    const spacing = bulletSpacing(120, 3);
    expect(cues.filter((c) => c.kind === 'tick').map((c) => c.from)).toEqual([0, 1, 2].map((k) => 88 + REVEAL_START + k * spacing + 3));
    expect(cues.map((c) => c.from)).toEqual([...cues.map((c) => c.from)].sort((x, y) => x - y));
  });

  it('adds nothing to storyboards without sound design (older videos re-rendered)', () => {
    expect(sfxCues(storyboard(false))).toEqual([]);
  });
});
