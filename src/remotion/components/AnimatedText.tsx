import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Entrance, Theme } from '../contract/storyboard';
import { parseEmphasis, springFor } from '../utils';
import { findSpoken, VoiceSyncContext } from '../motion/sync';

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

/**
 * A word never breaks, so the longest one must fit on a line: "OUAGADOUGOU" in bold capitals is far
 * wider than the 0.72 em per character fitFontSize assumes (O, G, D, U run ~0.8 em, plus the 0.02 em
 * letter spacing of uppercase headlines). Shrinks the size only when needed.
 */
export const fitLongestWord = (text: string, fontSize: number, maxWidth: number | undefined, uppercase: boolean): number => {
  if (!maxWidth) return fontSize;
  // Breakable spaces only: a word and its no-break-spaced punctuation ("Ouagadougou ?") stay on one line.
  const longest = Math.max(1, ...text.replace(/\*/g, '').split(/[ \t\r\n]+/).map((word) => word.length));
  const emPerChar = uppercase ? 0.88 : 0.72;
  return Math.max(1, Math.min(fontSize, Math.floor(maxWidth / (longest * emPerChar))));
};

/** French typography: a no-break space before ? ! : ; and inside « », so the mark never starts a line alone. */
export const keepPunctuation = (text: string): string =>
  text.replace(/(\S)[ \t]+([?!:;»])/g, '$1\u00A0$2').replace(/«[ \t]+/g, '«\u00A0');

/** Word-by-word animated text, with `*emphasis*` markup rendered in the accent colour. */
export const AnimatedText: React.FC<Props> = ({
  text: rawText,
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
  const text = keepPunctuation(rawText);
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const config = springFor(theme.motion);
  const sync = React.useContext(VoiceSyncContext);
  // The block never freezes: a slow push towards the viewer plus a gentle float, all scene long.
  const life = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const drift = `scale(${(1 + 0.04 * life).toFixed(4)}) translateY(${(Math.sin(frame / 24) * 0.035).toFixed(4)}em)`;
  // Words leave one after the other (last first) just before the scene ends.
  const exitFrames = Math.max(6, Math.min(14, Math.round(durationInFrames * 0.15)));
  const exitStart = durationInFrames - exitFrames - 2;

  const style: React.CSSProperties = {
    fontSize: fitLongestWord(text, fontSize, maxWidth, uppercase),
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
          // Words stay whole while typing: no line break at a hyphen ("ZSR-TechNum").
          return (
            <span key={i} style={{ color: seg.emphasis ? emphasisColor : color }}>
              {visible.split(/(\s+)/).map((word, wi) => (/\S/.test(word) ? <span key={wi} style={{ whiteSpace: 'nowrap' }}>{word}</span> : word))}
            </span>
          );
        })}
        {/* Drawn, not a glyph: "▍" is missing from the fonts and rendered as an empty box. */}
        <span style={{ display: 'inline-block', width: '0.08em', height: '0.9em', marginLeft: '0.08em', verticalAlign: '-0.08em', background: emphasisColor, opacity: cursorVisible ? 1 : 0 }} />
      </p>
    );
  }

  const total = text.replace(/\*/g, '').split(/\s+/).filter(Boolean).length;
  // Bouncier springs: motion design overshoots a little, then lands.
  const pop = { damping: 9, stiffness: 170, mass: 0.8 };
  let wordIndex = 0;
  return (
    <p style={{ ...style, transform: drift }}>
      {parseEmphasis(text).map((seg, si) =>
        seg.text.split(/(\s+)/).map((word, wi) => {
          if (word.trim() === '') return <span key={`${si}-${wi}`}>{word}</span>;
          const index = wordIndex++;
          const start = delay + index * stagger;
          const progress = spring({ frame: frame - start, fps, config: entrance === 'pop' ? pop : config });
          const exitAt = exitStart + (total - 1 - index) * 1.5;
          const exit = interpolate(frame, [exitAt, exitAt + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const opacity = interpolate(progress, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' }) * (1 - exit);
          const transforms: string[] = [];
          let filter = exit > 0 ? `blur(${(exit * 0.12).toFixed(3)}em)` : 'none';
          if (entrance === 'pop') transforms.push(`scale(${interpolate(progress, [0, 1], [0.3, 1])})`, `rotate(${((1 - progress) * -10).toFixed(2)}deg)`);
          if (entrance === 'slide') transforms.push(`translateX(${((1 - progress) * -1.4).toFixed(3)}em)`, `skewX(${((1 - progress) * -14).toFixed(2)}deg)`);
          if (entrance === 'blur') {
            transforms.push(`scale(${interpolate(progress, [0, 1], [1.25, 1])})`);
            if (progress < 1) filter = `blur(${((1 - progress) * 0.35 + exit * 0.12).toFixed(3)}em)`;
          }
          if (exit > 0) transforms.push(`translateY(${(-exit * 0.45).toFixed(3)}em)`);
          // The highlighted word: a marker stroke draws under it once it has landed, and it breathes.
          // ...drawn when the voice says it (else just after the word lands).
          const said = seg.emphasis && sync.words.length ? findSpoken(sync.words, seg.text) : -1;
          const markerAt = said >= 0 ? Math.max(start + 6, sync.offset + sync.words[said]!.from) : start + 8;
          const marker = seg.emphasis ? spring({ frame: frame - markerAt, fps, config: { damping: 20, stiffness: 120 } }) : 0;
          if (seg.emphasis && progress > 0.95) transforms.push(`scale(${(1 + Math.sin((frame - start) / 9) * 0.025).toFixed(4)})`);
          const inner = (
            <span
              style={{
                display: 'inline-block',
                position: 'relative',
                // Rise: the word comes up from behind an invisible edge (mask reveal).
                transform: [entrance === 'rise' ? `translateY(${((1 - progress) * 110).toFixed(2)}%)` : '', ...transforms].join(' ').trim() || 'none',
                opacity,
                filter,
                color: seg.emphasis ? emphasisColor : color,
              }}
            >
              {word}
              {seg.emphasis ? (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: '-0.04em',
                    right: '-0.04em',
                    bottom: '0.02em',
                    height: '0.13em',
                    borderRadius: '0.07em',
                    background: emphasisColor,
                    opacity: 0.55 * (1 - exit),
                    transform: `scaleX(${marker.toFixed(4)})`,
                    transformOrigin: 'left center',
                    zIndex: -1,
                  }}
                />
              ) : null}
            </span>
          );
          return entrance === 'rise' ? (
            // The mask: room for accents above and descenders below, clipped while the word rises.
            <span key={`${si}-${wi}`} style={{ display: 'inline-block', overflow: 'hidden', padding: '0.12em 0.04em 0.14em', margin: '-0.12em -0.04em -0.14em', verticalAlign: 'bottom' }}>
              {inner}
            </span>
          ) : (
            <React.Fragment key={`${si}-${wi}`}>{inner}</React.Fragment>
          );
        }),
      )}
    </p>
  );
};
