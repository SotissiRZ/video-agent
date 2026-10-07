/** Assigns motion design (entrances, backgrounds, transitions, layouts) according to the style. */
import type { Scene, Storyboard } from '../remotion/contract/storyboard';
import type { StyleDefinition } from '../remotion/contract/styles';

const DIRECTIONS = ['from-right', 'from-bottom', 'from-left', 'from-top'] as const;

export const applyAnimations = (storyboard: Storyboard, style: StyleDefinition): Storyboard => {
  const { fps } = storyboard.format;
  const stagger = style.theme.motion === 'energetic' ? 3 : style.theme.motion === 'calm' ? 6 : 4;
  const baseTransition = Math.round(style.transitionSeconds * fps);

  const scenes: Scene[] = storyboard.scenes.map((scene, i) => {
    const isLast = i === storyboard.scenes.length - 1;
    const background = scene.kind === 'cta' ? style.ctaBackground ?? 'gradient' : style.backgrounds[i % style.backgrounds.length]!;
    // Never let a transition eat more than a third of the shorter neighbour.
    const next = storyboard.scenes[i + 1];
    const maxTransition = next ? Math.floor(Math.min(scene.durationInFrames, next.durationInFrames) / 3) : 0;
    const type = isLast ? 'none' : style.transitions[i % style.transitions.length]!;
    return {
      ...scene,
      background: { ...scene.background, variant: scene.media && scene.kind !== 'image' ? 'media' : background },
      animation: {
        entrance: scene.kind === 'quote' ? 'blur' : style.entrances[i % style.entrances.length]!,
        stagger,
        kenBurns: scene.media ? 0.025 : 0.04,
      },
      transitionOut: {
        type,
        durationInFrames: Math.max(0, Math.min(baseTransition, maxTransition)),
        direction: DIRECTIONS[i % DIRECTIONS.length]!,
      },
    };
  });
  return { ...storyboard, scenes };
};
