/** In-memory job queue for the web interface. Jobs run one at a time (rendering is CPU-bound). */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentDependencies } from '../agent/orchestrator';
import { VideoAgent } from '../agent/orchestrator';
import { newJobId } from '../agent/job';
import type { AppConfig } from '../config/config';
import { errorMessage } from '../core/errors';
import type { ProgressEvent, VideoOptions } from '../core/types';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobRecord {
  id: string;
  prompt: string;
  options: VideoOptions;
  status: JobStatus;
  createdAt: string;
  finishedAt?: string;
  dir: string;
  overall: number;
  step?: string;
  message?: string;
  steps: Record<string, { status: ProgressEvent['status']; message: string }>;
  videoFile?: string;
  posterFile?: string;
  title?: string;
  warnings: string[];
  error?: string;
  providers?: Record<string, string>;
}

export class JobManager extends EventEmitter {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly controllers = new Map<string, AbortController>();
  private queue: string[] = [];
  private running = false;

  constructor(
    private readonly config: AppConfig,
    private readonly deps: AgentDependencies = {},
  ) {
    super();
    this.setMaxListeners(100);
    this.loadHistory();
  }

  /** Previous jobs found in the output directory (completed renders). */
  private loadHistory(): void {
    const root = this.config.paths.output;
    if (!fs.existsSync(root)) return;
    for (const id of fs.readdirSync(root)) {
      const file = path.join(root, id, 'job.json');
      if (!fs.existsSync(file)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.jobs.set(id, {
          id,
          prompt: data.prompt ?? '',
          options: data.options ?? {},
          status: data.status === 'completed' ? 'completed' : 'failed',
          createdAt: data.createdAt ?? new Date(0).toISOString(),
          finishedAt: data.createdAt,
          dir: path.join(root, id),
          overall: 1,
          steps: {},
          videoFile: data.videoFile ? path.join(root, id, data.videoFile) : undefined,
          posterFile: data.posterFile ? path.join(root, id, data.posterFile) : undefined,
          warnings: data.warnings ?? [],
          providers: data.providers,
        });
      } catch {
        /* ignore unreadable jobs */
      }
    }
  }

  list(): JobRecord[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  create(prompt: string, options: VideoOptions): JobRecord {
    const id = newJobId(prompt.split(/\s+/).slice(0, 6).join(' '));
    const job: JobRecord = {
      id,
      prompt,
      options,
      status: 'queued',
      createdAt: new Date().toISOString(),
      dir: path.join(this.config.paths.output, id),
      overall: 0,
      steps: {},
      warnings: [],
    };
    this.jobs.set(id, job);
    this.queue.push(id);
    this.update(job);
    void this.pump();
    return job;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === 'queued') {
      this.queue = this.queue.filter((q) => q !== id);
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      this.update(job);
      return true;
    }
    const controller = this.controllers.get(id);
    controller?.abort(new Error('Cancelled'));
    return Boolean(controller);
  }

  private update(job: JobRecord): void {
    this.emit('update', job);
    this.emit(`job:${job.id}`, job);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const id = this.queue.shift();
    if (!id) return;
    const job = this.jobs.get(id)!;
    this.running = true;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    job.status = 'running';
    this.update(job);
    try {
      const agent = new VideoAgent(this.config, this.deps);
      const result = await agent.run(
        { prompt: job.prompt, options: { ...job.options, outDir: job.dir } },
        {
          signal: controller.signal,
          onProgress: (e) => {
            job.overall = e.overall;
            job.step = e.step;
            job.message = e.message;
            job.steps[e.step] = { status: e.status, message: e.message };
            this.update(job);
          },
        },
      );
      job.status = 'completed';
      job.videoFile = result.videoFile;
      job.posterFile = result.posterFile;
      job.title = result.concept.title;
      job.warnings = result.warnings;
      job.providers = result.providers;
      job.overall = 1;
    } catch (err) {
      job.status = controller.signal.aborted ? 'cancelled' : 'failed';
      job.error = errorMessage(err);
    } finally {
      job.finishedAt = new Date().toISOString();
      this.controllers.delete(id);
      this.running = false;
      this.update(job);
      void this.pump();
    }
  }
}

/** Public view of a job (no absolute paths). */
export const publicJob = (job: JobRecord) => ({
  id: job.id,
  prompt: job.prompt,
  options: job.options,
  status: job.status,
  createdAt: job.createdAt,
  finishedAt: job.finishedAt,
  overall: job.overall,
  step: job.step,
  message: job.message,
  steps: job.steps,
  title: job.title,
  warnings: job.warnings,
  error: job.error,
  providers: job.providers,
  videoUrl: job.videoFile ? `/api/jobs/${job.id}/video` : undefined,
  downloadUrl: job.videoFile ? `/api/jobs/${job.id}/video?download=1` : undefined,
  posterUrl: job.posterFile ? `/api/jobs/${job.id}/poster` : undefined,
  videoName: job.videoFile ? path.basename(job.videoFile) : undefined,
});
