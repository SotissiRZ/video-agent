/**
 * Fonts are bundled from @fontsource packages so rendering works offline and looks
 * identical on Windows, macOS and Linux. loadFont() blocks rendering until they are ready.
 *
 * Note: the Latin subset covers French, English, Spanish, Portuguese, German...
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
import { BODY_FONT, HEADING_FONT } from './contract/styles';

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
  ];
  for (const font of fonts) {
    loadFont({ ...font, display: 'block', format: 'woff2' }).catch((err) => {
      // A missing font must not break the render: system fallbacks are declared in the theme.
      console.warn(`[video-agent] could not load font ${font.family} ${font.weight}`, err);
    });
  }
};
