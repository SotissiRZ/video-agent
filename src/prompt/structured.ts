/**
 * Detailed prompts written as a script ("SCÈNE 1 — INTRO (0–5 s)", "Texte : « … »",
 * "VOIX OFF : « … »", "Texte final : …"). The user's structure, texts and voice-over are
 * kept as they are instead of being rewritten from a template.
 */
import type { PlannedScene } from '../core/types';
import type { SceneKind } from '../remotion/contract/storyboard';
import { normalize } from './parser';

export interface StructuredScene {
  index: number;
  title: string;
  startSec?: number;
  endSec?: number;
  /** On-screen texts, in order. */
  texts: string[];
  /** What to show (visual direction). */
  description: string;
}

export interface StructuredScript {
  scenes: StructuredScene[];
  voiceover?: string;
  finalTexts: string[];
  /** End of the last timed scene. */
  totalSec?: number;
  /** Lower bound of a requested range ("Durée : 45 à 60 secondes"). */
  minSec?: number;
}

const SCENE_HEADER = /^\s*(?:#+\s*)?(?:sc[eè]ne|scene|plan|shot)\s*(\d+)\s*[—–:\-.]*\s*(.*)$/i;
const TIME_RANGE = /\(\s*(\d+(?:[.,]\d+)?)\s*(?:s|sec)?\s*[–—-]\s*(\d+(?:[.,]\d+)?)\s*(?:s|sec|secondes|seconds)?\s*\)/i;
const QUOTED = /[«“"]\s*([^»”"]+?)\s*[»”"]/g;
const LABEL = /^\s*(texte(?:\s+final)?|text(?:\s+on\s+screen)?|on-screen text|voix[\s-]?off|voice[\s-]?over|narration|direction artistique|art direction|dur[ée]e|duration|format|style(?:\s+visuel)?|musique|music)\s*:\s*(.*)$/i;

const quotedIn = (line: string): string[] => [...line.matchAll(QUOTED)].map((m) => m[1]!.trim()).filter(Boolean);
const num = (s: string) => Number(s.replace(',', '.'));

/** Returns undefined unless the prompt describes at least two numbered scenes. */
export const parseStructuredPrompt = (text: string): StructuredScript | undefined => {
  const lines = text.split(/\r?\n/);
  const scenes: StructuredScene[] = [];
  let current: StructuredScene | undefined;
  let section: 'scene' | 'voice' | 'final' | 'other' = 'other';
  const voice: string[] = [];
  const finalTexts: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const header = SCENE_HEADER.exec(line);
    if (header) {
      const time = TIME_RANGE.exec(line);
      current = {
        index: Number(header[1]),
        title: header[2]!.replace(TIME_RANGE, '').replace(/[—–:\-\s]+$/, '').trim(),
        startSec: time ? num(time[1]!) : undefined,
        endSec: time ? num(time[2]!) : undefined,
        texts: [],
        description: '',
      };
      scenes.push(current);
      section = 'scene';
      continue;
    }
    const label = LABEL.exec(line);
    if (label) {
      const name = normalize(label[1]!);
      const rest = label[2]!;
      if (/^(voix|voice|narration)/.test(name)) {
        section = 'voice';
        current = undefined;
        if (rest) voice.push(quotedIn(rest).join(' ') || rest);
      } else if (/final/.test(name)) {
        section = 'final';
        current = undefined;
        finalTexts.push(...quotedIn(rest));
      } else if (/^(texte|text|on-screen)/.test(name) && section === 'scene' && current) {
        current.texts.push(...(quotedIn(rest).length ? quotedIn(rest) : rest ? [rest] : []));
      } else {
        // Global settings (duration, format, style, music, art direction): already read by the prompt parser.
        section = 'other';
        current = undefined;
      }
      continue;
    }
    if (section === 'voice') voice.push(quotedIn(line).join(' ') || line);
    else if (section === 'final') finalTexts.push(...(quotedIn(line).length ? quotedIn(line) : [line]));
    else if (section === 'scene' && current) {
      const quoted = quotedIn(line);
      // A line made only of quoted text continues the scene's on-screen texts.
      if (quoted.length && line.replace(QUOTED, '').replace(/[\s.,;:•-]/g, '') === '') current.texts.push(...quoted);
      else current.description = `${current.description} ${line}`.trim();
    }
  }
  if (scenes.length < 2) return undefined;
  const ends = scenes.map((s) => s.endSec).filter((v): v is number => v !== undefined);
  const voiceText = voice.join(' ').replace(/^[«“"]\s*|\s*[»”"]$/g, '').replace(/\s+/g, ' ').trim();
  const range = /(\d+)\s*(?:à|a|-|–|to)\s*(\d+)\s*(?:s\b|sec|secondes|seconds)/i.exec(text);
  return { scenes, voiceover: voiceText || undefined, finalTexts, totalSec: ends.length ? Math.max(...ends) : undefined, minSec: range ? Number(range[1]) : undefined };
};

