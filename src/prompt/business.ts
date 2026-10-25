/**
 * Local-business details read from the brief without any LLM: the kind of shop, what it sells,
 * the phone number and practical perks (delivery, opening hours…). Offline copywriting uses them
 * so a restaurant ad talks about its dishes and ends on its number, not on generic app claims.
 */
import { normalize } from './parser';

export interface BusinessKind {
  /** Normalised word found in the brief ("restaurant", "salon de coiffure"). */
  id: string;
  fr: string;
  en: string;
  /** Food places get "Envie de… ? / Commandez" copy. */
  food: boolean;
}

export interface BusinessDetails {
  kind?: BusinessKind;
  /** Dishes, products or services, as written in the brief ("Riz gras", "Poulet braisé"). */
  offers: string[];
  phone?: string;
  /** Practical perks, already translated: "Livraison à domicile". */
  perks: string[];
}

/** Longest phrases first, so "salon de coiffure" wins over "salon". */
const KINDS: BusinessKind[] = [
  { id: 'salon de coiffure', fr: 'salon de coiffure', en: 'hair salon', food: false },
  { id: 'salon de beaute', fr: 'salon de beauté', en: 'beauty salon', food: false },
  { id: 'auto-ecole', fr: 'auto-école', en: 'driving school', food: false },
  { id: 'fast-food', fr: 'fast-food', en: 'fast food', food: true },
  { id: 'restaurant', fr: 'restaurant', en: 'restaurant', food: true },
  { id: 'maquis', fr: 'maquis', en: 'restaurant', food: true },
  { id: 'boulangerie', fr: 'boulangerie', en: 'bakery', food: true },
  { id: 'patisserie', fr: 'pâtisserie', en: 'pastry shop', food: true },
  { id: 'cafe', fr: 'café', en: 'café', food: true },
  { id: 'traiteur', fr: 'traiteur', en: 'caterer', food: true },
  { id: 'cafeteria', fr: 'cafétéria', en: 'cafeteria', food: true },
  { id: 'boucherie', fr: 'boucherie', en: 'butcher shop', food: true },
  { id: 'bakery', fr: 'boulangerie', en: 'bakery', food: true },
  { id: 'boutique', fr: 'boutique', en: 'shop', food: false },
  { id: 'magasin', fr: 'magasin', en: 'store', food: false },
  { id: 'supermarche', fr: 'supermarché', en: 'supermarket', food: false },
  { id: 'pharmacie', fr: 'pharmacie', en: 'pharmacy', food: false },
  { id: 'salon', fr: 'salon', en: 'salon', food: false },
  { id: 'couture', fr: 'atelier de couture', en: 'tailor shop', food: false },
  { id: 'garage', fr: 'garage', en: 'garage', food: false },
  { id: 'hotel', fr: 'hôtel', en: 'hotel', food: false },
  { id: 'pressing', fr: 'pressing', en: 'dry cleaner', food: false },
  { id: 'shop', fr: 'boutique', en: 'shop', food: false },
];

export const LOCAL_BUSINESS_WORDS = KINDS.map((k) => k.id);

const PERKS: Array<[RegExp, string, string]> = [
  [/\blivr(?:aison|e|ons|ent)\b|\bdelivery\b|\bdeliver/, 'Livraison à domicile', 'Home delivery'],
  [/\ba emporter\b|\btake ?away\b/, 'À emporter', 'Takeaway'],
  [/\b7\s*j?\s*\/\s*7\b|\btous les jours\b|\bevery day\b|\b7 days\b/, 'Ouvert 7j/7', 'Open 7 days a week'],
  [/\bprix (?:abordables?|bas|doux|imbattables?)\b|\bpas cher\b|\baffordable\b|\bcheap\b/, 'Prix abordables', 'Affordable prices'],
  [/\b(?:toujours|produits?|poissons?|ingredients?|bien) frais\b|\bfresh\b/, 'Toujours frais', 'Always fresh'],
  [/\bmobile money\b|\borange money\b|\bwave\b|\bmoov money\b/, 'Paiement mobile money', 'Mobile money accepted'],
  [/\bsur rendez-vous\b|\bby appointment\b/, 'Sur rendez-vous', 'By appointment'],
];

/** "70 00 00 00", "+226 70 00 00 00", "07-12-34-56-78". */
export const parsePhone = (text: string): string | undefined => {
  for (const m of text.matchAll(/(?:\+\d{1,3}[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){2,5}/g)) {
    const digits = m[0].replace(/\D/g, '');
    // Years, durations and resolutions ("1080x1920", "2026") are shorter than a phone number.
    if (digits.length >= 8 && digits.length <= 15) return m[0].trim();
  }
  return undefined;
};

const OFFER_INTRO = String.raw`(?:sp[ée]cialit[ée]s?|sp[ée]cialis[ée]e?s?\s+(?:dans|en)|nos\s+plats?|plats?|menu|on\s+(?:vend|propose)|qui\s+(?:vend|propose)|vend(?:ons)?|propos(?:e|ons)|specialit(?:y|ies)|specialising\s+in|specializing\s+in|selling|serving|sells|serves|offers?)`;
const OFFER_STOP = /[.;!?\n]|,\s*(?:livr|ouvert|appel|contact|t[ée]l|whats|d[ée]livr|paiement|payment|prix|price|sur rendez|deliver|open|call|style|sans|avec|with|no\b)|\s+(?:à|a|au|aux|en|in|at)\s+(?=[A-ZÀ-Þ])|\s+(?:pour|for)\s+(?:les|des|the)\b/iu;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "spécialité riz gras et poulet braisé" → ["Riz gras", "Poulet braisé"]. */
export const parseOffers = (text: string): string[] => {
  const m = new RegExp(`${OFFER_INTRO}\\s*:?\\s*(?:de\\s+|du\\s+|des\\s+|d['’]\\s*|le\\s+|la\\s+|les\\s+)?(.+)`, 'iu').exec(text);
  if (!m) return [];
  const list = m[1]!.split(OFFER_STOP)[0]!;
  return list
    .split(/\s*,\s*|\s+(?:et|and|ou|or)\s+|\s*\+\s*/)
    .map((s) => s.replace(/^(?:du|de la|de l['’]|des|de|le|la|les|l['’]|un|une|the|a|an)\s+/i, '').trim())
    .filter((s) => s.length >= 2 && s.split(/\s+/).length <= 5 && !/\d{4,}/.test(s.replace(/\s/g, '')))
    .slice(0, 4)
    .map(cap);
};

export const parseBusinessKind = (text: string): BusinessKind | undefined => {
  const t = ` ${normalize(text).replace(/[^a-z0-9-]+/g, ' ')} `;
  return KINDS.find((k) => t.includes(` ${k.id} `) || t.includes(` ${k.id}s `));
};

export const parseBusinessDetails = (text: string, lang: 'fr' | 'en'): BusinessDetails => {
  const t = normalize(text);
  return {
    kind: parseBusinessKind(text),
    offers: parseOffers(text),
    phone: parsePhone(text),
    perks: PERKS.filter(([re]) => re.test(t)).map(([, fr, en]) => (lang === 'fr' ? fr : en)),
  };
};
