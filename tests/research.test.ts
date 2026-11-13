import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VideoAgent } from '../src/agent/orchestrator';
import { createLogger } from '../src/core/logger';
import { UsageMeter } from '../src/core/usage';
import { researchWeb, sourcesMarkdown, wantsResearch, type Research } from '../src/planning/research';
import { proceduralCaptions } from '../src/publish/captions';
import { priceUsage } from '../src/saas/costs';
import { fakeRenderer, FakeLLM, testConfig } from './helpers';

const logger = createLogger('silent');
const DOCUMENTARY = "fait le tour de la toile , recueille les nouveauté su l'IA et moi un documentaire de 3 mn à publier sur youtube";

describe('requests that need web research', () => {
  it('recognises them', () => {
    for (const prompt of [
      DOCUMENTARY,
      'Cherche sur internet les dernières annonces de Google et fais une vidéo de 1 minute',
      'Fais une revue de presse des actualités tech de cette semaine',
      "Gather this week's AI news and make a 2 minute video",
    ]) {
      expect(wantsResearch(prompt), prompt).toBe(true);
    }
  });

  it('leaves ordinary videos alone, even when they mention news or the web', () => {
    for (const prompt of [
      'Crée une vidéo verticale de 30 secondes pour promouvoir Sirago auprès des chauffeurs au Burkina Faso.',
      'Découvrez nos nouveautés : la nouvelle collection de pagnes arrive en boutique',
      'Pub pour notre agence de développement web à Dakar',
    ]) {
      expect(wantsResearch(prompt), prompt).toBe(false);
    }
  });
});

const dossier: Research = {
  dossier: "## Un nouveau modèle ouvert\nDate: 20 octobre 2026\nFaits: Le laboratoire X publie un modèle.\nImportance: accès libre.\nSources: Exemple — https://example.com/modele\n\n## Fil conducteur\nL'IA s'ouvre.",
  sources: [{ title: 'Exemple', url: 'https://example.com/modele', age: '8 days ago' }],
  searches: 6,
  model: 'claude-opus-5-5',
  inputTokens: 40_000,
  outputTokens: 2_000,
};

