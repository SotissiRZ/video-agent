import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame } from 'remotion';
import type { Storyboard } from '../contract/storyboard';
import { computeTimeline } from '../contract/timeline';
import { resolveSrc, useLayout } from '../utils';

/** Discreet brand mark (logo or name) shown in a corner during the whole video. */
export const Watermark: React.FC<{ storyboard: Storyboard }> = ({ storyboard }) => {
  const frame = useCurrentFrame();
  const layout = useLayout();
  const { brand, theme } = storyboard;
  if (!brand.showWatermark || (!brand.logo && !brand.name)) return null;
  // The opening title and the closing scene already show the logo large: the corner mark waits for
  // the first one to end and leaves before the last one, so the logo is never on screen twice.
  const scenes = storyboard.scenes;
  const timeline = computeTimeline(scenes);
  const first = brand.logo && scenes[0]?.kind === 'title' ? timeline[0] : undefined;
  const last = brand.logo && scenes.length > 1 && scenes[scenes.length - 1]?.kind === 'cta' ? timeline[timeline.length - 1] : undefined;
  const start = first ? first.soloTo : 20;
  const end = last ? last.soloFrom : Number.POSITIVE_INFINITY;
  const fadeIn = interpolate(frame, [start, start + 20], [0, 0.9], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = Number.isFinite(end) ? Math.min(fadeIn, interpolate(frame, [end - 15, end], [0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })) : fadeIn;
  if (opacity <= 0) return null;
  const size = Math.round(layout.unit * 0.075);
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
          <Img src={resolveSrc(brand.logo)} style={{ height: size, width: 'auto', objectFit: 'contain', borderRadius: size * 0.12 }} />
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
