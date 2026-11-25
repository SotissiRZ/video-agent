import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseFit, fitPictures, readImageSize } from '../src/media/fit';
import type { Storyboard } from '../src/remotion/contract/storyboard';
import { tmpDir } from './helpers';

const png = (width: number, height: number) => {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
};

/** SOI, an APP0 segment, then a baseline start-of-frame. */
const jpeg = (width: number, height: number) => {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
};

const webpExtended = (width: number, height: number) => {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
};

describe('picture sizes', () => {
  it('reads the size of PNG, JPEG and WebP pictures', () => {
    const dir = tmpDir();
    const files: Array<[string, Buffer]> = [['a.png', png(1600, 900)], ['b.jpg', jpeg(474, 474)], ['c.webp', webpExtended(1080, 1920)]];
    for (const [name, data] of files) fs.writeFileSync(path.join(dir, name), data);
    expect(readImageSize(path.join(dir, 'a.png'))).toEqual({ width: 1600, height: 900 });
    expect(readImageSize(path.join(dir, 'b.jpg'))).toEqual({ width: 474, height: 474 });
    expect(readImageSize(path.join(dir, 'c.webp'))).toEqual({ width: 1080, height: 1920 });
    expect(readImageSize(path.join(dir, 'missing.jpg'))).toBeUndefined();
  });
});

describe('how a picture fills the frame', () => {
  const vertical = { width: 1080, height: 1920 };

  it('fills the frame with a large picture of the right shape', () => {
    expect(chooseFit({ width: 1080, height: 1920 }, vertical, false)).toEqual({ fit: 'cover', tooSmall: false });
    expect(chooseFit({ width: 1600, height: 1600 }, vertical, false)).toEqual({ fit: 'cover', tooSmall: false });
  });

  it('shows whole a picture that would be blown up too much', () => {
    // A 1024 px square in 1080×1920 is enlarged 1.9× when it fills the frame.
    expect(chooseFit({ width: 1024, height: 1024 }, vertical, false).fit).toBe('contain');
  });

  it('never crops a customer poster or product photo of another shape, and flags the small ones', () => {
    expect(chooseFit({ width: 1600, height: 1600 }, vertical, true)).toEqual({ fit: 'contain', tooSmall: false });
    expect(chooseFit({ width: 474, height: 474 }, vertical, true)).toEqual({ fit: 'contain', tooSmall: true });
    expect(chooseFit({ width: 1080, height: 1920 }, vertical, true)).toEqual({ fit: 'cover', tooSmall: false });
  });

  it('decides every local picture of a storyboard and warns about small customer photos', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'product'));
    fs.mkdirSync(path.join(dir, 'media'));
    fs.writeFileSync(path.join(dir, 'product', 'poster.jpg'), jpeg(474, 474));
    fs.writeFileSync(path.join(dir, 'media', 'stock.jpg'), jpeg(1080, 1920));
    const scene = (id: string, src: string, origin: string) => ({ id, media: { type: 'image' as const, src, fit: 'cover' as const, origin } });
    const sb = {
      format: { width: 1080, height: 1920, fps: 30, durationInFrames: 300 },
      scenes: [scene('a', 'product/poster.jpg', 'user:product'), scene('b', 'media/stock.jpg', 'stock:pexels'), scene('c', 'https://example.com/x.jpg', 'stock:pexels')],
    } as unknown as Storyboard;
    const { storyboard, warnings } = fitPictures(sb, dir);
    expect(storyboard.scenes.map((s) => s.media!.fit)).toEqual(['contain', 'cover', 'cover']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^photo poster\.jpg \(474×474\) is small .*at least 1080 px wide/);
  });
});
