import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, Loop, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Media } from '../contract/storyboard';
import { resolveSrc, seeded } from '../utils';
import { ScreenCapture } from './ScreenCapture';

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
export const MediaLayer: React.FC<Props> = (props) => {
  const { screen } = props.media;
  if (!screen) return <PictureLayer {...props} />;
  return (
    <AbsoluteFill style={props.style}>
      <ScreenCapture media={{ ...props.media, screen }} />
    </AbsoluteFill>
  );
};

/** Frames of the "punch" that opens every shot: it lands slightly zoomed in, then settles. */
const PUNCH_FRAMES = 16;

const PictureLayer: React.FC<Props> = ({ media, kenBurns, style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // Videos already move: a zoom is enough. Photos get zoom + pan, like footage.
  const move = media.type === 'video' ? { scale: 1 + kenBurns * 0.6 * progress, x: 0, y: 0 } : kenBurnsMove(media.src, kenBurns, progress);
  const punch = 1 + 0.09 * (1 - Easing.out(Easing.cubic)(Math.min(1, frame / PUNCH_FRAMES)));
  const common: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: media.fit,
    transform: `scale(${(move.scale * punch).toFixed(4)}) translate(${move.x.toFixed(3)}%, ${move.y.toFixed(3)}%)`,
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
const CROSSFADE = 12;

/** How the next shot of a scene comes in: never the same plain fade twice in a row. */
export const SHOT_CUTS = ['zoom', 'slide', 'circle', 'wipe'] as const;
export type ShotCut = (typeof SHOT_CUTS)[number];

export const shotCutStyle = (cut: ShotCut, progress: number): React.CSSProperties => {
  const p = Easing.inOut(Easing.cubic)(Math.min(1, Math.max(0, progress)));
  switch (cut) {
    case 'zoom':
      return { transform: `scale(${1.3 - 0.3 * p})`, opacity: Math.min(1, p * 2.5) };
    case 'slide':
      return { transform: `translateX(${((1 - p) * 100).toFixed(2)}%)`, filter: `blur(${(Math.sin(Math.PI * p) * 14).toFixed(2)}px)` };
    case 'circle':
      return { clipPath: `circle(${(p * 75).toFixed(2)}% at 50% 50%)` };
    case 'wipe':
      // Diagonal edge sweeping from left to right.
      return { clipPath: `polygon(0 0, ${(p * 140).toFixed(2)}% 0, ${(p * 140 - 40).toFixed(2)}% 100%, 0 100%)` };
  }
};

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
        const cut = SHOT_CUTS[(hash(shot.src) + i) % SHOT_CUTS.length]!;
        const enter = i === 0 ? {} : shotCutStyle(cut, (frame - from) / CROSSFADE);
        return (
          <Sequence key={`${shot.src}-${i}`} from={from} durationInFrames={until} layout="none">
            <AbsoluteFill style={{ overflow: 'hidden', ...enter }}>
              <MediaLayer media={shot} kenBurns={kenBurns} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
