import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VideoAgent } from '../src/agent/orchestrator';
import { RevisionNotApplicable } from '../src/agent/revise';
import { encodeWav } from '../src/audio/wav';
import { createLogger } from '../src/core/logger';
import { describeProductPhoto, placeProductPhotos } from '../src/media/product-photos';
import type { VoiceProvider } from '../src/providers/voice/types';
import { SAMPLE_STORYBOARD } from '../src/remotion/sample';
import { StoryboardSchema, type Storyboard } from '../src/remotion/contract/storyboard';
import { fakeRenderer, FakeLLM, testConfig, tmpDir } from './helpers';
import { mockFetch } from './fetch-mock';
import type { StockProvider } from '../src/providers/stock/types';

const logger = createLogger('silent');
const PROMPT = 'Crée une vidéo verticale de 30 secondes pour promouvoir le jus Bissap Doux à Dakar.';

const countingVoice = () => {
  const spoken: string[] = [];
  const voice: VoiceProvider = {
    id: 'fake-voice',
    async synthesize({ text, outFile }) {
      spoken.push(text);
      const seconds = Math.max(1, text.split(' ').length * 0.15);
      fs.writeFileSync(outFile, encodeWav(new Float32Array(Math.round(seconds * 8000)), 8000));
      return { file: outFile, durationSec: seconds };
    },
  };
  return { voice, spoken };
};

const readStoryboard = (dir: string): Storyboard => StoryboardSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'storyboard.json'), 'utf8')));

const editOf = (sb: Storyboard) =>
  sb.scenes.map((s) => ({ id: s.id, headline: s.headline, subheadline: s.subheadline, body: s.body, items: s.items, statValue: s.stat?.value ?? '', statLabel: s.stat?.label ?? '', narration: s.narration, visual: 'keep' }));

describe('product photos', () => {
  const scenes = StoryboardSchema.parse(SAMPLE_STORYBOARD).scenes.slice(0, 3);

  it('honours the script, then fills free scenes, then adds extra shots', () => {
    const placed = placeProductPhotos(scenes, ['p/1.png', 'p/2.png', 'p/3.png', 'p/4.png', 'p/5.png'], [2, undefined, undefined], [2]);
    expect(placed.map((s) => s.media?.src)).toEqual(['p/2.png', 'p/3.png', 'p/1.png']);
    // Nothing is lost: the two photos without a free scene become extra shots.
    expect(placed.flatMap((s) => s.shots ?? []).map((m) => m.src).sort()).toEqual(['p/4.png', 'p/5.png']);
    expect(placed.every((s) => !s.media || s.media.origin === 'user:product')).toBe(true);
  });

  it('sends the picture to the vision model', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'bouteille.png');
    fs.writeFileSync(file, 'png bytes');
    const llm = new FakeLLM(['  Bouteille de jus de bissap rouge,\n étiquette « Bissap Doux ».  ']);
    expect(await describeProductPhoto(llm, file, 'bouteille.png')).toBe('Bouteille de jus de bissap rouge, étiquette « Bissap Doux ».');
    expect(llm.requests[0]!.messages[0]!.images).toEqual([{ mediaType: 'image/png', data: Buffer.from('png bytes').toString('base64') }]);
  });
});

