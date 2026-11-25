import { describe, expect, it } from 'vitest';
import { compositionChunks } from '../src/providers/music/elevenlabs-song';
import { lyricSections, lyricsProblem, MAX_SECTION_LINES, MAX_SONG_LINES } from '../src/providers/music/lyrics';
import { fitLyrics, lyricLineBudget } from '../src/saas/songs';

const section = (label: string, lines: number) => [`[${label}]`, ...Array.from({ length: lines }, (_, i) => `${label} ligne ${i + 1}`)].join('\n');
const twoMinuteSong = [section('Verse 1', 8), section('Chorus', 6), section('Verse 2', 8), section('Chorus', 6), section('Bridge', 4), section('Chorus', 6)].join('\n\n');

describe('lyric sections', () => {
  it('splits on labels, or on stanzas without labels, and drops lone labels', () => {
    expect(lyricSections(twoMinuteSong).map((s) => [s.name, s.lines.length])).toEqual([
      ['Verse 1', 8],
      ['Chorus', 6],
      ['Verse 2', 8],
      ['Chorus', 6],
      ['Bridge', 4],
      ['Chorus', 6],
    ]);
    expect(lyricSections('une\ndeux\n\ntrois').map((s) => s.lines)).toEqual([['une', 'deux'], ['trois']]);
    expect(lyricSections('[Intro]\n\n[Verse]\nla la')).toEqual([{ name: 'Verse', lines: ['la la'] }]);
    expect(lyricSections('avant le titre\n[Chorus]\nrefrain')[0]).toEqual({ name: 'Intro', lines: ['avant le titre'] });
  });

  it('accepts a two-minute song of 38 lines: the limit is 30 lines per section', () => {
    expect(lyricsProblem(twoMinuteSong)).toBeNull();
    expect(lyricsProblem(section('Verse', MAX_SECTION_LINES + 1))).toBe('section_too_long');
    expect(lyricsProblem(`[Chorus]\n${'x'.repeat(201)}`)).toBe('line_too_long');
    expect(lyricsProblem(Array.from({ length: 4 }, (_, i) => section(`V${i}`, 25)).join('\n'))).toBe('too_long');
    expect(lyricsProblem('[Outro]')).toBe('empty');
  });

  it('asks for about one sung line every 4 s, in more sections for longer songs', () => {
    expect(lyricLineBudget(30)).toEqual({ sung: 8, sections: 2 });
    expect(lyricLineBudget(120)).toEqual({ sung: 30, sections: 5 });
  });
});

describe('composition chunks', () => {
  const styles = ['afropop music'];

  it('makes one chunk per section, sharing the exact length by line count', () => {
    const chunks = compositionChunks(lyricSections(twoMinuteSong), 120, styles);
    expect(chunks).toHaveLength(6);
    expect(chunks.reduce((n, c) => n + c.duration_ms, 0)).toBe(120_000);
    expect(chunks[0]!.duration_ms).toBeGreaterThan(chunks[4]!.duration_ms); // 8 lines vs 4
    expect(chunks[1]!.text).toBe(Array.from({ length: 6 }, (_, i) => `Chorus ligne ${i + 1}`).join('\n'));
    expect(chunks[1]!.positive_styles).toEqual(['afropop music', 'Chorus of the song']);
    for (const c of chunks) expect(c.duration_ms).toBeGreaterThanOrEqual(3000);
  });

  it('merges neighbouring sections when a short song has too many of them', () => {
    const many = Array.from({ length: 12 }, (_, i) => section(`S${i}`, 1)).join('\n');
    const chunks = compositionChunks(lyricSections(many), 20, styles);
    expect(chunks.length).toBeLessThanOrEqual(6);
    expect(chunks.reduce((n, c) => n + c.duration_ms, 0)).toBe(20_000);
    for (const c of chunks) expect(c.duration_ms).toBeGreaterThanOrEqual(3000);
  });

  it('refuses a song longer than 120 s per section', () => {
    expect(() => compositionChunks(lyricSections('[Verse]\nla la'), 200, styles)).toThrow(/120 s/);
  });
});

describe('fitLyrics (safety net for AI drafts)', () => {
  it('keeps valid lyrics untouched, two-minute songs included', () => {
    expect(fitLyrics(twoMinuteSong)).toBe(twoMinuteSong);
  });

  it('caps a section at 30 lines, a song at the total cap, and shortens long lines', () => {
    expect(lyricSections(fitLyrics(section('Verse', 40)))[0]!.lines).toHaveLength(MAX_SECTION_LINES);
    const huge = Array.from({ length: 5 }, (_, i) => section(`V${i}`, 20)).join('\n\n');
    const fitted = fitLyrics(huge);
    expect(lyricsProblem(fitted)).toBeNull();
    expect(lyricSections(fitted).reduce((n, s) => n + s.lines.length, 0)).toBeLessThanOrEqual(MAX_SONG_LINES);
    expect(fitted).not.toContain('[V4]');
    const line = fitLyrics(`[Verse]\n${'mot '.repeat(60)}fin`).split('\n')[1]!;
    expect(line.length).toBeLessThanOrEqual(200);
    expect(line.endsWith('mot')).toBe(true);
  });
});