// ---- From the script to planned scenes ------------------------------------------------------

/** French (and English) visual words → English stock-photo terms. Longest phrases first. */
const VISUAL_LEXICON: Array<[RegExp, string]> = [
  [/intelligence artificielle|\bia\b|artificial intelligence|\bai\b/, 'artificial intelligence'],
  [/machine learning|apprentissage automatique/, 'machine learning'],
  [/computer vision|vision par ordinateur/, 'computer vision camera'],
  [/data science|analyse de donnees|data analys/, 'data analytics'],
  [/tableau de bord|dashboard/, 'dashboard'],
  [/bases? de donnees|database/, 'database server'],
  [/site web|site internet|website/, 'website design'],
  [/application|appli\b|\bapp\b/, 'mobile app'],
  [/responsive/, 'responsive design'],
  [/ordinateur portable|laptop/, 'laptop'],
  [/ordinateur|computer/, 'computer'],
  [/smartphone|telephone|mobile/, 'smartphone'],
  [/interface/, 'user interface'],
  [/donnees|data\b/, 'data'],
  [/connexion|reseau|network/, 'network connection'],
  [/automatis|workflow/, 'workflow automation'],
  [/formulaire|form\b/, 'online form'],
  [/notification/, 'notification'],
  [/synchronis/, 'cloud sync'],
  [/logo/, 'logo design'],
  [/affiche|poster/, 'poster design'],
  [/banniere|banner/, 'banner design'],
  [/flyer|prospectus/, 'flyer print'],
  [/powerpoint|presentation|pptx/, 'presentation slides'],
  [/pdf|document/, 'document'],
  [/reseaux sociaux|social media|contenus/, 'social media content'],
  [/billetterie|ticket/, 'ticketing app'],
  [/saas|plateforme|platform/, 'saas platform'],
  [/analytique|analytics/, 'analytics charts'],
  [/code|developpe|developer/, 'developer coding'],
  [/equipe|team/, 'team office'],
  [/client|customer/, 'client meeting'],
  [/bureau|office/, 'modern office'],
  [/graphi|design/, 'graphic designer'],
];

export const visualKeywordsFor = (text: string, max = 6): string[] => {
  const t = normalize(text);
  const out: string[] = [];
  for (const [re, term] of VISUAL_LEXICON) {
    if (re.test(t) && !out.includes(term)) out.push(term);
    if (out.length >= max) break;
  }
  return out;
};

/** Split the voice-over into sentences; enumerations ("web, IA, automatisation et contenus") into items. */
export const splitNarration = (text: string): string[] =>
  text
    .split(/(?<=[.!?…:;])\s+/)
    .flatMap((s) => ((s.match(/,/g) ?? []).length >= 3 ? s.split(/(?<=,)\s+|\s+(?=(?:et|and)\s)/) : [s]))
    .map((s) => s.trim())
    .filter(Boolean);

const STOP = new Set(['vous', 'votre', 'vos', 'nous', 'notre', 'nos', 'pour', 'dans', 'avec', 'sans', 'sont', 'plus', 'tout', 'tous', 'cette', 'your', 'with', 'from', 'that', 'this', 'what', 'have', 'avez']);
const stems = (text: string): Set<string> =>
  new Set(
    normalize(text)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map((w) => w.replace(/(es|s)$/, '').slice(0, 7)),
  );

/**
 * Give each scene the part of the voice-over that talks about it: fragments are matched to scenes
 * by shared words, keeping the order of the text. Without any match, falls back to proportions.
 */
export const alignNarration = (fragments: string[], scenes: Array<{ title: string; texts: string[] }>, durations: number[]): string[] => {
  const sceneWords = scenes.map((s) => stems(`${s.title} ${s.texts.join(' ')}`));
  const score = (f: string, i: number) => [...stems(f)].filter((w) => sceneWords[i]!.has(w)).length;
  const matched = fragments.filter((f) => scenes.some((_, i) => score(f, i) > 0)).length;
  if (matched < 2) return distributeNarration(fragments, durations);
  const out = scenes.map(() => [] as string[]);
  let current = 0;
  for (const fragment of fragments) {
    let best = current;
    let bestScore = 0;
    for (let i = current; i < scenes.length; i++) {
      // Jumping ahead needs a stronger match: the text keeps its order and rarely skips scenes.
      const sc = score(fragment, i) - 0.6 * (i - current);
      if (sc > bestScore) {
        best = i;
        bestScore = sc;
      }
    }
    current = best;
    out[current]!.push(fragment);
  }
  return out.map((s) => s.join(' '));
};

