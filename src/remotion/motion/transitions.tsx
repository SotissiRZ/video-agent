/**
 * Scene transitions drawn with CSS only (no WebGL shader, which a headless render server may lack):
 * a zoom through the cut and a whip pan with motion blur. Remotion's iris, clock-wipe and push-cut
 * presentations are DOM-based too and are used alongside.
 */
import React from 'react';
import { AbsoluteFill, Easing, interpolate } from 'remotion';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '@remotion/transitions';

const ease = Easing.bezier(0.65, 0, 0.35, 1);

type ZoomProps = Record<string, never>;

/** The outgoing scene rushes towards the viewer and fades, the next one settles from slightly behind. */
const ZoomPresentation: React.FC<TransitionPresentationComponentProps<ZoomProps>> = ({ children, presentationDirection, presentationProgress }) => {
  const p = ease(presentationProgress);
  const exiting = presentationDirection === 'exiting';
  const style: React.CSSProperties = exiting
    ? { transform: `scale(${1 + 0.35 * p})`, opacity: 1 - p, filter: `blur(${8 * p}px)` }
    : { transform: `scale(${0.82 + 0.18 * p})`, opacity: interpolate(p, [0, 0.4], [0, 1], { extrapolateRight: 'clamp' }) };
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

export const zoomThrough = (): TransitionPresentation<ZoomProps> => ({ component: ZoomPresentation, props: {} });

export type WhipDirection = 'from-left' | 'from-right' | 'from-top' | 'from-bottom';
type WhipProps = { direction: WhipDirection };

/** Fast camera pan: both scenes slide together, smeared by a motion blur that peaks mid-way. */
const WhipPresentation: React.FC<TransitionPresentationComponentProps<WhipProps>> = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  const p = ease(presentationProgress);
  const horizontal = passedProps.direction === 'from-left' || passedProps.direction === 'from-right';
  const sign = passedProps.direction === 'from-left' || passedProps.direction === 'from-top' ? 1 : -1;
  const offset = presentationDirection === 'exiting' ? sign * p * 100 : sign * (p - 1) * 100;
  const blur = Math.sin(Math.PI * presentationProgress) * 18;
  return (
    <AbsoluteFill
      style={{
        transform: horizontal ? `translateX(${offset}%)` : `translateY(${offset}%)`,
        filter: `blur(${blur.toFixed(2)}px)`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const whip = (direction: WhipDirection): TransitionPresentation<WhipProps> => ({ component: WhipPresentation, props: { direction } });
