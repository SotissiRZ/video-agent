import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from 'remotion';
import type { Storyboard } from '../contract/storyboard';
import { resolveSrc, useLayout } from '../utils';

/** Discreet brand mark (logo or name) shown in a corner during the whole video. */
export const Watermark: React.FC<{ storyboard: Storyboard }> = ({ storyboard }) => {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const { brand, theme } = storyboard;
  if (!brand.showWatermark || (!brand.logo && !brand.name)) return null;
  const opacity = interpolate(frame, [20, 40], [0, 0.9], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const size = Math.round(layout.unit * 0.05);
  const top = layout.isPortrait ? layout.height * 0.055 : layout.padY * 0.6;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          top,
          left: layout.padX,
          display: 'flex',
          alignItems: 'center',
          gap: size * 0.3,
          opacity,
        }}
      >
        {brand.logo ? (
          <Img src={resolveSrc(brand.logo)} style={{ height: size, width: 'auto', objectFit: 'contain' }} />
        ) : (
          <span
            style={{
              fontFamily: theme.headingFont,
              fontWeight: 800,
              fontSize: size * 0.6,
              color: theme.palette.text,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              padding: `${size * 0.12}px ${size * 0.3}px`,
              borderRadius: theme.radius,
              background: theme.palette.surface,
            }}
          >
            {brand.name}
          </span>
        )}
      </div>
    </AbsoluteFill>
  );
};

/** Plan badge ("Made with SOVID AI") in the top-right corner, away from the subtitles. */
export const PlanBadge: React.FC<{ storyboard: Storyboard }> = ({ storyboard }) => {
  const layout = useLayout();
  const { brand, theme } = storyboard;
  if (!brand.badge) return null;
  const size = Math.round(layout.unit * 0.026);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          right: layout.padX * 0.6,
          top: layout.isPortrait ? layout.height * 0.055 : layout.padY * 0.6,
          fontFamily: theme.bodyFont,
          fontWeight: 600,
          fontSize: size,
          color: '#ffffff',
          background: 'rgba(0,0,0,0.45)',
          padding: `${size * 0.35}px ${size * 0.7}px`,
          borderRadius: size,
          opacity: 0.85,
        }}
      >
        {brand.badge}
      </div>
    </AbsoluteFill>
  );
};