describe('documentary from web research', () => {
  it('gives the dossier to the director, keeps it in the job folder and counts the searches', async () => {
    const config = testConfig({ ANTHROPIC_API_KEY: 'test-key', VIDEO_AGENT_MUSIC: 'none', VIDEO_AGENT_STOCK_PROVIDERS: 'none', VIDEO_AGENT_IMAGE_PROVIDER: 'none' });
    const meter = new UsageMeter();
    const asked: string[] = [];
    // The director fails here: the rule-based planner takes over, the dossier was still given to it.
    const llm = new FakeLLM([new Error('no plan'), new Error('no concept'), new Error('no script')]);
    const agent = new VideoAgent(config, {
      renderer: fakeRenderer,
      logger,
      llm,
      voice: null,
      meter,
      captureScreen: null,
      research: async (prompt) => {
        asked.push(prompt);
        return dossier;
      },
    });
    const result = await agent.run({ prompt: DOCUMENTARY });

    expect(asked).toEqual([DOCUMENTARY]);
    expect(llm.requests[0]!.messages[0]!.content).toContain('<research>');
    expect(llm.requests[0]!.messages[0]!.content).toContain('Le laboratoire X publie un modèle.');
    expect(result.brief.durationSec).toBe(180);
    expect(result.brief.width).toBeGreaterThan(result.brief.height);
    expect(fs.readFileSync(path.join(result.jobDir, 'research.md'), 'utf8')).toContain('https://example.com/modele');
    const lines = meter.lines;
    expect(lines).toContainEqual(expect.objectContaining({ kind: 'search', provider: 'anthropic', calls: 6 }));
    // 6 searches at $0.01, 40k input and 2k output tokens at Claude Opus 5.5 prices.
    expect(priceUsage(lines.filter((l) => l.provider === 'anthropic')).usd).toBeCloseTo(0.06 + 0.16 + 0.04, 5);
  });

  it('never makes a news video from memory: no research, no video', async () => {
    const config = testConfig({ VIDEO_AGENT_MUSIC: 'none', VIDEO_AGENT_STOCK_PROVIDERS: 'none', VIDEO_AGENT_IMAGE_PROVIDER: 'none' });
    const llm = new FakeLLM([]);
    const withoutKey = new VideoAgent(config, { renderer: fakeRenderer, logger, llm, voice: null, captureScreen: null });
    await expect(withoutKey.run({ prompt: DOCUMENTARY })).rejects.toThrow(/recherche sur le web/);

    const failing = new VideoAgent(testConfig({ ANTHROPIC_API_KEY: 'test-key', VIDEO_AGENT_MUSIC: 'none' }), {
      renderer: fakeRenderer,
      logger,
      llm,
      voice: null,
      captureScreen: null,
      research: async () => {
        throw new Error('rate limited');
      },
    });
    await expect(failing.run({ prompt: DOCUMENTARY })).rejects.toThrow(/La recherche sur le web a échoué : rate limited/);
  });

  it('lists the sources in long descriptions', () => {
    const concept = { title: 'IA : le mois en revue', idea: 'Les nouveautés', angle: '', tone: '', keyMessage: 'Ce qui a changé', callToAction: 'Abonnez-vous', tagline: '' };
    const brief = { language: 'fr', width: 1920, height: 1080, templateId: 'storytelling', brand: '', location: '', audience: '' } as never;
    const captions = proceduralCaptions({ brief, concept, durationSec: 180, credits: [], includeCredits: true, sources: dossier.sources }, ['youtube', 'tiktok']);
    expect(captions.youtube!.caption).toContain('Sources :\n- Exemple : https://example.com/modele');
    expect(captions.tiktok!.caption).not.toContain('Sources');
    expect(sourcesMarkdown(dossier)).toContain('- Exemple — https://example.com/modele (8 days ago)');
  });

  it('reads web search results and citations from the API response, resuming paused turns', async () => {
    const responses = [
      {
        id: 'm1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'pause_turn', stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 50, server_tool_use: { web_search_requests: 2 } },
        content: [{ type: 'web_search_tool_result', tool_use_id: 't1', content: [{ type: 'web_search_result', title: 'Article A', url: 'https://a.example/1', page_age: '2 days ago', encrypted_content: 'x' }, { type: 'web_search_result', title: 'Article B', url: 'https://b.example/2', encrypted_content: 'y' }] }],
      },
      {
        id: 'm2', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 3000, output_tokens: 400, server_tool_use: { web_search_requests: 1 } },
        content: [
          { type: 'text', text: '## A\nDate: hier\nFaits: ', citations: null },
          { type: 'text', text: 'Il se passe A.', citations: [{ type: 'web_search_result_location', url: 'https://a.example/1', title: 'Article A', cited_text: 'A', encrypted_index: 'z' }] },
        ],
      },
    ];
    const bodies: unknown[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const research = await researchWeb('nouveautés IA', { apiKey: 'k', model: 'claude-opus-5-5', effort: 'medium', timeoutMs: 10_000, language: 'fr', today: new Date('2026-10-28') });
      expect(research.dossier).toBe('## A\nDate: hier\nFaits: Il se passe A.');
      expect(research.sources).toEqual([{ title: 'Article A', url: 'https://a.example/1', age: '2 days ago' }]);
      expect(research).toMatchObject({ searches: 3, inputTokens: 4000, outputTokens: 450 });
      const first = bodies[0] as { tools: Array<{ type: string }>; system: string };
      expect(first.tools[0]!.type).toBe('web_search_20260209');
      expect(first.system).toContain('Today is 2026-10-28');
      // The paused turn is sent back so the server continues it.
      expect((bodies[1] as { messages: Array<{ role: string }> }).messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
