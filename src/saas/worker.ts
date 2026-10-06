/**
 * Render worker: takes queued videos from the database one at a time (rendering uses all CPU
 * cores), reports progress, honours cancellation, and runs due publications in parallel.
 * Run several workers (containers) to render several videos at once.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { VideoAgent, type AgentDependencies } from '../agent/orchestrator';
import type { AppConfig } from '../config/config';
import { errorMessage } from '../core/errors';
import type { Logger } from '../core/logger';
import type { VideoOptions } from '../core/types';
import { resolveLLM } from '../llm/registry';
import { publishJob, type PublishOutcome } from '../publish/service';
import type { PlatformId, Publisher } from '../publish/types';
import { createConnectionPublisher, getConnection, providerFor, saveConnection, type ConnectionData } from './connections';
import type { Vault } from './crypto';
import type { Db } from './db';
import { getBrandKit } from './brand';
import { claimNextJob, failStaleJobs, purgeOldJobs, type JobRow, refundCredits } from './jobs';
import { planOfUser } from './plans';
import { claimDuePublication, finishPublication, type PublicationRow } from './publications';

export interface WorkerOptions {
  db: Db;
  vault: Vault;
  /** Fresh configuration for each job (admin settings changes apply without restart). */
  config: () => AppConfig;
  logger: Logger;
  deps?: AgentDependencies;
  pollMs?: number;
  /** Test seam: replaces the per-user publisher factory. */
  publisherFactory?: (platform: PlatformId, userId: string) => Publisher;
}

export const BADGE_TEXT = 'Made with SOVID AI';

