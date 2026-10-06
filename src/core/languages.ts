/**
 * Languages a video can be written and voiced in. French and English are written by the
 * offline copywriter too; the others need an LLM (Claude, GPT, Llama via Groq...), which
 * writes on-screen text and narration in the requested language.
 */
export interface LanguageInfo {
  code: string;
  /** English name, given to the LLM. */
  name: string;
  /** Name in the language itself (UI). */
  native: string;
  /** Language of the offline copywriter and of the publishing captions. */
  base: 'fr' | 'en';
  rtl?: boolean;
  /** Piper voice (free, local). */
  piper?: string;
  /** Meta MMS text-to-speech on Hugging Face (ISO 639-3), experimental. */
  mms?: string;
  /** espeak-ng voice. */
  espeak?: string;
  /** Supported by ElevenLabs multilingual models. */
  elevenlabs?: boolean;
  /** Supported by OpenAI text-to-speech. */
  openai?: boolean;
  /** "en wolof", "in Swahili"... (normalized prompt: no accents, lower case). */
  detect?: RegExp;
}

export const LANGUAGES: LanguageInfo[] = [
  { code: 'fr', name: 'French', native: 'Français', base: 'fr', elevenlabs: true, openai: true, espeak: 'fr' },
  { code: 'en', name: 'English', native: 'English', base: 'en', elevenlabs: true, openai: true, espeak: 'en' },
  {
    code: 'ar', name: 'Modern Standard Arabic', native: 'العربية', base: 'fr', rtl: true, piper: 'ar_JO-kareem-medium', elevenlabs: true, openai: true, espeak: 'ar',
    detect: /\b(en|in) arabe?\b|\barabic\b|\ben langue arabe\b/,
  },
  {
    code: 'ary', name: 'Moroccan Arabic (Darija), written in Arabic script', native: 'الدارجة', base: 'fr', rtl: true, piper: 'ar_JO-kareem-medium', elevenlabs: true, openai: true, espeak: 'ar',
    detect: /\bdarija\b|\ben marocain\b|\barabe marocain\b/,
  },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili', base: 'en', piper: 'sw_CD-lanfrica-medium', mms: 'swh', openai: true, espeak: 'sw', detect: /\bswahili\b|\bkiswahili\b/ },
  { code: 'ha', name: 'Hausa', native: 'Hausa', base: 'fr', mms: 'hau', detect: /\b(en|in) haoussa\b|\b(en|in) hausa\b/ },
  { code: 'yo', name: 'Yoruba (with tone marks)', native: 'Yorùbá', base: 'en', mms: 'yor', detect: /\byoruba\b/ },
  { code: 'wo', name: 'Wolof', native: 'Wolof', base: 'fr', mms: 'wol', detect: /\bwolof\b/ },
  { code: 'bm', name: 'Bambara', native: 'Bamanankan', base: 'fr', mms: 'bam', detect: /\bbambara\b|\bbamanankan\b/ },
  { code: 'ln', name: 'Lingala', native: 'Lingála', base: 'fr', mms: 'lin', detect: /\blingala\b/ },
  { code: 'pt', name: 'Portuguese', native: 'Português', base: 'en', piper: 'pt_BR-faber-medium', elevenlabs: true, openai: true, espeak: 'pt', detect: /\b(en|in) portugais\b|\bportuguese\b/ },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

export const getLanguage = (code: string | undefined): LanguageInfo | undefined => LANGUAGES.find((l) => l.code === code);

/** Language explicitly requested in a prompt ("une vidéo en wolof"), if any. */
export const detectRequestedLanguage = (normalizedPrompt: string): string | undefined => LANGUAGES.find((l) => l.detect?.test(normalizedPrompt))?.code;
