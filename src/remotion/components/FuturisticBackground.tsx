/**
 * Futuristic backgrounds drawn in SVG: circuit board with travelling pulses, holographic perspective
 * grid, particle network and HUD rings. Deterministic (seeded) and filter-free, so they render fast
 * and identically on every frame.
 */
import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme } from '../contract/storyboard';
import { seeded, withAlpha } from '../utils';

export type FuturisticVariant = 'circuit' | 'hologram' | 'particles' | 'hud';

interface Props {
  variant: FuturisticVariant;
  theme: Theme;
  seed: number;
}

type Point = [number, number];

/** Thin horizontal lines and a dark vignette: the "screen" texture shared by every variant. */
const ScreenTexture: React.FC<{ theme: Theme }> = ({ theme }) => (
  <>
    <AbsoluteFill style={{ backgroundImage: `repeating-linear-gradient(0deg, ${withAlpha(theme.palette.text, 0.035)} 0px, ${withAlpha(theme.palette.text, 0.035)} 1px, transparent 1px, transparent 4px)` }} />
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 50%, transparent 55%, ${withAlpha(theme.palette.background, 0.85)} 100%)` }} />
  </>
);

const Base: React.FC<{ theme: Theme; frame: number; seed: number }> = ({ theme, frame, seed }) => {
  const angle = 160 + Math.sin((frame + seed * 40) / 120) * 12;
  return <AbsoluteFill style={{ background: `linear-gradient(${angle}deg, ${theme.palette.background} 0%, ${theme.palette.backgroundAlt} 100%)` }} />;
};

const polylineLength = (points: Point[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i]![0], p[1] - points[i]![1]), 0);

/** Point at `t` (0..1) of the way along a polyline. */
const pointAlong = (points: Point[], t: number): Point => {
  let remaining = polylineLength(points) * t;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const length = Math.hypot(bx - ax, by - ay);
    if (remaining <= length) return [ax + ((bx - ax) * remaining) / length, ay + ((by - ay) * remaining) / length];
    remaining -= length;
  }
  return points[points.length - 1]!;
};

const Circuit: React.FC<{ theme: Theme; seed: number; frame: number; width: number; height: number }> = ({ theme, seed, frame, width, height }) => {
  const step = Math.min(width, height) / 14;
  const traces = useMemo(() => {
    const list: Point[][] = [];
    for (let t = 0; t < 26; t++) {
      const r = (k: number) => seeded(seed * 97 + t * 13 + k);
      let x = Math.round(r(1) * (width / step)) * step;
      let y = Math.round(r(2) * (height / step)) * step;
      const points: Point[] = [[x, y]];
      let horizontal = r(3) > 0.5;
      const segments = 3 + Math.floor(r(4) * 3);
      for (let s = 0; s < segments; s++) {
        const length = (1 + Math.floor(r(10 + s) * 4)) * step * (r(20 + s) > 0.5 ? 1 : -1);
        // A 45° chamfer before turning, like real PCB traces.
        if (s > 0 && r(30 + s) > 0.4) {
          const d = step * 0.5 * Math.sign(length);
          if (horizontal) x += d;
          else y += d;
          if (horizontal) y += d * (r(40 + s) > 0.5 ? 1 : -1);
          else x += d * (r(40 + s) > 0.5 ? 1 : -1);
          points.push([x, y]);
        }
        if (horizontal) x += length;
        else y += length;
        points.push([x, y]);
        horizontal = !horizontal;
      }
      list.push(points);
    }
    return list;
  }, [seed, width, height, step]);
  const stroke = Math.max(1.5, step * 0.035);
  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <radialGradient id={`pulse-${seed}`}>
          <stop offset="0%" stopColor={theme.palette.primary} stopOpacity={0.9} />
          <stop offset="35%" stopColor={theme.palette.primary} stopOpacity={0.35} />
          <stop offset="100%" stopColor={theme.palette.primary} stopOpacity={0} />
        </radialGradient>
      </defs>
      {traces.map((points, i) => (
        <g key={i}>
          <polyline points={points.map((p) => p.join(',')).join(' ')} fill="none" stroke={withAlpha(i % 4 === 0 ? theme.palette.secondary : theme.palette.primary, 0.22)} strokeWidth={stroke} strokeLinejoin="round" />
          {[points[0]!, points[points.length - 1]!].map(([x, y], k) => (
            <circle key={k} cx={x} cy={y} r={step * 0.11} fill={theme.palette.background} stroke={withAlpha(theme.palette.primary, 0.5)} strokeWidth={stroke} />
          ))}
        </g>
      ))}
      {traces.map((points, i) => {
        const period = 70 + seeded(seed * 7 + i) * 90;
        const t = ((frame + seeded(seed * 3 + i) * period) % period) / period;
        const [x, y] = pointAlong(points, t);
        const fade = Math.sin(t * Math.PI);
        return (
          <g key={`p${i}`} opacity={fade}>
            <circle cx={x} cy={y} r={step * 0.45} fill={`url(#pulse-${seed})`} />
            <circle cx={x} cy={y} r={step * 0.07} fill={theme.palette.text} />
          </g>
        );
      })}
    </svg>
  );
};

