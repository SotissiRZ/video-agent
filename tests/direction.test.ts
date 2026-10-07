import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VideoAgent } from '../src/agent/orchestrator';
import { createLogger } from '../src/core/logger';
import type { StockProvider, StockQuery } from '../src/providers/stock/types';
import { StoryboardSchema } from '../src/remotion/contract/storyboard';
import { mockFetch } from './fetch-mock';
import { fakeRenderer, FakeLLM, testConfig, tmpDir } from './helpers';

const logger = createLogger('silent');
let restore: (() => void) | undefined;
afterEach(() => restore?.());

const PROMPT = `Crée une vidéo pour ZSR-TechNum, entreprise technologique à Ouagadougou.
SCÈNE 1 — INTRODUCTION
Texte à l'écran : « ZSR-TechNum »
SCÈNE 2 — DÉVELOPPEMENT WEB
Montrer un professionnel travaillant sur une application web.
Texte à l'écran : « Sites web & applications »
Texte final : « Contactez-nous pour votre projet. »
La vidéo doit donner une impression de confiance.
IMPORTANT : éviter les robots.`;

/** A free description (no scenes written by the customer): the director designs the structure. */
const FREE_PROMPT = `Fais une pub pour ZSR-TechNum, entreprise technologique à Ouagadougou : sites web, applications et intelligence artificielle.
Montrer un professionnel travaillant sur une application web. Finir par un appel à nous contacter.
La vidéo doit donner une impression de confiance.
IMPORTANT : éviter les robots.`;

const scene = (over: Record<string, unknown>) => ({
  role: 'scene', kind: 'text', seconds: 6, headline: '', subheadline: '', body: '', items: [], statValue: '', statLabel: '',
  narration: '', visual: '', visualQueries: [], visualPrompt: '', productPhoto: 0, ...over,
});

const DIRECTION = {
  title: 'ZSR-TechNum',
  idea: 'Présenter les services numériques de ZSR-TechNum.',
  tone: 'confiant, moderne',
  keyMessage: 'Votre idée. Notre technologie.',
  callToAction: 'Contactez-nous',
  tagline: 'Votre idée. Notre technologie.',
  language: 'fr',
  durationSec: 18,
  style: 'corporate',
  brand: 'ZSR-TechNum',
  audience: 'entreprises',
  location: 'Ouagadougou',
  avoid: ['robot'],
  scenes: [
    scene({ role: 'intro', kind: 'title', headline: '*ZSR-TechNum*', narration: 'Bienvenue chez ZSR-TechNum.', visualQueries: ['african business team modern office'] }),
    scene({ role: 'web', headline: 'Sites web & *applications*', narration: 'Nous créons vos sites web et applications.', visual: 'un développeur sur une application web', visualQueries: ['african developer coding laptop office', 'web application on laptop screen'] }),
    scene({ role: 'cta', kind: 'cta', headline: 'Contactez-nous', subheadline: 'Contactez-nous', narration: 'Contactez-nous pour votre projet.', visualQueries: ['business handshake office'] }),
  ],
};

const recordingStock = () => {
  const queries: string[] = [];
  const stock: StockProvider = {
    id: 'fake',
    supports: ['photo'],
    async search(q: StockQuery) {
      queries.push(q.query);
      return [
        { provider: 'fake', id: `robot-${q.query}`, kind: 'photo', downloadUrl: 'https://cdn.test/r.jpg', width: 1080, height: 1920, author: 'R', pageUrl: `https://fake/robot/${q.query}`, extension: 'jpg', description: `robot ${q.query}` },
        { provider: 'fake', id: `ok-${q.query}`, kind: 'photo', downloadUrl: 'https://cdn.test/ok.jpg', width: 1080, height: 1920, author: 'A', pageUrl: `https://fake/ok/${q.query}`, extension: 'jpg', description: q.query },
      ];
    },
  };
  return { stock, queries };
};

const readStoryboard = (dir: string) => StoryboardSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'storyboard.json'), 'utf8')));

