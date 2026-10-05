import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { AnimatedText } from '../components/AnimatedText';
import { fitFontSize, springFor, useLayout } from '../utils';
import { SceneShell, type SceneProps } from './SceneShell';

/** Numbered steps (tutorials, "how it works"). The current step is highlighted. */
export const StepsScene: React.FC<SceneProps> = (props) => {
  const { scene, storyboard } = props;
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const layout = useLayout();
  const { theme } = storyboard;
  const steps = scene.items.slice(0, 5);
  const spacing = Math.max(8, Math.floor((durationInFrames * 0.75 - 15) / Math.max(1, steps.length)));
  const size = Math.round(layout.unit * (steps.length > 3 ? 0.042 : 0.05));
  const active = Math.min(steps.length - 1, Math.max(0, Math.floor((frame - 15) / spacing)));
  return (
    <SceneShell {...props}>
      <AnimatedText
        text={scene.headline}
        theme={theme}
        entrance={scene.animation.entrance}
        stagger={scene.animation.stagger}
        fontSize={fitFontSize(scene.headline, layout, 0.08)}
        uppercase={theme.uppercaseHeadlines}
        maxWidth={layout.contentWidth}
        align={scene.layout === 'left' ? 'left' : 'center'}
      />
      <div style={{ display: 'flex', flexDirection: layout.isPortrait ? 'column' : 'row', gap: size * 0.6, width: '100%', justifyContent: 'center' }}>
        {steps.map((step, i) => {
          const p = spring({ frame: frame - 15 - i * spacing, fps, config: springFor(theme.motion) });
          const isActive = i === active;
          return (
            <div
              key={i}
              style={{
                flex: layout.isPortrait ? undefined : 1,
                display: 'flex',
                flexDirection: layout.isPortrait ? 'row' : 'column',
                alignItems: 'center',
                gap: size * 0.5,
                padding: size * 0.6,
                borderRadius: theme.radius,
                background: isActive ? theme.palette.primary : theme.palette.surface,
                color: isActive ? theme.palette.onPrimary : theme.palette.text,
                opacity: interpolate(p, [0, 0.6], [0, 1], { extrapolateRight: 'clamp' }),
                transform: `scale(${interpolate(p, [0, 1], [0.85, 1])})`,
              }}
            >
              <div
                style={{
                  width: size * 1.6,
                  height: size * 1.6,
                  flexShrink: 0,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: theme.headingFont,
                  fontWeight: 900,
                  fontSize: size * 0.9,
                  background: isActive ? theme.palette.onPrimary : theme.palette.primary,
                  color: isActive ? theme.palette.primary : theme.palette.onPrimary,
                }}
              >
                {i + 1}
              </div>
              <span style={{ fontFamily: theme.bodyFont, fontWeight: 600, fontSize: size, lineHeight: 1.25, textAlign: layout.isPortrait ? 'left' : 'center' }}>
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </SceneShell>
  );
};
