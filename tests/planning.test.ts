import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/core/logger';
import { extractJson, generateJson } from '../src/llm/json';
import { buildBrief } from '../src/planning/brief';
import { Planner } from '../src/planning/planner';
import { ConceptSchema } from '../src/planning/schemas';
import { selectSlots } from '../src/planning/slots';
import { parsePrompt } from '../src/prompt/parser';
import { getTemplate } from '../src/templates/registry';
import { FakeLLM, testConfig } from './helpers';

const SIRAGO = 'Crée une vidéo verticale de 30 secondes pour promouvoir Sirago auprès des chauffeurs au Burkina Faso.';
const logger = createLogger('silent');

const brief = (prompt = SIRAGO, options = {}, env = {}) => buildBrief(parsePrompt(prompt), options, testConfig(env)).brief;

describe('brief', () => {
  it('merges prompt, template and configuration', () => {
    const b = brief();
    expect(b).toMatchObject({ templateId: 'advertisement', width: 1080, height: 1920, durationSec: 30, fps: 30, styleId: 'vibrant', language: 'fr', brand: 'Sirago', outputFormat: 'mp4' });
  });

  it('explicit options win over the prompt', () => {
    const b = brief(SIRAGO, { format: 'square', durationSec: 12, fps: 24, style: 'minimal', outputFormat: 'webm', subtitles: false });
    expect(b).toMatchObject({ width: 1080, height: 1080, durationSec: 12, fps: 24, styleId: 'minimal', outputFormat: 'webm', subtitles: false });
  });

  it('accepts a custom resolution and makes it even', () => {
    expect(brief(SIRAGO, { width: 1281, height: 721 })).toMatchObject({ width: 1282, height: 722 });
  });

  it('uses the template defaults when the prompt says nothing', () => {
    const b = brief('Un reel Instagram viral sur notre café');
    expect(b.templateId).toBe('social-media');
    expect(b.formatId).toBe('vertical');
    expect(b.durationSec).toBe(20);
  });

  it('rejects unknown formats and styles', () => {
    expect(() => brief(SIRAGO, { format: 'hexagon' })).toThrow(/Unknown format/);
    expect(() => brief(SIRAGO, { style: 'baroque' })).toThrow(/Unknown style/);
  });
});

describe('scene slots', () => {
  const ad = getTemplate('advertisement')!;
  it('keeps all scenes when there is time', () => {
    expect(selectSlots(ad, 30).map((s) => s.role)).toEqual(['hook', 'problem', 'solution', 'benefits', 'proof', 'cta']);
  });
  it('drops optional scenes for short videos', () => {
    const roles = selectSlots(ad, 10).map((s) => s.role);
    expect(roles).not.toContain('proof');
    expect(roles[0]).toBe('hook');
    expect(roles.at(-1)).toBe('cta');
    expect(roles.length).toBeLessThanOrEqual(4);
  });
  it('repeats repeatable scenes for long videos', () => {
    const slots = selectSlots(ad, 120);
    const benefits = slots.filter((s) => s.role === 'benefits').length;
    expect(benefits).toBeGreaterThan(1);
    // Capped repetitions: long videos get longer scenes instead of endless duplicates.
    expect(benefits).toBeLessThanOrEqual(3);
    expect(selectSlots(ad, 600).filter((s) => s.role === 'benefits').length).toBe(3);
    expect(slots.at(-1)!.role).toBe('cta');
  });
});

describe('planner', () => {
  const template = getTemplate('advertisement')!;
  const slots = selectSlots(template, 30);

  it('procedural plan follows the blueprint and the language', async () => {
    const planner = new Planner(null, logger);
    const b = brief();
    const concept = await planner.concept(b, template);
    expect(concept.source).toBe('procedural');
    expect(concept.value.title).toContain('Sirago');
    const script = await planner.script(b, template, concept.value, slots);
    expect(script.value.map((s) => s.role)).toEqual(slots.map((s) => s.role));
    expect(script.value[0]!.subheadline).toBe('Chauffeurs au Burkina Faso');
    expect(script.value.every((s) => s.narration.length > 0)).toBe(true);
  });

  it('produces English copy for English briefs', async () => {
    const planner = new Planner(null, logger);
    const b = brief('Create a 20 second ad to promote Zeta Pay for small shop owners in Nigeria');
    const script = await planner.script(b, template, (await planner.concept(b, template)).value, selectSlots(template, 20));
    expect(script.value.at(-1)!.headline).toMatch(/Try \*Zeta Pay\* today/);
  });

  it('uses the LLM output when valid', async () => {
    const concept = { title: 'Roulez avec Sirago', idea: 'i', angle: 'a', tone: 't', keyMessage: 'k', callToAction: 'Installez Sirago', tagline: 'Toujours en route' };
    const scenes = slots.map((s) => ({ role: s.role, kind: s.kind, headline: `Titre ${s.role}`, subheadline: '', body: '', items: s.kind === 'bullets' ? ['a', 'b', 'c'] : [], statValue: '', statLabel: '', narration: `Voix ${s.role}`, visualKeywords: ['taxi'], visualPrompt: 'a taxi' }));
    const llm = new FakeLLM([JSON.stringify(concept), '```json\n' + JSON.stringify({ scenes }) + '\n```']);
    const planner = new Planner(llm, logger);
    const b = brief();
    const c = await planner.concept(b, template);
    expect(c).toMatchObject({ source: 'fake:fake-1', value: { title: 'Roulez avec Sirago' } });
    const s = await planner.script(b, template, c.value, slots);
    expect(s.value[3]!.items).toEqual(['a', 'b', 'c']);
    expect(s.value[0]!.headline).toBe('Titre hook');
    expect(llm.requests[1]!.json?.name).toBe('video_script');
    expect(llm.requests[1]!.messages[0]!.content).toContain('exactly 6 scenes');
  });

  it('falls back to procedural planning when the LLM fails', async () => {
    const planner = new Planner(new FakeLLM([new Error('boom'), 'not json', 'still not json']), logger);
    const b = brief();
    const c = await planner.concept(b, template);
    expect(c.source).toBe('procedural');
    expect(c.warning).toMatch(/boom/);
    const s = await planner.script(b, template, c.value, slots);
    expect(s.source).toBe('procedural');
    expect(s.value).toHaveLength(slots.length);
  });
});

describe('JSON extraction', () => {
  it('handles fences and chatter', () => {
    expect(extractJson('Voici :\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a": {"b": 2}} done')).toEqual({ a: { b: 2 } });
    expect(() => extractJson('nothing')).toThrow();
  });

  it('asks the model to correct invalid JSON once', async () => {
    const llm = new FakeLLM(['{"title": ""}', '{"title": "ok", "idea": "x"}']);
    const result = await generateJson(llm, { messages: [{ role: 'user', content: 'go' }] }, ConceptSchema);
    expect(result.title).toBe('ok');
    expect(llm.requests[1]!.messages.at(-1)!.content).toMatch(/not valid/);
  });
});
