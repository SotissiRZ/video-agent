import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoAgent } from '../src/agent/orchestrator';
import { createLogger } from '../src/core/logger';
import { ElevenLabsMusicProvider } from '../src/providers/music/elevenlabs';
import { buildMusicPrompt } from '../src/providers/music/prompt';
import { resolveMusicProvider } from '../src/providers/music/registry';
import { ReplicateMusicProvider } from '../src/providers/music/replicate';
import { StabilityMusicProvider } from '../src/providers/music/stability';
import type { MusicProvider } from '../src/providers/music/types';
import { fakeRenderer, testConfig } from './helpers';

const logger = createLogger('silent');
afterEach(() => vi.unstubAllGlobals());

describe('music prompt', () => {
  it('follows the genre the user asked for', () => {
    const p = buildMusicPrompt({ prompt: 'Pub pour mon maquis à Abidjan. Musique : coupé-décalé rapide.', mood: 'energetic' });
    expect(p).toContain('coupé-décalé');
    expect(p).toContain('fast tempo');
    expect(p).toContain('instrumental, no vocals');
  });
  it('falls back to the industry of the video', () => {
    expect(buildMusicPrompt({ prompt: 'Vidéo pour une entreprise de cybersécurité', mood: 'normal' })).toContain('dark electronic');
  });
});

describe('music providers', () => {
  it('ElevenLabs sends the length in ms and forces instrumental', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetchMock);
    const r = await new ElevenLabsMusicProvider({ apiKey: 'k' }).generate({ prompt: 'afrobeats', durationSec: 42.3 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/music');
    expect(JSON.parse(String(init.body))).toMatchObject({ prompt: 'afrobeats', music_length_ms: 43_000, force_instrumental: true });
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('k');
    expect(r).toMatchObject({ extension: 'mp3', durationSec: 43 });
  });

  it('Stable Audio posts multipart and caps the duration', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([9])));
    vi.stubGlobal('fetch', fetchMock);
    const r = await new StabilityMusicProvider({ apiKey: 's' }).generate({ prompt: 'piano', durationSec: 400 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/v2beta/audio/stable-audio-2/text-to-audio');
    expect((init.body as FormData).get('duration')).toBe('190');
    expect(r.durationSec).toBe(190);
  });

  it('MusicGen on Replicate: version-pinned prediction, then download', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/predictions')) return Response.json({ id: 'p1', status: 'succeeded', output: 'https://replicate.delivery/track.mp3' });
      return new Response(new Uint8Array([7, 7]));
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await new ReplicateMusicProvider({ token: 't', model: 'meta/musicgen:abc' }).generate({ prompt: 'lofi', durationSec: 60 });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ version: 'abc', input: { prompt: 'lofi', duration: 30, output_format: 'mp3' } });
    expect(r.audio.length).toBe(2);
  });

  it('is off by default; "auto" picks the first configured key', () => {
    expect(resolveMusicProvider(testConfig({ ELEVENLABS_API_KEY: 'x' }))).toBeNull();
    expect(resolveMusicProvider(testConfig({ VIDEO_AGENT_MUSIC_PROVIDER: 'auto', REPLICATE_API_TOKEN: 'r', STABILITY_API_KEY: 's' }))?.id).toBe('stability');
    expect(() => resolveMusicProvider(testConfig({ VIDEO_AGENT_MUSIC_PROVIDER: 'elevenlabs' }))).toThrow(/not available/);
  });
});

describe('AI music in the pipeline', () => {
  const prompt = 'Crée une vidéo de 15 secondes pour une agence immobilière à Dakar, musique piano douce.';

  it('writes the composed track and uses it', async () => {
    let asked = { prompt: '', durationSec: 0 };
    const music: MusicProvider = {
      id: 'fake-music',
      maxDurationSec: 120,
      async generate(req) {
        asked = req;
        return { audio: Buffer.from('ID3fake'), extension: 'mp3', durationSec: req.durationSec };
      },
    };
    const result = await new VideoAgent(testConfig(), { renderer: fakeRenderer, logger, voice: null, llm: null, stock: [], image: null, music }).run({ prompt });
    const sb = JSON.parse(fs.readFileSync(result.storyboardFile, 'utf8'));
    expect(sb.audio.music.src).toBe('music/generated.mp3');
    expect(fs.existsSync(path.join(result.jobDir, 'public/music/generated.mp3'))).toBe(true);
    expect(asked.prompt).toContain('piano');
    expect(asked.durationSec).toBeGreaterThanOrEqual(15);
  });

  it('falls back to synthesized music when the provider fails', async () => {
    const music: MusicProvider = { id: 'broken', maxDurationSec: 30, generate: async () => Promise.reject(new Error('quota exceeded')) };
    const result = await new VideoAgent(testConfig(), { renderer: fakeRenderer, logger, voice: null, llm: null, stock: [], image: null, music }).run({ prompt });
    const sb = JSON.parse(fs.readFileSync(result.storyboardFile, 'utf8'));
    expect(sb.audio.music.src).toBe('music/procedural.wav');
    expect(result.warnings.join(' ')).toMatch(/quota exceeded/);
  });
});
