import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Background as BackgroundSpec, Theme } from '../contract/storyboard';
import { seeded, withAlpha } from '../utils';
import { FuturisticBackground } from './FuturisticBackground';

interface Props {
  spec: BackgroundSpec;
  theme: Theme;
  /** Seed so each scene gets a different but deterministic composition. */
  seed: number;
}

/** Procedural animated backgrounds: no external asset required. */
export const Background: React.FC<Props> = ({ spec, theme, seed }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const { palette } = theme;
  const from = spec.from ?? palette.background;
  const to = spec.to ?? palette.backgroundAlt;
  const angle = 135 + Math.sin((frame + seed * 40) / 90) * 20;
  const base = (
    <AbsoluteFill style={{ background: `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)` }} />
  );

  switch (spec.variant) {
    case 'circuit':
    case 'hologram':
    case 'particles':
    case 'hud':
      return <FuturisticBackground variant={spec.variant} theme={theme} seed={seed} />;
    case 'shapes':
      return (
        <AbsoluteFill>
          {base}
          {Array.from({ length: 5 }).map((_, i) => {
            const r = seeded(seed * 10 + i);
            const size = Math.min(width, height) * (0.25 + r * 0.45);
            const x = (seeded(seed * 20 + i) * 1.2 - 0.1) * width + Math.sin((frame + i * 30) / (60 + i * 9)) * 40;
            const y = (seeded(seed * 30 + i) * 1.2 - 0.1) * height + Math.cos((frame + i * 20) / (70 + i * 7)) * 50;
            const colors = [palette.primary, palette.secondary, palette.accent];
            const color = colors[i % colors.length]!;
            // Soft edges via radial gradients: much cheaper to render than CSS blur filters.
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: x - size / 2,
                  top: y - size / 2,
                  width: size,
                  height: size,
                  borderRadius: '50%',
                  background: `radial-gradient(circle, ${withAlpha(color, 0.45)} 0%, ${withAlpha(color, 0.18)} 45%, transparent 70%)`,
                  transform: `scale(${1 + Math.sin((frame + i * 25) / 50) * 0.06})`,
                }}
              />
            );
          })}
        </AbsoluteFill>
      );
    case 'grid': {
      const cell = Math.round(Math.min(width, height) / 12);
      const offset = (frame * 0.6) % cell;
      return (
        <AbsoluteFill>
          {base}
          <AbsoluteFill
            style={{
              backgroundImage: `linear-gradient(${withAlpha(palette.text, 0.06)} 1px, transparent 1px), linear-gradient(90deg, ${withAlpha(palette.text, 0.06)} 1px, transparent 1px)`,
              backgroundSize: `${cell}px ${cell}px`,
              backgroundPosition: `${offset}px ${offset}px`,
            }}
          />
          <AbsoluteFill
            style={{
              background: `radial-gradient(circle at 50% 40%, ${withAlpha(palette.primary, 0.25)} 0%, transparent 60%)`,
            }}
          />
        </AbsoluteFill>
      );
    }
    case 'waves': {
      const waves = [0, 1, 2];
      return (
        <AbsoluteFill>
          {base}
          <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
            {waves.map((i) => {
              const amp = height * (0.025 + i * 0.012);
              const baseY = height * (0.62 + i * 0.12);
              const phase = frame / (40 + i * 15) + i;
              const points: string[] = [];
              for (let x = 0; x <= width; x += width / 40) {
                const y = baseY + Math.sin(x / (width / (2 + i)) * Math.PI * 2 + phase) * amp;
                points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
              }
              const fill = [palette.primary, palette.secondary, palette.accent][i]!;
              return (
                <path
                  key={i}
                  d={`M0,${height} L${points.join(' L')} L${width},${height} Z`}
                  fill={withAlpha(fill, 0.18 + i * 0.06)}
                />
              );
            })}
          </svg>
        </AbsoluteFill>
      );
    }
    case 'spotlight': {
      const progress = frame / Math.max(1, durationInFrames);
      const cx = interpolate(progress, [0, 1], [35 + seeded(seed) * 10, 60 - seeded(seed + 1) * 10]);
      return (
        <AbsoluteFill>
          {base}
          <AbsoluteFill
            style={{
              background: `radial-gradient(circle at ${cx}% 35%, ${withAlpha(palette.primary, 0.35)} 0%, transparent 55%), radial-gradient(circle at ${100 - cx}% 85%, ${withAlpha(palette.secondary, 0.2)} 0%, transparent 50%)`,
            }}
          />
        </AbsoluteFill>
      );
    }
    case 'media':
    case 'gradient':
    default:
      return (
        <AbsoluteFill>
          {base}
          <AbsoluteFill
            style={{
              background: `radial-gradient(circle at ${30 + Math.sin(frame / 80) * 10}% 20%, ${withAlpha(palette.primary, 0.3)} 0%, transparent 55%)`,
            }}
          />
        </AbsoluteFill>
      );
  }
};
