import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import type { Subtitles, Theme } from '../contract/storyboard';
import { useLayout, withAlpha } from '../utils';

interface Props {
  subtitles: Subtitles;
  theme: Theme;
}

/** Burned-in subtitles. Cues are expressed in absolute composition frames. */
export const SubtitlesOverlay: React.FC<Props> = ({ subtitles, theme }) => {
  const frame = useCurrentFrame();
  const layout = useLayout();
  if (!subtitles.enabled) return null;
  const cue = subtitles.cues.find((c) => frame >= c.startFrame && frame < c.endFrame);
  if (!cue) return null;

  const fontSize = Math.round(layout.unit * (layout.isPortrait ? 0.042 : 0.036));
  const fadeIn = interpolate(frame - cue.startFrame, [0, 4], [0, 1], { extrapolateRight: 'clamp' });
  const bottom = layout.isPortrait ? layout.height * 0.2 : layout.height * 0.07;
  const { palette } = theme;

  const base: React.CSSProperties = {
    fontFamily: theme.bodyFont,
    fontWeight: 600,
    fontSize,
    lineHeight: 1.3,
    textAlign: 'center',
    maxWidth: layout.width * 0.86,
    opacity: fadeIn,
    padding: `${fontSize * 0.3}px ${fontSize * 0.6}px`,
    borderRadius: fontSize * 0.4,
  };

  let content: React.ReactNode = cue.text;
  let style: React.CSSProperties = base;
  if (subtitles.style === 'boxed') {
    style = { ...base, color: '#FFFFFF', background: 'rgba(0,0,0,0.62)' };
  } else if (subtitles.style === 'outline') {
    style = {
      ...base,
      color: '#FFFFFF',
      textShadow: '0 0 4px rgba(0,0,0,0.9), 0 2px 8px rgba(0,0,0,0.8)',
      WebkitTextStroke: `${Math.max(1, fontSize * 0.03)}px rgba(0,0,0,0.85)`,
    };
  } else {
    // Karaoke: words light up progressively across the cue.
    const words = cue.text.split(/\s+/);
    const progress = (frame - cue.startFrame) / Math.max(1, cue.endFrame - cue.startFrame);
    const active = Math.floor(progress * words.length);
    style = { ...base, color: '#FFFFFF', background: withAlpha('#000000', 0.45), fontWeight: 800 };
    content = words.map((w, i) => (
      <span key={i} style={{ color: i <= active ? palette.accent : '#FFFFFF' }}>
        {w}
        {i < words.length - 1 ? ' ' : ''}
      </span>
    ));
  }

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: bottom, pointerEvents: 'none' }}>
      <div style={style}>{content}</div>
    </AbsoluteFill>
  );
};