describe('AI director', () => {
  it('reads the whole request and the video follows its plan', async () => {
    restore = mockFetch([['GET', /cdn\.test/, () => new Response('bytes')]]).restore;
    const llm = new FakeLLM([JSON.stringify(DIRECTION)]);
    const { stock, queries } = recordingStock();
    const result = await new VideoAgent(testConfig({ VIDEO_AGENT_MUSIC: 'none', VIDEO_AGENT_MEDIA_COVERAGE: 'all' }), { renderer: fakeRenderer, logger, llm, voice: null, stock: [stock], image: null }).run({
      prompt: FREE_PROMPT,
      options: { outDir: path.join(tmpDir(), 'direction') },
    });

    // The model gets the request word for word, notes included, to apply them.
    const sent = llm.requests[0]!.messages[0]!.content;
    expect(sent).toContain('<request>');
    expect(sent).toContain('IMPORTANT : éviter les robots.');
    expect(llm.requests).toHaveLength(1);

    const sb = readStoryboard(result.jobDir);
    expect(sb.scenes.map((s) => s.headline)).toEqual(['*ZSR-TechNum*', 'Sites web & *applications*', 'Contactez-nous']);
    expect(sb.scenes.map((s) => s.narration)).toEqual(DIRECTION.scenes.map((s) => s.narration));
    expect(JSON.stringify(sb.scenes)).not.toMatch(/impression de confiance|IMPORTANT/);
    expect(sb.meta.style).toBe('corporate');
    expect(result.brief.durationSec).toBe(18);
    expect(result.providers.planner).toBe('fake:fake-1');
    expect(fs.existsSync(path.join(result.jobDir, 'direction.json'))).toBe(true);

    // Its searches are used as written, and what it says to avoid never appears.
    expect(queries).toContain('african developer coding laptop office');
    expect(sb.scenes.every((s) => !s.media || !s.media.alt?.includes('robot'))).toBe(true);
  });

  it("keeps the customer's own script word for word, with the director's pictures", async () => {
    const script = [
      'SCÈNE 1 — INTRODUCTION (0–5 s)',
      "Texte à l'écran :",
      '« ZSR-TechNum »',
      '« Transformons vos idées en solutions numériques. »',
      'SCÈNE 2 — IA (5–13 s)',
      "Montrer une interface IA professionnelle plutôt qu'un robot.",
      "Texte à l'écran :",
      '« Intelligence Artificielle »',
      '« Machine Learning • Computer Vision • Data Science »',
      'Voix off :',
      '« Bienvenue chez ZSR-TechNum. Nos experts en intelligence artificielle analysent vos données. »',
    ].join('\n');
    // The director drops texts and puts the whole voice-over at the end: the script still wins.
    const lossy = {
      ...DIRECTION,
      durationSec: 13,
      scenes: [
        scene({ kind: 'title', headline: '*ZSR-TechNum*', seconds: 5, visualQueries: ['african business team modern office'] }),
        scene({ headline: 'Intelligence *Artificielle*', seconds: 5, narration: 'Bienvenue… tout le texte', visualQueries: ['ai analytics dashboard laptop screen'] }),
      ],
    };
    const llm = new FakeLLM([JSON.stringify(lossy)]);
    const { stock, queries } = recordingStock();
    restore = mockFetch([['GET', /cdn\.test/, () => new Response('bytes')]]).restore;
    const result = await new VideoAgent(testConfig({ VIDEO_AGENT_MUSIC: 'none', VIDEO_AGENT_MEDIA_COVERAGE: 'all' }), { renderer: fakeRenderer, logger, llm, voice: null, stock: [stock], image: null }).run({
      prompt: script,
      options: { outDir: path.join(tmpDir(), 'script-law') },
    });
    const sb = readStoryboard(result.jobDir);
    expect(sb.scenes[0]!.body).toBe('Transformons vos idées en solutions numériques.');
    expect(sb.scenes[1]!.items).toEqual(['Machine Learning', 'Computer Vision', 'Data Science']);
    expect(sb.scenes[0]!.narration).toContain('Bienvenue chez ZSR-TechNum.');
    expect(sb.scenes[1]!.narration).toContain('intelligence artificielle');
    expect(queries).toContain('ai analytics dashboard laptop screen');
  });

  it('keeps what the customer set in the form', async () => {
    const llm = new FakeLLM([JSON.stringify(DIRECTION)]);
    const result = await new VideoAgent(testConfig({ VIDEO_AGENT_MUSIC: 'none' }), { renderer: fakeRenderer, logger, llm, voice: null, stock: [], image: null }).run({
      prompt: PROMPT,
      options: { outDir: path.join(tmpDir(), 'locked'), durationSec: 24, style: 'warm', language: 'en' },
    });
    expect(result.brief.durationSec).toBe(24);
    expect(readStoryboard(result.jobDir).meta.style).toBe('warm');
    expect(result.brief.locale).toBe('en');
    expect(llm.requests[0]!.messages[0]!.content).toContain('Duration: exactly 24 seconds');
  });

  it('falls back to the rule-based planning when the director fails', async () => {
    const llm = new FakeLLM([new Error('HTTP 529 overloaded')]);
    const result = await new VideoAgent(testConfig({ VIDEO_AGENT_MUSIC: 'none' }), { renderer: fakeRenderer, logger, llm, voice: null, stock: [], image: null }).run({
      prompt: PROMPT,
      options: { outDir: path.join(tmpDir(), 'fallback') },
    });
    expect(result.warnings.join()).toContain('AI direction failed');
    // The structured script parser takes over: the user's texts are still there, the notes are not.
    const sb = readStoryboard(result.jobDir);
    expect(JSON.stringify(sb.scenes)).toContain('Sites web & ');
    expect(JSON.stringify(sb.scenes)).not.toMatch(/impression de confiance/);
  });
});

