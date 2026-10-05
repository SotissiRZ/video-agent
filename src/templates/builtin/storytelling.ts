import { tr } from '../helpers';
import type { TemplateDefinition } from '../types';

/** Story arc: setting → challenge → turning point → resolution → message. */
export const storytelling: TemplateDefinition = {
  id: 'storytelling',
  name: 'Storytelling',
  description: 'Récit en arc narratif : situation, difficulté, déclic, résolution, message final.',
  keywords: ['storytelling', 'histoire', 'raconter', 'raconte', 'recit', 'temoignage', 'parcours', 'journey', 'story of', 'tell', 'narrative', 'inspirant', 'inspiring', 'emotion', 'emouvant', 'il etait une fois', 'portrait'],
  strongKeywords: ['raconte', 'raconter', 'histoire', 'storytelling', 'temoignage', 'parcours', 'story of', 'journey'],
  defaultStyle: 'elegant',
  defaultDurationSec: 60,
  scenes: [
    { role: 'setting', kind: 'image', weight: 1.2, purpose: 'Set the scene: who, where. Evocative.' },
    { role: 'challenge', kind: 'text', weight: 1.2, purpose: 'The obstacle or tension.' },
    { role: 'turning-point', kind: 'quote', weight: 1.2, purpose: 'The moment everything changes (a quote or realisation).' },
    { role: 'resolution', kind: 'image', weight: 1.2, optional: true, repeatable: true, purpose: 'How things change for the better.' },
    { role: 'message', kind: 'title', weight: 1, purpose: 'The moral / brand message.' },
    { role: 'outro', kind: 'cta', weight: 0.8, optional: true, purpose: 'Soft call to action or signature.' },
  ],
  guidance: 'Emotional, human, sensory details, slower pace, present tense. Narration reads like a short story.',
  concept(ctx) {
    const t = tr(ctx);
    const hero = ctx.audience || t('une personne ordinaire', 'an ordinary person');
    return {
      title: t(`Une histoire — ${ctx.subject}`, `A story — ${ctx.subject}`),
      idea: t(`Raconter le parcours de ${hero}${ctx.locationPhrase ? ' ' + ctx.locationPhrase : ''}.`, `Tell the journey of ${hero}${ctx.locationPhrase ? ' ' + ctx.locationPhrase : ''}.`),
      angle: t('Du doute à la réussite.', 'From doubt to success.'),
      tone: t('Émouvant et inspirant', 'Moving and inspiring'),
      keyMessage: t('Chaque parcours mérite d’être raconté.', 'Every journey deserves to be told.'),
      callToAction: t('Écrivez la suite', 'Write what comes next'),
      tagline: t('Chaque parcours compte.', 'Every journey matters.'),
    };
  },
  copy(ctx) {
    const t = tr(ctx);
    const hero = ctx.audience ? t(`les ${ctx.audience}`, ctx.audience) : t('nous', 'us');
    return {
      setting: [{ headline: ctx.locationPhrase ? t(`Ici, *${ctx.location}*`, `Here, *${ctx.location}*`) : t('Tout commence *ici*', 'It all starts *here*'), body: t('Chaque matin, une nouvelle journée commence.', 'Every morning, a new day begins.'), narration: t('Chaque matin, une nouvelle journée commence.', 'Every morning, a new day begins.'), visualKeywords: [ctx.location, 'landscape', 'morning', ctx.audience] }],
      challenge: [{ headline: t('Rien n’est *facile*', 'Nothing comes *easy*'), body: t(`Pour ${hero}, chaque jour est un défi.`, `For ${hero}, every day is a challenge.`), narration: t(`Pour ${hero}, chaque jour est un défi.`, `For ${hero}, every day is a challenge.`) }],
      'turning-point': [{ headline: t('Et puis, *tout a changé*.', 'And then, *everything changed*.'), subheadline: ctx.subject, narration: t('Et puis, tout a changé.', 'And then, everything changed.') }],
      resolution: [{ headline: t('Un *nouveau départ*', 'A *new beginning*'), body: t('Pas à pas, l’avenir se dessine.', 'Step by step, the future takes shape.'), narration: t('Pas à pas, l’avenir se dessine.', 'Step by step, the future takes shape.'), visualKeywords: ['success', 'smile', 'people', ctx.location] }],
      message: [{ headline: t('Chaque parcours *compte*', 'Every journey *matters*'), subheadline: ctx.subject, narration: t('Parce que chaque parcours compte.', 'Because every journey matters.') }],
      outro: [{ headline: `*${ctx.subject}*`, subheadline: t('Écrivez la suite', 'Write what comes next'), narration: t('Écrivez la suite.', 'Write what comes next.') }],
    };
  },
};
