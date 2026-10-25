import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { AnimatedText } from '../components/AnimatedText';
import { fitFontSize, springFor, useLayout } from '../utils';
import { Kicker, SceneShell, type SceneProps } from './SceneShell';

/** Headline + list of benefits/features revealed one after the other. */
export const BulletsScene: React.FC<SceneProps> = (props) => {
  const { scene, storyboard } = props;
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const layout = useLayout();
  const { theme } = storyboard;
  const items = scene.items.slice(0, 6);
  // Spread the reveals across the first 60% of the scene.
  const spacing = Math.max(6, Math.floor((durationInFrames * 0.6 - 15) / Math.max(1, items.length)));
  const longest = items.reduce((m, i) => Math.max(m, i.length), 0);
  // A sixth line gets slightly smaller text so the list still fits a landscape frame.
  const itemSize = Math.round(layout.unit * Math.min(0.055, Math.max(0.034, 0.055 * Math.sqrt(20 / Math.max(20, longest)))) * (items.length > 5 ? 0.88 : 1));
  return (
    <SceneShell {...props}>
      <Kicker text={scene.subheadline} storyboard={storyboard} />
      <AnimatedText
        text={scene.headline}
        theme={theme}
        entrance={scene.animation.entrance}
        stagger={scene.animation.stagger}
        fontSize={fitFontSize(scene.headline, layout, 0.085)}
        align={scene.layout === 'left' ? 'left' : 'center'}
        uppercase={theme.uppercaseHeadlines}
        maxWidth={layout.contentWidth}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: itemSize * 0.5, width: layout.isPortrait ? '100%' : '80%' }}>
        {items.map((item, i) => {
          const p = spring({ frame: frame - 15 - i * spacing, fps, config: springFor(theme.motion) });
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: itemSize * 0.5,
                padding: `${itemSize * 0.45}px ${itemSize * 0.6}px`,
                borderRadius: theme.radius,
                background: theme.palette.surface,
                opacity: interpolate(p, [0, 0.6], [0, 1], { extrapolateRight: 'clamp' }),
                transform: `translateX(${(1 - p) * -60}px)`,
              }}
            >
              <svg width={itemSize * 1.1} height={itemSize * 1.1} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="12" fill={theme.palette.primary} />
                <path
                  d="M7 12.5l3.2 3.2L17 9"
                  fill="none"
                  stroke={theme.palette.onPrimary}
                  strokeWidth={2.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={20}
                  strokeDashoffset={20 * (1 - Math.min(1, p))}
                />
              </svg>
              <span style={{ fontFamily: theme.bodyFont, fontWeight: 600, fontSize: itemSize, color: theme.palette.text, lineHeight: 1.25 }}>
                {item}
              </span>
            </div>
          );
        })}
      </div>
    </SceneShell>
  );
};
