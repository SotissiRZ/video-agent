/** Publications: immediate or scheduled posts of a video, executed by the workers. */
import type { PublishOutcome } from '../publish/service';
import type { PlatformId } from '../publish/types';
import { newId } from './crypto';
import type { Db } from './db';

export type PublicationStatus = 'pending' | 'running' | 'done' | 'partial' | 'failed' | 'cancelled';

export interface PublicationRow {
  id: string;
  user_id: string;
  job_id: string;
  platforms: PlatformId[];
  at: Date | string;
  status: PublicationStatus;
  outcomes: PublishOutcome[] | null;
  error: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

export const createPublication = async (db: Db, userId: string, jobId: string, platforms: PlatformId[], at: Date = new Date()): Promise<PublicationRow> =>
  (await db.query<PublicationRow>('INSERT INTO publications (id, user_id, job_id, platforms, at) VALUES ($1, $2, $3, $4, $5) RETURNING *', [newId(), userId, jobId, JSON.stringify(platforms), at.toISOString()]))[0]!;

export const listPublications = (db: Db, userId: string, jobId?: string) =>
  jobId
    ? db.query<PublicationRow>('SELECT * FROM publications WHERE user_id = $1 AND job_id = $2 ORDER BY created_at DESC LIMIT 50', [userId, jobId])
    : db.query<PublicationRow & { title: string | null; prompt: string }>(
        'SELECT p.*, j.title, j.prompt FROM publications p JOIN jobs j ON j.id = p.job_id WHERE p.user_id = $1 ORDER BY p.at DESC LIMIT 100',
        [userId],
      );

export const getPublication = (db: Db, userId: string, id: string) => db.one<PublicationRow>('SELECT * FROM publications WHERE id = $1 AND user_id = $2', [id, userId]);

export const cancelPublication = async (db: Db, userId: string, id: string): Promise<boolean> =>
  (await db.query("UPDATE publications SET status = 'cancelled', finished_at = now() WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING id", [id, userId])).length > 0;

export const claimDuePublication = (db: Db) =>
  db.one<PublicationRow>(
    `UPDATE publications SET status = 'running', started_at = now()
     WHERE id = (SELECT id FROM publications WHERE status = 'pending' AND at <= now() ORDER BY at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING *`,
  );

export const finishPublication = (db: Db, id: string, status: PublicationStatus, outcomes: PublishOutcome[], error?: string) =>
  db.query('UPDATE publications SET status = $2, outcomes = $3, error = $4, finished_at = now() WHERE id = $1', [id, status, JSON.stringify(outcomes.map(({ text: _t, ...o }) => o)), error ?? null]);

export const publicPublication = (p: PublicationRow & { title?: string | null; prompt?: string }) => ({
  id: p.id,
  jobId: p.job_id,
  jobTitle: p.title ?? p.prompt?.slice(0, 80),
  platforms: p.platforms,
  at: new Date(p.at).toISOString(),
  status: p.status,
  outcomes: p.outcomes ?? [],
  error: p.error ?? undefined,
});
