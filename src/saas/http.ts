/** Small HTTP helpers (no framework). */
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.gif': 'image/gif',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/** Security headers sent with every response. Scripts are files only (no inline script). */
export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
  // Microphone: recording one's own voice for cloning (same origin only). Nothing else.
  'permissions-policy': 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy':
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) => {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};

export const redirect = (res: http.ServerResponse, location: string) => {
  res.writeHead(302, { ...SECURITY_HEADERS, location, 'cache-control': 'no-store' });
  res.end();
};

export const readBuffer = (req: http.IncomingMessage, limit = 64 * 1024): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

export const readRaw = async (req: http.IncomingMessage, limit = 64 * 1024): Promise<string> => (await readBuffer(req, limit)).toString('utf8');

export const readJson = async (req: http.IncomingMessage, limit?: number): Promise<unknown> => {
  const raw = await readRaw(req, limit);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
};

/** Serve a file with HTTP Range support (needed for <video> seeking). */
export const sendFile = (req: http.IncomingMessage, res: http.ServerResponse, file: string, opts: { download?: boolean; cache?: string } = {}): void => {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'not found' });
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const headers: Record<string, string | number> = { ...SECURITY_HEADERS, 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': opts.cache ?? 'no-cache' };
  if (opts.download) headers['content-disposition'] = `attachment; filename="${path.basename(file).replace(/"/g, '')}"`;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) {
      res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': stat.size });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
};

/** Client address. X-Forwarded-For is only trusted behind our own reverse proxy (it is spoofable). */
export const clientIp = (req: http.IncomingMessage, trustProxy: boolean): string => {
  const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() : '';
  return forwarded || req.socket.remoteAddress || 'unknown';
};
