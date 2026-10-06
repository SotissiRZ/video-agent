/** Video jobs stored in the database: one row per video, always scoped to its owner. */
import crypto from 'node:crypto';
import path from 'node:path';
import { newJobId } from '../agent/job';
import type { AppConfig } from '../config/config';
import type { ProgressEvent, VideoOptions } from '../core/types';
import type { Db } from './db';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobRow {
  id: string;
  user_id: string;
  prompt: string;
  options: VideoOptions;
  status: JobStatus;
  /** Paid with an extra-video credit (outside the monthly quota). */
  paid_with_credit: boolean;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  heartbeat_at: Date | string | null;
  worker_id: string | null;
  cancel_requested: boolean;
  overall: number;
  step: string | null;
  message: string | null;
  steps: Record<string, { status: ProgressEvent['status']; message: string }>;
  title: string | null;
  warnings: string[];
  error: string | null;
  providers: Record<string, string> | null;
  dir: string;
  video_file: string | null;
  poster_file: string | null;
  duration_sec: number | null;
  credits: number;
}

export const JOB_ID = /^[a-z0-9-]{1,100}$/;

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : undefined);

/** Public view of a job (no absolute paths, no other user's data). */
export const publicJob = (job: JobRow) => ({
  id: job.id,
  prompt: job.prompt,
  options: job.options,
  paidWithCredit: job.paid_with_credit || undefined,
  status: job.status,
  createdAt: iso(job.created_at),
  finishedAt: iso(job.finished_at),
  overall: job.overall,
  step: job.step ?? undefined,
  message: job.message ?? undefined,
  steps: job.steps,
  title: job.title ?? undefined,
  warnings: job.warnings,
  error: job.error ?? undefined,
  providers: job.providers ?? undefined,
  durationSec: job.duration_sec ?? undefined,
  videoUrl: job.video_file ? `/api/jobs/${job.id}/video` : undefined,
  downloadUrl: job.video_file ? `/api/jobs/${job.id}/video?download=1` : undefined,
  posterUrl: job.poster_file ? `/api/jobs/${job.id}/poster` : undefined,
  videoName: job.video_file ? path.basename(job.video_file) : undefined,
  credits: job.credits,
});
export type PublicJob = ReturnType<typeof publicJob>;

export const userJobsDir = (config: AppConfig, userId: string): string => path.join(config.paths.output, 'users', userId);

export const createJob = async (db: Db, config: AppConfig, userId: string, prompt: string, options: VideoOptions, paidWithCredit = false): Promise<JobRow> => {
  // Timestamp + slug for readability, random suffix: several users may submit the same prompt.
  const id = `${newJobId(prompt.split(/\s+/).slice(0, 6).join(' '))}-${crypto.randomBytes(3).toString('hex')}`.slice(0, 100);
  const rows = await db.query<JobRow>('INSERT INTO jobs (id, user_id, prompt, options, dir, paid_with_credit) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *', [
    id,
    userId,
    prompt,
    JSON.stringify(options),
    path.join(userJobsDir(config, userId), id),
    paidWithCredit,
  ]);
  return rows[0]!;
};

export const getJob = (db: Db, userId: string, id: string): Promise<JobRow | undefined> => db.one<JobRow>('SELECT * FROM jobs WHERE id = $1 AND user_id = $2', [id, userId]);

export const listJobs = (db: Db, userId: string, limit = 60): Promise<JobRow[]> =>
  db.query<JobRow>('SELECT * FROM jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, limit]);

/** Take one extra-video credit; false when the balance is empty. */
export const useCredit = async (db: Db, userId: string): Promise<boolean> =>
  (await db.query('UPDATE users SET credits = credits - 1 WHERE id = $1 AND credits > 0 RETURNING credits', [userId])).length > 0;

/** Give back the credits of failed or cancelled videos (once per video; safe to call anytime). */
export const refundCredits = (db: Db) =>
  db.tx(async (t) => {
    const rows = await t.query<{ user_id: string }>("UPDATE jobs SET credit_refunded = true WHERE paid_with_credit AND NOT credit_refunded AND status IN ('failed', 'cancelled') RETURNING user_id");
    const perUser = new Map<string, number>();
    for (const r of rows) perUser.set(r.user_id, (perUser.get(r.user_id) ?? 0) + 1);
    for (const [userId, n] of perUser) await t.query('UPDATE users SET credits = credits + $2 WHERE id = $1', [userId, n]);
    return rows.length;
  });

/** Queued jobs are cancelled at once; running ones are flagged and stopped by their worker. */
export const requestCancel = async (db: Db, userId: string, id: string): Promise<boolean> => {
  const queued = await db.query("UPDATE jobs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND user_id = $2 AND status = 'queued' RETURNING id", [id, userId]);
  if (queued.length) return true;
  const running = await db.query("UPDATE jobs SET cancel_requested = true WHERE id = $1 AND user_id = $2 AND status = 'running' RETURNING id", [id, userId]);
  return running.length > 0;
};

export const deleteJob = (db: Db, userId: string, id: string) => db.query("DELETE FROM jobs WHERE id = $1 AND user_id = $2 AND status NOT IN ('queued', 'running') RETURNING dir", [id, userId]);

/** Atomically take the oldest queued job (several workers can poll concurrently). */
export const claimNextJob = async (db: Db, workerId: string): Promise<JobRow | undefined> =>
  db.one<JobRow>(
    `UPDATE jobs SET status = 'running', worker_id = $1, started_at = now(), heartbeat_at = now()
     WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING *`,
    [workerId],
  );

/** Jobs whose worker died (no heartbeat) are marked failed so that users are not stuck. */
export const failStaleJobs = (db: Db, staleAfterMs = 120_000) =>
  db.query(
    `UPDATE jobs SET status = 'failed', error = 'Le rendu a été interrompu (redémarrage du serveur). Relancez la vidéo.', finished_at = now()
     WHERE status = 'running' AND heartbeat_at < $1 RETURNING id`,
    [new Date(Date.now() - staleAfterMs).toISOString()],
  );

export const queuePosition = async (db: Db, job: JobRow): Promise<number> => {
  if (job.status !== 'queued') return 0;
  const row = await db.one<{ n: string | number }>("SELECT count(*) AS n FROM jobs WHERE status = 'queued' AND created_at < $1", [new Date(job.created_at).toISOString()]);
  return Number(row?.n ?? 0) + 1;
};

/**
 * Retention: finished videos older than `days` are deleted (rows and files are removed by the
 * caller), except those still waiting to be published.
 */
export const purgeOldJobs = (db: Db, days: number) =>
  db.query<{ id: string; dir: string }>(
    `DELETE FROM jobs j WHERE j.status IN ('completed', 'failed', 'cancelled') AND j.created_at < $1
       AND NOT EXISTS (SELECT 1 FROM publications p WHERE p.job_id = j.id AND p.status IN ('pending', 'running'))
     RETURNING id, dir`,
    [new Date(Date.now() - days * 86_400_000).toISOString()],
  );
