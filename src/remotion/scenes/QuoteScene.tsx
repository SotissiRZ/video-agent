import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { AnimatedText } from '../components/AnimatedText';
import { fitFontSize, useLayout } from '../utils';
import { FadeUp, SceneShell, type SceneProps } from './SceneShell';

/** Testimonial / quote. `headline` is the quote, `subheadline` the attribution. */
export const QuoteScene: React.FC<SceneProps> = (props) => {
  const { scene, storyboard } = props;
  const frame = useCurrentFrame();
  const layout = useLayout();
  const { theme } = storyboard;
  return (
    <SceneShell {...props}>
      <div
        style={{
          fontFamily: 'Georgia, serif',
          fontSize: layout.unit * 0.3,
          lineHeight: 0.6,
          height: layout.unit * 0.13,
          color: theme.palette.accent,
          opacity: interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        “
      </div>
      <AnimatedText
        text={scene.headline}
        theme={theme}
        entrance={scene.animation.entrance === 'typewriter' ? 'typewriter' : 'blur'}
        stagger={Math.max(2, scene.animation.stagger - 1)}
        delay={8}
        fontSize={fitFontSize(scene.headline, layout, 0.075)}
        fontWeight={600}
        maxWidth={layout.contentWidth}
        lineHeight={1.25}
      />
      {scene.subheadline ? (
        <FadeUp delay={30}>
          <p style={{ margin: 0, fontFamily: theme.bodyFont, fontWeight: 600, fontSize: layout.unit * 0.036, color: theme.palette.mutedText }}>
            — {scene.subheadline}
          </p>
        </FadeUp>
      ) : null}
    </SceneShell>
  );
};
