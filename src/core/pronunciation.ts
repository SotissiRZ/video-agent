/**
 * Customer pronunciation fixes: a word written one way, spoken another ("SOVID" → "So-vide").
 * Applied to the text sent to the voice only, so on-screen text and subtitles keep the spelling.
 */
export interface Pronunciation {
  word: string;
  spoken: string;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordPattern = (word: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(word.trim())}(?![\\p{L}\\p{N}])`, 'giu');

/** Whole words only, case-insensitive; longer entries first so "Bissap Doux" wins over "Bissap". */
export const applyPronunciations = (text: string, entries: Pronunciation[] = []): string =>
  [...entries]
    .filter((entry) => entry.word.trim() && entry.spoken.trim())
    .sort((a, b) => b.word.length - a.word.length)
    .reduce((out, entry) => out.replace(wordPattern(entry.word), entry.spoken.trim()), text);

const AND: Record<string, string> = { fr: 'et', en: 'and', pt: 'e', ar: 'و', ary: 'و', sw: 'na' };

/**
 * Symbols voices read in English or aloud: "Sites web & applications" becomes "Sites web et
 * applications", "Web • IA • Data" a list with pauses. On screen the text keeps its symbols.
 */
export const spokenText = (text: string, language: string): string =>
  text
    .replace(/\s*&\s*/g, ` ${AND[language] ?? AND[language.split('-')[0]!] ?? 'and'} `)
    .replace(/\s*[•·|]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

/** Does this text contain one of the words (to know which scenes must be voiced again)? */
export const mentionsAny = (text: string, entries: Pronunciation[]): boolean => entries.some((entry) => entry.word.trim() && wordPattern(entry.word).test(text));
