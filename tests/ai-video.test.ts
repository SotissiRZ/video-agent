import { describe, expect, it } from 'vitest';
import { priceLine } from '../src/saas/costs';
import { PROVIDER_DEFAULTS } from '../src/saas/commerce';
import { planConfig } from '../src/saas/plan-providers';
import { replicateVideoInput, veoDuration } from '../src/providers/video/replicate';
import { resolveVideoProvider } from '../src/providers/video/registry';
import { testConfig } from './helpers';

const request = { prompt: 'moto-taxi in a Ouagadougou street', width: 1080, height: 1920, durationSec: 5.2, outFileBase: '/tmp/x' };

describe('AI footage with Veo 3.1 Fast', () => {
  it('asks Veo for vertical 1080p without audio, the shortest clip that covers the shot', () => {
    expect(veoDuration(3)).toBe(4);
    expect(veoDuration(5.2)).toBe(6);
    expect(veoDuration(12)).toBe(8);
    const { input, seconds } = replicateVideoInput('google/veo-3.1-fast', request);
    expect(input).toMatchObject({ prompt: request.prompt, aspect_ratio: '9:16', duration: 6, resolution: '1080p', generate_audio: false });
    expect(seconds).toBe(6);
    expect(replicateVideoInput('google/veo-3.1-fast', { ...request, width: 1920, height: 1080 }).input.aspect_ratio).toBe('16:9');
    // Another model keeps the generic input.
    expect(replicateVideoInput('minimax/video-01', request).input).toEqual({ prompt: request.prompt, aspect_ratio: '9:16' });
  });

  it('prices AI footage per second and picks a provider only when a key exists', () => {
    expect(priceLine({ kind: 'video', provider: 'replicate', model: 'google/veo-3.1-fast', calls: 2, seconds: 12 }).usd).toBeCloseTo(1.2, 5);
    expect(resolveVideoProvider(testConfig({}))).toBeNull();
    expect(resolveVideoProvider(testConfig({ REPLICATE_API_TOKEN: 'r8_test' }))?.id).toBe('replicate');
  });

  it('gives each plan its clip budget: none for free trials', () => {
    const config = testConfig({ REPLICATE_API_TOKEN: 'r8_test' });
    expect(PROVIDER_DEFAULTS.free.aiVideoClips).toBe(0);
    expect(planConfig(config, PROVIDER_DEFAULTS.free).env.VIDEO_AGENT_MAX_GENERATED_CLIPS).toBe(0);
    expect(planConfig(config, PROVIDER_DEFAULTS.creator).env.VIDEO_AGENT_MAX_GENERATED_CLIPS).toBe(2);
    expect(planConfig(config, PROVIDER_DEFAULTS.pro).env.VIDEO_AGENT_MAX_GENERATED_CLIPS).toBe(4);
  });
});

describe('AI footage through OpenRouter (Wan 3.0)', () => {
  it('submits a silent vertical clip of the scene length, polls, then downloads it with the key', async () => {
    const { OpenRouterVideoProvider } = await import('../src/providers/video/openrouter');
    const { mockFetch, json } = await import('./fetch-mock');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { tmpDir } = await import('./helpers');
    let polls = 0;
    const m = mockFetch([
      ['POST', /\/api\/v1\/videos$/, () => json({ id: 'job-1', polling_url: '/api/v1/videos/job-1', status: 'pending' }, { status: 202 })],
      ['GET', /\/videos\/job-1$/, () => json(++polls < 2 ? { id: 'job-1', status: 'in_progress' } : { id: 'job-1', status: 'completed', unsigned_urls: ['https://openrouter.ai/api/v1/videos/job-1/content?index=0'], usage: { cost: 0.6 } })],
      ['GET', /\/videos\/job-1\/content\?index=0$/, () => new Response('mp4-bytes')],
    ]);
    try {
      const provider = new OpenRouterVideoProvider({ apiKey: 'sk-or-test', model: 'alibaba/wan-3.0', resolution: '720p', pollMs: 1 });
      const base = path.join(tmpDir(), 'clip');
      const out = await provider.generate({ ...request, outFileBase: base });
      expect(out).toEqual({ file: `${base}.mp4`, seconds: 6 });
      expect(fs.readFileSync(out.file, 'utf8')).toBe('mp4-bytes');
      expect(JSON.parse(m.calls[0]!.body as string)).toEqual({ model: 'alibaba/wan-3.0', prompt: request.prompt, duration: 6, resolution: '720p', aspect_ratio: '9:16', generate_audio: false });
      // Every call, the download included, carries the key (the links are not presigned).
      expect(m.calls.every((c) => c.headers.authorization === 'Bearer sk-or-test')).toBe(true);
      expect(provider.model).toBe('alibaba/wan-3.0@720p');
    } finally {
      m.restore();
    }
  });

  it('reports a failed job', async () => {
    const { OpenRouterVideoProvider } = await import('../src/providers/video/openrouter');
    const { mockFetch, json } = await import('./fetch-mock');
    const m = mockFetch([['POST', /\/videos$/, () => json({ id: 'job-2', status: 'failed', error: 'content policy' })]]);
    try {
      const provider = new OpenRouterVideoProvider({ apiKey: 'k', model: 'alibaba/wan-3.0', resolution: '720p', pollMs: 1 });
      await expect(provider.generate(request)).rejects.toThrow(/video failed: content policy/);
    } finally {
      m.restore();
    }
  });

  it('fits durations and shapes, prices per resolution and finds the key', async () => {
    const { openRouterAspect, openRouterDuration } = await import('../src/providers/video/openrouter');
    expect([openRouterDuration(1), openRouterDuration(5.2), openRouterDuration(5.02), openRouterDuration(45)]).toEqual([2, 6, 5, 30]);
    expect([openRouterAspect(1080, 1920), openRouterAspect(1920, 1080), openRouterAspect(1080, 1080), openRouterAspect(1080, 1350)]).toEqual(['9:16', '16:9', '1:1', '3:4']);
    expect(priceLine({ kind: 'video', provider: 'openrouter', model: 'alibaba/wan-3.0@720p', calls: 1, seconds: 6 }).usd).toBeCloseTo(0.6, 5);
    expect(priceLine({ kind: 'video', provider: 'openrouter', model: 'alibaba/wan-3.0-prime@1080p', calls: 1, seconds: 5 }).usd).toBeCloseTo(1.4, 5);
    expect(resolveVideoProvider(testConfig({ OPENROUTER_API_KEY: 'sk-or' }))?.id).toBe('openrouter');
    // The LLM key works too when it is an OpenRouter key.
    const shared = testConfig({ OPENAI_COMPATIBLE_BASE_URL: 'https://openrouter.ai/api/v1', OPENAI_COMPATIBLE_API_KEY: 'sk-or', OPENAI_COMPATIBLE_MODEL: 'x' });
    expect(resolveVideoProvider(shared)?.model).toBe('alibaba/wan-3.0@720p');
    expect(resolveVideoProvider(testConfig({ OPENAI_COMPATIBLE_BASE_URL: 'https://api.groq.com/openai/v1', OPENAI_COMPATIBLE_API_KEY: 'gsk' }))).toBeNull();
  });
});
