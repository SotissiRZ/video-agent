import { describe, expect, it } from 'vitest';
import { fitLyrics, lyricLineBudget, lyricsTooLong, MAX_LYRIC_LINES } from '../src/saas/songs';

const nonEmpty = (text: string) => text.split('\n').filter((line) => line.trim()).length;
const section = (label: string, lines: number) => [`[${label}]`, ...Array.from({ length: lines }, (_, i) => `${label} ligne ${i + 1}`)].join('\n');

describe('song lyrics limits', () => {
  it('asks for fewer lines for shorter songs, always under the limit with the labels', () => {
    expect(lyricLineBudget(30)).toEqual({ sung: 8, sections: 2 });
    expect(lyricLineBudget(60)).toEqual({ sung: 15, sections: 3 });
    for (const d of [30, 60, 90, 120]) {
      const { sung, sections } = lyricLineBudget(d);
      expect(sung + sections).toBeLessThanOrEqual(MAX_LYRIC_LINES);
    }
  });

  it('counts section labels as lines', () => {
    expect(lyricsTooLong(section('Verse 1', 29))).toBe(false); // 30 with the label
    expect(lyricsTooLong(section('Verse 1', 30))).toBe(true);
    expect(lyricsTooLong(`[Chorus]\n${'x'.repeat(201)}`)).toBe(true);
  });

  it('keeps short lyrics untouched', () => {
    const lyrics = [section('Verse 1', 6), '', section('Chorus', 4)].join('\n');
    expect(fitLyrics(lyrics)).toBe(lyrics);
  });

  it('drops whole trailing sections, never a cut verse', () => {
    // 36 non-empty lines, like the draft that failed: verse 7 + pre-chorus 3 + chorus 5 + verse 7 + chorus 5 + bridge 4 + outro 5
    const lyrics = [section('Verse 1', 6), section('Pre-Chorus', 2), section('Chorus', 4), section('Verse 2', 6), section('Chorus', 4), section('Bridge', 3), section('Outro', 4)].join('\n\n');
    expect(nonEmpty(lyrics)).toBe(36);
    const fitted = fitLyrics(lyrics);
    expect(lyricsTooLong(fitted)).toBe(false);
    // Up to the second chorus = 27 lines; the bridge would make 31, so it goes with the outro.
    expect(fitted.endsWith('Chorus ligne 4')).toBe(true);
    expect(fitted).not.toContain('[Bridge]');
    expect(nonEmpty(fitted)).toBe(27);
  });

  it('shortens an over-long line at a word boundary and trims a single huge section', () => {
    const long = `${'mot '.repeat(60)}fin`;
    const fitted = fitLyrics(`[Verse]\n${long}`);
    expect(lyricsTooLong(fitted)).toBe(false);
    expect(fitted.split('\n')[1]!.endsWith('mot')).toBe(true);
    const huge = fitLyrics(section('Verse', 40));
    expect(nonEmpty(huge)).toBe(MAX_LYRIC_LINES);
  });
});
