/** Right-to-left languages (browser-safe: used by the composition). */
export const RTL_LANGUAGES = ['ar', 'ary', 'he', 'fa', 'ur'];
export const isRtl = (language: string | undefined): boolean => Boolean(language && RTL_LANGUAGES.includes(language.split('-')[0]!));
