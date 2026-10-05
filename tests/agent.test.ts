import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VideoAgent } from '../src/agent/orchestrator';
import { createLogger } from '../src/core/logger';
import { PIPELINE_STEPS, type ProgressEvent } from '../src/core/types';
import { SCENE_KINDS } from '../src/remotion/contract/storyboard';
import { SAMPLE_STORYBOARD } from '../src/remotion/sample';
import { validateStoryboard } from '../src/storyboard/validator';
import type { VoiceProvider } from '../src/providers/voice/types';
import { encodeWav } from '../src/audio/wav';
import { fakeRenderer, FakeLLM, testConfig, tmpDir } from './helpers';

const SIRAGO = 'Crée une vidéo verticale de 30 secondes pour promouvoir Sirago auprès des chauffeurs au Burkina Faso.';
const logger = createLogger('silent');

/** Voice double writing silent WAV files of 1.5 s per 10 words. */
const fakeVoice: VoiceProvider = {
  id: 'fake-voice',
  async synthesize({ text, outFile }) {
    const seconds = Math.max(1, text.split(' ').length * 0.15);
    fs.writeFileSync(outFile, encodeWav(new Float32Array(Math.round(seconds * 8000)), 8000));
    return { file: outFile, durationSec: seconds };
  },
};

describe('VideoAgent pipeline (Remotion project generation)', () => {
  it('runs the 12 steps offline and writes a complete Remotion project', async () => {
    const config = testConfig();
    const events: ProgressEvent[] = [];
    const agent = new VideoAgent(config, { renderer: fakeRenderer, logger, voice: null });
    const result = await agent.run({ prompt: SIRAGO }, { onProgress: (e) => events.push(e) });

    const completed = events.filter((e) => e.status === 'completed').map((e) => e.step);
    expect(completed).toEqual(PIPELINE_STEPS.map((s) => s.id));
    expect(events.at(-1)!.overall).toBe(1);
    for (let i = 1; i < events.length; i++) expect(events[i]!.overall).toBeGreaterThanOrEqual(events[i - 1]!.overall - 1e-9);

    for (const file of ['brief.json', 'concept.json', 'script.md', 'storyboard.json', 'props.json', 'subtitles.srt', 'subtitles.vtt', 'README.md', 'job.json', 'video.mp4', 'poster.jpg', 'public/music/procedural.wav']) {
      expect(fs.existsSync(path.join(result.jobDir, file)), file).toBe(true);
    }
    const storyboard = JSON.parse(fs.readFileSync(result.storyboardFile, 'utf8'));
    const props = JSON.parse(fs.readFileSync(path.join(result.jobDir, 'props.json'), 'utf8'));
    expect(props.storyboard).toEqual(storyboard);
    const validation = validateStoryboard(storyboard, { publicDir: path.join(result.jobDir, 'public') });
    expect(validation.errors).toEqual([]);
    expect(storyboard.format).toMatchObject({ width: 1080, height: 1920, durationInFrames: 900 });
    expect(storyboard.brand.name).toBe('Sirago');
    expect(storyboard.audio.music.src).toBe('music/procedural.wav');
    expect(result.providers).toMatchObject({ planner: 'procedural', voice: 'none', image: 'none' });
    expect(fs.readFileSync(path.join(result.jobDir, 'script.md'), 'utf8')).toContain('Sirago');
  });

  it('uses the injected LLM, voice-over and local assets', async () => {
    const config = testConfig({ VIDEO_AGENT_MUSIC: 'none' });
    fs.mkdirSync(path.join(config.paths.assets, 'images'), { recursive: true });
    fs.writeFileSync(path.join(config.paths.assets, 'sirago-logo.png'), 'png');
    fs.writeFileSync(path.join(config.paths.assets, 'images', 'chauffeur-moto-ouagadougou.jpg'), 'jpg');

    const concept = { title: 'Sirago, la route simplifiée', idea: 'i', angle: 'a', tone: 't', keyMessage: 'k', callToAction: 'Installez Sirago', tagline: 'En route' };
    const llm = new FakeLLM([JSON.stringify(concept), 'garbage', 'garbage']); // script falls back to procedural
    const agent = new VideoAgent(config, { renderer: fakeRenderer, logger, llm, voice: fakeVoice });
    const result = await agent.run({ prompt: SIRAGO, options: { durationSec: 30 } });

    expect(result.concept.title).toBe('Sirago, la route simplifiée');
    expect(result.warnings.join()).toMatch(/LLM script failed/);
    const sb = result.storyboard;
    expect(sb.brand.logo).toBe('brand/sirago-logo.png');
    expect(sb.scenes.some((s) => s.media?.src === 'media/chauffeur-moto-ouagadougou.jpg')).toBe(true);
    expect(sb.scenes.every((s) => s.voiceover)).toBe(true);
    expect(sb.audio.music).toBeUndefined();
    expect(validateStoryboard(sb, { publicDir: path.join(result.jobDir, 'public') }).valid).toBe(true);
  });

  it('can stop after the project files (--no-render) and supports cancellation', async () => {
    const config = testConfig();
    const out = path.join(tmpDir(), 'job');
    const agent = new VideoAgent(config, { logger });
    const result = await agent.run({ prompt: 'Tutoriel de 20 secondes en anglais', options: { skipRender: true, outDir: out, language: 'en' } });
    expect(result.videoFile).toBeUndefined();
    expect(result.storyboard.meta.language).toBe('en');
    expect(fs.existsSync(path.join(out, 'storyboard.json'))).toBe(true);

    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(agent.run({ prompt: SIRAGO }, { signal: controller.signal })).rejects.toThrow('stop');
  });

  it('rejects empty prompts', async () => {
    await expect(new VideoAgent(testConfig(), { logger }).run({ prompt: '  ' })).rejects.toThrow(/empty/);
  });
});

describe('Remotion compositions', () => {
  it('every scene kind has a component and the Studio sample is valid', async () => {
    const { SCENE_COMPONENTS } = await import('../src/remotion/scenes');
    for (const kind of SCENE_KINDS) expect(typeof SCENE_COMPONENTS[kind]).toBe('function');
    expect(validateStoryboard(SAMPLE_STORYBOARD).errors).toEqual([]);
  });
});
