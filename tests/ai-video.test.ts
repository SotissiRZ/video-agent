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
