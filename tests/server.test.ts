import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/core/logger';
import { startServer } from '../src/server/server';
import { fakeRenderer, testConfig, tmpDir } from './helpers';
import { ScheduleStore } from '../src/publish/scheduler';

let server: http.Server;
let base: string;

beforeAll(async () => {
  const started = await startServer(testConfig(), { port: 0, host: '127.0.0.1', webRoot: path.resolve('web'), deps: { renderer: fakeRenderer, logger: createLogger('silent'), llm: null, voice: null, stock: [] },
    scheduler: false,
    publishDeps: {
      scheduleStore: new ScheduleStore(path.join(tmpDir(), 'schedule.json')),
      publisherFactory: (id) => ({ id, label: id, constraints: { maxCaption: 2200, maxHashtags: 30, minDurationSec: 1, maxDurationSec: 600, vertical: true, nativeScheduling: false }, publish: async () => ({ platform: id, status: 'published', url: `https://${id}.test/ok` }) }),
    },
  });
  server = started.server;
  base = started.url;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const getJson = async (p: string) => (await fetch(base + p)).json();

describe('web server', () => {
  it('serves the UI and the options', async () => {
    const html = await (await fetch(base + '/')).text();
    expect(html).toContain('Video Agent');
    const options = await getJson('/api/options');
    expect(options.formats.map((f: { id: string }) => f.id)).toEqual(expect.arrayContaining(['landscape', 'vertical', 'square']));
    expect(options.templates).toHaveLength(7);
    expect(JSON.stringify(options)).not.toContain('secrets');
  });

  it('validates job requests', async () => {
    const res = await fetch(base + '/api/jobs', { method: 'POST', body: JSON.stringify({ prompt: '' }) });
    expect(res.status).toBe(400);
    expect((await fetch(base + '/api/jobs/..%2F..%2Fetc')).status).toBe(400);
    expect((await fetch(base + '/%2e%2e/package.json')).status).not.toBe(200);
  });

  it('runs a job and exposes progress, video and files', async () => {
    const res = await fetch(base + '/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Annonce carrée de 6 secondes pour la boutique Kora', fps: 24, outputFormat: 'mp4' }),
    });
    expect(res.status).toBe(201);
    const job = await res.json();
    let current = job;
    for (let i = 0; i < 100 && !['completed', 'failed'].includes(current.status); i++) {
      await new Promise((r) => setTimeout(r, 50));
      current = await getJson(`/api/jobs/${job.id}`);
    }
    expect(current.error).toBeUndefined();
    expect(current.status).toBe('completed');
    expect(current.steps.render.status).toBe('completed');
    const video = await fetch(base + current.videoUrl, { headers: { range: 'bytes=0-3' } });
    expect(video.status).toBe(206);
    expect(await video.text()).toBe('fake');
    const storyboard = await getJson(`/api/jobs/${job.id}/files/storyboard.json`);
    expect(storyboard.format).toMatchObject({ width: 1080, height: 1080, fps: 24 });
    expect((await getJson('/api/jobs')).some((j: { id: string }) => j.id === job.id)).toBe(true);

    // Publication: captions, edits, publish, local scheduling.
    const platforms = await getJson('/api/platforms');
    expect(platforms.map((p: { id: string }) => p.id)).toEqual(['tiktok', 'instagram', 'facebook', 'youtube', 'linkedin']);
    const captions = await getJson(`/api/jobs/${job.id}/captions?platforms=tiktok,instagram`);
    expect(captions.tiktok.hashtags.length).toBeGreaterThan(0);
    const bad = await fetch(`${base}/api/jobs/${job.id}/publish`, { method: 'POST', body: JSON.stringify({ platforms: ['myspace'] }) });
    expect(bad.status).toBe(400);
    const pub = await fetch(`${base}/api/jobs/${job.id}/publish`, {
      method: 'POST',
      body: JSON.stringify({ platforms: ['tiktok'], captions: { tiktok: { title: 'T', caption: 'Texte modifié', hashtags: ['#Kora'] } } }),
    });
    const { outcomes } = await pub.json();
    expect(outcomes[0]).toMatchObject({ platform: 'tiktok', ok: true, url: 'https://tiktok.test/ok', text: 'Texte modifié\n\n#Kora' });
    const later = new Date(Date.now() + 86400_000).toISOString();
    const scheduled = await (await fetch(`${base}/api/jobs/${job.id}/publish`, { method: 'POST', body: JSON.stringify({ platforms: ['instagram'], at: later }) })).json();
    expect(scheduled.outcomes[0].status).toBe('scheduled-local');
    const queue = await getJson('/api/schedule');
    expect(queue).toHaveLength(1);
    expect((await (await fetch(`${base}/api/schedule/${queue[0].id}`, { method: 'DELETE' })).json()).cancelled).toBe(true);
  });
});

describe('web password', () => {
  it('requires the password when VIDEO_AGENT_WEB_PASSWORD is set, except for health checks', async () => {
    const started = await startServer(testConfig({ VIDEO_AGENT_WEB_PASSWORD: 's3cret' }), { port: 0, host: '127.0.0.1', webRoot: path.resolve('web'), scheduler: false,
      deps: { renderer: fakeRenderer, logger: createLogger('silent'), llm: null, voice: null, stock: [] } });
    try {
      const url = started.url;
      expect((await fetch(url + '/api/health')).status).toBe(200);
      const denied = await fetch(url + '/api/options');
      expect(denied.status).toBe(401);
      expect(denied.headers.get('www-authenticate')).toContain('Basic');
      const auth = (pwd: string) => ({ authorization: 'Basic ' + Buffer.from(`moi:${pwd}`).toString('base64') });
      expect((await fetch(url + '/api/options', { headers: auth('mauvais') })).status).toBe(401);
      expect((await fetch(url + '/api/options', { headers: auth('s3cret') })).status).toBe(200);
      expect((await fetch(url + '/', { headers: auth('s3cret') })).status).toBe(200);
    } finally {
      await new Promise<void>((r) => started.server.close(() => r()));
    }
  });

  it('never returns the password in the settings view', async () => {
    const started = await startServer(testConfig({ VIDEO_AGENT_WEB_PASSWORD: 's3cret' }), { port: 0, host: '127.0.0.1', webRoot: path.resolve('web'), scheduler: false,
      deps: { renderer: fakeRenderer, logger: createLogger('silent'), llm: null, voice: null, stock: [] } });
    try {
      const res = await fetch(started.url + '/api/settings', { headers: { authorization: 'Basic ' + Buffer.from(':s3cret').toString('base64') } });
      const body = await res.text();
      expect(res.status).toBe(200);
      expect(body).not.toContain('s3cret');
      expect(body).toContain('VIDEO_AGENT_WEB_PASSWORD');
    } finally {
      await new Promise<void>((r) => started.server.close(() => r()));
    }
  });
});
