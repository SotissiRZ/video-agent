import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, type AppConfig } from '../src/config/config';
import type { LLMProvider, LLMRequest } from '../src/llm/types';
import type { RenderOptions, RenderResult } from '../src/render/renderer';

export const tmpDir = (prefix = 'video-agent-test-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** Configuration isolated from the developer's .env and real API keys. */
export const testConfig = (env: Record<string, string> = {}): AppConfig => {
  const dir = tmpDir();
  return loadConfig({
    env: { VIDEO_AGENT_OUTPUT_DIR: path.join(dir, 'output'), VIDEO_AGENT_ASSETS_DIR: path.join(dir, 'assets'), VIDEO_AGENT_LOG_LEVEL: 'silent', ...env },
    dotenvDir: false,
    cwd: dir,
  });
};

/** LLM double returning scripted answers (or throwing). */
export class FakeLLM implements LLMProvider {
  readonly id = 'fake';
  readonly model = 'fake-1';
  readonly requests: LLMRequest[] = [];
  constructor(private readonly answers: Array<string | Error>) {}
  async generate(request: LLMRequest) {
    this.requests.push(request);
    const next = this.answers.shift();
    if (next === undefined) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return { text: next, provider: this.id, model: this.model };
  }
}

/** Renderer double: writes a placeholder file instead of rendering. */
export const fakeRenderer = async (opts: RenderOptions): Promise<RenderResult> => {
  fs.mkdirSync(path.dirname(opts.outputFile), { recursive: true });
  fs.writeFileSync(opts.outputFile, 'fake video');
  if (opts.posterFile) fs.writeFileSync(opts.posterFile, 'fake poster');
  opts.onProgress?.({ stage: 'render', progress: 1 });
  return { file: opts.outputFile, posterFile: opts.posterFile, durationSec: opts.storyboard.format.durationInFrames / opts.storyboard.format.fps, browser: 'fake' };
};
