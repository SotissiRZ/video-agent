import React from 'react';
import type { SceneKind } from '../contract/storyboard';
import { BulletsScene } from './BulletsScene';
import { CtaScene } from './CtaScene';
import { ImageScene } from './ImageScene';
import { QuoteScene } from './QuoteScene';
import type { SceneProps } from './SceneShell';
import { StatScene } from './StatScene';
import { StepsScene } from './StepsScene';
import { TextScene } from './TextScene';
import { TitleScene } from './TitleScene';

/** Scene kind → component. Add a new kind here (and in the storyboard schema) to extend the engine. */
export const SCENE_COMPONENTS: Record<SceneKind, React.FC<SceneProps>> = {
  title: TitleScene,
  text: TextScene,
  bullets: BulletsScene,
  stat: StatScene,
  image: ImageScene,
  quote: QuoteScene,
  steps: StepsScene,
  cta: CtaScene,
};

export const SceneRenderer: React.FC<SceneProps> = (props) => {
  const Component = SCENE_COMPONENTS[props.scene.kind] ?? TextScene;
  return <Component {...props} />;
};

export type { SceneProps };
