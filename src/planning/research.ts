/**
 * Web research before planning: "fais le tour de la toile, recueille les nouveautés sur l'IA et fais-moi
 * un documentaire de 3 min". Claude searches the web (Anthropic's server-side web search tool), reads
 * the recent articles and writes a dated research dossier with its sources; the AI director then
 * plans the video from that dossier instead of from what the model remembers.
 */
import Anthropic from '@anthropic-ai/sdk';
import { getLanguage } from '../core/languages';
import { normalize } from '../prompt/parser';

/** "fais le tour de la toile", "cherche sur internet les dernières annonces", "gather this week's news"… */
const ASKS_RESEARCH =
  /\b(?:fai(?:s|t|tes|re) le tour (?:de la toile|du web|d['’]internet|de l['’]actualite|des actualites)|(?:cherche|recherche|recueille|collecte|rassemble|compile|trouve|parcour|fouille|scrute|surveille|search|gather|collect|find|browse|research|look up)\w*\b.{0,80}\b(?:web|toile|internet|en ligne|online|actualites?|nouveautes?|news|dernier(?:e|s|es)?|recent\w*|latest|cette semaine|ce mois|this (?:week|month)))/;
const ROUNDUP = /\b(?:revue de presse|veille|recap\w*|tour d['’]horizon|roundup|round-up|news digest)\b/;
const RECENT = /\b(?:actualites?|nouveautes?|news|dernier(?:e|s|es)? (?:nouvelles|annonces|sorties|avancees)|latest|recent\w*|cette semaine|ce mois|this (?:week|month)|aujourd['’]hui|today|en ce moment)\b/;

/** The request asks to look up recent information on the web, not only to write about a subject. */
export const wantsResearch = (prompt: string): boolean => {
  const t = normalize(prompt);
  return ASKS_RESEARCH.test(t) || (ROUNDUP.test(t) && RECENT.test(t));
};

export interface ResearchSource {
  title: string;
  url: string;
  /** How old the page is, as given by the search engine ("2 days ago", a date…). */
  age?: string;
}

export interface Research {
  /** Dated facts with their sources, in the language of the video. */
  dossier: string;
  /** Pages the dossier cites (or, without citations, the pages the searches returned). */
  sources: ResearchSource[];
  searches: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ResearchOptions {
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  timeoutMs: number;
  /** Language code of the video (fr, en, wo…). */
  language: string;
  /** Searches allowed for one video (each costs about one cent). */
  maxSearches?: number;
  today?: Date;
}

/** Models with the dynamic-filtering web search (`web_search_20260209`); older ones get the basic tool. */
const DYNAMIC_SEARCH = /^claude-(opus-5|opus-4-[678]|fable|sonnet-5|sonnet-4-6|mythos)/;
const SUPPORTS_EFFORT = /^claude-(opus|fable|sonnet-5|mythos)/;
const SUPPORTS_FALLBACKS = /^claude-(opus-5|opus-5-5|fable-5|fable-5-1|sonnet-5-5)$/;

const system = (today: Date, language: string) => `You are the research desk of a video documentary studio. Today is ${today.toISOString().slice(0, 10)}.
Search the web for what the customer's request asks about and write a research dossier the scriptwriter will use.

Rules:
- Use only facts found in your search results today. Never complete them from memory: an AI video built on outdated
  or invented news would mislead its viewers.
- Recent means what the request says ("this week", "this month"…); without a period, the last 30 days. Prefer primary
  sources (official announcements, company blogs, papers) and established news outlets; skip rumours, or label them.
- Cover the subject broadly: search several angles (products, research, companies, regulation, impact on people,
  Africa when relevant), then keep the 6 to 10 most important items, most significant first.
- Write the dossier in ${getLanguage(language)?.name ?? language}, plain text with this layout for each item:
  ## <short title>
  Date: <date of the event, as precise as the sources allow>
  Faits: <2 to 4 factual sentences: who, what, figures only as published>
  Importance: <one sentence on why it matters>
  Sources: <outlet name — URL> (one or two)
- End with "## Fil conducteur": 3 to 5 sentences suggesting how a documentary could link these items.
- No preamble and no closing remarks: the dossier only.`;

/**
 * Search the web and write the research dossier. A long search can pause ("pause_turn"): the paused
 * turn is sent back so the server continues it, a few times at most.
 */
export const researchWeb = async (prompt: string, opts: ResearchOptions, signal?: AbortSignal): Promise<Research> => {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: Math.max(opts.timeoutMs, 600_000), maxRetries: 2 });
  const tool = DYNAMIC_SEARCH.test(opts.model)
    ? { type: 'web_search_20260209', name: 'web_search', max_uses: opts.maxSearches ?? 10 }
    : { type: 'web_search_20250305', name: 'web_search', max_uses: opts.maxSearches ?? 10 };
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: `Customer request (between the tags):\n<request>\n${prompt}\n</request>\n\nResearch it on the web and write the dossier.` },
  ];
  const results = new Map<string, ResearchSource>();
  const cited = new Map<string, ResearchSource>();
  let inputTokens = 0;
  let outputTokens = 0;
  let searches = 0;
  let model = opts.model;
  let text = '';

  for (let turn = 0; turn < 5; turn++) {
    const params = {
      model: opts.model,
      max_tokens: 16000,
      system: system(opts.today ?? new Date(), opts.language),
      messages,
      tools: [tool],
      ...(SUPPORTS_EFFORT.test(opts.model) ? { output_config: { effort: opts.effort } } : {}),
      // Re-route automatically if a safety classifier declines the request.
      ...(SUPPORTS_FALLBACKS.test(opts.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    };
    const message = (await client.beta.messages.create(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming, { signal })) as Anthropic.Beta.BetaMessage;
    model = message.model ?? model;
    inputTokens += (message.usage.input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
    outputTokens += message.usage.output_tokens ?? 0;
    searches += message.usage.server_tool_use?.web_search_requests ?? 0;

    const parts: string[] = [];
    for (const block of message.content) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const r of block.content) if (r.type === 'web_search_result') results.set(r.url, { title: r.title, url: r.url, ...(r.page_age ? { age: r.page_age } : {}) });
      } else if (block.type === 'text') {
        parts.push(block.text);
        for (const c of block.citations ?? []) {
          if (c.type === 'web_search_result_location') cited.set(c.url, { title: c.title ?? c.url, url: c.url, ...(results.get(c.url)?.age ? { age: results.get(c.url)!.age } : {}) });
        }
      }
    }
    if (parts.length) text = parts.join('');
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: message.content as Anthropic.Beta.BetaContentBlockParam[] });
      continue;
    }
    if (message.stop_reason === 'refusal') throw new Error('the model declined to research this request');
    break;
  }

  const dossier = text.trim();
  if (!dossier) throw new Error(`the web research returned no dossier (${searches} searches)`);
  const sources = [...(cited.size ? cited : results).values()].slice(0, 20);
  return { dossier, sources, searches, model, inputTokens, outputTokens };
};

/** Sources block for the job folder and the video descriptions. */
export const sourcesMarkdown = (research: Pick<Research, 'sources'>): string =>
  research.sources.length ? `## Sources\n\n${research.sources.map((s) => `- ${s.title} — ${s.url}${s.age ? ` (${s.age})` : ''}`).join('\n')}\n` : '';
