import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeSecrets, loadConfig } from '../src/config/config';
import { resolveLLM } from '../src/llm/registry';
import { resolveImageProvider } from '../src/providers/image/registry';
import { resolveVoiceProvider } from '../src/providers/voice/registry';
import { testConfig, tmpDir } from './helpers';

describe('configuration', () => {
  it('has working defaults with no environment at all', () => {
    const c = loadConfig({ env: {}, dotenvDir: false, cwd: '/tmp' });
    expect(c.env.VIDEO_AGENT_LLM_PROVIDER).toBe('auto');
    expect(c.env.VIDEO_AGENT_DEFAULT_FPS).toBe(30);
    expect(c.env.VIDEO_AGENT_DEFAULT_OUTPUT_FORMAT).toBe('mp4');
    expect(c.env.ANTHROPIC_MODEL).toBe('claude-opus-5-5');
    expect(c.paths.output).toBe(path.resolve('/tmp', 'output'));
  });

  it('treats empty strings as unset', () => {
    const c = loadConfig({ env: { OPENAI_API_KEY: '  ', VIDEO_AGENT_DEFAULT_FPS: '' }, dotenvDir: false });
    expect(c.env.OPENAI_API_KEY).toBeUndefined();
    expect(c.env.VIDEO_AGENT_DEFAULT_FPS).toBe(30);
  });

  it('normalizes enum values without changing their canonical casing', () => {
    const c = loadConfig({
      env: { TIKTOK_PRIVACY: 'PUBLIC_TO_EVERYONE', LINKEDIN_VISIBILITY: 'PUBLIC' },
      dotenvDir: false,
    });
    expect(c.env.TIKTOK_PRIVACY).toBe('PUBLIC_TO_EVERYONE');
    expect(c.env.LINKEDIN_VISIBILITY).toBe('PUBLIC');
  });

  it('rejects invalid values with a helpful error', () => {
    expect(() => loadConfig({ env: { VIDEO_AGENT_LLM_PROVIDER: 'skynet' }, dotenvDir: false })).toThrow(/VIDEO_AGENT_LLM_PROVIDER/);
    expect(() => loadConfig({ env: { VIDEO_AGENT_PORT: 'abc' }, dotenvDir: false })).toThrow(/Invalid configuration/);
  });

  it('reads a .env file but real environment variables win', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, '.env'), 'GROQ_API_KEY=from-file\nVIDEO_AGENT_DEFAULT_FPS=25\n');
    const c = loadConfig({ env: { VIDEO_AGENT_DEFAULT_FPS: '60' }, dotenvDir: dir, cwd: dir });
    expect(c.env.GROQ_API_KEY).toBe('from-file');
    expect(c.env.VIDEO_AGENT_DEFAULT_FPS).toBe(60);
  });

  it('never exposes secret values in diagnostics', () => {
    const c = testConfig({ ANTHROPIC_API_KEY: 'sk-secret' });
    const d = describeSecrets(c.env);
    expect(d.ANTHROPIC_API_KEY).toBe(true);
    expect(JSON.stringify(d)).not.toContain('sk-secret');
  });

  it('the .env.example documents every variable of the schema', () => {
    const example = fs.readFileSync(path.resolve('.env.example'), 'utf8');
    const keys = Object.keys(loadConfig({ env: {}, dotenvDir: false }).env).filter((k) => k !== 'REMOTION_BROWSER_EXECUTABLE');
    for (const key of keys) expect(example, key).toMatch(new RegExp(`^${key}=`, 'm'));
  });
});

describe('provider resolution', () => {
  it('auto without keys means procedural planning', () => {
    expect(resolveLLM(testConfig())).toBeNull();
  });

  it('auto picks providers in priority order', () => {
    expect(resolveLLM(testConfig({ GROQ_API_KEY: 'g', OPENAI_API_KEY: 'o' }))?.id).toBe('openai');
    expect(resolveLLM(testConfig({ GROQ_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }))?.id).toBe('anthropic');
    expect(resolveLLM(testConfig({ GROQ_API_KEY: 'g' }))?.model).toBe('llama-3.3-70b-versatile');
  });

  it('local disables the LLM even with keys', () => {
    expect(resolveLLM(testConfig({ ANTHROPIC_API_KEY: 'a' }), 'local')).toBeNull();
  });

  it('an explicitly requested but unconfigured provider is an error', () => {
    expect(() => resolveLLM(testConfig(), 'anthropic')).toThrow(/not configured/);
    expect(() => resolveLLM(testConfig(), 'mystery')).toThrow(/Unknown LLM provider/);
  });

  it('supports any OpenAI-compatible server', () => {
    const llm = resolveLLM(testConfig({ OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:11434/v1', OPENAI_COMPATIBLE_MODEL: 'llama3.1' }));
    expect(llm).toMatchObject({ id: 'openai-compatible', model: 'llama3.1' });
  });

  it('image and voice providers are optional', () => {
    expect(resolveImageProvider(testConfig())).toBeNull();
    expect(resolveVoiceProvider(testConfig())).toBeNull();
    expect(resolveImageProvider(testConfig({ VIDEO_AGENT_IMAGE_PROVIDER: 'auto', REPLICATE_API_TOKEN: 'r' }))?.id).toBe('replicate');
    expect(resolveVoiceProvider(testConfig({ ELEVENLABS_API_KEY: 'e' }))?.id).toBe('elevenlabs');
  });
});