const Hologram: React.FC<{ theme: Theme; seed: number; frame: number; width: number; height: number }> = ({ theme, frame, width, height }) => {
  const horizon = height * 0.58;
  const cx = width / 2;
  const { primary, secondary } = theme.palette;
  const stroke = Math.max(1.2, Math.min(width, height) * 0.0018);
  const rows = 16;
  const ring = Math.min(width, height) * 0.2;
  return (
    <>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 22% at 50% ${(horizon / height) * 100}%, ${withAlpha(secondary, 0.45)} 0%, ${withAlpha(primary, 0.15)} 45%, transparent 75%)` }} />
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="holo-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primary} stopOpacity={0.05} />
            <stop offset="100%" stopColor={primary} stopOpacity={0.6} />
          </linearGradient>
          <clipPath id="holo-sky">
            <rect x={0} y={0} width={width} height={horizon} />
          </clipPath>
        </defs>
        {/* Portal: rings rising behind the horizon */}
        <g clipPath="url(#holo-sky)">
          {[1, 0.78, 0.56].map((k, i) => (
            <circle key={i} cx={cx} cy={horizon} r={ring * k * (1 + Math.sin(frame / 40 + i) * 0.03)} fill="none" stroke={withAlpha(i === 0 ? secondary : primary, 0.55 - i * 0.12)} strokeWidth={stroke * (3 - i)} />
          ))}
          <circle cx={cx} cy={horizon} r={ring * 0.4} fill={withAlpha(secondary, 0.12)} />
        </g>
        {/* Floor: lines converge to the vanishing point, rows travel towards the viewer */}
        {Array.from({ length: 25 }, (_, i) => i - 12).map((i) => (
          <line key={`v${i}`} x1={cx + i * width * 0.012} y1={horizon} x2={cx + i * width * 0.16} y2={height} stroke="url(#holo-floor)" strokeWidth={stroke} />
        ))}
        {Array.from({ length: rows }, (_, k) => {
          const s = ((k + frame * 0.05) % rows) / rows;
          const y = horizon + (height - horizon) * Math.pow(s, 2.2);
          return <line key={`h${k}`} x1={0} y1={y} x2={width} y2={y} stroke={withAlpha(primary, 0.08 + s * 0.5)} strokeWidth={stroke * (0.6 + s * 1.4)} />;
        })}
        <line x1={0} y1={horizon} x2={width} y2={horizon} stroke={withAlpha(secondary, 0.8)} strokeWidth={stroke * 2} />
      </svg>
    </>
  );
};

const Particles: React.FC<{ theme: Theme; seed: number; frame: number; width: number; height: number }> = ({ theme, seed, frame, width, height }) => {
  const unit = Math.min(width, height);
  const nodes: Point[] = Array.from({ length: 46 }, (_, i) => [
    seeded(seed * 31 + i) * width + Math.sin(frame / (80 + (i % 7) * 9) + i) * unit * 0.04,
    seeded(seed * 57 + i) * height + Math.cos(frame / (95 + (i % 5) * 11) + i * 2) * unit * 0.04,
  ]);
  const reach = unit * 0.24;
  const links: Array<[Point, Point, number]> = [];
  for (let a = 0; a < nodes.length; a++) {
    for (let b = a + 1; b < nodes.length; b++) {
      const d = Math.hypot(nodes[a]![0] - nodes[b]![0], nodes[a]![1] - nodes[b]![1]);
      if (d < reach) links.push([nodes[a]!, nodes[b]!, 1 - d / reach]);
    }
  }
  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <radialGradient id={`node-${seed}`}>
          <stop offset="0%" stopColor={theme.palette.primary} stopOpacity={0.8} />
          <stop offset="100%" stopColor={theme.palette.primary} stopOpacity={0} />
        </radialGradient>
      </defs>
      {links.map(([a, b, strength], i) => (
        <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={withAlpha(i % 5 === 0 ? theme.palette.secondary : theme.palette.primary, strength * 0.45)} strokeWidth={Math.max(1, unit * 0.0016)} />
      ))}
      {nodes.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={unit * 0.018} fill={`url(#node-${seed})`} opacity={0.5 + Math.sin(frame / 20 + i) * 0.3} />
          <circle cx={x} cy={y} r={unit * 0.0035} fill={theme.palette.text} />
        </g>
      ))}
    </svg>
  );
};

const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
  const a = (from * Math.PI) / 180;
  const b = (to * Math.PI) / 180;
  return `M${cx + r * Math.cos(a)},${cy + r * Math.sin(a)} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${cx + r * Math.cos(b)},${cy + r * Math.sin(b)}`;
};

