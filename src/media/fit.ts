/**
 * How each picture fills the frame. A picture filling the frame ("cover") is cropped to the video's
 * shape and blown up to its size: fine for a large photo of the right shape, but a 474 px square
 * poster in a 1080×1920 video loses its sides and turns soft. Such pictures are shown whole ("contain",
 * over a blurred copy of themselves), and the customer is told when their photo is too small.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Media, Storyboard } from '../remotion/contract/storyboard';

export interface ImageSize {
  width: number;
  height: number;
}

/** Width and height read from a PNG, JPEG or WebP header; undefined for anything else. */
export const readImageSize = (file: string): ImageSize | undefined => {
  let b: Buffer;
  try {
    b = fs.readFileSync(file);
  } catch {
    return undefined;
  }
  // PNG: the IHDR chunk comes first.
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  // JPEG: walk the segments up to a start-of-frame marker.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return undefined;
  }
  // WebP: lossy (VP8), lossless (VP8L) or extended (VP8X).
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return undefined;
};

/** Enlargement above which a picture filling the frame looks soft. */
const MAX_COVER_SCALE = 1.8;
/** Share of a customer photo the frame may cut off (posters and products must stay whole). */
const MAX_USER_CROP = 0.12;
/** Enlargement of a picture shown whole above which the customer is warned it will look blurry. */
const MAX_CONTAIN_SCALE = 1.5;

export interface FitDecision {
  fit: Media['fit'];
  /** The picture stays soft even when shown whole: worth telling the customer. */
  tooSmall: boolean;
}

/** Fill the frame, or show the whole picture, for a picture of `size` in a `frame`-sized video. */
export const chooseFit = (size: ImageSize, frame: ImageSize, userPhoto: boolean): FitDecision => {
  const cover = Math.max(frame.width / size.width, frame.height / size.height);
  const contain = Math.min(frame.width / size.width, frame.height / size.height);
  // Share of the picture lost on its longer side when it fills the frame.
  const crop = 1 - contain / cover;
  const whole = cover > MAX_COVER_SCALE || (userPhoto && crop > MAX_USER_CROP);
  return { fit: whole ? 'contain' : 'cover', tooSmall: userPhoto && contain > MAX_CONTAIN_SCALE };
};

/**
 * Decide the fit of every local picture of the storyboard. Videos, web captures and remote pictures
 * keep theirs. Returns the storyboard and one warning per customer photo too small for the video.
 */
export const fitPictures = (sb: Storyboard, publicDir: string): { storyboard: Storyboard; warnings: string[] } => {
  const frame = { width: sb.format.width, height: sb.format.height };
  const small = new Map<string, ImageSize>();
  const adapt = (media: Media | undefined): Media | undefined => {
    if (!media || media.type !== 'image' || media.screen || /^https?:/.test(media.src)) return media;
    const size = readImageSize(path.join(publicDir, media.src));
    if (!size || !size.width || !size.height) return media;
    const userPhoto = media.origin.startsWith('user:');
    const { fit, tooSmall } = chooseFit(size, frame, userPhoto);
    if (tooSmall) small.set(media.src, size);
    return fit === media.fit ? media : { ...media, fit };
  };
  const scenes = sb.scenes.map((scene) => ({
    ...scene,
    media: adapt(scene.media),
    ...(scene.shots ? { shots: scene.shots.map((shot) => adapt(shot)!) } : {}),
  }));
  const minWidth = Math.min(frame.width, frame.height);
  const warnings = [...small].map(
    ([src, size]) => `photo ${path.basename(src)} (${size.width}×${size.height}) is small for a ${frame.width}×${frame.height} video: it will look blurry. Upload a picture at least ${minWidth} px wide.`,
  );
  return { storyboard: { ...sb, scenes }, warnings };
};
