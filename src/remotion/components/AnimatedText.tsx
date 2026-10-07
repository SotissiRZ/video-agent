import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Entrance, Theme } from '../contract/storyboard';
import { parseEmphasis, springFor } from '../utils';

interface Props {
  text: string;
  theme: Theme;
  entrance: Entrance;
  /** Frame (relative to the scene) at which the animation starts. */
  delay?: number;
  stagger?: number;
  fontSize: number;
  fontFamily?: string;
  fontWeight?: number;
  color?: string;
  emphasisColor?: string;
  align?: 'left' | 'center';
  lineHeight?: number;
  uppercase?: boolean;
  maxWidth?: number;
}

/** Word-by-word animated text, with `*emphasis*` markup rendered in the accent colour. */
export const AnimatedText: React.FC<Props> = ({
  text,
  theme,
  entrance,
  delay = 0,
  stagger = 4,
  fontSize,
  fontFamily = theme.headingFont,
  fontWeight = theme.headingWeight,
  color = theme.palette.text,
  emphasisColor = theme.palette.accent,
  align = 'center',
  lineHeight = 1.12,
  uppercase = false,
  maxWidth,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const config = springFor(theme.motion);

  const style: React.CSSProperties = {
    fontSize,
    fontFamily,
    fontWeight,
    color,
    lineHeight,
    textAlign: align,
    textTransform: uppercase ? 'uppercase' : 'none',
    letterSpacing: uppercase ? '0.02em' : '-0.01em',
    margin: 0,
    maxWidth,
    textWrap: 'balance',
  };

  if (entrance === 'typewriter') {
    const plain = text.replace(/\*/g, '');
    const chars = Math.floor(interpolate(frame - delay, [0, plain.length * 1.4], [0, plain.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }));
    const cursorVisible = chars < plain.length || Math.floor(frame / 15) % 2 === 0;
    let remaining = chars;
    return (
      <p style={style}>
        {parseEmphasis(text).map((seg, i) => {
          const visible = seg.text.slice(0, Math.max(0, remaining));
          remaining -= seg.text.length;
          return (
            <span key={i} style={{ color: seg.emphasis ? emphasisColor : color }}>
              {visible}
            </span>
          );
        })}
        {/* Drawn, not a glyph: "▍" is missing from the fonts and rendered as an empty box. */}
        <span style={{ display: 'inline-block', width: '0.08em', height: '0.9em', marginLeft: '0.08em', verticalAlign: '-0.08em', background: emphasisColor, opacity: cursorVisible ? 1 : 0 }} />
      </p>
    );
  }

  let wordIndex = 0;
  return (
    <p style={style}>
      {parseEmphasis(text).map((seg, si) =>
        seg.text.split(/(\s+)/).map((word, wi) => {
          if (word.trim() === '') return <span key={`${si}-${wi}`}>{word}</span>;
          const index = wordIndex++;
          const progress = spring({ frame: frame - delay - index * stagger, fps, config });
          const opacity = interpolate(progress, [0, 0.6], [0, 1], { extrapolateRight: 'clamp' });
          let transform = 'none';
          let filter = 'none';
          if (entrance === 'rise') transform = `translateY(${(1 - progress) * 0.7}em)`;
          if (entrance === 'pop') transform = `scale(${interpolate(progress, [0, 1], [0.4, 1])})`;
          if (entrance === 'slide') transform = `translateX(${(1 - progress) * -1.2}em)`;
          if (entrance === 'blur') filter = `blur(${(1 - progress) * 0.35}em)`;
          return (
            <span
              key={`${si}-${wi}`}
              style={{
                display: 'inline-block',
                opacity,
                transform,
                filter,
                color: seg.emphasis ? emphasisColor : color,
              }}
            >
              {word}
            </span>
          );
        }),
      )}
    </p>
  );
};
