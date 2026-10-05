import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { saveSettings, settingsView } from '../src/config/settings';
import { loadConfig } from '../src/config/config';
import { createLogger } from '../src/core/logger';
import { resolveLLM } from '../src/llm/registry';
import { OllamaProvider } from '../src/llm/providers/ollama';
import { CloudflareImageProvider } from '../src/providers/image/cloudflare';
import { HuggingFaceImageProvider } from '../src/providers/image/huggingface';
import { resolveImageProvider } from '../src/providers/image/registry';
import { piperArchiveName, piperVoiceUrl } from '../src/providers/voice/piper';
import { resolveVoiceProvider } from '../src/providers/voice/registry';
import { json, mockFetch } from './fetch-mock';
import { fakeRenderer, testConfig, tmpDir } from './helpers';

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe('Ollama (free local LLM)', () => {
  it('pulls the model on first use, then chats through the OpenAI-compatible endpoint', async () => {
    const m = mockFetch([
      ['GET', /\/api\/tags$/, () => json({ models: [{ name: 'llama3.2:1b' }] })],
      ['POST', /\/api\/pull$/, () => json({ status: 'success' })],
      ['POST', /\/v1\/chat\/completions$/, () => json({ model: 'qwen2.5:3b', choices: [{ message: { content: '{"ok":true}' } }] })],
    ]);
    restore = m.restore;
    const llm = new OllamaProvider({ baseUrl: 'http://ollama:11434/', model: 'qwen2.5:3b', timeoutMs: 1000, temperature: 0.5 });
    const r1 = await llm.generate({ messages: [{ role: 'user', content: 'hi' }], json: { name: 'x', schema: {} } });
    await llm.generate({ messages: [{ role: 'user', content: 'again' }] });
    expect(r1.text).toBe('{"ok":true}');
    expect(m.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['GET /api/tags', 'POST /api/pull', 'POST /v1/chat/completions', 'POST /v1/chat/completions']);
    expect(JSON.parse(m.calls[1]!.body as string)).toEqual({ model: 'qwen2.5:3b', stream: false });
  });

  it('explains how to start Ollama when unreachable, and is picked by "auto" last', async () => {
    const m = mockFetch([['GET', /\/api\/tags$/, () => { throw new TypeError('fetch failed'); }]]);
    restore = m.restore;
    const llm = new OllamaProvider({ baseUrl: 'http://localhost:11434', model: 'm', timeoutMs: 1000, temperature: 0 });
    await expect(llm.generate({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ hint: expect.stringContaining('ollama') });
    expect(resolveLLM(testConfig({ OLLAMA_BASE_URL: 'http://ollama:11434' }))?.id).toBe('ollama');
    expect(resolveLLM(testConfig({ OLLAMA_BASE_URL: 'http://ollama:11434', GROQ_API_KEY: 'g' }))?.id).toBe('groq');
  });
});

describe('Piper (free neural voice)', () => {
  it('maps platforms to release archives and voices to their URL', () => {
    expect(piperArchiveName('linux', 'x64')).toBe('piper_linux_x86_64.tar.gz');
    expect(piperArchiveName('linux', 'arm64')).toBe('piper_linux_aarch64.tar.gz');
    expect(piperArchiveName('darwin', 'arm64')).toBe('piper_macos_aarch64.tar.gz');
    expect(piperArchiveName('win32', 'x64')).toBe('piper_windows_amd64.zip');
    expect(piperVoiceUrl('fr_FR-siwis-medium')).toBe('https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx');
    expect(piperVoiceUrl('en_US-lessac-x_low')).toContain('/en/en_US/lessac/x_low/');
    expect(() => piperVoiceUrl('french')).toThrow(/invalid voice/);
  });

  it('is used by "auto" only when installed, and on demand when requested', () => {
    const dir = tmpDir();
    expect(resolveVoiceProvider(testConfig({ PIPER_DATA_DIR: dir }))).toBeNull();
    expect(resolveVoiceProvider(testConfig({ PIPER_DATA_DIR: dir, VIDEO_AGENT_VOICE_PROVIDER: 'piper' }))?.id).toBe('piper');
    fs.mkdirSync(path.join(dir, 'piper'));
    fs.writeFileSync(path.join(dir, 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper'), '');
    expect(resolveVoiceProvider(testConfig({ PIPER_DATA_DIR: dir }))?.id).toBe('piper');
    expect(resolveVoiceProvider(testConfig({ PIPER_DATA_DIR: dir, ELEVENLABS_API_KEY: 'e' }))?.id).toBe('elevenlabs');
  });
});

describe('free AI images', () => {
  it('Cloudflare Workers AI returns a base64 JPEG', async () => {
    const m = mockFetch([['POST', /api\.cloudflare\.com\/client\/v4\/accounts\/acc\/ai\/run\/@cf\/black-forest-labs\/flux-1-schnell/, () => json({ success: true, result: { image: Buffer.from('jpeg-bytes').toString('base64') } })]]);
    restore = m.restore;
    const base = path.join(tmpDir(), 'img');
    const { file } = await new CloudflareImageProvider({ accountId: 'acc', apiToken: 'tok', model: '@cf/black-forest-labs/flux-1-schnell' }).generate({ prompt: 'taxi', width: 1080, height: 1920, outFileBase: base });
    expect(fs.readFileSync(file, 'utf8')).toBe('jpeg-bytes');
    expect(m.calls[0]!.headers.authorization).toBe('Bearer tok');
  });

  it('Hugging Face returns image bytes at a size multiple of 16', async () => {
    const m = mockFetch([['POST', /router\.huggingface\.co\/hf-inference\/models\/black-forest-labs\/FLUX\.1-schnell/, () => new Response('png-bytes')]]);
    restore = m.restore;
    const { file } = await new HuggingFaceImageProvider({ token: 'hf', model: 'black-forest-labs/FLUX.1-schnell' }).generate({ prompt: 'moto', width: 1080, height: 1920, outFileBase: path.join(tmpDir(), 'i') });
    expect(fs.readFileSync(file, 'utf8')).toBe('png-bytes');
    const { parameters } = JSON.parse(m.calls[0]!.body as string);
    expect(parameters.width % 16).toBe(0);
    expect(parameters.height).toBeGreaterThan(parameters.width);
  });

  it('auto prefers the free image providers', () => {
    expect(resolveImageProvider(testConfig({ HF_TOKEN: 'h', REPLICATE_API_TOKEN: 'r' }))?.id).toBe('huggingface');
    expect(resolveImageProvider(testConfig({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't', HF_TOKEN: 'h' }))?.id).toBe('cloudflare');
  });
});

describe('settings (web UI)', () => {
  const setup = () => {
    const dir = tmpDir();
    const envFile = path.join(dir, '.env');
    fs.writeFileSync(envFile, 'PEXELS_API_KEY=secret-pexels\nVIDEO_AGENT_MUSIC=procedural\n');
    const reload = () => loadConfig({ env: { VIDEO_AGENT_OUTPUT_DIR: path.join(dir, 'out') }, dotenvDir: dir, cwd: dir });
    return { dir, envFile, reload };
  };

  it('never returns secret values, but reports them as configured', () => {
    const { reload } = setup();
    const view = settingsView(reload());
    const fields = view.flatMap((g) => g.fields);
    expect(fields.find((f) => f.key === 'PEXELS_API_KEY')).toMatchObject({ configured: true, value: '' });
    expect(fields.find((f) => f.key === 'VIDEO_AGENT_MUSIC')).toMatchObject({ value: 'procedural' });
    expect(JSON.stringify(view)).not.toContain('secret-pexels');
  });

  it('saves, keeps secrets when left empty, clears with null and rolls back invalid values', () => {
    const { envFile, reload } = setup();
    let config = saveSettings(envFile, { PEXELS_API_KEY: '', GROQ_API_KEY: 'gsk_1', VIDEO_AGENT_MUSIC: 'none' }, reload);
    expect(config.env).toMatchObject({ PEXELS_API_KEY: 'secret-pexels', GROQ_API_KEY: 'gsk_1', VIDEO_AGENT_MUSIC: 'none' });
    config = saveSettings(envFile, { PEXELS_API_KEY: null }, reload);
    expect(config.env.PEXELS_API_KEY).toBeUndefined();
    const before = fs.readFileSync(envFile, 'utf8');
    expect(() => saveSettings(envFile, { VIDEO_AGENT_MUSIC: 'loud' }, reload)).toThrow();
    expect(fs.readFileSync(envFile, 'utf8')).toBe(before);
    expect(() => saveSettings(envFile, { VIDEO_AGENT_OUTPUT_DIR: '/etc' }, reload)).toThrow(/non modifiable/);
    expect(() => saveSettings(envFile, { GROQ_API_KEY: 'a\nINJECTED=1' }, reload)).toThrow(/invalide/);
  });
});

