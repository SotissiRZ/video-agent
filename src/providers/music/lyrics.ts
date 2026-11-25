/**
 * Song lyrics as sections. ElevenLabs Music (composition plan, music_v2_5) takes one chunk per
 * section, each with at most 30 lines of 200 characters and 3–120 s: a long song is several
 * chunks, not one 30-line block.
 */
export const MAX_SECTION_LINES = 30;
export const MAX_LINE_CHARS = 200;
/** Sanity cap for a whole song (about 2 minutes of singing is ~30–40 lines). */
export const MAX_SONG_LINES = 80;

const LABEL = /^\s*\[([^\]]{1,100})\]\s*$/;

export interface LyricSection {
  name: string;
  lines: string[];
}

/**
 * Sections from [Label] lines; without any label, stanzas separated by blank lines.
 * Labels alone (an instrumental "[Outro]") carry no lines and are dropped.
 */
export const lyricSections = (lyrics: string): LyricSection[] => {
  const raw = lyrics.split(/\r?\n/).map((line) => line.trim());
  const labelled = raw.some((line) => LABEL.test(line));
  const sections: LyricSection[] = [];
  let current: LyricSection | undefined;
  for (const line of raw) {
    const label = LABEL.exec(line);
    if (label) {
      current = { name: label[1]!.trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (!line) {
      if (!labelled) current = undefined;
      continue;
    }
    if (!current) {
      current = { name: labelled ? 'Intro' : `Part ${sections.length + 1}`, lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  }
  return sections.filter((section) => section.lines.length);
};

export type LyricsProblem = 'empty' | 'section_too_long' | 'line_too_long' | 'too_long';

export const lyricsProblem = (lyrics: string): LyricsProblem | null => {
  const sections = lyricSections(lyrics);
  if (!sections.length) return 'empty';
  if (sections.some((s) => s.lines.some((line) => line.length > MAX_LINE_CHARS))) return 'line_too_long';
  if (sections.some((s) => s.lines.length > MAX_SECTION_LINES)) return 'section_too_long';
  if (sections.reduce((n, s) => n + s.lines.length, 0) > MAX_SONG_LINES) return 'too_long';
  return null;
};
