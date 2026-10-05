import { audienceLine, tr } from '../helpers';
import type { TemplateDefinition } from '../types';

/** Short-form social video: scroll-stopping hook → 3 punchy points → follow CTA. */
export const socialMedia: TemplateDefinition = {
  id: 'social-media',
  name: 'Réseaux sociaux',
  description: 'Format court et rythmé pour TikTok, Reels, Shorts : accroche forte, points percutants, abonnement.',
  keywords: ['reseaux sociaux', 'social', 'social media', 'tiktok', 'reels', 'reel', 'shorts', 'instagram', 'viral', 'stories', 'story', 'facebook', 'linkedin', 'post', 'buzz', 'tendance', 'trend'],
  defaultStyle: 'vibrant',
  defaultFormat: 'vertical',
  defaultDurationSec: 20,
  scenes: [
    { role: 'hook', kind: 'title', weight: 1, purpose: 'Scroll-stopping hook (question or bold statement), max 6 words.' },
    { role: 'point', kind: 'text', weight: 1, repeatable: true, purpose: 'One punchy idea per scene, max 7 words.' },
    { role: 'list', kind: 'bullets', weight: 1.2, optional: true, purpose: 'Quick list of 3 tips/benefits.' },
    { role: 'cta', kind: 'cta', weight: 0.9, purpose: 'Follow / like / share call to action.' },
  ],
  guidance: 'Very short lines, rhythm, direct address, emotion. One idea per scene.',
  concept(ctx) {
    const t = tr(ctx);
    return {
      title: t(`${ctx.subject} en 3 points`, `${ctx.subject} in 3 points`),
      idea: t(`Un format court et rythmé autour de ${ctx.subject}.`, `A short, punchy video about ${ctx.subject}.`),
      angle: t('Une idée par plan, un rythme soutenu.', 'One idea per shot, fast rhythm.'),
      tone: t('Fun, direct, rythmé', 'Fun, direct, punchy'),
      keyMessage: t(`${ctx.subject}, ça change tout.`, `${ctx.subject} changes everything.`),
      callToAction: t('Abonnez-vous', 'Follow for more'),
      tagline: t('Partagez si vous aimez !', 'Share if you like it!'),
    };
  },
  copy(ctx) {
    const t = tr(ctx);
    const who = audienceLine(ctx);
    return {
      hook: [{ subheadline: who, headline: t(`Vous connaissez *${ctx.subject}* ?`, `Do you know *${ctx.subject}*?`), narration: t(`Vous connaissez ${ctx.subject} ?`, `Do you know ${ctx.subject}?`) }],
      point: [
        { headline: t('Ça va *vous plaire*', 'You’re going to *love it*'), narration: t('Ça va vous plaire.', 'You’re going to love it.') },
        { headline: t('Simple, rapide, *efficace*', 'Simple, fast, *effective*'), narration: t('Simple, rapide, efficace.', 'Simple, fast, effective.') },
        { headline: t('Et c’est *pour vous*', 'And it’s *for you*'), narration: t('Et c’est pour vous.', 'And it’s for you.') },
      ],
      list: [{ headline: t('Les *3 raisons*', '*3 reasons*'), items: t('Gain de temps|Zéro prise de tête|Résultats visibles', 'Saves time|Zero hassle|Visible results').split('|'), narration: t('Gain de temps, zéro prise de tête, résultats visibles.', 'Saves time, zero hassle, visible results.') }],
      cta: [{ headline: t('*Abonnez-vous* pour la suite', '*Follow* for more'), subheadline: t('Suivre', 'Follow'), body: t('Partagez si vous aimez !', 'Share if you like it!'), narration: t('Abonnez-vous et partagez si vous aimez !', 'Follow for more and share if you like it!') }],
    };
  },
};
