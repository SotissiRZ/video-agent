import { sentences, tr } from '../helpers';
import type { TemplateDefinition } from '../types';

/** Announcement: teaser → reveal → details → date/place → CTA. */
export const announcement: TemplateDefinition = {
  id: 'announcement',
  name: 'Annonce',
  description: 'Annonce d’une nouveauté, d’un lancement ou d’un événement.',
  keywords: ['annonce', 'annoncer', 'announcement', 'announce', 'lancement', 'launch', 'nouveaute', 'ouverture', 'opening', 'evenement', 'event', 'inauguration', 'bientot', 'coming soon', 'save the date', 'arrive', 'disponible'],
  defaultStyle: 'elegant',
  defaultDurationSec: 20,
  scenes: [
    { role: 'teaser', kind: 'title', weight: 1, purpose: 'Build anticipation ("Big news!").' },
    { role: 'reveal', kind: 'title', weight: 1.2, purpose: 'Reveal what is announced, with the name in emphasis.' },
    { role: 'details', kind: 'bullets', weight: 1.4, optional: true, purpose: 'Three key details (what, where, when, who).' },
    { role: 'cta', kind: 'cta', weight: 1, purpose: 'What to do now (join, book, follow).' },
  ],
  guidance: 'Exciting but elegant. Short reveal. Use the actual date/place if the brief mentions them, otherwise stay generic.',
  concept(ctx) {
    const t = tr(ctx);
    return {
      title: t(`Annonce — ${ctx.subject}`, `Announcement — ${ctx.subject}`),
      idea: t(`Annoncer ${ctx.subject} de façon mémorable.`, `Announce ${ctx.subject} in a memorable way.`),
      angle: t('Créer l’attente puis révéler.', 'Build anticipation, then reveal.'),
      tone: t('Enthousiaste et élégant', 'Exciting and elegant'),
      keyMessage: t(`${ctx.subject} arrive${ctx.locationPhrase ? ' ' + ctx.locationPhrase : ''}.`, `${ctx.subject} is coming${ctx.locationPhrase ? ' ' + ctx.locationPhrase : ''}.`),
      callToAction: t('Soyez les premiers', 'Be the first'),
      tagline: t('Le moment est venu.', 'The time has come.'),
    };
  },
  copy(ctx) {
    const t = tr(ctx);
    return {
      teaser: [{ subheadline: t('Annonce', 'Announcement'), headline: t('Une *grande nouvelle*…', 'Big *news*…'), narration: t('Nous avons une grande nouvelle.', 'We have big news.') }],
      reveal: [{ headline: `*${ctx.subject}*`, body: ctx.locationPhrase ? t(`Arrive ${ctx.locationPhrase}`, `Coming ${ctx.locationPhrase}`) : t('Arrive bientôt', 'Coming soon'), narration: sentences(t(`${ctx.subject} arrive${ctx.locationPhrase ? ' ' + ctx.locationPhrase : ''}`, `${ctx.subject} is coming${ctx.locationPhrase ? ' ' + ctx.locationPhrase : ''}`)), visualKeywords: [ctx.brand, ctx.location] }],
      details: [{ headline: t('Ce qui vous *attend*', 'What’s *in store*'), items: t('Une expérience inédite|Pensée pour vous|À ne pas manquer', 'A brand-new experience|Designed for you|Not to be missed').split('|'), narration: t('Une expérience inédite, pensée pour vous, à ne pas manquer.', 'A brand-new experience, designed for you. Not to be missed.') }],
      cta: [{ headline: t('Soyez *les premiers*', 'Be *the first*'), subheadline: t('Restez informés', 'Stay tuned'), narration: t('Soyez les premiers. Restez informés.', 'Be the first. Stay tuned.') }],
    };
  },
};
