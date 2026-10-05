/** Local web interface: static UI + JSON API + Server-Sent Events. No framework needed. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { z } from 'zod';
import type { AgentDependencies } from '../agent/orchestrator';
import { providerStatus } from '../agent/doctor';
import { loadConfig } from '../config/config';
import { saveSettings, settingsView } from '../config/settings';
import type { AppConfig } from '../config/config';
import { errorMessage } from '../core/errors';
import { FORMAT_PRESETS, OUTPUT_FORMATS, SUPPORTED_FPS } from '../core/formats';
import { STYLES } from '../remotion/contract/styles';
import { listTemplates } from '../templates/registry';
import { JobManager, publicJob } from './jobs';
import { resolveLLM } from '../llm/registry';
import { platformStatus } from '../publish/registry';
import { ScheduleStore, startSchedulerLoop } from '../publish/scheduler';
import { ensureCaptions, loadJob, publishJob, saveCaptions, type PublishJobOptions } from '../publish/service';
import { PLATFORM_IDS, type Captions, type PlatformId } from '../publish/types';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.gif': 'image/gif',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export const CreateJobSchema = z.object({
  prompt: z.string().trim().min(3).max(4000),
  format: z.string().max(20).optional(),
  width: z.number().int().min(16).max(7680).optional(),
  height: z.number().int().min(16).max(7680).optional(),
  durationSec: z.number().int().min(3).max(600).optional(),
  fps: z.number().int().min(1).max(120).optional(),
  style: z.string().max(30).optional(),
  template: z.string().max(40).optional(),
  language: z.enum(['auto', 'fr', 'en']).optional(),
  outputFormat: z.enum(OUTPUT_FORMATS).optional(),
  voice: z.boolean().optional(),
  music: z.boolean().optional(),
  subtitles: z.boolean().optional(),
  offline: z.boolean().optional(),
  stock: z.boolean().optional(),
  mediaCoverage: z.enum(['all', 'visual', 'none']).optional(),
});

const JOB_ID = /^[a-z0-9-]{1,80}$/;

const PlatformsSchema = z.array(z.enum(PLATFORM_IDS)).min(1);
export const PublishSchema = z.object({
  platforms: PlatformsSchema,
  at: z.string().datetime({ offset: true }).optional(),
  captions: z.record(z.enum(PLATFORM_IDS), z.object({ title: z.string().max(300), caption: z.string().max(6000), hashtags: z.array(z.string().max(100)).max(30) })).optional(),
  dryRun: z.boolean().optional(),
});

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const readBody = (req: http.IncomingMessage, limit = 64 * 1024): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });

/** Serve a file with HTTP Range support (needed for <video> seeking). */
const sendFile = (req: http.IncomingMessage, res: http.ServerResponse, file: string, download = false) => {
  if (!fs.existsSync(file)) return json(res, 404, { error: 'not found' });
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const headers: Record<string, string | number> = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  if (download) headers['content-disposition'] = `attachment; filename="${path.basename(file)}"`;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
};

export interface ServerOptions {
  port?: number;
  host?: string;
  webRoot: string;
  deps?: AgentDependencies;
  /** Test seam for publishing. */
  publishDeps?: Pick<PublishJobOptions, 'publisherFactory' | 'scheduleStore'>;
  /** Run the local publication scheduler (default: VIDEO_AGENT_SCHEDULER). */
  scheduler?: boolean;
  /** .env file edited by the Settings page (default: ./.env). */
  envFile?: string;
  /** How to rebuild the configuration after a settings change. */
  reloadConfig?: () => AppConfig;
}

