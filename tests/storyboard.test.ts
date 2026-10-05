import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/core/logger';
import { buildBrief } from '../src/planning/brief';
import { Planner } from '../src/planning/planner';
import { selectSlots } from '../src/planning/slots';
import { parsePrompt } from '../src/prompt/parser';
import { StoryboardSchema, type Storyboard } from '../src/remotion/contract/storyboard';
import { getStyle, STYLES } from '../src/remotion/contract/styles';
import { computeTimeline, computeTotalDuration } from '../src/remotion/contract/timeline';
import { applyAnimations } from '../src/storyboard/animations';
import { allocateDurations, buildStoryboard, sanitizeScene } from '../src/storyboard/builder';
import { refineScenes } from '../src/storyboard/scenes';
import { fitScenesToVoiceover, matchTargetDuration } from '../src/storyboard/timing';
import { validateStoryboard } from '../src/storyboard/validator';
import { buildSubtitleCues, chunkText, toSrt, toVtt } from '../src/subtitles/subtitles';
import { getTemplate } from '../src/templates/registry';
import { testConfig } from './helpers';

const makeStoryboard = async (prompt: string, options = {}): Promise<Storyboard> => {
  const { brief } = buildBrief(parsePrompt(prompt), options, testConfig());
  const template = getTemplate(brief.templateId)!;
  const planner = new Planner(null, createLogger('silent'));
  const concept = (await planner.concept(brief, template)).value;
  const scenes = (await planner.script(brief, template, concept, selectSlots(template, brief.durationSec))).value;
  const style = getStyle(brief.styleId);
  const sb = refineScenes(buildStoryboard({ brief, concept, scenes, style }));
  return matchTargetDuration(applyAnimations(sb, style), Math.round(brief.durationSec * brief.fps));
};

describe('duration allocation', () => {
  it('is exact and respects transitions', () => {
    const frames = allocateDurations([1, 1.1, 1.1, 1.5, 1, 1.1], 900, 15, 30);
    expect(frames.reduce((a, b) => a + b, 0)).toBe(900 + 15 * 5);
    expect(Math.min(...frames)).toBeGreaterThanOrEqual(36);
  });
});

describe('storyboard generation', () => {
  it.each([
    ['Crée une vidéo verticale de 30 secondes pour promouvoir Sirago auprès des chauffeurs au Burkina Faso.', 1080, 1920, 30],
    ['Tutoriel de 60 secondes en 16:9 expliquant comment installer notre application', 1920, 1080, 60],
    ['Annonce carrée de 15 secondes pour la boutique Kora', 1080, 1080, 15],
    ['Storytelling de 2 minutes sur le parcours d’une agricultrice au Sénégal', 1920, 1080, 120],
  ])('"%s" → valid %ix%i storyboard of %is', async (prompt, width, height, seconds) => {
    const sb = await makeStoryboard(prompt);
    const v = validateStoryboard(sb);
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
    expect(sb.format).toMatchObject({ width, height, fps: 30, durationInFrames: seconds * 30 });
    expect(computeTotalDuration(sb.scenes)).toBe(seconds * 30);
    expect(sb.scenes.at(-1)!.transitionOut.type).toBe('none');
  });

  it('assigns style-driven motion', async () => {
    const sb = await makeStoryboard('Vidéo de 30s pour promouvoir Sirago', { style: 'tech' });
    const tech = STYLES.tech!;
    for (const scene of sb.scenes) {
      if (scene.kind !== 'quote') expect(tech.entrances).toContain(scene.animation.entrance);
      if (scene.transitionOut.type !== 'none') expect(tech.transitions).toContain(scene.transitionOut.type);
    }
    expect(sb.theme.id).toBe('tech');
  });

  it('degrades scenes that lack their required content', () => {
    const concept = { title: 'T', idea: '', angle: '', tone: '', keyMessage: 'Message', callToAction: 'Go', tagline: '' };
    const base = { role: 'x', headline: '', subheadline: '', body: '', items: [], statValue: '', statLabel: '', narration: '', visualKeywords: [], visualPrompt: '', weight: 1 };
    expect(sanitizeScene({ ...base, kind: 'bullets' }, concept)).toMatchObject({ kind: 'text', headline: 'Message' });
    expect(sanitizeScene({ ...base, kind: 'stat', statValue: 'beaucoup' }, concept).kind).toBe('text');
    expect(sanitizeScene({ ...base, kind: 'cta', headline: 'Hey' }, concept).subheadline).toBe('Go');
  });
});

