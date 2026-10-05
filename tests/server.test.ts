import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/core/logger';
import { startServer } from '../src/server/server';
import { fakeRenderer, testConfig } from './helpers';

let server: http.Server;
let base: string;

beforeAll(async () => {
  const started = await startServer(testConfig(), { port: 0, host: '127.0.0.1', webRoot: path.resolve('web'), deps: { renderer: fakeRenderer, logger: createLogger('silent'), llm: null, voice: null } });
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
  });
});