export class Worker {
  readonly id = `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  private stopped = false;
  private loops: Promise<void>[] = [];
  private readonly wakers = new Set<() => void>();

  constructor(private readonly o: WorkerOptions) {}

  start(): void {
    this.loops = [this.loop(this.renderTick), this.loop(() => this.publishNext())];
    void failStaleJobs(this.o.db).catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.poke();
    await Promise.all(this.loops);
  }

  /** Called when a job is queued in the same process (embedded worker): no need to wait for the poll. */
  poke(): void {
    for (const wake of [...this.wakers]) wake();
  }

  /** Delete videos past VIDEO_AGENT_RETENTION_DAYS (hourly; harmless when several workers do it). */
  async purge(): Promise<number> {
    const days = this.o.config().env.VIDEO_AGENT_RETENTION_DAYS;
    if (!days) return 0;
    const removed = await purgeOldJobs(this.o.db, days);
    for (const job of removed) fs.rmSync(job.dir, { recursive: true, force: true });
    if (removed.length) this.o.logger.info(`retention: ${removed.length} video(s) older than ${days} days deleted`);
    return removed.length;
  }

  private async loop(tick: () => Promise<boolean>): Promise<void> {
    let lastStaleCheck = Date.now();
    let lastPurge = 0;
    while (!this.stopped) {
      let worked = false;
      try {
        worked = await tick();
        if (Date.now() - lastStaleCheck > 60_000) {
          lastStaleCheck = Date.now();
          await failStaleJobs(this.o.db);
          await refundCredits(this.o.db);
        }
        if (tick === this.renderTick && Date.now() - lastPurge > 3600_000) {
          lastPurge = Date.now();
          await this.purge();
        }
      } catch (err) {
        this.o.logger.error(`worker: ${errorMessage(err)}`);
      }
      if (!worked && !this.stopped) {
        await new Promise<void>((resolve) => {
          const wake = () => {
            clearTimeout(timer);
            this.wakers.delete(wake);
            resolve();
          };
          const timer = setTimeout(wake, this.o.pollMs ?? 2000);
          this.wakers.add(wake);
        });
      }
    }
  }

  private readonly renderTick = () => this.renderNext();

  /** Render one queued video. Returns false when the queue is empty. */
  async renderNext(): Promise<boolean> {
    const job = await claimNextJob(this.o.db, this.id);
    if (!job) return false;
    await this.render(job);
    return true;
  }

  private async render(job: JobRow): Promise<void> {
    const { db, logger } = this.o;
    const config = this.o.config();
    const user = await db.one<{ plan: string; subscription_status: string | null; current_period_end: Date | string | null }>('SELECT plan, subscription_status, current_period_end FROM users WHERE id = $1', [job.user_id]);
    const plan = planOfUser(config, user);
    const controller = new AbortController();
    const steps = { ...job.steps };
    let progress = { overall: 0, step: '', message: '' };
    let dirty = false;

    const flush = async () => {
      if (!dirty) return;
      dirty = false;
      await db.query('UPDATE jobs SET overall = $2, step = $3, message = $4, steps = $5, heartbeat_at = now() WHERE id = $1', [job.id, progress.overall, progress.step, progress.message, JSON.stringify(steps)]);
    };
    // Progress is written at most once a second; the heartbeat also checks for cancellation.
    const ticker = setInterval(() => {
      void (async () => {
        try {
          await flush();
          const row = await db.one<{ cancel_requested: boolean }>('UPDATE jobs SET heartbeat_at = now() WHERE id = $1 RETURNING cancel_requested', [job.id]);
          if (row?.cancel_requested) controller.abort(new Error('Cancelled'));
        } catch (err) {
          logger.warn(`progress update failed: ${errorMessage(err)}`);
        }
      })();
    }, 1000);

    // Brand kit (unless the customer unticked it for this video).
    const kit = (job.options as { brandKit?: boolean }).brandKit === false ? undefined : await getBrandKit(db, job.user_id);
    const options: VideoOptions = {
      ...job.options,
      ...(kit ? { brandName: kit.name || undefined, brandColors: kit.colors.length ? kit.colors : undefined, brandLogo: kit.logoFile ?? undefined } : {}),
      outDir: job.dir,
      maxDurationSec: plan.maxDurationSec,
      badge: plan.badge ? BADGE_TEXT : undefined,
      skipRender: false,
    };
    try {
      const agent = new VideoAgent(config, { logger, ...this.o.deps });
      const result = await agent.run(
        { prompt: job.prompt, options },
        {
          signal: controller.signal,
          onProgress: (e) => {
            progress = { overall: e.overall, step: e.step, message: e.message };
            steps[e.step] = { status: e.status, message: e.message };
            dirty = true;
          },
        },
      );
      clearInterval(ticker);
      dirty = true;
      await flush();
      const fps = result.storyboard.format.fps;
      await db.query(
        `UPDATE jobs SET status = 'completed', overall = 1, finished_at = now(), video_file = $2, poster_file = $3, title = $4, warnings = $5, providers = $6, credits = $7, duration_sec = $8 WHERE id = $1`,
        [job.id, result.videoFile ?? null, result.posterFile ?? null, result.concept.title, JSON.stringify(result.warnings), JSON.stringify(result.providers), result.credits.length, result.storyboard.format.durationInFrames / fps],
      );
    } catch (err) {
      clearInterval(ticker);
      dirty = true;
      await flush().catch(() => undefined);
      const cancelled = controller.signal.aborted;
      await db.query("UPDATE jobs SET status = $2, error = $3, finished_at = now() WHERE id = $1", [job.id, cancelled ? 'cancelled' : 'failed', cancelled ? null : errorMessage(err)]);
      if (!cancelled) logger.warn(`job ${job.id} failed: ${errorMessage(err)}`);
      if (job.paid_with_credit) await refundCredits(db).catch(() => 0);
    }
  }

  /** Run one due publication. Returns false when none is due. */
  async publishNext(): Promise<boolean> {
    const publication = await claimDuePublication(this.o.db);
    if (!publication) return false;
    await this.publish(publication);
    return true;
  }

  private async publish(p: PublicationRow): Promise<void> {
    const { db, vault } = this.o;
    const config = this.o.config();
    const job = await db.one<JobRow>('SELECT * FROM jobs WHERE id = $1 AND user_id = $2', [p.job_id, p.user_id]);
    if (!job || job.status !== 'completed') {
      await finishPublication(db, p.id, 'failed', [], 'La vidéo n’existe plus');
      return;
    }
    // Rotated tokens are saved after each platform, whatever the outcome.
    const pending: Array<{ provider: ReturnType<typeof providerFor>; persist: () => ConnectionData | undefined; name: string }> = [];
    const connections = new Map<string, { data: ConnectionData; name: string }>();
    for (const platform of p.platforms) {
      const provider = providerFor(platform);
      if (connections.has(provider)) continue;
      const row = await getConnection(db, p.user_id, provider);
      if (row) connections.set(provider, { data: vault.decrypt<ConnectionData>(row.data), name: row.account_name });
    }
    const factory = (platform: PlatformId): Publisher => {
      if (this.o.publisherFactory) return this.o.publisherFactory(platform, p.user_id);
      const provider = providerFor(platform);
      const connection = connections.get(provider);
      if (!connection) throw new Error('Compte non connecté');
      const { publisher, persist } = createConnectionPublisher(config, platform, connection.data);
      pending.push({ provider, persist, name: connection.name });
      return publisher;
    };
    let llm = null;
    try {
      llm = this.o.deps?.llm !== undefined ? this.o.deps.llm : resolveLLM(config);
    } catch {
      llm = null;
    }
    try {
      const { outcomes } = await publishJob(config, job.dir, { platforms: p.platforms, llm, publisherFactory: factory });
      await finishPublication(db, p.id, outcomes.every((o) => o.ok) ? 'done' : outcomes.some((o) => o.ok) ? 'partial' : 'failed', outcomes);
    } catch (err) {
      await finishPublication(db, p.id, 'failed', [] as PublishOutcome[], errorMessage(err));
    } finally {
      for (const item of pending) {
        const data = item.persist();
        if (data) await saveConnection(db, vault, p.user_id, item.provider, item.name, data).catch(() => undefined);
      }
    }
  }
}
