/** Customer product photos: what the model sees in them, and where they go in the video. */
import fs from 'node:fs';
import path from 'node:path';
import type { LLMImage, LLMProvider } from '../llm/types';
import type { Scene } from '../remotion/contract/storyboard';

export interface ProductPhoto {
  /** Absolute path of the uploaded picture. */
  file: string;
  name?: string;
  /** Short factual description written by a vision model (absent when none is available). */
  description?: string;
}

const MEDIA_TYPES: Record<string, LLMImage['mediaType']> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export const toLLMImage = (file: string): LLMImage | undefined => {
  const mediaType = MEDIA_TYPES[path.extname(file).toLowerCase()];
  return mediaType && fs.existsSync(file) ? { mediaType, data: fs.readFileSync(file).toString('base64') } : undefined;
};

/**
 * Ask a vision-capable model what the photo shows, so the script can talk about the real product.
 * Text-only models fail here: the caller keeps the photo without a description.
 */
export const describeProductPhoto = async (llm: LLMProvider, file: string, name = '', signal?: AbortSignal): Promise<string> => {
  const image = toLLMImage(file);
  if (!image) throw new Error(`unsupported product photo: ${path.basename(file)}`);
  const response = await llm.generate({
    system: 'You describe product photos for a video copywriter. Be factual and concise; never guess prices, claims or details you cannot see.',
    maxTokens: 400,
    signal,
    messages: [
      {
        role: 'user',
        images: [image],
        content: `File name: "${name || path.basename(file)}".
In at most 2 sentences (max 60 words, in French), describe what this photo shows: the product, its type, colours, packaging, visible brand or text, and the setting. Reply with the description only.`,
      },
    ],
  });
  return response.text.replace(/\s+/g, ' ').trim().slice(0, 400);
};

/** Brief lines listing the photos, numbered from 1 as the script refers to them. */
export const productPhotoLines = (photos: ProductPhoto[]): string =>
  photos.map((photo, i) => `${i + 1}. ${photo.description || photo.name || path.basename(photo.file)}`).join('\n');

/**
 * Put every customer photo on screen at least once.
 * 1. Scenes the script asked a photo for (1-based `requested[i]`) get it.
 * 2. Photos left over go to the free preferred scenes, then to any free scene.
 * 3. With more photos than scenes, the extras become additional shots of scenes already showing a photo.
 */
export const placeProductPhotos = (scenes: Scene[], srcs: string[], requested: Array<number | undefined>, preferred: number[]): Scene[] => {
  const out = scenes.map((scene) => ({ ...scene }));
  const show = (i: number, src: string) => {
    out[i] = { ...out[i]!, media: { type: 'image', src, fit: 'cover', origin: 'user:product' }, shots: undefined };
  };
  const used = new Set<number>();
  const taken = new Set<number>();
  requested.forEach((photo, i) => {
    if (!photo || photo < 1 || photo > srcs.length || i >= out.length) return;
    show(i, srcs[photo - 1]!);
    used.add(photo - 1);
    taken.add(i);
  });
  const order = [...preferred, ...out.map((_, i) => i)].filter((i, pos, all) => i < out.length && all.indexOf(i) === pos);
  const extras: number[] = [];
  srcs.forEach((src, photo) => {
    if (used.has(photo)) return;
    const scene = order.find((i) => !taken.has(i));
    if (scene === undefined) return extras.push(photo);
    show(scene, src);
    taken.add(scene);
  });
  // Extras are spread over the scenes showing a photo, at most 4 shots each.
  const hosts = [...taken].sort((a, b) => a - b);
  let cursor = 0;
  for (const photo of extras) {
    for (let k = 0; k < hosts.length; k++) {
      const i = hosts[(cursor + k) % hosts.length]!;
      if ((out[i]!.shots?.length ?? 0) >= 4) continue;
      out[i] = { ...out[i]!, shots: [...(out[i]!.shots ?? []), { type: 'image', src: srcs[photo]!, fit: 'cover', origin: 'user:product' }] };
      cursor = (cursor + k + 1) % hosts.length;
      break;
    }
  }
  return out;
};
