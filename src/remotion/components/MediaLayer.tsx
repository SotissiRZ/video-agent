import React from 'react';
import { AbsoluteFill, Img, interpolate, Loop, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Media } from '../contract/storyboard';
import { resolveSrc, seeded } from '../utils';

interface Props {
  media: Media;
  kenBurns: number;
  style?: React.CSSProperties;
}

const hash = (text: string): number => {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/**
 * Camera move for a still image, chosen from the source so consecutive photos move differently:
 * zoom in or out combined with a slow pan, which makes photos feel like footage.
 */
export const kenBurnsMove = (src: string, kenBurns: number, progress: number) => {
  const r = seeded(hash(src));
  const zoomIn = r < 0.6;
  const angle = seeded(hash(src) + 1) * Math.PI * 2;
  const scale = zoomIn ? 1 + kenBurns * progress : 1 + kenBurns * (1 - progress);
  // Pan stays inside the zoom margin so no edge ever shows.
  const reach = ((kenBurns / 2) * 100 * 0.8) / (1 + kenBurns);
  const t = zoomIn ? progress : 1 - progress;
  return { scale, x: Math.cos(angle) * reach * t, y: Math.sin(angle) * reach * t };
};

/** Full-bleed image or video with an optional slow camera move (Ken Burns effect). */
export const MediaLayer: React.FC<Props> = ({ media, kenBurns, style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // Videos already move: a gentle zoom is enough. Photos get zoom + pan.
  const move = media.type === 'video' ? { scale: 1 + kenBurns * progress, x: 0, y: 0 } : kenBurnsMove(media.src, kenBurns, progress);
  const common: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: media.fit,
    transform: `scale(${move.scale}) translate(${move.x.toFixed(3)}%, ${move.y.toFixed(3)}%)`,
  };
  const src = resolveSrc(media.src);
  let content: React.ReactNode;
  if (media.type === 'video') {
    const video = <OffthreadVideo src={src} muted style={common} />;
    content = media.durationInFrames ? <Loop durationInFrames={media.durationInFrames}>{video}</Loop> : video;
  } else {
    content = <Img src={src} style={common} />;
  }
  return <AbsoluteFill style={{ overflow: 'hidden', ...style }}>{content}</AbsoluteFill>;
};
