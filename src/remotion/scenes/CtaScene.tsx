import React from 'react';
import { Img, interpolate, useCurrentFrame } from 'remotion';
import { AnimatedText } from '../components/AnimatedText';
import { bodyFontSize, fitFontSize, resolveSrc, useLayout, withAlpha } from '../utils';
import { FadeUp, SceneShell, useEntrance, type SceneProps } from './SceneShell';

/** Call to action: headline, pulsing button (subheadline), contact line (body). */
export const CtaScene: React.FC<SceneProps> = (props) => {
  const { scene, storyboard } = props;
  const frame = useCurrentFrame();
  const layout = useLayout();
  const { theme, brand } = storyboard;
  const pop = useEntrance(18, theme.motion);
  const pulse = 1 + Math.sin(Math.max(0, frame - 30) / 6) * 0.035 * Math.min(1, Math.max(0, frame - 30) / 10);
  const buttonSize = Math.round(layout.unit * 0.052);
  return (
    <SceneShell {...props}>
      {brand.logo ? (
        <FadeUp>
          <Img src={resolveSrc(brand.logo)} style={{ height: layout.unit * 0.12, width: 'auto', objectFit: 'contain' }} />
        </FadeUp>
      ) : brand.name ? (
        <FadeUp>
          <div style={{ fontFamily: theme.headingFont, fontWeight: 900, fontSize: layout.unit * 0.07, color: theme.palette.text, letterSpacing: '0.02em' }}>
            {brand.name}
          </div>
        </FadeUp>
      ) : null}
      <AnimatedText
        text={scene.headline}
        theme={theme}
        entrance={scene.animation.entrance}
        stagger={scene.animation.stagger}
        delay={4}
        fontSize={fitFontSize(scene.headline, layout, 0.09)}
        uppercase={theme.uppercaseHeadlines}
        maxWidth={layout.contentWidth}
      />
      {scene.subheadline ? (
        <div
          style={{
            transform: `scale(${interpolate(pop, [0, 1], [0.5, 1]) * pulse})`,
            opacity: interpolate(pop, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' }),
            fontFamily: theme.headingFont,
            fontWeight: 800,
            fontSize: buttonSize,
            color: theme.palette.onPrimary,
            background: theme.palette.primary,
            padding: `${buttonSize * 0.55}px ${buttonSize * 1.2}px`,
            borderRadius: 999,
            boxShadow: `0 ${buttonSize * 0.3}px ${buttonSize}px ${withAlpha(theme.palette.primary, 0.45)}`,
            textAlign: 'center',
          }}
        >
          {scene.subheadline}
        </div>
      ) : null}
      {scene.body ? (
        <FadeUp delay={30}>
          <p style={{ margin: 0, fontFamily: theme.bodyFont, fontWeight: 600, fontSize: bodyFontSize(scene.body, layout), color: theme.palette.mutedText, textAlign: 'center', maxWidth: layout.contentWidth }}>
            {scene.body}
          </p>
        </FadeUp>
      ) : null}
    </SceneShell>
  );
};
