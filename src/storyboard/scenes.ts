/** Scene-level decisions that depend on the output format (layout, density). */
import type { Scene, Storyboard } from '../remotion/contract/storyboard';

export const MAX_ITEMS = 5;

export const refineScenes = (storyboard: Storyboard): Storyboard => {
  const { width, height } = storyboard.format;
  const portrait = height > width * 1.15;
  const scenes: Scene[] = storyboard.scenes.map((scene, i) => {
    const items = scene.items.slice(0, MAX_ITEMS);
    // Landscape: alternate left-aligned text scenes for rhythm. Portrait: always centred.
    const layout = !portrait && (scene.kind === 'text' || scene.kind === 'bullets') && i % 2 === 1 ? 'left' : 'center';
    // Long step lists don't fit side by side in landscape: use a bullet list instead.
    const kind = scene.kind === 'steps' && !portrait && items.some((it) => it.length > 28) ? 'bullets' : scene.kind;
    return { ...scene, kind, items, layout };
  });
  return { ...storyboard, scenes };
};
