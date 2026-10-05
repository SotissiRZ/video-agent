import React from 'react';
import { AbsoluteFill, Img, interpolate, Loop, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
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

/** Shortest shot when a scene shows several visuals (frames are dropped below this). */
export const MIN_SHOT_SECONDS = 1.6;
const CROSSFADE = 10;

/** Visible shots of a scene: as many as fit with at least MIN_SHOT_SECONDS each. */
export const visibleShots = (media: Media[], durationInFrames: number, fps: number): Media[] =>
  media.slice(0, Math.max(1, Math.min(media.length, Math.floor(durationInFrames / (MIN_SHOT_SECONDS * fps)))));

/**
 * A scene's visuals one after another (2–4 s shots), each with its own camera move,
 * the next one fading in over the previous.
 */
export const MediaStack: React.FC<{ media: Media[]; kenBurns: number; style?: React.CSSProperties }> = ({ media, kenBurns, style }) => {
  const { durationInFrames, fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const shots = visibleShots(media, durationInFrames, fps);
  if (shots.length === 1) return <MediaLayer media={shots[0]!} kenBurns={kenBurns} style={style} />;
  const length = Math.ceil(durationInFrames / shots.length);
  return (
    <AbsoluteFill style={style}>
      {shots.map((shot, i) => {
        const from = i * length;
        // Each shot stays until the next one has fully faded in.
        const until = i === shots.length - 1 ? durationInFrames - from : length + CROSSFADE;
        const opacity = i === 0 ? 1 : interpolate(frame - from, [0, CROSSFADE], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        return (
          <Sequence key={`${shot.src}-${i}`} from={from} durationInFrames={until} layout="none">
            <AbsoluteFill style={{ opacity }}>
              <MediaLayer media={shot} kenBurns={kenBurns} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