describe('storyboard validation', () => {
  it('detects incoherent timing, empty scenes, bad subtitles and missing assets', async () => {
    const sb = await makeStoryboard('Vidéo de 20s pour promouvoir Sirago');
    const broken = structuredClone(sb);
    broken.format.durationInFrames += 10;
    broken.scenes[0]!.headline = '';
    broken.scenes[1]!.media = { type: 'image', src: 'media/missing.png', fit: 'cover', origin: 'asset' };
    broken.subtitles.cues = [{ startFrame: 10, endFrame: 5, text: 'x' }];
    const v = validateStoryboard(broken, { publicDir: '/nonexistent' });
    expect(v.valid).toBe(false);
    expect(v.errors.join('\n')).toMatch(/durationInFrames/);
    expect(v.errors.join('\n')).toMatch(/empty headline/);
    expect(v.errors.join('\n')).toMatch(/missing asset/);
    expect(v.errors.join('\n')).toMatch(/ends before it starts/);
  });

  it('rejects schema violations and odd H.264 sizes', async () => {
    expect(validateStoryboard({ meta: {} }).valid).toBe(false);
    const sb = await makeStoryboard('Vidéo de 10s pour Sirago');
    expect(validateStoryboard({ ...sb, format: { ...sb.format, width: 1081 } }).errors.join()).toMatch(/even/);
  });
});

describe('timing with voice-over', () => {
  it('extends scenes so the voice fits between transitions', async () => {
    const sb = await makeStoryboard('Vidéo de 10s pour promouvoir Sirago');
    sb.scenes[0] = { ...sb.scenes[0]!, voiceover: { src: 'voice/a.wav', durationInFrames: sb.scenes[0]!.durationInFrames * 2, volume: 1 } };
    const fitted = fitScenesToVoiceover(sb);
    expect(fitted.scenes[0]!.durationInFrames).toBeGreaterThan(sb.scenes[0]!.voiceover!.durationInFrames);
    expect(fitted.format.durationInFrames).toBe(computeTotalDuration(fitted.scenes));
    expect(validateStoryboard(fitted).valid).toBe(true);
  });
});

describe('subtitles', () => {
  it('chunks text into balanced lines without orphans', () => {
    const chunks = chunkText('Simple à utiliser, rapide, fiable, et pensé pour vous.', 32);
    expect(chunks).toEqual(['Simple à utiliser, rapide,', 'fiable, et pensé pour vous.']);
    expect(chunkText('Court.', 32)).toEqual(['Court.']);
    expect(chunkText('', 32)).toEqual([]);
    for (const c of chunkText('Un texte vraiment très long qui doit absolument être découpé en plusieurs morceaux lisibles à l’écran.', 30)) {
      expect(c.length).toBeLessThanOrEqual(33);
      expect(c.split(' ').length).toBeGreaterThan(1);
    }
  });

  it('times cues inside each scene and exports SRT/VTT', async () => {
    const sb = await makeStoryboard('Vidéo verticale de 20s pour promouvoir Sirago');
    const cues = buildSubtitleCues(sb);
    expect(cues.length).toBeGreaterThan(sb.scenes.length - 1);
    const timeline = computeTimeline(sb.scenes);
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.startFrame).toBeGreaterThanOrEqual(cues[i - 1]!.endFrame);
    expect(cues.at(-1)!.endFrame).toBeLessThanOrEqual(timeline.at(-1)!.from + timeline.at(-1)!.durationInFrames);
    expect(validateStoryboard({ ...sb, subtitles: { ...sb.subtitles, cues } }).valid).toBe(true);
    expect(toSrt([{ startFrame: 0, endFrame: 45, text: 'Bonjour' }], 30)).toBe('1\n00:00:00,000 --> 00:00:01,500\nBonjour\n');
    expect(toVtt([{ startFrame: 30, endFrame: 3690, text: 'Hi' }], 30)).toContain('00:00:01.000 --> 00:02:03.000');
  });
});

describe('contract', () => {
  it('fills defaults for minimal hand-written storyboards', () => {
    const sb = StoryboardSchema.parse({
      meta: { title: 't', template: 'advertisement', style: 'modern' },
      format: { width: 640, height: 360, fps: 30, durationInFrames: 60 },
      theme: getStyle('modern').theme,
      scenes: [{ id: 'a', kind: 'title', role: 'hook', durationInFrames: 60, headline: 'Hello' }],
    });
    expect(sb.scenes[0]!.transitionOut.type).toBe('fade');
    expect(sb.subtitles.enabled).toBe(true);
    expect(computeTotalDuration(sb.scenes)).toBe(60);
  });
});
