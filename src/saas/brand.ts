/** Brand kit of a customer: name, colours and logo applied to their videos. */
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/config';
import type { Db } from './db';
import { HttpError } from './http';
import { userJobsDir } from './jobs';

export interface BrandKit {
  name: string;
  colors: string[];
  logoFile: string | null;
}

export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const HEX = /^#[0-9A-F]{6}$/;

/** Image type from its first bytes (the declared content type is not trusted). SVG is refused: it can carry scripts. */
export const sniffImage = (buf: Buffer): 'png' | 'jpg' | 'webp' | undefined => {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return undefined;
};

export const getBrandKit = async (db: Db, userId: string): Promise<BrandKit | undefined> => {
  const row = await db.one<{ name: string; colors: string[]; logo_file: string | null }>('SELECT name, colors, logo_file FROM brand_kits WHERE user_id = $1', [userId]);
  return row ? { name: row.name, colors: row.colors ?? [], logoFile: row.logo_file && fs.existsSync(row.logo_file) ? row.logo_file : null } : undefined;
};

export const saveBrandKit = async (db: Db, userId: string, input: { name?: string; colors?: string[] }): Promise<void> => {
  const colors = (input.colors ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (colors.length > 4 || colors.some((c) => !HEX.test(c))) throw new HttpError(400, 'Couleurs invalides (format #RRGGBB, 4 au maximum)', 'invalid_colors');
  await db.query(
    `INSERT INTO brand_kits (user_id, name, colors) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, colors = excluded.colors, updated_at = now()`,
    [userId, (input.name ?? '').trim().slice(0, 80), JSON.stringify(colors)],
  );
};

export const saveLogo = async (db: Db, config: AppConfig, userId: string, data: Buffer): Promise<string> => {
  if (data.length > MAX_LOGO_BYTES) throw new HttpError(413, 'Logo trop lourd (5 Mo maximum)', 'logo_too_large');
  const ext = sniffImage(data);
  if (!ext) throw new HttpError(400, 'Format accepté : PNG (idéalement transparent), JPEG ou WebP', 'logo_format');
  // Inside the user's folder (removed with the account); "_" cannot clash with a job id.
  const dir = path.join(userJobsDir(config, userId), '_brand');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith('logo.')) fs.rmSync(path.join(dir, f), { force: true });
  const file = path.join(dir, `logo.${ext}`);
  fs.writeFileSync(file, data);
  await db.query(
    `INSERT INTO brand_kits (user_id, logo_file) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET logo_file = excluded.logo_file, updated_at = now()`,
    [userId, file],
  );
  return file;
};

export const deleteLogo = async (db: Db, userId: string): Promise<void> => {
  const kit = await getBrandKit(db, userId);
  if (kit?.logoFile) fs.rmSync(kit.logoFile, { force: true });
  await db.query('UPDATE brand_kits SET logo_file = NULL, updated_at = now() WHERE user_id = $1', [userId]);
};

export const publicBrandKit = (kit: BrandKit | undefined) => ({
  name: kit?.name ?? '',
  colors: kit?.colors ?? [],
  logoUrl: kit?.logoFile ? `/api/brand/logo?v=${fs.statSync(kit.logoFile).mtimeMs.toFixed(0)}` : undefined,
});