describe('targeted correction', () => {
  const setup = async () => {
    const config = testConfig({ VIDEO_AGENT_MUSIC: 'none' });
    const photo = path.join(tmpDir(), 'bissap.png');
    fs.writeFileSync(photo, 'png');
    const first = countingVoice();
    const original = await new VideoAgent(config, { renderer: fakeRenderer, logger, llm: null, voice: first.voice, stock: [] }).run({
      prompt: PROMPT,
      options: { outDir: path.join(tmpDir(), 'original'), badge: 'Made with SOVID AI' },
      productImages: [{ file: photo, description: 'Bouteille de bissap rouge' }],
    });
    return { config, photo, original, sb: readStoryboard(original.jobDir) };
  };

  it('edits the storyboard, re-records only the changed narration and keeps the rest', async () => {
    const { config, photo, original, sb } = await setup();
    expect(sb.scenes.some((s) => s.media?.src === 'product/bissap.png')).toBe(true);
    const edit = editOf(sb);
    edit[0]!.headline = 'Le vrai goût du *bissap*';
    edit[1]!.narration = 'Une nouvelle phrase pour la deuxième scène.';
    edit[2]!.visual = 'none';
    const removed = edit.splice(3, 1)[0]!;
    const llm = new FakeLLM([JSON.stringify({ feasible: true, reason: '', scenes: edit, primaryColor: '#aa0044', accentColor: '' })]);
    const voice = countingVoice();
    const outDir = path.join(tmpDir(), 'corrected');
    const result = await new VideoAgent(config, { renderer: fakeRenderer, logger, llm, voice: voice.voice }).revise({
      sourceDir: original.jobDir,
      outDir,
      instruction: 'Change le titre d’ouverture et la phrase de la 2e scène',
      productImages: [{ file: photo, description: 'Bouteille de bissap rouge' }],
    });

    expect(llm.requests[0]!.messages[0]!.content).toContain('photo-1: Bouteille de bissap rouge');
    expect(voice.spoken).toEqual(['Une nouvelle phrase pour la deuxième scène.']);
    const revised = readStoryboard(outDir);
    expect(revised.scenes.map((s) => s.id)).toEqual(edit.map((s) => s.id));
    expect(revised.scenes.map((s) => s.id)).not.toContain(removed.id);
    expect(revised.scenes[0]!.headline).toBe('Le vrai goût du *bissap*');
    expect(revised.scenes[2]!.media).toBeUndefined();
    expect(revised.theme.palette.primary).toBe('#aa0044');
    // Unchanged scenes keep their recorded voice-over; the badge follows the current plan.
    expect(revised.scenes[0]!.voiceover).toEqual(sb.scenes[0]!.voiceover);
    expect(revised.brand.badge).toBeUndefined();
    expect(result.videoFile).toBe(path.join(outDir, 'video.mp4'));
    expect(fs.existsSync(path.join(outDir, 'export.mp4'))).toBe(false);
    expect(fs.readFileSync(path.join(outDir, 'subtitles.srt'), 'utf8')).toContain('Une nouvelle phrase');
    expect(JSON.parse(fs.readFileSync(path.join(outDir, 'job.json'), 'utf8'))).toMatchObject({ correctionOf: path.basename(original.jobDir) });
  });

  it('replaces a picture by searching a new one, describing the current pictures to the model', async () => {
    const { config, original, sb } = await setup();
    const stock: StockProvider = {
      id: 'fake',
      supports: ['photo'],
      search: async (q) => [{ provider: 'fake', id: `juice-${q.query}`, kind: 'photo', downloadUrl: 'https://cdn.test/juice.jpg', width: 1080, height: 1920, author: 'A', pageUrl: `https://fake/${q.query}`, extension: 'jpg', description: 'fresh hibiscus juice bottle' }],
    };
    const m = mockFetch([['GET', /cdn\.test/, () => new Response('bytes')]]);
    try {
      const edit = editOf(sb);
      edit[1]!.visual = 'search: fresh hibiscus juice bottle';
      const llm = new FakeLLM([JSON.stringify({ feasible: true, reason: '', scenes: edit, primaryColor: '', accentColor: '' })]);
      const outDir = path.join(tmpDir(), 'pictures');
      await new VideoAgent(config, { renderer: fakeRenderer, logger, llm, voice: null, stock: [stock], image: null }).revise({
        sourceDir: original.jobDir,
        outDir,
        instruction: 'Remplace l’image de la 2e scène par des jus naturels',
        productImages: [],
      });
      // The model is told what each picture shows, and how to ask for a new one.
      expect(llm.requests[0]!.messages[0]!.content).toContain('search: <English keywords>');
      const revised = readStoryboard(outDir);
      expect(revised.scenes[1]!.media).toMatchObject({ origin: 'stock:fake', alt: 'fresh hibiscus juice bottle' });
      expect(fs.existsSync(path.join(outDir, 'public', revised.scenes[1]!.media!.src))).toBe(true);
    } finally {
      m.restore();
    }
  });

  it('hands back to the full pipeline when the request needs a new video', async () => {
    const { config, original, sb } = await setup();
    const llm = new FakeLLM([JSON.stringify({ feasible: false, reason: 'new duration', scenes: editOf(sb), primaryColor: '', accentColor: '' })]);
    const agent = new VideoAgent(config, { renderer: fakeRenderer, logger, llm, voice: null });
    await expect(agent.revise({ sourceDir: original.jobDir, outDir: path.join(tmpDir(), 'x'), instruction: 'Fais-la durer 60 secondes' })).rejects.toBeInstanceOf(RevisionNotApplicable);
    const broken = new FakeLLM([JSON.stringify({ feasible: true, reason: '', scenes: [{ ...editOf(sb)[0]!, id: 'invented' }], primaryColor: '', accentColor: '' })]);
    await expect(new VideoAgent(config, { renderer: fakeRenderer, logger, llm: broken, voice: null }).revise({ sourceDir: original.jobDir, outDir: path.join(tmpDir(), 'y'), instruction: 'x' })).rejects.toBeInstanceOf(RevisionNotApplicable);
    await expect(new VideoAgent(config, { renderer: fakeRenderer, logger, llm: null }).revise({ sourceDir: original.jobDir, outDir: path.join(tmpDir(), 'z'), instruction: 'x' })).rejects.toBeInstanceOf(RevisionNotApplicable);
  });
});
