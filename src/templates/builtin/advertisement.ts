import { audienceLine, forAudience, sentences, tr } from '../helpers';
import type { TemplateDefinition } from '../types';

/** Classic AIDA ad: hook → problem → solution → benefits → proof → call to action. */
export const advertisement: TemplateDefinition = {
  id: 'advertisement',
  name: 'Publicité',
  description: 'Spot publicitaire persuasif (accroche, problème, solution, bénéfices, appel à l’action).',
  keywords: ['pub', 'publicite', 'publicitaire', 'promouvoir', 'promotion', 'promo', 'campagne', 'marketing', 'spot', 'advert', 'advertisement', 'ad', 'ads', 'promote', 'commercial', 'vendre', 'sell', 'convaincre', 'faire connaitre'],
  strongKeywords: ['promouvoir', 'publicite', 'pub', 'promote', 'advertisement', 'advert'],
  defaultStyle: 'vibrant',
  defaultDurationSec: 30,
  scenes: [
    { role: 'hook', kind: 'title', weight: 1, purpose: 'Grab attention in the first 2 seconds by speaking directly to the audience.' },
    { role: 'problem', kind: 'text', weight: 1.1, optional: true, purpose: 'Name the pain point or frustration of the audience.' },
    { role: 'solution', kind: 'title', weight: 1.1, purpose: 'Introduce the brand/product as the answer.' },
    { role: 'benefits', kind: 'bullets', weight: 1.5, repeatable: true, purpose: 'Three short, concrete benefits (max 4 words each).' },
    { role: 'proof', kind: 'image', weight: 1, optional: true, purpose: 'Visual moment that makes the promise tangible (people, usage, place).' },
    { role: 'cta', kind: 'cta', weight: 1.1, purpose: 'Clear call to action with a short button label.' },
  ],
  guidance: 'Persuasive, benefit-driven, short sentences. Speak to the audience with "vous"/"you". No invented statistics.',
  concept(ctx) {
    const t = tr(ctx);
    return {
      title: t(`${ctx.subject} — publicité`, `${ctx.subject} — ad`),
      idea: t(`Montrer comment ${ctx.subject} simplifie le quotidien ${forAudience(ctx)}${ctx.locationPhrase ? ' ' + ctx.locationPhrase : ''}.`, `Show how ${ctx.subject} makes life easier ${forAudience(ctx)}${ctx.locationPhrase ? ' ' + ctx.locationPhrase : ''}.`),
      angle: t('Du problème du quotidien à la solution, en quelques secondes.', 'From an everyday problem to the solution, in seconds.'),
      tone: t('Énergique, direct et positif', 'Energetic, direct and positive'),
      keyMessage: t(`${ctx.subject}, pensé ${forAudience(ctx)}.`, `${ctx.subject}, built ${forAudience(ctx)}.`),
      callToAction: t(`Essayez ${ctx.subject} dès aujourd'hui`, `Try ${ctx.subject} today`),
      tagline: t('Simple. Rapide. Fiable.', 'Simple. Fast. Reliable.'),
    };
  },
  copy(ctx) {
    const t = tr(ctx);
    const who = audienceLine(ctx);
    const loc = ctx.locationPhrase ? ` ${ctx.locationPhrase}` : '';
    return {
      hook: [{
        subheadline: who,
        headline: t('Et si votre quotidien devenait *plus simple* ?', 'What if your day got *a lot easier*?'),
        narration: sentences(who && `${who},`, t('et si votre quotidien devenait plus simple ?', 'what if your day got a lot easier?')).replace(/,\./, ','),
        visualKeywords: [ctx.audience, ctx.location, 'people'],
      }],
      problem: [{
        headline: t('Moins de temps perdu, *plus de résultats*', 'Less time wasted, *more results*'),
        body: t('Chaque minute compte. Vous méritez un outil qui travaille pour vous.', 'Every minute counts. You deserve a tool that works for you.'),
        narration: t('Chaque minute compte. Vous méritez un outil qui travaille pour vous.', 'Every minute counts. You deserve a tool that works for you.'),
        visualKeywords: [ctx.audience, 'city'],
      }],
      solution: [{
        subheadline: t('La solution', 'Meet'),
        headline: t(`Découvrez *${ctx.subject}*`, `Meet *${ctx.subject}*`),
        body: t(`Pensé ${forAudience(ctx)}${loc}.`, `Built ${forAudience(ctx)}${loc}.`),
        narration: t(`Découvrez ${ctx.subject}, pensé ${forAudience(ctx)}${loc}.`, `Meet ${ctx.subject}, built ${forAudience(ctx)}${loc}.`),
        visualKeywords: [ctx.brand, 'logo', 'product'],
      }],
      benefits: [
        {
          headline: t(`Pourquoi *${ctx.subject}* ?`, `Why *${ctx.subject}*?`),
          items: t('Simple à utiliser|Rapide et fiable|Pensé pour vous', 'Easy to use|Fast and reliable|Built for you').split('|'),
          narration: t('Simple à utiliser, rapide, fiable, et pensé pour vous.', 'Easy to use, fast, reliable, and built for you.'),
        },
        {
          headline: t('Tout ce qu’il vous faut', 'Everything you need'),
          items: t('Disponible partout|Accompagnement humain|Sans complication', 'Available everywhere|Human support|No hassle').split('|'),
          narration: t('Disponible partout, avec un accompagnement humain et sans complication.', 'Available everywhere, with human support and no hassle.'),
        },
      ],
      proof: [{
        headline: t('Avancez *plus loin*', 'Go *further*'),
        body: t(`Avec ${ctx.subject}, chaque journée compte davantage.`, `With ${ctx.subject}, every day counts for more.`),
        narration: t(`Avec ${ctx.subject}, chaque journée compte davantage.`, `With ${ctx.subject}, every day counts for more.`),
        visualKeywords: [ctx.audience, ctx.location, 'success', 'people'],
      }],
      cta: [{
        headline: t(`Essayez *${ctx.subject}* dès aujourd'hui`, `Try *${ctx.subject}* today`),
        subheadline: t('Je me lance', 'Get started'),
        body: t('Simple. Rapide. Fiable.', 'Simple. Fast. Reliable.'),
        narration: t(`Essayez ${ctx.subject} dès aujourd'hui.`, `Try ${ctx.subject} today.`),
      }],
    };
  },
};
