/** Music prompt (English) from the video prompt: what the user asked for, then mood and industry. */
import { normalize } from '../../prompt/parser';
import { detectDomain } from '../../media/domains';

const MOODS = { calm: 'calm, soft, ambient', normal: 'modern, steady groove, uplifting', energetic: 'energetic, punchy, driving beat' } as const;

const DOMAIN_STYLE: Record<string, string> = {
  cybersecurity: 'dark electronic, synth pulses, tension, cinematic',
  tech: 'modern electronic, future bass, clean synths',
  fintech: 'corporate electronic, confident, clean',
  food: 'warm acoustic, light percussion, feel-good',
  'fashion-beauty': 'chic deep house, elegant',
  health: 'soft piano, gentle strings, reassuring',
  education: 'light acoustic, optimistic, playful marimba',
  mobility: 'driving electronic, motion',
  'real-estate': 'elegant piano, warm pads',
  travel: 'world music, warm guitar, adventurous',
  sport: 'hip hop beat, powerful drums, motivational',
  agriculture: 'warm acoustic guitar, organic percussion',
  events: 'afrobeats, festive, danceable',
  retail: 'upbeat pop, catchy, bright',
  business: 'corporate, inspiring, modern',
};

/** Words the user may use to describe the music, mapped to English genre tags. */
const GENRES: Array<[RegExp, string]> = [
  [/afro ?beat|afrobeats?/, 'afrobeats'],
  [/coupe[- ]decale/, 'coupé-décalé, ivorian dance music'],
  [/amapiano/, 'amapiano, log drums'],
  [/gnaoua|gnawa/, 'gnawa, guembri'],
  [/rai\b/, 'raï'],
  [/zouk/, 'zouk'],
  [/hip[- ]?hop|rap\b/, 'hip hop beat'],
  [/electro|techno|house/, 'electronic'],
  [/jazz/, 'jazz'],
  [/piano/, 'piano'],
  [/guitare|guitar/, 'guitar'],
  [/orchestr|cinemat|epique|epic/, 'cinematic orchestral'],
  [/lofi|lo-fi|chill/, 'lofi chill'],
  [/rock/, 'rock'],
];

export const buildMusicPrompt = (opts: { prompt: string; mood: keyof typeof MOODS; minor?: boolean }): string => {
  const t = normalize(opts.prompt);
  const domain = detectDomain(opts.prompt);
  // The sentence about the music, if any: it carries genre and tempo words.
  const sentence = t.split(/[.;\n!?]/).find((s) => /musique|music|bande[- ]son|soundtrack|ambiance sonore/.test(s)) ?? '';
  const genres = GENRES.filter(([re]) => re.test(sentence || t)).map(([, g]) => g);
  const tempo = /lent|slow|douce?|calme/.test(sentence) ? 'slow tempo' : /rapide|fast|dynamique|energ/.test(sentence) ? 'fast tempo' : '';
  return [genres.length ? genres.join(', ') : DOMAIN_STYLE[domain.id] ?? DOMAIN_STYLE.business, MOODS[opts.mood], tempo, opts.minor ? 'minor key, sophisticated' : '', 'background music for an advertising video, instrumental, no vocals, high quality']
    .filter(Boolean)
    .join(', ');
};
