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
import { VoiceSyncContext, voiceOffsetInScene } from '../motion/sync';

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
  // Every element of the scene can follow its voice-over word by word.
  const sync = React.useMemo(
    () => ({ words: props.scene.voiceover?.words ?? [], offset: voiceOffsetInScene(props.storyboard.scenes, props.index) }),
    [props.scene.voiceover?.words, props.storyboard.scenes, props.index],
  );
  return (
    <VoiceSyncContext.Provider value={sync}>
      <Component {...props} />
    </VoiceSyncContext.Provider>
  );
};

export type { SceneProps };
