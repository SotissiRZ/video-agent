/**
 * Fonts are bundled from @fontsource packages so rendering works offline and looks
 * identical on Windows, macOS and Linux. loadFont() blocks rendering until they are ready.
 *
 * The Latin subset covers French, English, Portuguese...; the Latin Extended subset
 * (Hausa ɓ ɗ ƙ, Yoruba ẹ ọ ṣ, Lingala and Bambara ɛ ɔ ɲ) and Noto Sans Arabic are
 * registered under their own family names, listed after the main font in the theme:
 * the browser falls back to them glyph by glyph.
 * Do not pass `unicodeRange` to loadFont(): in headless Chrome the face is then
 * registered but never applied.
 */
import { loadFont } from '@remotion/fonts';
import montserrat600 from '@fontsource/montserrat/files/montserrat-latin-600-normal.woff2';
import montserrat700 from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff2';
import montserrat800 from '@fontsource/montserrat/files/montserrat-latin-800-normal.woff2';
import montserrat900 from '@fontsource/montserrat/files/montserrat-latin-900-normal.woff2';
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2';
import montserratExt600 from '@fontsource/montserrat/files/montserrat-latin-ext-600-normal.woff2';
import montserratExt700 from '@fontsource/montserrat/files/montserrat-latin-ext-700-normal.woff2';
import montserratExt800 from '@fontsource/montserrat/files/montserrat-latin-ext-800-normal.woff2';
import montserratExt900 from '@fontsource/montserrat/files/montserrat-latin-ext-900-normal.woff2';
import interExt400 from '@fontsource/inter/files/inter-latin-ext-400-normal.woff2';
import interExt600 from '@fontsource/inter/files/inter-latin-ext-600-normal.woff2';
import arabic400 from '@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-400-normal.woff2';
import arabic600 from '@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-600-normal.woff2';
import arabic700 from '@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-700-normal.woff2';
import arabic800 from '@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-800-normal.woff2';
import arabic900 from '@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-900-normal.woff2';
import { ARABIC_FONT, BODY_FONT, BODY_FONT_EXT, HEADING_FONT, HEADING_FONT_EXT } from './contract/styles';

let loaded = false;

export const ensureFonts = (): void => {
  if (loaded) return;
  loaded = true;
  const fonts = [
    { family: HEADING_FONT, url: montserrat600, weight: '600' },
    { family: HEADING_FONT, url: montserrat700, weight: '700' },
    { family: HEADING_FONT, url: montserrat800, weight: '800' },
    { family: HEADING_FONT, url: montserrat900, weight: '900' },
    { family: BODY_FONT, url: inter400, weight: '400' },
    { family: BODY_FONT, url: inter600, weight: '600' },
    { family: HEADING_FONT_EXT, url: montserratExt600, weight: '600' },
    { family: HEADING_FONT_EXT, url: montserratExt700, weight: '700' },
    { family: HEADING_FONT_EXT, url: montserratExt800, weight: '800' },
    { family: HEADING_FONT_EXT, url: montserratExt900, weight: '900' },
    { family: BODY_FONT_EXT, url: interExt400, weight: '400' },
    { family: BODY_FONT_EXT, url: interExt600, weight: '600' },
    { family: ARABIC_FONT, url: arabic400, weight: '400' },
    { family: ARABIC_FONT, url: arabic600, weight: '600' },
    { family: ARABIC_FONT, url: arabic700, weight: '700' },
    { family: ARABIC_FONT, url: arabic800, weight: '800' },
    { family: ARABIC_FONT, url: arabic900, weight: '900' },
  ];
  for (const font of fonts) {
    loadFont({ ...font, display: 'block', format: 'woff2' }).catch((err) => {
      // A missing font must not break the render: system fallbacks are declared in the theme.
      console.warn(`[video-agent] could not load font ${font.family} ${font.weight}`, err);
    });
  }
};
