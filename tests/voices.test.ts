import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VideoAgent } from '../src/agent/orchestrator';
import { encodeWav } from '../src/audio/wav';
import { createLogger } from '../src/core/logger';
import { applyPronunciations, mentionsAny } from '../src/core/pronunciation';
import type { VoiceProvider, VoiceRequest } from '../src/providers/voice/types';
import { StoryboardSchema } from '../src/remotion/contract/storyboard';
import { fakeRenderer, testConfig, tmpDir } from './helpers';

const logger = createLogger('silent');
const PROMPT = 'Crée une vidéo verticale de 20 secondes pour promouvoir SOVID AI auprès des commerçants de Dakar.';

const recordingVoice = (id = 'fake-voice', fail = false) => {
  const requests: VoiceRequest[] = [];
  const voice: VoiceProvider = {
    id,
    async synthesize(request) {
      requests.push(request);
      if (fail) throw new Error('HTTP 402: paid_plan_required');
      const seconds = Math.max(1, request.text.split(' ').length * 0.15);
      fs.writeFileSync(request.outFile, encodeWav(new Float32Array(Math.round(seconds * 8000)), 8000));
      return { file: request.outFile, durationSec: seconds };
    },
  };
  return { voice, requests };
};

const readStoryboard = (dir: string) => StoryboardSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'storyboard.json'), 'utf8')));

describe('pronunciation dictionary', () => {
  it('replaces whole words, whatever the case, longest first', () => {
    const entries = [
      { word: 'SOVID', spoken: 'So-vide' },
      { word: 'SOVID AI', spoken: 'So-vide A I' },
      { word: 'Ouaga', spoken: 'Wa-ga' },
    ];
    expect(applyPronunciations('Avec sovid ai, à Ouaga ! SOVIDIENS reste tel quel.', entries)).toBe('Avec So-vide A I, à Wa-ga ! SOVIDIENS reste tel quel.');
    expect(applyPronunciations('Ouagadougou', entries)).toBe('Ouagadougou');
    expect(mentionsAny('Le studio SOVID.', [{ word: 'sovid', spoken: 'x' }])).toBe(true);
    expect(mentionsAny('Le studio SOVIDIA.', [{ word: 'sovid', spoken: 'x' }])).toBe(false);
  });
});

describe('narrator voice', () => {
  it('passes the chosen voice and says the dictionary words as asked, subtitles keep the spelling', async () => {
    const { voice, requests } = recordingVoice();
    const result = await new VideoAgent(testConfig({ VIDEO_AGENT_MUSIC: 'none' }), { renderer: fakeRenderer, logger, llm: null, voice, stock: [] }).run({
      prompt: PROMPT,
      options: { outDir: path.join(tmpDir(), 'v'), voiceGender: 'male', voiceId: 'clone-123', pronunciations: [{ word: 'SOVID', spoken: 'So-vide' }] },
    });
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.gender === 'male' && r.voiceId === 'clone-123')).toBe(true);
    const spoken = requests.map((r) => r.text).join(' ');
    expect(spoken).toContain('So-vide');
    expect(spoken).not.toMatch(/\bSOVID\b/);
    expect(fs.readFileSync(path.join(result.jobDir, 'subtitles.srt'), 'utf8')).toMatch(/SOVID/);
  });

  it('records the whole video again with the fallback voice when the chosen one fails', async () => {
    const broken = recordingVoice('elevenlabs', true);
    const fallback = recordingVoice('piper');
    const result = await new VideoAgent(testConfig({ VIDEO_AGENT_MUSIC: 'none' }), { renderer: fakeRenderer, logger, llm: null, voice: broken.voice, voiceFallback: fallback.voice, stock: [] }).run({
      prompt: PROMPT,
      options: { outDir: path.join(tmpDir(), 'f'), voiceId: 'clone-123' },
    });
    expect(broken.requests).toHaveLength(1);
    expect(result.providers.voice).toBe('piper');
    const storyboard = readStoryboard(result.jobDir);
    const narrated = storyboard.scenes.filter((s) => s.narration.trim());
    expect(narrated.every((s) => s.voiceover)).toBe(true);
    // The cloned voice belongs to the failed provider: the fallback uses its own voice.
    expect(fallback.requests.every((r) => r.voiceId === undefined)).toBe(true);
    expect(result.warnings.join()).toContain('voice-over recorded again with piper');
  });
});