/** Give each scene its share of the voice-over, in order, proportionally to the scene durations. */
export const distributeNarration = (sentences: string[], durations: number[]): string[] => {
  const out = durations.map(() => [] as string[]);
  const words = sentences.map((s) => s.split(/\s+/).length);
  const totalWords = words.reduce((a, b) => a + b, 0);
  const totalTime = durations.reduce((a, b) => a + b, 0);
  let spoken = 0;
  let scene = 0;
  let sceneEnd = durations[0]! / totalTime;
  sentences.forEach((sentence, i) => {
    // Move on when the sentence would start after the end of the current scene.
    while (scene < durations.length - 1 && spoken / totalWords >= sceneEnd - 1e-9 && out[scene]!.length) {
      scene++;
      sceneEnd += durations[scene]! / totalTime;
    }
    out[scene]!.push(sentence);
    spoken += words[i]!;
  });
  return out.map((s) => s.join(' '));
};

const emphasizeLast = (text: string): string => {
  if (text.includes('*')) return text;
  const words = text.split(/\s+/);
  if (words.length < 2) return `*${text}*`;
  return `${words.slice(0, -1).join(' ')} *${words[words.length - 1]}*`;
};

const BULLET = /\s*[•·|]\s*/;
const slug = (s: string) => normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'scene';

/** Planned scenes from a structured script (no LLM needed). */
export const plannedFromStructured = (script: StructuredScript, opts: { brand: string; totalSec: number; language: 'fr' | 'en' }): PlannedScene[] => {
  const n = script.scenes.length;
  const timed = script.scenes.map((s) => (s.startSec !== undefined && s.endSec !== undefined && s.endSec > s.startSec ? s.endSec - s.startSec : undefined));
  const known = timed.filter((d): d is number => d !== undefined);
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : opts.totalSec / n;
  const durations = timed.map((d) => d ?? fallback);
  const narration = script.voiceover ? alignNarration(splitNarration(script.voiceover), script.scenes, durations) : script.scenes.map((s) => s.texts.join('. '));
  // The closing scene reads the final texts when the voice-over does not cover it.
  if (script.finalTexts.length && !narration[n - 1]) {
    narration[n - 1] = script.finalTexts.map((t) => t.replace(/[.!?]*$/, '.')).join(' ');
  }

  return script.scenes.map((scene, i) => {
    const last = i === n - 1;
    const texts = last && script.finalTexts.length ? [...scene.texts, ...script.finalTexts] : scene.texts;
    const items = texts.flatMap((t) => (BULLET.test(t) && t.split(BULLET).length >= 3 ? t.split(BULLET).map((x) => x.trim()).filter(Boolean) : []));
    const plain = texts.filter((t) => !(BULLET.test(t) && t.split(BULLET).length >= 3));
    let kind: SceneKind;
    let headline = plain[0] ?? scene.title;
    let subheadline = '';
    let body = '';
    if (last) {
      kind = 'cta';
      // "ZSR-TechNum" / "Votre idée. Notre technologie." / "Contactez-nous pour votre projet."
      const rest = plain.filter((t) => normalize(t) !== normalize(opts.brand));
      headline = rest[0] ?? headline;
      const action = rest[1] ?? '';
      subheadline = action ? action.replace(/\s+(pour|for|today|maintenant|des maintenant|dès maintenant)\b.*$/i, '').split(/\s+/).slice(0, 3).join(' ').replace(/[.!]+$/, '') : opts.language === 'fr' ? 'Contactez-nous' : 'Contact us';
      body = action;
    } else if (i === 0) {
      kind = 'title';
      body = plain[1] ?? '';
      subheadline = plain.length > 1 ? '' : scene.title;
    } else if (items.length) {
      kind = 'bullets';
    } else if (plain.length >= 2) {
      kind = 'text';
      body = plain.slice(1).join(' ');
    } else {
      kind = 'image';
      body = '';
    }
    return {
      role: last ? 'cta' : i === 0 ? 'intro' : slug(scene.title),
      kind,
      headline: emphasizeLast(headline),
      subheadline,
      body,
      items: items.slice(0, 6),
      statValue: '',
      statLabel: '',
      narration: narration[i] ?? '',
      visualKeywords: visualKeywordsFor(`${scene.title} ${scene.description} ${texts.join(' ')}`),
      visualPrompt: `${scene.description || scene.title}, realistic, professional lighting, cinematic`,
      weight: durations[i]!,
    };
  });
};
