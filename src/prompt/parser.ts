/**
 * Deterministic natural-language brief analysis (French & English).
 * It works without any LLM and gives the planner reliable constraints
 * (duration, format, brand, audience, location...). An LLM, when configured,
 * refines the creative part but never overrides what is parsed here.
 */
import { FORMAT_PRESETS, resolveFormat } from '../core/formats';
import type { ParsedPrompt } from '../core/types';

/** Lower-case and strip accents. */
export const normalize = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const FR_MARKERS = ['une', 'des', 'les', 'pour', 'avec', 'video', 'cree', 'creer', 'secondes', 'aupres', 'qui', 'dans', 'sur', 'est', 'notre', 'nos', 'vos', 'et', 'de', 'la', 'le', 'du', 'au', 'aux', 'fais', 'genere', 'presente'];
const EN_MARKERS = ['the', 'and', 'for', 'with', 'create', 'make', 'seconds', 'video', 'our', 'your', 'about', 'that', 'to', 'of', 'a', 'an', 'is', 'generate', 'showing', 'explaining'];

export const detectLanguage = (text: string): 'fr' | 'en' => {
  const words = normalize(text).split(/[^a-z0-9']+/).filter(Boolean);
  let fr = /[éèêàçùôîœ]/i.test(text) ? 2 : 0;
  let en = 0;
  for (const w of words) {
    if (FR_MARKERS.includes(w)) fr++;
    if (EN_MARKERS.includes(w)) en++;
  }
  return en > fr ? 'en' : 'fr';
};

const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, one: 1, a: 1, deux: 2, two: 2, trois: 3, three: 3, quatre: 4, four: 4, cinq: 5, five: 5,
  six: 6, sept: 7, seven: 7, huit: 8, eight: 8, neuf: 9, nine: 9, dix: 10, ten: 10, quinze: 15, fifteen: 15,
  vingt: 20, twenty: 20, trente: 30, thirty: 30, quarante: 40, forty: 40, cinquante: 50, fifty: 50,
  soixante: 60, sixty: 60, 'quatre-vingt-dix': 90, ninety: 90,
};

/** Duration in seconds, or undefined. Handles "30s", "30 secondes", "1 min 30", "1m30", "une minute", "trente secondes". */
export const parseDuration = (text: string): number | undefined => {
  const t = normalize(text);
  const minSec = /(\d+)\s*(?:minutes?|mins?|mn|m)\s*(?:et\s+|and\s+)?(\d{1,2})\s*(?:s|sec|secs|secondes?|seconds?)?\b/.exec(t);
  if (minSec) return Number(minSec[1]) * 60 + Number(minSec[2]);
  const num = /(\d+(?:[.,]\d+)?)\s*-?\s*(secondes?|seconds?|secs?|s|minutes?|mins?|mn)(?![a-z])/.exec(t);
  if (num) {
    const value = Number(num[1]!.replace(',', '.'));
    return Math.round(num[2]!.startsWith('m') ? value * 60 : value);
  }
  const words = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|');
  const word = new RegExp(`\\b(${words})\\s+(secondes?|seconds?|minutes?)\\b`).exec(t);
  if (word) {
    const value = NUMBER_WORDS[word[1]!]!;
    return word[2]!.startsWith('m') ? value * 60 : value;
  }
  if (/\b(demi-minute|half a minute|half-minute)\b/.test(t)) return 30;
  return undefined;
};

const PLATFORM_FORMATS: Array<{ platform: string; pattern: RegExp; format: string }> = [
  { platform: 'tiktok', pattern: /\btik\s?tok\b/, format: 'vertical' },
  { platform: 'youtube-shorts', pattern: /\b(youtube\s+)?shorts?\b/, format: 'vertical' },
  { platform: 'instagram-reels', pattern: /\breels?\b/, format: 'vertical' },
  { platform: 'stories', pattern: /\bstor(y|ies)\b/, format: 'vertical' },
  { platform: 'whatsapp', pattern: /\bwhatsapp\b/, format: 'vertical' },
  { platform: 'instagram', pattern: /\binstagram\b/, format: 'square' },
  { platform: 'linkedin', pattern: /\blinkedin\b/, format: 'square' },
  { platform: 'facebook', pattern: /\bfacebook\b/, format: 'square' },
  { platform: 'youtube', pattern: /\byoutube\b/, format: 'landscape' },
];

export const parseFormat = (text: string): { format?: ParsedPrompt['format']; platform?: string } => {
  const t = normalize(text);
  const explicit = /\b(\d{3,5})\s*[x×]\s*(\d{3,5})\b/.exec(t);
  if (explicit) {
    const f = resolveFormat(`${explicit[1]}x${explicit[2]}`);
    if (f) return { format: f };
  }
  const ratio = /\b(16:9|9:16|1:1|4:5)\b/.exec(t);
  const byWord =
    (ratio && resolveFormat(ratio[1])) ||
    (/\b(verticale?|portrait|en hauteur)\b/.test(t) && resolveFormat('vertical')) ||
    (/\b(carree?|square)\b/.test(t) && resolveFormat('square')) ||
    (/\b(horizontale?|paysage|landscape|widescreen)\b/.test(t) && resolveFormat('landscape')) ||
    undefined;
  const platform = PLATFORM_FORMATS.find((p) => p.pattern.test(t));
  if (byWord) return { format: byWord, platform: platform?.platform };
  if (platform) return { format: resolveFormat(platform.format), platform: platform.platform };
  return {};
};

export const parseFps = (text: string): number | undefined => {
  const m = /\b(\d{2,3})\s*(?:fps|i\/s|ips|images par seconde|frames per second)\b/i.exec(normalize(text));
  return m ? Number(m[1]) : undefined;
};

const NOT_BRANDS = new Set(
  [
    'cree', 'creer', 'create', 'make', 'fais', 'faire', 'genere', 'generer', 'generate', 'produis', 'realise', 'video', 'une', 'un',
    'tiktok', 'instagram', 'youtube', 'facebook', 'linkedin', 'whatsapp', 'reels', 'shorts', 'je', 'nous', 'i', 'we', 'please', 'merci',
    'pour', 'for', 'avec', 'with', 'le', 'la', 'les', 'the', 'a', 'an', 'mon', 'ma', 'notre', 'our', 'my',
    // Acronyms and generic business words written in capitals, not brand names ("plateforme SaaS pour les PME").
    'saas', 'paas', 'pme', 'pmes', 'tpe', 'tpes', 'eti', 'sme', 'smes', 'ia', 'ai', 'api', 'apis', 'crm', 'erp', 'b2b', 'b2c', 'it', 'iot', 'cloud',
    'data', 'web', 'web3', 'tech', 'fintech', 'edtech', 'healthtech', 'ecommerce', 'e-commerce', 'rh', 'hr', 'seo', 'rgpd', 'gdpr', 'ceo', 'cto',
    'pdg', 'dg', 'ux', 'ui', 'mvp', 'roi', 'kpi', 'ong', 'ngo', 'vtc', 'gps', 'nft', 'blockchain', 'bitcoin', 'android', 'ios', 'windows', 'mac',
    'internet', 'startup', 'start-up', 'bac', 'master', 'covid',
    'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'noel', 'christmas',
  ].map(normalize),
);

const CAP_WORD = "[A-ZÀ-ÖØ-Þ][\\wÀ-ÖØ-öø-ÿ'’&.-]*";
const CAP_GROUP = `${CAP_WORD}(?:\\s+(?:(?:de|du|des|d'|of|and|et)\\s+)?${CAP_WORD})*`;

export interface ParsedLocation {
  /** "Burkina Faso" */
  name: string;
  /** "au Burkina Faso" — keeps the original preposition for natural copywriting. */
  phrase: string;
}

export const parseLocation = (text: string): ParsedLocation | undefined => {
  const re = new RegExp(`(?:^|\\s)((?:au|aux|en|à|a|dans|sur|in|at|across|throughout)\\s+(?:l'|la\\s+|le\\s+|les\\s+|the\\s+)?)(${CAP_GROUP})`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[2]!.replace(/[.,;:!?]+$/, '');
    if (!NOT_BRANDS.has(normalize(name.split(/\s+/)[0]!))) return { name, phrase: `${m[1]!.trim()} ${name}`.replace(/' /, "'") };
  }
  return undefined;
};

export const parseBrand = (text: string, location?: string): string | undefined => {
  const quoted = /["«“]\s*([^"»”]{2,40}?)\s*["»”]/.exec(text);
  if (quoted) return quoted[1]!.trim();
  // After an intent verb: "promouvoir Sirago", "présenter Acme Pay", "launch of Zeta".
  const verbs = '(?:promouvoir|promotion\\s+de|pub(?:licit[ée])?\\s+(?:pour|de)|pr[ée]senter|pr[ée]sentation\\s+de|lancer|lancement\\s+de|annoncer|faire\\s+conna[iî]tre|vanter|valoriser|promote|present|presenting|introduce|introducing|launch|launching|announce|advertise|advertising|showcase|for|pour|about|sur)';
  const afterVerb = new RegExp(`${verbs}\\s+(?:l'|le\\s+|la\\s+|les\\s+|the\\s+|our\\s+|notre\\s+|nos\\s+|l’)?(?:(?:application|app|marque|brand|produit|product|service|plateforme|platform|startup|entreprise|company|solution|logiciel|software)\\s+)?(${CAP_GROUP})`, 'g');
  let m: RegExpExecArray | null;
  while ((m = afterVerb.exec(text))) {
    const candidate = m[1]!.replace(/[.,;:!?]+$/, '');
    if (location && candidate === location) continue;
    // "AI API", "SaaS": generic words, not a brand.
    if (candidate.split(/\s+/).every((w) => NOT_BRANDS.has(normalize(w)))) continue;
    if (!NOT_BRANDS.has(normalize(candidate))) return candidate;
  }
  // Any capitalised word that is not the first word of a sentence nor part of the location.
  const words = text.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!.replace(/^[«"“(]+|[.,;:!?)»”"]+$/g, '');
    const prev = words[i - 1]!;
    if (/[.!?]$/.test(prev)) continue;
    if (!/^[A-ZÀ-ÖØ-Þ][\w'-]+$/u.test(w)) continue;
    // "une couturière de Bamako", "made in Lagos": a place or a person, not a brand.
    if (/^(de|d'|d’|du|des|à|a|au|aux|en|in|of|from|chez)$/i.test(prev)) continue;
    if (location && location.split(/\s+/).includes(w)) continue;
    if (NOT_BRANDS.has(normalize(w))) continue;
    return w;
  }
  return undefined;
};

export const parseAudience = (text: string): string | undefined => {
  const stop = "(?=\\s+(?:au|aux|en|à|dans|avec|qui|pour|sur|afin|in|at|on|with|who|to|across|using)\\b|[.,;:!?]|$)";
  const patterns = [
    new RegExp(`aupr[eè]s\\s+(?:des|du|de\\s+la|de\\s+l'|de)\\s+([^.,;:!?]+?)${stop}`, 'i'),
    new RegExp(`(?:destin[ée]e?s?|adress[ée]e?s?)\\s+(?:aux|au|à\\s+la|à)\\s+([^.,;:!?]+?)${stop}`, 'i'),
    new RegExp(`(?:à\\s+destination\\s+des?|ciblant\\s+les|ciblant|pour\\s+(?:les|des))\\s+([^.,;:!?]+?)${stop}`, 'i'),
    new RegExp(`(?:targeting|aimed\\s+at|for)\\s+((?:young\\s+|local\\s+|new\\s+|small\\s+)?[a-z][a-z-]+(?:\\s+[a-z][a-z-]+){0,3}?)${stop}`, ''),
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const audience = m[1]!.trim();
      if (audience && audience.split(/\s+/).length <= 6 && !/^\d/.test(audience)) return audience;
    }
  }
  return undefined;
};

const STYLE_HINTS: Record<string, string[]> = {
  minimal: ['minimal', 'minimaliste', 'epure', 'epuree', 'sobre', 'clean'],
  vibrant: ['vibrant', 'colore', 'coloree', 'dynamique', 'energique', 'energetic', 'punchy', 'flashy', 'pop'],
  corporate: ['corporate', 'professionnel', 'professionnelle', 'professional', 'institutionnel', 'institutionnelle', 'b2b', 'serieux', 'serieuse'],
  elegant: ['elegant', 'elegante', 'luxe', 'luxury', 'premium', 'chic', 'haut de gamme', 'sombre', 'dark', 'cinematique', 'cinematic'],
  playful: ['ludique', 'playful', 'fun', 'amusant', 'amusante', 'enfants', 'kids', 'cartoon', 'joyeux', 'joyeuse'],
  tech: ['tech', 'technologique', 'futuriste', 'futuristic', 'saas', 'logiciel', 'software', 'digital', 'numerique', 'neon'],
  warm: ['chaleureux', 'chaleureuse', 'warm', 'humain', 'humaine', 'convivial', 'conviviale', 'familial', 'authentique', 'authentic'],
};

export const parseStyleHints = (text: string): string[] => {
  const t = ` ${normalize(text)} `;
  return Object.entries(STYLE_HINTS)
    .filter(([, words]) => words.some((w) => t.includes(` ${w} `) || t.includes(` ${w},`) || t.includes(` ${w}.`)))
    .map(([id]) => id);
};

const toggle = (t: string, positive: RegExp, negative: RegExp): boolean | undefined =>
  negative.test(t) ? false : positive.test(t) ? true : undefined;

const STOPWORDS = new Set(
  (
    'une un des les le la de du au aux et ou en a pour par sur avec dans qui que quoi est sont cree creer fais faire genere video videos secondes seconde ' +
    'minute minutes format verticale vertical horizontale horizontal carree carre notre nos votre vos leur leurs ce cette ces son sa ses mon ma mes aupres ' +
    'the and for with into from that this these those create make generate video videos seconds second minute minutes our your their about of to an in on at by ' +
    'promouvoir promote presenter present annoncer announce min sec sans without style fps comment how'
  ).split(' '),
);

export const extractKeywords = (text: string): string[] => {
  const seen = new Set<string>();
  for (const raw of normalize(text).split(/[^a-z0-9-]+/)) {
    const w = raw.replace(/^-+|-+$/g, '');
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+s?$/.test(w)) continue;
    seen.add(w);
  }
  return [...seen];
};

/** Derive the main subject of the brief when no brand is found. */
export const parseTopic = (text: string, brand?: string): string => {
  if (brand) return brand;
  const t = text.replace(/\s+/g, ' ').trim();
  // Story subjects first ("l'histoire d'une couturière…", "the story of…"), then intent verbs.
  const story = /(?:l['’]histoire|histoire|le parcours|parcours|the story|story|journey)\s+(?:d['’]|de |du |des |of )\s*(.+?)(?:[.,;!?]|$)/i.exec(t);
  const m = story ?? /(?:pour|sur|about|on|expliquant|explaining|pr[ée]sentant|presenting|montrant|showing|promouvoir|promote|pr[ée]senter|present|annoncer|announce|raconter|tell)\s+(.+?)(?:[.,;!?]|$)/i.exec(t);
  const topic = (m ? m[1]! : t)
    // "pour promouvoir un café" → "un café": drop chained intent verbs.
    .replace(/^(?:(?:faire\s+)?(?:promouvoir|pr[ée]senter|annoncer|expliquer|montrer|raconter|vendre|lancer|d[ée]couvrir|faire conna[iî]tre|promote|present|announce|explain|show|tell|sell|launch|introduce|showcase)\s+)+/i, '')
    .replace(/\b(?:de|of|en|in)\s+\d+\s*(?:secondes?|seconds?|s|min(?:utes?)?)\b/gi, '')
    // Cut the relative clause and the audience/location tail: keep the subject itself.
    .replace(/\s+(?:qui|que|dont|who|that|which)\s+.*$/i, '')
    .replace(/\s+(?:aupr[eè]s|targeting)\s+.*$/i, '')
    .replace(/\s+(?:pour|for)\s+(?:les|des|the)\s+.*$/i, '')
    .replace(/\s+(?:au|aux|en|à|in|for)\s+(?=[A-ZÀ-Þ0-9]).*$/u, '')
    .trim();
  return topic.length > 80 ? `${topic.slice(0, 77).trim()}…` : topic;
};

export const parsePrompt = (raw: string): ParsedPrompt => {
  const text = raw.trim();
  const t = normalize(text);
  const language = detectLanguage(text);
  const location = parseLocation(text);
  const brand = parseBrand(text, location?.name);
  const { format, platform } = parseFormat(text);
  return {
    raw: text,
    language,
    durationSec: parseDuration(text),
    format,
    fps: parseFps(text),
    brand,
    audience: parseAudience(text),
    location: location?.name,
    locationPhrase: location?.phrase,
    topic: parseTopic(text, brand),
    styleHints: parseStyleHints(text),
    platform,
    wantsVoice: toggle(t, /\b(voix[- ]?off|voiceover|voice[- ]over|narration|narre|narree|narrated|commentaire audio)\b/, /\b(sans|no|without|pas de)\s+(voix|voice|narration)/),
    wantsMusic: toggle(t, /\b(musique|music|soundtrack|bande[- ]son)\b/, /\b(sans|no|without|pas de)\s+(musique|music)/),
    wantsSubtitles: toggle(t, /\b(sous[- ]titres?|sous[- ]titrees?|subtitles?|captions?)\b/, /\b(sans|no|without|pas de)\s+(sous[- ]titres?|subtitles?|captions?)/),
    keywords: extractKeywords(text),
  };
};

export const KNOWN_FORMATS = FORMAT_PRESETS.map((p) => p.id);