describe('AI director answers', () => {
  it('tolerates small format slips instead of dropping the whole plan', async () => {
    const { DirectionSchema } = await import('../src/planning/direction');
    const parsed = DirectionSchema.parse({ ...DIRECTION, tone: ['confiant', 'moderne'], durationSec: '45', avoid: 'robot, science fiction', scenes: [{ ...DIRECTION.scenes[0], seconds: '7', items: 'Logo • Affiche • PDF', productPhoto: '0' }] });
    expect(parsed.tone).toBe('confiant, moderne');
    expect(parsed.durationSec).toBe(45);
    expect(parsed.avoid).toEqual(['robot', 'science fiction']);
    expect(parsed.scenes[0]).toMatchObject({ seconds: 7, items: ['Logo', 'Affiche', 'PDF'], productPhoto: 0 });
  });
});

describe('AI director completeness', () => {
  const twoScenes = ['SCÈNE 1 — WEB (0–6 s)', "Texte à l'écran : « Sites web »", 'SCÈNE 2 — IA (6–12 s)', "Texte à l'écran : « Intelligence Artificielle »"].join('\n');
  const plan = (scenes: unknown[]) => JSON.stringify({ ...DIRECTION, durationSec: 12, scenes });

  it('asks again when the plan stops early, and keeps the complete one', async () => {
    const llm = new FakeLLM([
      plan([scene({ headline: 'Sites web', visualQueries: ['web designer laptop office'] })]),
      plan([scene({ headline: 'Sites web', visualQueries: ['web designer laptop office'] }), scene({ headline: 'Intelligence Artificielle', visualQueries: ['data scientist charts screen'] })]),
    ]);
    const { stock, queries } = recordingStock();
    restore = mockFetch([['GET', /cdn\.test/, () => new Response('bytes')]]).restore;
    const result = await new VideoAgent(testConfig({ VIDEO_AGENT_MUSIC: 'none', VIDEO_AGENT_MEDIA_COVERAGE: 'all' }), { renderer: fakeRenderer, logger, llm, voice: null, stock: [stock], image: null }).run({
      prompt: twoScenes,
      options: { outDir: path.join(tmpDir(), 'retry') },
    });
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1]!.messages.at(-1)!.content).toContain('only 1 scenes');
    expect(readStoryboard(result.jobDir).scenes).toHaveLength(2);
    expect(queries).toContain('data scientist charts screen');
  });

  it('never loses a scene the customer wrote, even if the director does', async () => {
    const short = plan([scene({ headline: 'Intelligence Artificielle', visualQueries: ['data scientist charts screen'] })]);
    const llm = new FakeLLM([short, short]);
    const { stock, queries } = recordingStock();
    restore = mockFetch([['GET', /cdn\.test/, () => new Response('bytes')]]).restore;
    const result = await new VideoAgent(testConfig({ VIDEO_AGENT_MUSIC: 'none', VIDEO_AGENT_MEDIA_COVERAGE: 'all' }), { renderer: fakeRenderer, logger, llm, voice: null, stock: [stock], image: null }).run({
      prompt: twoScenes,
      options: { outDir: path.join(tmpDir(), 'kept') },
    });
    const sb = readStoryboard(result.jobDir);
    expect(sb.scenes.map((s) => s.headline.replace(/\*/g, ''))).toEqual(['Sites web', 'Intelligence Artificielle']);
    // The director's pictures go to the scene it described, matched by headline.
    expect(queries).toContain('data scientist charts screen');
  });
});
