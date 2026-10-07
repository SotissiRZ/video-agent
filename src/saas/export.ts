import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/config';
import { renderStoryboard, type RenderOptions, type RenderResult } from '../render/renderer';
import { StoryboardSchema } from '../remotion/contract/storyboard';
import type { Db } from './db';
import type { JobRow } from './jobs';

const exportsInProgress = new Map<string, Promise<string>>();

/** Remove the free-plan badge from the final export after the user is entitled to download it. */
export const ensureCleanVideoExport = async (
  db: Db,
  config: AppConfig,
  job: JobRow,
  renderer: (options: RenderOptions) => Promise<RenderResult> = renderStoryboard,
): Promise<string> => {
  if (!job.video_file) throw new Error('Completed job has no video file');
  const storyboardFile = path.join(job.dir, 'storyboard.json');
  const storyboard = StoryboardSchema.parse(JSON.parse(fs.readFileSync(storyboardFile, 'utf8')));
  if (!storyboard.brand.badge) return job.video_file;
  const target = path.join(job.dir, 'export.mp4');
  if (fs.existsSync(target)) return target;
  const existing = exportsInProgress.get(job.id);
  if (existing) return existing;
  const task = (async () => {
    const clean = StoryboardSchema.parse({ ...storyboard, brand: { ...storyboard.brand, badge: undefined } });
    const temporary = path.join(job.dir, 'export.tmp.mp4');
    fs.rmSync(temporary, { force: true });
    try {
      await renderer({
        storyboard: clean,
        publicDir: path.join(job.dir, 'public'),
        outputFile: temporary,
        outputFormat: 'mp4',
        browserExecutable: config.browserExecutable,
        concurrency: config.env.VIDEO_AGENT_RENDER_CONCURRENCY,
        crf: config.env.VIDEO_AGENT_CRF,
        x264Preset: config.env.VIDEO_AGENT_X264_PRESET,
        gl: config.env.VIDEO_AGENT_RENDER_GL,
        timeoutMs: config.env.VIDEO_AGENT_RENDER_TIMEOUT_MS,
      });
      fs.renameSync(temporary, target);
    } catch (err) {
      fs.rmSync(temporary, { force: true });
      throw err;
    }
    await db.query('UPDATE jobs SET video_file = $2 WHERE id = $1 AND user_id = $3', [job.id, target, job.user_id]);
    return target;
  })().finally(() => exportsInProgress.delete(job.id));
  exportsInProgress.set(job.id, task);
  return task;
};
