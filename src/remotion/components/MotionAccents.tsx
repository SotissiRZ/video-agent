/**
 * Motion-design layer drawn over the picture and under the text: frames that trace themselves, a light
 * sweep, floating colour orbs, speed lines, a rotating ring. One variant per scene (chosen from its
 * index, so neighbours differ), in the theme's colours, light enough never to fight the photo or the text.
 */
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme } from '../contract/storyboard';
import { seeded, useLayout, withAlpha } from '../utils';

export const ACCENTS = ['brackets', 'sweep', 'orbs', 'lines', 'ring'] as const;
export type Accent = (typeof ACCENTS)[number];

export const accentFor = (index: number): Accent => ACCENTS[index % ACCENTS.length]!;

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const MotionAccents: React.FC<{ theme: Theme; index: number; variant?: Accent }> = ({ theme, index, variant = accentFor(index) }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const layout = useLayout();
  const { primary, accent, secondary } = theme.palette;
  const fadeOut = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], clamp);
  const draw = Easing.out(Easing.cubic)(interpolate(frame, [4, 26], [0, 1], clamp));
  const stroke = Math.max(3, Math.round(layout.unit * 0.006));

  if (variant === 'brackets') {
    // Four corner brackets drawing in, then breathing slightly.
    const inset = layout.unit * 0.07;
    const arm = layout.unit * 0.12 * draw;
    const breathe = Math.sin(frame / 18) * layout.unit * 0.006;
    const corner = (x: 'left' | 'right', y: 'top' | 'bottom') => (
      <div
        key={`${x}${y}`}
        style={{
          position: 'absolute',
          [x]: inset - breathe,
          // Top corners stay below the watermark / brand label; bottom ones above the subtitles band.
          [y]: (y === 'top' ? layout.unit * 0.2 : layout.unit * 0.12) - breathe,
          width: arm,
          height: arm,
          [`border${y === 'top' ? 'Top' : 'Bottom'}`]: `${stroke}px solid ${accent}`,
          [`border${x === 'left' ? 'Left' : 'Right'}`]: `${stroke}px solid ${accent}`,
          opacity: 0.9,
        }}
      />
    );
    return <AbsoluteFill style={{ opacity: fadeOut, pointerEvents: 'none' }}>{[corner('left', 'top'), corner('right', 'top'), corner('left', 'bottom'), corner('right', 'bottom')]}</AbsoluteFill>;
  }

  if (variant === 'sweep') {
    // A soft light band crossing the frame diagonally, every ~2.5 s.
    const period = 75;
    const t = ((frame + 10) % period) / period;
    const x = interpolate(t, [0, 0.55], [-60, 160], clamp);
    return (
      <AbsoluteFill style={{ opacity: fadeOut, pointerEvents: 'none', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            top: '-30%',
            left: `${x}%`,
            width: '22%',
            height: '160%',
            transform: 'rotate(18deg)',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)',
            mixBlendMode: 'screen',
          }}
        />
      </AbsoluteFill>
    );
  }

  if (variant === 'orbs') {
    // Blurred colour orbs drifting slowly: the brand's colours glowing through the picture.
    const colors = [primary, accent, secondary];
    return (
      <AbsoluteFill style={{ opacity: 0.55 * fadeOut * draw, pointerEvents: 'none', mixBlendMode: 'screen' }}>
        {colors.map((c, i) => {
          const r = seeded(index * 7 + i + 1);
          const size = layout.unit * (0.35 + r * 0.25);
          const x = 15 + ((r * 70 + i * 23) % 70) + Math.sin(frame / (40 + i * 9) + i) * 6;
          const y = 12 + ((r * 60 + i * 31) % 70) + Math.cos(frame / (46 + i * 7) + i) * 6;
          return <div key={i} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, borderRadius: '50%', background: withAlpha(c, 0.55), filter: `blur(${Math.round(size * 0.25)}px)` }} />;
        })}
      </AbsoluteFill>
    );
  }

  if (variant === 'lines') {
    // Thin speed lines streaking across at different heights and speeds.
    return (
      <AbsoluteFill style={{ opacity: 0.7 * fadeOut, pointerEvents: 'none', overflow: 'hidden' }}>
        {Array.from({ length: 6 }, (_, i) => {
          const r = seeded(index * 13 + i + 3);
          const speed = 1.6 + r * 2.4;
          const len = 18 + r * 30;
          const x = ((frame * speed + r * 200) % 200) - 60;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: `${8 + i * 15 + r * 6}%`,
                left: `${x}%`,
                width: `${len}%`,
                height: Math.max(2, stroke * 0.6),
                borderRadius: 99,
                background: `linear-gradient(90deg, transparent, ${i % 2 ? accent : '#ffffff'})`,
                opacity: 0.35 + r * 0.4,
              }}
            />
          );
        })}
      </AbsoluteFill>
    );
  }

  // ring: a dashed circle drawing itself around the centre and turning slowly.
  const size = layout.unit * 0.95;
  const circumference = Math.PI * (size - stroke * 2);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: 0.75 * fadeOut, pointerEvents: 'none' }}>
      <svg width={size} height={size} style={{ transform: `rotate(${frame * 0.6}deg)` }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={size / 2 - stroke * 2}
          fill="none"
          stroke={accent}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * 0.18} ${circumference * 0.07}`}
          strokeDashoffset={circumference * (1 - draw)}
          opacity={draw}
        />
      </svg>
    </AbsoluteFill>
  );
};
