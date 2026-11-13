import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Scene, Storyboard } from '../contract/storyboard';
import { Background } from '../components/Background';
import { MediaStack } from '../components/MediaLayer';
import { scrim, springFor, useLayout, withAlpha } from '../utils';

export interface SceneProps {
  scene: Scene;
  storyboard: Storyboard;
  index: number;
}

/**
 * Common frame for every scene: background (procedural or media), safe-area padding
 * and content alignment. Media in a non-image scene becomes a darkened backdrop.
 */
export const SceneShell: React.FC<SceneProps & { children: React.ReactNode; justify?: React.CSSProperties['justifyContent'] }> = ({
  scene,
  storyboard,
  index,
  children,
  justify = 'center',
}) => {
  const layout = useLayout();
  const { theme } = storyboard;
  const align = scene.layout === 'left' ? 'flex-start' : 'center';
  const mediaBackdrop = scene.media && scene.kind !== 'image';
  return (
    <AbsoluteFill style={{ backgroundColor: theme.palette.background }}>
      {mediaBackdrop && scene.media ? (
        <>
          <MediaStack media={[scene.media, ...(scene.shots ?? [])]} kenBurns={scene.animation.kenBurns} />
          <AbsoluteFill
            style={{
              // Neutral and local: darker only behind the centred text and the subtitles at the
              // bottom, so the picture keeps its own colours and contrast everywhere else.
              background: [
                `radial-gradient(ellipse 90% 50% at 50% 50%, ${scrim(theme.palette.text, 0.42)} 0%, ${scrim(theme.palette.text, 0.2)} 65%, ${scrim(theme.palette.text, 0.08)} 100%)`,
                `linear-gradient(180deg, ${scrim(theme.palette.text, 0.18)} 0%, transparent 22%, transparent 62%, ${scrim(theme.palette.text, 0.6)} 100%)`,
              ].join(', '),
            }}
          />
        </>
      ) : (
        <Background spec={scene.background} theme={theme} seed={index + 1} />
      )}
      <AbsoluteFill
        style={{
          padding: `${layout.padY}px ${layout.padX}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: justify,
          alignItems: align,
          gap: layout.unit * 0.035,
          // Inherited by every text of the scene.
          textShadow: theme.glow
            ? `0 0 ${layout.unit * 0.012}px ${withAlpha(theme.palette.primary, 0.75)}, 0 0 ${layout.unit * 0.035}px ${withAlpha(theme.palette.primary, 0.35)}`
            : mediaBackdrop
              ? `0 ${layout.unit * 0.003}px ${layout.unit * 0.02}px ${scrim(theme.palette.text, 0.65)}, 0 0 ${layout.unit * 0.006}px ${scrim(theme.palette.text, 0.5)}`
              : undefined,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Small rounded label shown above headlines. */
export const Kicker: React.FC<{ text: string; storyboard: Storyboard; delay?: number }> = ({ text, storyboard, delay = 0 }) => {
  const layout = useLayout();
  const { theme } = storyboard;
  if (!text) return null;
  return (
    <FadeUp delay={delay}>
      <div
        style={{
          fontFamily: theme.bodyFont,
          fontWeight: 600,
          fontSize: Math.round(layout.unit * 0.032),
          color: theme.palette.onPrimary,
          background: theme.palette.primary,
          padding: `${layout.unit * 0.012}px ${layout.unit * 0.03}px`,
          borderRadius: 999,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {text}
      </div>
    </FadeUp>
  );
};

export const useEntrance = (delay: number, motion: Storyboard['theme']['motion']) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: springFor(motion) });
};

/** Generic fade + rise wrapper for blocks. */
export const FadeUp: React.FC<{ delay?: number; children: React.ReactNode; distance?: number; style?: React.CSSProperties }> = ({
  delay = 0,
  children,
  distance = 40,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 110 } });
  return (
    <div style={{ opacity: interpolate(p, [0, 0.7], [0, 1], { extrapolateRight: 'clamp' }), transform: `translateY(${(1 - p) * distance}px)`, ...style }}>
      {children}
    </div>
  );
};
