import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Media } from '../contract/storyboard';
import { resolveSrc, useLayout } from '../utils';

/**
 * A web page capture inside a browser window (desktop) or a phone (mobile), in the upper part of
 * the frame so the scene's headline stays readable below it. The page scrolls slowly down, like
 * someone browsing the site.
 */
export const ScreenCapture: React.FC<{ media: Media & { screen: NonNullable<Media['screen']> } }> = ({ media }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const layout = useLayout();
  const { device, url, aspect } = media.screen;
  const mobile = device === 'mobile';

  // Room above the headline (bottom third in portrait, bottom quarter otherwise).
  // Below the corner logo or brand name.
  const top = layout.height * (layout.isPortrait ? 0.11 : 0.1);
  const bottom = layout.height * (layout.isPortrait ? 0.5 : 0.62);
  const maxWidth = layout.width * (layout.isPortrait ? 0.88 : 0.66);
  const maxHeight = bottom - top;

  const bar = mobile ? 0 : Math.round(layout.unit * 0.05);
  const bezel = mobile ? Math.round(layout.unit * 0.014) : 0;
  let width: number;
  let height: number;
  if (mobile) {
    // iPhone-like proportions, never wider than the room.
    height = maxHeight;
    width = Math.min(maxWidth, height * 0.49);
    height = Math.min(height, width / 0.49);
  } else {
    width = maxWidth;
    height = Math.min(maxHeight, bar + width * 0.68);
  }
  const screenWidth = width - bezel * 2;
  const screenHeight = height - bar - bezel * 2;
  const pageHeight = screenWidth * aspect;
  const overflow = Math.max(0, pageHeight - screenHeight);

  const enter = interpolate(frame, [0, Math.round(fps * 0.6)], [0, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  // A short look at the top of the page, then a slow scroll that stops before the end of the scene.
  const scroll = interpolate(frame, [Math.round(fps * 0.9), Math.max(Math.round(fps * 0.9) + 1, durationInFrames - Math.round(fps * 0.6))], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const radius = mobile ? layout.unit * 0.055 : layout.unit * 0.016;

  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <div
        style={{
          position: 'absolute',
          top: top + (maxHeight - height) / 2,
          width,
          height,
          borderRadius: radius,
          overflow: 'hidden',
          background: mobile ? '#0B0D12' : '#1E222B',
          padding: bezel,
          boxShadow: `0 ${layout.unit * 0.03}px ${layout.unit * 0.09}px rgba(0,0,0,0.5), 0 0 0 ${Math.max(1, layout.unit * 0.002)}px rgba(255,255,255,0.12)`,
          opacity: enter,
          transform: `translateY(${(1 - enter) * layout.unit * 0.05}px) scale(${0.94 + 0.06 * enter})`,
        }}
      >
        {mobile ? null : (
          <div style={{ height: bar, display: 'flex', alignItems: 'center', gap: bar * 0.16, padding: `0 ${bar * 0.4}px` }}>
            {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
              <span key={c} style={{ width: bar * 0.24, height: bar * 0.24, borderRadius: '50%', background: c, flexShrink: 0 }} />
            ))}
            <div
              style={{
                flex: 1,
                marginLeft: bar * 0.3,
                height: bar * 0.56,
                borderRadius: bar * 0.28,
                background: 'rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.8)',
                fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
                fontSize: bar * 0.3,
                display: 'flex',
                alignItems: 'center',
                padding: `0 ${bar * 0.3}px`,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              🔒 {url}
            </div>
          </div>
        )}
        <div style={{ position: 'relative', width: screenWidth, height: screenHeight, overflow: 'hidden', borderRadius: mobile ? radius - bezel : 0, background: '#FFFFFF' }}>
          <Img src={resolveSrc(media.src)} style={{ position: 'absolute', top: 0, left: 0, width: screenWidth, height: pageHeight, transform: `translateY(${-overflow * scroll}px)` }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
