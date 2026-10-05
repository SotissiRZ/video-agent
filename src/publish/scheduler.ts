/**
 * Local publication scheduler for platforms without native scheduling (TikTok, Instagram, LinkedIn),
 * or for any platform when you prefer the agent to publish at the right time.
 * Entries live in <output>/schedule.json. The scheduler runs inside "video-agent web"
 * or standalone with "video-agent scheduler".
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/config';
import { errorMessage } from '../core/errors';
import type { Logger } from '../core/logger';
import type { PlatformId } from './types';

export interface ScheduleEntry {
  id: string;
  jobDir: string;
  platforms: PlatformId[];
  /** ISO date. */
  at: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  createdAt: string;
  results?: Array<{ platform: PlatformId; ok: boolean; url?: string; message?: string }>;
  error?: string;
}

export class ScheduleStore {
  constructor(private readonly file: string) {}

  static forConfig(config: AppConfig): ScheduleStore {
    return new ScheduleStore(path.join(config.paths.output, 'schedule.json'));
  }

  list(): ScheduleEntry[] {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as ScheduleEntry[];
    } catch {
      return [];
    }
  }

  private save(entries: ScheduleEntry[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
    fs.renameSync(tmp, this.file);
  }

  add(entry: Pick<ScheduleEntry, 'jobDir' | 'platforms' | 'at'>): ScheduleEntry {
    const full: ScheduleEntry = { ...entry, id: randomUUID().slice(0, 8), status: 'pending', createdAt: new Date().toISOString() };
    this.save([...this.list(), full]);
    return full;
  }

  update(id: string, patch: Partial<ScheduleEntry>): void {
    this.save(this.list().map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  cancel(id: string): boolean {
    const entry = this.list().find((e) => e.id === id && e.status === 'pending');
    if (!entry) return false;
    this.update(id, { status: 'cancelled' });
    return true;
  }

  due(now = new Date()): ScheduleEntry[] {
    return this.list().filter((e) => e.status === 'pending' && new Date(e.at).getTime() <= now.getTime());
  }
}

export type PublishFn = (jobDir: string, platforms: PlatformId[]) => Promise<Array<{ platform: PlatformId; ok: boolean; url?: string; message?: string }>>;

/** Publish every due entry once. Returns the number of processed entries. */
export const runDueEntries = async (store: ScheduleStore, publish: PublishFn, logger?: Logger, now = new Date()): Promise<number> => {
  const due = store.due(now);
  for (const entry of due) {
    store.update(entry.id, { status: 'running' });
    try {
      const results = await publish(entry.jobDir, entry.platforms);
      const failed = results.filter((r) => !r.ok);
      store.update(entry.id, { status: failed.length ? 'failed' : 'done', results, error: failed.map((f) => `${f.platform}: ${f.message}`).join('; ') || undefined });
      logger?.info(`publication programmée ${entry.id} : ${results.map((r) => `${r.platform} ${r.ok ? '✔' : '✖'}`).join(' ')}`);
    } catch (err) {
      store.update(entry.id, { status: 'failed', error: errorMessage(err) });
      logger?.error(`publication programmée ${entry.id} échouée : ${errorMessage(err)}`);
    }
  }
  return due.length;
};

/** Loop until the signal aborts. */
export const startSchedulerLoop = (store: ScheduleStore, publish: PublishFn, opts: { intervalMs?: number; logger?: Logger; signal?: AbortSignal } = {}): void => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueEntries(store, publish, opts.logger);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), opts.intervalMs ?? 30_000);
  timer.unref?.();
  opts.signal?.addEventListener('abort', () => clearInterval(timer));
  void tick();
};
