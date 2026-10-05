import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { AnimatedText } from '../components/AnimatedText';
import { bodyFontSize, fitFontSize, useLayout } from '../utils';
import { FadeUp, SceneShell, useEntrance, type SceneProps } from './SceneShell';

/** Parse "12 500+", "98%", "3x" → numeric part for a count-up animation. */
const splitNumber = (value: string): { prefix: string; number: number | null; decimals: number; suffix: string } => {
  const m = /^(\D*?)(\d[\d\s.,]*)(.*)$/.exec(value.trim());
  if (!m) return { prefix: '', number: null, decimals: 0, suffix: value };
  const raw = m[2]!.replace(/\s/g, '');
  const decimalMatch = /[.,](\d{1,2})$/.exec(raw);
  const decimals = decimalMatch ? decimalMatch[1]!.length : 0;
  const normalized = decimals ? raw.slice(0, -decimals - 1).replace(/[.,]/g, '') + '.' + decimalMatch![1] : raw.replace(/[.,]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? { prefix: m[1]!, number, decimals, suffix: m[3]! } : { prefix: '', number: null, decimals: 0, suffix: value };
};

export const StatScene: React.FC<SceneProps> = (props) => {
  const { scene, storyboard } = props;
  const frame = useCurrentFrame();
  const layout = useLayout();
  const { theme } = storyboard;
  const value = scene.stat?.value ?? scene.headline;
  const label = scene.stat?.label ?? scene.body;
  const parts = splitNumber(value);
  const pop = useEntrance(0, theme.motion);
  let display = value;
  if (parts.number !== null) {
    const current = interpolate(frame, [5, 40], [0, parts.number], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    display = `${parts.prefix}${current.toLocaleString('fr-FR', { minimumFractionDigits: parts.decimals, maximumFractionDigits: parts.decimals })}${parts.suffix}`;
  }
  return (
    <SceneShell {...props}>
      {scene.stat && scene.headline ? (
        <AnimatedText
          text={scene.headline}
          theme={theme}
          entrance="rise"
          fontSize={fitFontSize(scene.headline, layout, 0.06)}
          color={theme.palette.mutedText}
          fontWeight={700}
          maxWidth={layout.contentWidth}
        />
      ) : null}
      <div
        style={{
          fontFamily: theme.headingFont,
          fontWeight: 900,
          fontSize: fitFontSize(value, { ...layout, isPortrait: false }, 0.26, 0.12),
          color: theme.palette.accent,
          transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})`,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {display}
      </div>
      {label ? (
        <FadeUp delay={18}>
          <p style={{ margin: 0, fontFamily: theme.bodyFont, fontWeight: 600, fontSize: bodyFontSize(label, layout), color: theme.palette.text, textAlign: 'center', maxWidth: layout.contentWidth }}>
            {label}
          </p>
        </FadeUp>
      ) : null}
    </SceneShell>
  );
};
