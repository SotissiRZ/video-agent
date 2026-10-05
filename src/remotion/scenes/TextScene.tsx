import React from 'react';
import { AnimatedText } from '../components/AnimatedText';
import { bodyFontSize, fitFontSize, useLayout } from '../utils';
import { FadeUp, Kicker, SceneShell, type SceneProps } from './SceneShell';

/** Headline + paragraph. */
export const TextScene: React.FC<SceneProps> = (props) => {
  const { scene, storyboard } = props;
  const layout = useLayout();
  const { theme } = storyboard;
  const align = scene.layout === 'left' ? 'left' : 'center';
  return (
    <SceneShell {...props}>
      <Kicker text={scene.subheadline} storyboard={storyboard} />
      <AnimatedText
        text={scene.headline}
        theme={theme}
        entrance={scene.animation.entrance}
        stagger={scene.animation.stagger}
        delay={4}
        fontSize={fitFontSize(scene.headline, layout, 0.095)}
        align={align}
        uppercase={theme.uppercaseHeadlines}
        maxWidth={layout.contentWidth}
      />
      {scene.body ? (
        <FadeUp delay={18}>
          <p
            style={{
              fontFamily: theme.bodyFont,
              fontSize: bodyFontSize(scene.body, layout),
              color: theme.palette.mutedText,
              textAlign: align,
              margin: 0,
              lineHeight: 1.4,
              maxWidth: layout.contentWidth * 0.92,
            }}
          >
            {scene.body}
          </p>
        </FadeUp>
      ) : null}
    </SceneShell>
  );
};