export const createApp = (initialConfig: AppConfig, options: ServerOptions) => {
  // The configuration can be changed from the Settings page: keep a mutable reference.
  let config = initialConfig;
  const jobs = new JobManager(config, options.deps);
  const envFile = options.envFile ?? path.join(process.cwd(), '.env');
  const reloadConfig = options.reloadConfig ?? (() => loadConfig({ packageRoot: initialConfig.paths.root }));
  const webRoot = path.resolve(options.webRoot);
  const schedule = options.publishDeps?.scheduleStore ?? ScheduleStore.forConfig(config);
  const llm = () => {
    if (options.deps?.llm !== undefined) return options.deps.llm;
    try {
      return resolveLLM(config);
    } catch {
      return null;
    }
  };
  const publish = (jobDir: string, opts: Omit<PublishJobOptions, 'llm'>) => publishJob(config, jobDir, { ...opts, llm: llm(), ...options.publishDeps });

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      // Refuse cross-site writes (a web page cannot drive the local agent through the browser).
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
        let originHost = '';
        try {
          originHost = new URL(req.headers.origin).host;
        } catch {
          /* invalid origin */
        }
        if (originHost !== req.headers.host) return json(res, 403, { error: 'cross-origin request refused' });
      }
      if (parts[0] === 'api') {
        if (req.method === 'GET' && parts[1] === 'health') return json(res, 200, { ok: true });
        if (parts[1] === 'settings' && parts.length === 2) {
          if (!config.env.VIDEO_AGENT_SETTINGS_UI) return json(res, 403, { error: 'réglages désactivés (VIDEO_AGENT_SETTINGS_UI=false)' });
          if (req.method === 'GET') return json(res, 200, { envFile, groups: settingsView(config) });
          if (req.method === 'PUT') {
            const body = z.record(z.string(), z.string().max(2000).nullable()).safeParse(await readBody(req));
            if (!body.success) return json(res, 400, { error: 'format invalide' });
            try {
              config = saveSettings(envFile, body.data, reloadConfig);
            } catch (err) {
              return json(res, 400, { error: errorMessage(err) });
            }
            jobs.setConfig(config);
            return json(res, 200, { groups: settingsView(config), providers: (({ secrets: _s, ...rest }) => rest)(providerStatus(config)) });
          }
        }
        if (req.method === 'GET' && parts[1] === 'options') {
          return json(res, 200, {
            formats: FORMAT_PRESETS.map(({ id, label, width, height }) => ({ id, label, width, height })),
            templates: listTemplates().map(({ id, name, description }) => ({ id, name, description })),
            styles: Object.values(STYLES).map(({ id, label, description, theme }) => ({ id, label, description, colors: [theme.palette.background, theme.palette.primary, theme.palette.accent] })),
            outputFormats: OUTPUT_FORMATS,
            fps: SUPPORTED_FPS,
            defaults: { durationSec: config.env.VIDEO_AGENT_DEFAULT_DURATION ?? 30, fps: config.env.VIDEO_AGENT_DEFAULT_FPS, outputFormat: config.env.VIDEO_AGENT_DEFAULT_OUTPUT_FORMAT },
            providers: (({ secrets: _secrets, ...rest }) => rest)(providerStatus(config)),
          });
        }
        if (req.method === 'GET' && parts[1] === 'platforms') return json(res, 200, platformStatus(config));
        if (parts[1] === 'schedule') {
          if (req.method === 'GET' && parts.length === 2) return json(res, 200, schedule.list());
          if (req.method === 'DELETE' && parts[2]) return json(res, 200, { cancelled: schedule.cancel(parts[2]) });
        }
        if (parts[1] === 'jobs' && parts.length === 2) {
          if (req.method === 'GET') return json(res, 200, jobs.list().map(publicJob));
          if (req.method === 'POST') {
            const parsed = CreateJobSchema.safeParse(await readBody(req));
            if (!parsed.success) return json(res, 400, { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
            const { prompt, durationSec, ...rest } = parsed.data;
            const job = jobs.create(prompt, { ...rest, durationSec, style: rest.style === 'auto' ? undefined : rest.style, template: rest.template === 'auto' ? undefined : rest.template });
            return json(res, 201, publicJob(job));
          }
        }
        if (parts[1] === 'jobs' && parts[2]) {
          const id = parts[2];
          if (!JOB_ID.test(id)) return json(res, 400, { error: 'invalid job id' });
          const job = jobs.get(id);
          if (!job) return json(res, 404, { error: 'job not found' });
          const sub = parts[3];
          if (!sub && req.method === 'GET') return json(res, 200, publicJob(job));
          if (!sub && req.method === 'DELETE') return json(res, 200, { cancelled: jobs.cancel(id) });
          if (sub === 'events' && req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
            const send = (j: typeof job) => res.write(`data: ${JSON.stringify(publicJob(j))}\n\n`);
            send(job);
            const listener = (j: typeof job) => send(j);
            jobs.on(`job:${id}`, listener);
            const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000);
            req.on('close', () => {
              clearInterval(keepAlive);
              jobs.off(`job:${id}`, listener);
            });
            return;
          }
          if (sub === 'captions') {
            if (job.status !== 'completed') return json(res, 409, { error: 'job not completed' });
            if (req.method === 'GET') {
              const platforms = (url.searchParams.get('platforms') ?? PLATFORM_IDS.join(',')).split(',').filter((p): p is PlatformId => (PLATFORM_IDS as readonly string[]).includes(p));
              return json(res, 200, await ensureCaptions(config, loadJob(job.dir), platforms, { llm: llm() }));
            }
          }
          if (sub === 'publish' && req.method === 'POST') {
            if (job.status !== 'completed' || !job.videoFile) return json(res, 409, { error: 'la vidéo doit être générée avant publication' });
            const parsed = PublishSchema.safeParse(await readBody(req));
            if (!parsed.success) return json(res, 400, { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
            if (parsed.data.captions) {
              const current: Captions = await ensureCaptions(config, loadJob(job.dir), parsed.data.platforms, { llm: llm() });
              saveCaptions(job.dir, { ...current, ...parsed.data.captions });
            }
            const result = await publish(job.dir, { platforms: parsed.data.platforms, at: parsed.data.at ? new Date(parsed.data.at) : undefined, dryRun: parsed.data.dryRun });
            return json(res, 200, result);
          }
          if (sub === 'video' && job.videoFile) return sendFile(req, res, job.videoFile, url.searchParams.get('download') === '1');
          if (sub === 'poster' && job.posterFile) return sendFile(req, res, job.posterFile);
          if (sub === 'files' && parts[4] && ['storyboard.json', 'script.md', 'subtitles.srt', 'subtitles.vtt', 'credits.md', 'captions.json', 'publish.json'].includes(parts[4])) {
            return sendFile(req, res, path.join(job.dir, parts[4]), url.searchParams.get('download') === '1');
          }
        }
        return json(res, 404, { error: 'not found' });
      }

      // Static files.
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = path.resolve(webRoot, rel);
      if (!file.startsWith(webRoot + path.sep)) return json(res, 403, { error: 'forbidden' });
      return sendFile(req, res, file);
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: errorMessage(err) });
      else res.end();
    }
  };

  if (options.scheduler ?? config.env.VIDEO_AGENT_SCHEDULER) {
    startSchedulerLoop(schedule, async (jobDir, platforms) => (await publish(jobDir, { platforms })).outcomes);
  }
  return { handler, jobs };
};

export const startServer = async (config: AppConfig, options: ServerOptions): Promise<{ url: string; server: http.Server; jobs: JobManager }> => {
  const { handler, jobs } = createApp(config, options);
  const server = http.createServer((req, res) => void handler(req, res));
  const host = options.host ?? config.env.VIDEO_AGENT_HOST;
  const port = options.port ?? config.env.VIDEO_AGENT_PORT;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return { url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`, server, jobs };
};