const Hud: React.FC<{ theme: Theme; seed: number; frame: number; width: number; height: number }> = ({ theme, seed, frame, width, height }) => {
  const unit = Math.min(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const R = unit * 0.44;
  const { primary, secondary, text } = theme.palette;
  const stroke = Math.max(1.2, unit * 0.002);
  const corner = unit * 0.07;
  const margin = unit * 0.05;
  const hex = (n: number) => `0x${(Math.floor(n) & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
  const label = { fontFamily: "'Courier New', monospace", fontSize: unit * 0.022, fill: withAlpha(text, 0.45), letterSpacing: unit * 0.002 };
  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
      <defs>
        <linearGradient id={`sweep-${seed}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={primary} stopOpacity={0} />
          <stop offset="100%" stopColor={primary} stopOpacity={0.28} />
        </linearGradient>
      </defs>
      {/* Radar sweep */}
      <g transform={`rotate(${frame * 1.2} ${cx} ${cy})`}>
        <path d={`M${cx},${cy} L${cx + R * 0.92},${cy} A${R * 0.92},${R * 0.92} 0 0 1 ${cx + R * 0.92 * Math.cos(0.66)},${cy + R * 0.92 * Math.sin(0.66)} Z`} fill={`url(#sweep-${seed})`} />
      </g>
      {/* Segmented outer ring */}
      <g transform={`rotate(${frame * 0.35} ${cx} ${cy})`}>
        {[0, 70, 125, 200, 260, 310].map((start, i) => (
          <path key={i} d={arc(cx, cy, R, start, start + 28 + (i % 3) * 14)} fill="none" stroke={withAlpha(i % 2 ? secondary : primary, 0.6)} strokeWidth={stroke * 3} strokeLinecap="round" />
        ))}
      </g>
      {/* Tick ring */}
      <g transform={`rotate(${-frame * 0.2} ${cx} ${cy})`}>
        {Array.from({ length: 72 }, (_, i) => {
          const a = (i * 5 * Math.PI) / 180;
          const long = i % 6 === 0;
          const r1 = R * 0.84;
          const r2 = R * (long ? 0.78 : 0.81);
          return <line key={i} x1={cx + r1 * Math.cos(a)} y1={cy + r1 * Math.sin(a)} x2={cx + r2 * Math.cos(a)} y2={cy + r2 * Math.sin(a)} stroke={withAlpha(primary, long ? 0.55 : 0.25)} strokeWidth={stroke} />;
        })}
      </g>
      <circle cx={cx} cy={cy} r={R * 0.62} fill="none" stroke={withAlpha(primary, 0.25)} strokeWidth={stroke} strokeDasharray={`${unit * 0.01} ${unit * 0.014}`} transform={`rotate(${frame * 0.8} ${cx} ${cy})`} />
      <circle cx={cx} cy={cy} r={R * 0.4} fill="none" stroke={withAlpha(secondary, 0.18)} strokeWidth={stroke * 2} />
      {/* Screen corners and readouts */}
      {([[margin, margin, 1, 1], [width - margin, margin, -1, 1], [margin, height - margin, 1, -1], [width - margin, height - margin, -1, -1]] as const).map(([x, y, dx, dy], i) => (
        <path key={i} d={`M${x},${y + dy * corner} L${x},${y} L${x + dx * corner},${y}`} fill="none" stroke={withAlpha(primary, 0.6)} strokeWidth={stroke * 2} />
      ))}
      {/* Top right: the brand watermark sits top left. */}
      <text x={width - margin - corner * 0.25} y={margin + corner * 0.75} textAnchor="end" {...label}>SYS {hex(seed * 4099 + frame * 37)}</text>
      <text x={width - margin - corner * 0.25} y={height - margin - corner * 0.45} textAnchor="end" {...label}>
        {`${(98.2 + Math.sin(frame / 15) * 1.4).toFixed(1)}% · ${hex(frame * 113 + 4660)}`}
      </text>
    </svg>
  );
};

export const FuturisticBackground: React.FC<Props> = ({ variant, theme, seed }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const props = { theme, seed, frame, width, height };
  return (
    <AbsoluteFill>
      <Base theme={theme} frame={frame} seed={seed} />
      <AbsoluteFill style={{ background: `radial-gradient(circle at ${40 + Math.sin(frame / 90) * 15}% 25%, ${withAlpha(theme.palette.primary, 0.18)} 0%, transparent 55%)` }} />
      {variant === 'circuit' ? <Circuit {...props} /> : variant === 'hologram' ? <Hologram {...props} /> : variant === 'particles' ? <Particles {...props} /> : <Hud {...props} />}
      <ScreenTexture theme={theme} />
    </AbsoluteFill>
  );
};