describe('pronunciation fix of a rendered video', () => {
  it('records again only the sentences saying the word, with the same voice', async () => {
    const config = testConfig({ VIDEO_AGENT_MUSIC: 'none' });
    const first = recordingVoice();
    const original = await new VideoAgent(config, { renderer: fakeRenderer, logger, llm: null, voice: first.voice, stock: [] }).run({ prompt: PROMPT, options: { outDir: path.join(tmpDir(), 'o'), voiceGender: 'female' } });
    const before = readStoryboard(original.jobDir);
    const withWord = before.scenes.filter((s) => /\bSOVID\b/i.test(s.narration)).map((s) => s.id);
    expect(withWord.length).toBeGreaterThan(0);

    const again = recordingVoice();
    const outDir = path.join(tmpDir(), 'fixed');
    const fixed = await new VideoAgent(config, { renderer: fakeRenderer, logger, llm: null, voice: again.voice }).revoice({
      sourceDir: original.jobDir,
      outDir,
      changed: [{ word: 'SOVID', spoken: 'So-vide' }],
      pronunciations: [{ word: 'SOVID', spoken: 'So-vide' }],
      voiceGender: 'female',
    });
    expect(again.requests).toHaveLength(withWord.length);
    expect(again.requests.every((r) => r.text.includes('So-vide') && r.gender === 'female')).toBe(true);
    const after = readStoryboard(outDir);
    expect(after.scenes.map((s) => s.narration)).toEqual(before.scenes.map((s) => s.narration));
    const untouched = before.scenes.find((s) => !withWord.includes(s.id) && s.voiceover);
    if (untouched) expect(after.scenes.find((s) => s.id === untouched.id)!.voiceover!.src).toBe(untouched.voiceover!.src);
    expect(fixed.videoFile).toBe(path.join(outDir, 'video.mp4'));

    await expect(new VideoAgent(config, { renderer: fakeRenderer, logger, llm: null, voice: again.voice }).revoice({
      sourceDir: original.jobDir,
      outDir: path.join(tmpDir(), 'none'),
      changed: [{ word: 'Zanzibar', spoken: 'x' }],
      pronunciations: [],
    })).rejects.toThrow(/n’est pas prononcé/);
  });
});

describe('futuristic style', () => {
  it('draws sci-fi backgrounds, glows and asks the image service for a matching look', async () => {
    const prompts: string[] = [];
    const image = {
      id: 'fake-image',
      async generate({ prompt, outFileBase }: { prompt: string; outFileBase: string }) {
        prompts.push(prompt);
        fs.writeFileSync(`${outFileBase}.png`, 'png');
        return { file: `${outFileBase}.png` };
      },
    };
    const result = await new VideoAgent(testConfig({ VIDEO_AGENT_MUSIC: 'none' }), { renderer: fakeRenderer, logger, llm: null, voice: null, image, stock: [] }).run({
      prompt: 'Une vidéo futuriste de 15 secondes pour une application de paiement',
      options: { outDir: path.join(tmpDir(), 'futur'), mediaCoverage: 'all' },
    });
    const storyboard = readStoryboard(result.jobDir);
    expect(storyboard.meta.style).toBe('futuristic');
    expect(storyboard.theme.glow).toBe(true);
    const variants = storyboard.scenes.map((s) => s.background.variant);
    expect(variants.every((v) => ['hologram', 'circuit', 'particles', 'hud', 'media'].includes(v))).toBe(true);
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.every((p) => p.includes('holographic interface') && !p.includes('photorealistic, natural light'))).toBe(true);
    // No stock photos in this style: generated images or animated backgrounds only.
    expect(storyboard.scenes.every((s) => !s.media || s.media.origin.startsWith('ai:') || s.media.origin.startsWith('user'))).toBe(true);
  });
});
