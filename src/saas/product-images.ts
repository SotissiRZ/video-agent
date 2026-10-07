import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/config';
import type { Db } from './db';
import { HttpError } from './http';
import { sniffImage } from './brand';
import { userJobsDir } from './jobs';
import type { LLMProvider } from '../llm/types';
import { errorMessage } from '../core/errors';
import { describeProductPhoto, type ProductPhoto } from '../media/product-photos';

export interface ProductImage {
  id: string;
  user_id: string;
  name: string;
  file: string;
  description: string | null;
  created_at: Date | string;
}

export const publicProductImage = (image: ProductImage) => ({
  id: image.id,
  name: image.name,
  description: image.description ?? undefined,
  createdAt: new Date(image.created_at).toISOString(),
});

export const listProductImages = (db: Db, userId: string) =>
  db.query<ProductImage>('SELECT * FROM product_images WHERE user_id = $1 ORDER BY created_at DESC', [userId]);

export const productImageFiles = async (db: Db, userId: string, ids: string[], maxCount: number): Promise<string[]> => {
  if (ids.length > maxCount || new Set(ids).size !== ids.length) throw new HttpError(400, `Sélectionnez au maximum ${maxCount} images produit.`, 'product_image_limit');
  if (!ids.length) return [];
  const rows = await db.query<ProductImage>('SELECT * FROM product_images WHERE user_id = $1 AND id = ANY($2::text[])', [userId, ids]);
  if (rows.length !== ids.length) throw new HttpError(400, 'Une image sélectionnée est introuvable.', 'product_image_not_found');
  return ids.map((id) => rows.find((row) => row.id === id)!.file);
};

export const saveProductImage = async (
  db: Db,
  config: AppConfig,
  userId: string,
  name: string,
  data: Buffer,
  maxCount: number,
  maxBytes: number,
): Promise<ProductImage> => {
  if (data.length > maxBytes) throw new HttpError(413, `Image trop volumineuse (maximum ${Math.round(maxBytes / 1024 / 1024)} Mo).`, 'product_image_too_large');
  const ext = sniffImage(data);
  if (!ext) throw new HttpError(400, 'Format accepté : PNG, JPEG ou WebP.', 'product_image_format');
  const count = Number((await db.one<{ count: string | number }>('SELECT count(*) AS count FROM product_images WHERE user_id = $1', [userId]))?.count ?? 0);
  if (count >= maxCount) throw new HttpError(409, `Vous avez atteint la limite de ${maxCount} images produit.`, 'product_image_limit', { limit: maxCount });
  const id = crypto.randomUUID();
  const dir = path.join(userJobsDir(config, userId), '_products');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.${ext}`);
  fs.writeFileSync(file, data, { flag: 'wx' });
  try {
    const row = await db.one<ProductImage>(
      'INSERT INTO product_images (id, user_id, name, file) VALUES ($1, $2, $3, $4) RETURNING *',
      [id, userId, path.basename(name).slice(0, 120) || `Produit.${ext}`, file],
    );
    if (!row) throw new Error('Product image insert returned no record');
    return row;
  } catch (err) {
    fs.rmSync(file, { force: true });
    throw err;
  }
};

export const deleteProductImage = async (db: Db, userId: string, id: string): Promise<ProductImage | undefined> => {
  const referenced = await db.one<{ id: string }>(
    "SELECT id FROM jobs WHERE user_id = $1 AND $2 = ANY(product_image_ids) AND status IN ('queued', 'running') LIMIT 1",
    [userId, id],
  );
  if (referenced) throw new HttpError(409, 'Cette image est utilisée par une génération en cours.', 'product_image_in_use');
  return db.one<ProductImage>('DELETE FROM product_images WHERE id = $1 AND user_id = $2 RETURNING *', [id, userId]);
};

/** Let the vision model describe a photo once; a text-only or unavailable model leaves it undescribed. */
export const describeProductImage = async (db: Db, llm: LLMProvider | null, image: ProductImage, onError?: (message: string) => void): Promise<ProductImage> => {
  if (!llm || image.description) return image;
  try {
    const description = await describeProductPhoto(llm, image.file, image.name, AbortSignal.timeout(30_000));
    if (!description) return image;
    return (await db.one<ProductImage>('UPDATE product_images SET description = $3 WHERE id = $1 AND user_id = $2 RETURNING *', [image.id, image.user_id, description])) ?? image;
  } catch (err) {
    onError?.(errorMessage(err));
    return image;
  }
};

/** Selected photos in the customer's order, described when possible, for the video pipeline. */
export const productPhotos = async (db: Db, llm: LLMProvider | null, userId: string, ids: string[], onError?: (message: string) => void): Promise<ProductPhoto[]> => {
  if (!ids.length) return [];
  const rows = await db.query<ProductImage>('SELECT * FROM product_images WHERE user_id = $1 AND id = ANY($2::text[])', [userId, ids]);
  const photos: ProductPhoto[] = [];
  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    if (!row) continue;
    const image = await describeProductImage(db, llm, row, onError);
    photos.push({ file: image.file, name: image.name, description: image.description ?? undefined });
  }
  return photos;
};
