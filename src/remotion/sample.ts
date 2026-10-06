import { StoryboardSchema, type Storyboard } from './contract/storyboard';
import { computeTotalDuration } from './contract/timeline';
import { getStyle } from './contract/styles';

/** Demo storyboard used as default props in Remotion Studio. */
const style = getStyle('modern');
const scenes = StoryboardSchema.shape.scenes.parse([
  { id: 'hook', kind: 'title', role: 'hook', durationInFrames: 90, subheadline: 'SOVID AI', headline: 'Des vidéos *en une phrase*', narration: 'Des vidéos en une phrase.', background: { variant: 'shapes' }, transitionOut: { type: 'slide' } },
  { id: 'features', kind: 'bullets', role: 'benefits', durationInFrames: 120, headline: 'Tout est *automatique*', items: ['Script et storyboard', 'Animations Remotion', 'Sous-titres et musique'], background: { variant: 'grid' }, transitionOut: { type: 'wipe' } },
  { id: 'stat', kind: 'stat', role: 'proof', durationInFrames: 75, headline: 'Formats', stat: { value: '3', label: '16:9 · 9:16 · 1:1' }, background: { variant: 'spotlight' } },
  { id: 'cta', kind: 'cta', role: 'cta', durationInFrames: 90, headline: 'À vous de *créer*', subheadline: 'npm run demo', background: { variant: 'gradient' } },
]);

export const SAMPLE_STORYBOARD: Storyboard = StoryboardSchema.parse({
  meta: { title: 'SOVID AI demo', language: 'fr', template: 'advertisement', style: 'modern' },
  format: { width: 1080, height: 1920, fps: 30, durationInFrames: computeTotalDuration(scenes) },
  theme: style.theme,
  brand: { name: 'SOVID AI' },
  scenes,
  subtitles: { enabled: false },
});
