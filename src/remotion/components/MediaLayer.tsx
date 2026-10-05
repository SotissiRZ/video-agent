import React from 'react';
import { AbsoluteFill, Img, interpolate, Loop, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Media } from '../contract/storyboard';
import { resolveSrc } from '../utils';

interface Props {
  media: Media;
  kenBurns: number;
  style?: React.CSSProperties;
}

/** Full-bleed image or video with an optional slow zoom (Ken Burns effect). */
export const MediaLayer: React.FC<Props> = ({ media, kenBurns, style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const scale = interpolate(frame, [0, durationInFrames], [1, 1 + kenBurns], { extrapolateRight: 'clamp' });
  const common: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: media.fit,
    transform: `scale(${scale})`,
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
