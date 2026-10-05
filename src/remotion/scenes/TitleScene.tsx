import React from 'react';
import { Img } from 'remotion';
import { AnimatedText } from '../components/AnimatedText';
import { bodyFontSize, fitFontSize, resolveSrc, useLayout } from '../utils';
import { FadeUp, Kicker, SceneShell, type SceneProps } from './SceneShell';

/** Opening / hook scene: optional logo, kicker, big headline, short body. */
export const TitleScene: React.FC<SceneProps> = (props) => {
  const { scene, storyboard } = props;
  const layout = useLayout();
  const { theme, brand } = storyboard;
  const showLogo = props.index === 0 && brand.logo;
  return (
    <SceneShell {...props}>
      {showLogo && brand.logo ? (
        <FadeUp>
          <Img src={resolveSrc(brand.logo)} style={{ height: layout.unit * 0.14, width: 'auto', objectFit: 'contain' }} />
        </FadeUp>
      ) : null}
      <Kicker text={scene.subheadline} storyboard={storyboard} />
      <AnimatedText
        text={scene.headline}
        theme={theme}
        entrance={scene.animation.entrance}
        stagger={scene.animation.stagger}
        delay={6}
        fontSize={fitFontSize(scene.headline, layout, 0.12)}
        align={scene.layout === 'left' ? 'left' : 'center'}
        uppercase={theme.uppercaseHeadlines}
        maxWidth={layout.contentWidth}
      />
      {scene.body ? (
        <FadeUp delay={20}>
          <p
            style={{
              fontFamily: theme.bodyFont,
              fontSize: bodyFontSize(scene.body, layout),
              color: theme.palette.mutedText,
              textAlign: scene.layout === 'left' ? 'left' : 'center',
              margin: 0,
              maxWidth: layout.contentWidth * 0.9,
              lineHeight: 1.35,
            }}
          >
            {scene.body}
          </p>
        </FadeUp>
      ) : null}
    </SceneShell>
  );
};
