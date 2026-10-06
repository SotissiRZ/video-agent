/** Standalone song records and owner-scoped filesystem storage. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/config';
import type { Db } from './db';

export type SongStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed';

export interface SongRow {
  id: string;
  user_id: string;
  prompt: string;
  title: string;
  lyrics: string;
  style: string;
  mood: string;
  duration_sec: number;
  status: SongStatus;
  error: string | null;
  audio_file: string | null;
  heartbeat_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  finished_at: Date | string | null;
}

const iso = (date: Date | string | null) => (date ? new Date(date).toISOString() : undefined);

export const publicSong = (song: SongRow) => ({
  id: song.id,
  prompt: song.prompt,
  title: song.title,
  lyrics: song.lyrics,
  style: song.style,
  mood: song.mood,
  durationSec: song.duration_sec,
  status: song.status,
  error: song.error ?? undefined,
  createdAt: iso(song.created_at),
  finishedAt: iso(song.finished_at),
  audioUrl: song.audio_file ? `/api/songs/${song.id}/audio` : undefined,
  downloadUrl: song.audio_file ? `/api/songs/${song.id}/audio?download=1` : undefined,
});

export const SONG_ID = /^[a-f0-9-]{36}$/;

export const songDirectory = (config: AppConfig, userId: string, songId: string): string =>
  path.join(config.paths.output, 'users', userId, 'songs', songId);

export const createSongDraft = async (
  db: Db,
  config: AppConfig,
  userId: string,
  input: { prompt: string; title: string; lyrics: string; style: string; mood: string; durationSec: number },
): Promise<SongRow> => {
  const id = crypto.randomUUID();
  const dir = songDirectory(config, userId, id);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const row = await db.one<SongRow>(
      `INSERT INTO songs (id, user_id, prompt, title, lyrics, style, mood, duration_sec)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [id, userId, input.prompt, input.title, input.lyrics, input.style, input.mood, input.durationSec],
    );
    if (!row) throw new Error('Song draft insert returned no record');
    return row;
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
};

export const getSong = (db: Db, userId: string, id: string): Promise<SongRow | undefined> =>
  db.one<SongRow>('SELECT * FROM songs WHERE id = $1 AND user_id = $2', [id, userId]);

export const listSongs = (db: Db, userId: string): Promise<SongRow[]> =>
  db.query<SongRow>('SELECT * FROM songs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [userId]);

export const updateSongLyrics = async (db: Db, userId: string, id: string, title: string, lyrics: string): Promise<SongRow | undefined> =>
  db.one<SongRow>(
    `UPDATE songs SET title = $3, lyrics = $4, status = 'draft', error = NULL, updated_at = now()
     WHERE id = $1 AND user_id = $2 AND status IN ('draft', 'failed') RETURNING *`,
    [id, userId, title, lyrics],
  );
