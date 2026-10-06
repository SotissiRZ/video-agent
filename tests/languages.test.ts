import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoAgent } from '../src/agent/orchestrator';
import { findFfmpeg, toWav } from '../src/audio/ffmpeg';
import { encodeWav, wavDurationSec } from '../src/audio/wav';
import { createLogger } from '../src/core/logger';
import { buildBrief } from '../src/planning/brief';
import { parsePrompt } from '../src/prompt/parser';
import { MmsVoiceProvider } from '../src/providers/voice/mms';
import { resolveVoiceProvider } from '../src/providers/voice/registry';
import { isRtl } from '../src/remotion/contract/languages';
import { fakeRenderer, FakeLLM, testConfig, tmpDir } from './helpers';

const logger = createLogger('silent');
afterEach(() => vi.unstubAllGlobals());

describe('local languages', () => {
  it('detects the language asked for in the prompt', () => {
    const parsed = parsePrompt('Crée une vidéo de 20 secondes en wolof pour ma boutique de tissus à Dakar');
    expect(parsed.locale).toBe('wo');
    const { brief } = buildBrief(parsed, {}, testConfig());
    expect(brief).toMatchObject({ locale: 'wo', language: 'fr' });
    expect(parsePrompt('Make a video in Swahili for my shop in Nairobi').locale).toBe('sw');
    expect(parsePrompt('Une vidéo pour ma pharmacie à Casablanca').locale).toBeUndefined();
  });

  it('the language option wins and sets the base language', () => {
    const { brief } = buildBrief(parsePrompt('Une vidéo pour ma pharmacie à Casablanca'), { language: 'ary' }, testConfig());
    expect(brief).toMatchObject({ locale: 'ary', language: 'fr' });
    expect(isRtl(brief.locale)).toBe(true);
    expect(isRtl('wo')).toBe(false);
  });

  it('asks the LLM to write in the language; without an LLM the video falls back to the base language', async () => {
    const llm = new FakeLLM([new Error('offline'), new Error('offline'), new Error('offline'), new Error('offline')]);
    const result = await new VideoAgent(testConfig(), { renderer: fakeRenderer, logger, voice: null, llm, stock: [], image: null }).run({
      prompt: 'Crée une vidéo de 15 secondes en lingala pour mon restaurant à Kinshasa',
    });
    expect(String(llm.requests[0]!.messages[0]!.content)).toContain('in Lingala');
    expect(result.warnings.join(' ')).toMatch(/Lingala needs an AI model/);
    const sb = JSON.parse(fs.readFileSync(result.storyboardFile, 'utf8'));
    expect(sb.meta.language).toBe('fr');
  });
});

describe('voices per language', () => {
  it('"auto" picks a provider that speaks the language', () => {
    const config = testConfig({ VIDEO_AGENT_VOICE_PROVIDER: 'auto', OPENAI_API_KEY: 'sk', HF_TOKEN: 'hf' });
    expect(resolveVoiceProvider(config, undefined, 'fr')?.id).toBe('openai');
    expect(resolveVoiceProvider(config, undefined, 'sw')?.id).toBe('openai');
    expect(resolveVoiceProvider(config, undefined, 'wo')?.id).toBe('mms');
    expect(resolveVoiceProvider(testConfig({ VIDEO_AGENT_VOICE_PROVIDER: 'auto', OPENAI_API_KEY: 'sk' }), undefined, 'bm')).toBeNull();
  });

  it('MMS calls the Hugging Face model of the language', async () => {
    const wav = encodeWav(new Float32Array(16000), 16000);
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(wav)));
    vi.stubGlobal('fetch', fetchMock);
    const outFile = path.join(tmpDir(), 'v.wav');
    const r = await new MmsVoiceProvider({ token: 'hf' }).synthesize({ text: 'Dalal ak jamm', language: 'wo', outFile });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://router.huggingface.co/hf-inference/models/facebook/mms-tts-wol');
    expect(JSON.parse(String(init.body))).toEqual({ inputs: 'Dalal ak jamm' });
    expect(r.durationSec).toBeCloseTo(1, 1);
    expect(new MmsVoiceProvider({ token: 'hf' }).supports('fr')).toBe(false);
  });

  it('decodes compressed audio to WAV with ffmpeg', async () => {
    const bin = findFfmpeg();
    const mp3 = spawnSync(bin, ['-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0', '-f', 'mp3', 'pipe:1'], {
      input: encodeWav(new Float32Array(8000 * 2).map((_, i) => Math.sin(i / 5) * 0.3), 8000),
      env: { ...process.env, LD_LIBRARY_PATH: path.dirname(bin) },
    });
    if (mp3.status !== 0) return; // no ffmpeg on this machine
    const wav = await toWav(mp3.stdout);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    const sec = wavDurationSec(wav);
    expect(sec).toBeGreaterThan(1.9);
    expect(sec).toBeLessThan(2.2);
  });
});

describe('WhatsApp Status', () => {
  it('is vertical and at most 60 seconds', () => {
    const { brief, notes } = buildBrief(parsePrompt('Vidéo de 90 secondes pour mon statut WhatsApp : promo de ma boutique à Abidjan'), {}, testConfig());
    expect(brief).toMatchObject({ formatId: 'vertical', durationSec: 60 });
    expect(notes.join(' ')).toMatch(/WhatsApp/);
    expect(buildBrief(parsePrompt('Promo de ma boutique'), { format: 'whatsapp', durationSec: 45 }, testConfig()).brief).toMatchObject({ formatId: 'vertical', durationSec: 45 });
  });
});
