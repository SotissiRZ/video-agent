/** Local web interface: static UI + JSON API + Server-Sent Events. No framework needed. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { z } from 'zod';
import type { AgentDependencies } from '../agent/orchestrator';
import { providerStatus } from '../agent/doctor';
import type { AppConfig } from '../config/config';
import { errorMessage } from '../core/errors';
import { FORMAT_PRESETS, OUTPUT_FORMATS, SUPPORTED_FPS } from '../core/formats';
import { STYLES } from '../remotion/contract/styles';
import { listTemplates } from '../templates/registry';
import { JobManager, publicJob } from './jobs';

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
});

const JOB_ID = /^[a-z0-9-]{1,80}$/;

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
}

export const createApp = (config: AppConfig, options: ServerOptions) => {
  const jobs = new JobManager(config, options.deps);
  const webRoot = path.resolve(options.webRoot);

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (parts[0] === 'api') {
        if (req.method === 'GET' && parts[1] === 'health') return json(res, 200, { ok: true });
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
          if (sub === 'video' && job.videoFile) return sendFile(req, res, job.videoFile, url.searchParams.get('download') === '1');
          if (sub === 'poster' && job.posterFile) return sendFile(req, res, job.posterFile);
          if (sub === 'files' && parts[4] && ['storyboard.json', 'script.md', 'subtitles.srt', 'subtitles.vtt'].includes(parts[4])) {
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
