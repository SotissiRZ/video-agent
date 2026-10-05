import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { AnimatedText } from '../components/AnimatedText';
import { Background } from '../components/Background';
import { MediaLayer } from '../components/MediaLayer';
import { bodyFontSize, fitFontSize, useLayout, withAlpha } from '../utils';
import { FadeUp, type SceneProps } from './SceneShell';

/**
 * Visual scene: full-bleed media with a caption. Without media (procedural mode) it
 * draws an abstract animated emblem so the scene still carries visual energy.
 */
export const ImageScene: React.FC<SceneProps> = ({ scene, storyboard, index }) => {
  const layout = useLayout();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { theme } = storyboard;
  const { palette } = theme;
  return (
    <AbsoluteFill style={{ backgroundColor: palette.background }}>
      {scene.media ? (
        <MediaLayer media={scene.media} kenBurns={scene.animation.kenBurns} />
      ) : (
        <>
          <Background spec={scene.background} theme={theme} seed={index + 7} />
          <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: layout.height * 0.18 }}>
            {[0, 1, 2, 3].map((i) => {
              const size = layout.unit * (0.22 + i * 0.16);
              const p = interpolate(frame - i * 5, [0, 25], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    border: `${Math.max(2, layout.unit * 0.006)}px solid ${withAlpha(i % 2 ? palette.secondary : palette.primary, 0.7 - i * 0.12)}`,
                    transform: `scale(${p * (1 + Math.sin((frame + i * 12) / 25) * 0.03)}) rotate(${frame * (i % 2 ? -0.4 : 0.4)}deg)`,
                    borderStyle: i % 2 ? 'dashed' : 'solid',
                  }}
                />
              );
            })}
            <div
              style={{
                width: layout.unit * 0.16,
                height: layout.unit * 0.16,
                borderRadius: theme.radius,
                background: `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`,
                transform: `rotate(${45 + frame * 0.5}deg) scale(${interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' })})`,
                boxShadow: `0 0 ${layout.unit * 0.08}px ${withAlpha(palette.primary, 0.6)}`,
              }}
            />
          </AbsoluteFill>
        </>
      )}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, transparent 40%, ${withAlpha(palette.background, 0.92)} 100%)`,
          opacity: interpolate(frame, [0, durationInFrames * 0.2], [0.6, 1], { extrapolateRight: 'clamp' }),
        }}
      />
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: scene.layout === 'left' ? 'flex-start' : 'center',
          padding: `${layout.padY}px ${layout.padX}px`,
          paddingBottom: layout.isPortrait ? layout.height * 0.3 : layout.padY * 1.4,
          gap: layout.unit * 0.02,
        }}
      >
        <AnimatedText
          text={scene.headline}
          theme={theme}
          entrance={scene.animation.entrance}
          stagger={scene.animation.stagger}
          delay={8}
          fontSize={fitFontSize(scene.headline, layout, 0.085)}
          align={scene.layout === 'left' ? 'left' : 'center'}
          uppercase={theme.uppercaseHeadlines}
          maxWidth={layout.contentWidth}
        />
        {scene.body ? (
          <FadeUp delay={20}>
            <p style={{ margin: 0, fontFamily: theme.bodyFont, fontSize: bodyFontSize(scene.body, layout), color: palette.mutedText, textAlign: scene.layout === 'left' ? 'left' : 'center', maxWidth: layout.contentWidth }}>
              {scene.body}
            </p>
          </FadeUp>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
