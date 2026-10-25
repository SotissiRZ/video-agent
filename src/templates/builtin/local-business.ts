import { LOCAL_BUSINESS_WORDS } from '../../prompt/business';
import { cap, sentences, tr } from '../helpers';
import type { CopyContext, TemplateDefinition } from '../types';

/** "riz gras et poulet braisé" / "rice and chicken" */
const list = (ctx: CopyContext, items: string[]): string => {
  const words = items.map((i) => i.toLowerCase());
  if (words.length < 2) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} ${ctx.lang === 'fr' ? 'et' : 'and'} ${words.at(-1)}`;
};

/** "de riz gras" / "d'attiéké" */
const de = (word: string): string => (/^[aeiouyhàâéèêîôû]/i.test(word) ? `d'${word}` : `de ${word}`);

const details = (ctx: CopyContext) => {
  const b = ctx.business ?? { offers: [], perks: [] };
  const t = tr(ctx);
  const food = b.kind?.food ?? false;
  const loc = ctx.locationPhrase ? ` ${ctx.locationPhrase}` : '';
  const kind = b.kind ? t(b.kind.fr, b.kind.en) : '';
  const defaults = food
    ? t('Fait maison|Portions généreuses|Service rapide', 'Homemade|Generous portions|Fast service').split('|')
    : t('Service de qualité|Prix justes|Accueil chaleureux', 'Quality service|Fair prices|Warm welcome').split('|');
  return { ...b, food, loc, kind, kindEn: b.kind?.en, defaults };
};

/** Restaurants, shops, salons…: what they sell, where, and how to reach them. */
export const localBusiness: TemplateDefinition = {
  id: 'local-business',
  name: 'Commerce local',
  description: 'Publicité pour un commerce de proximité (restaurant, boutique, salon…) : spécialités, adresse, contact.',
  keywords: [...LOCAL_BUSINESS_WORDS, 'specialite', 'specialites', 'livraison', 'menu', 'plats', 'commander', 'commandez', 'quartier', 'delivery', 'dishes', 'takeaway'],
  // "café" is also the drink: a context word only.
  strongKeywords: LOCAL_BUSINESS_WORDS.filter((w) => w !== 'cafe'),
  defaultStyle: 'warm',
  defaultFormat: 'vertical',
  defaultDurationSec: 20,
  scenes: [
    { role: 'hook', kind: 'title', weight: 1, purpose: 'Make the viewer crave what the business sells, in a few words.' },
    { role: 'presentation', kind: 'title', weight: 1.1, purpose: 'Name the business, what kind of place it is and where it is.' },
    { role: 'offers', kind: 'bullets', weight: 1.5, repeatable: true, purpose: 'Its real specialities, products or services and practical perks (delivery, hours), as written in the brief.' },
    { role: 'proof', kind: 'image', weight: 1, optional: true, purpose: 'Appetising or inviting picture of the products or the place.' },
    { role: 'cta', kind: 'cta', weight: 1.2, purpose: 'How to order or come: the phone number from the brief when there is one.' },
  ],
  guidance: 'Local shop ad. Use the exact specialities, products, perks, address and phone number from the brief; never invent prices, dishes or numbers. Warm, appetising, concrete, short sentences.',
  concept(ctx) {
    const t = tr(ctx);
    const d = details(ctx);
    return {
      title: t(`${ctx.subject} — publicité`, `${ctx.subject} — ad`),
      idea: t(`Donner envie de découvrir ${ctx.subject}${d.loc}.`, `Make people want to try ${ctx.subject}${d.loc}.`),
      angle: t('L’envie d’abord, puis l’adresse et le contact.', 'Craving first, then the place and how to reach it.'),
      tone: t('Chaleureux, gourmand et direct', 'Warm, appetising and direct'),
      keyMessage: d.offers.length ? `${ctx.subject} : ${list(ctx, d.offers)}.` : t(`${ctx.subject}, près de chez vous.`, `${ctx.subject}, close to you.`),
      callToAction: d.phone ? t(`Appelez le ${d.phone}`, `Call ${d.phone}`) : t('Venez nous voir', 'Come and see us'),
      tagline: d.food ? t('Bon. Généreux. Près de chez vous.', 'Tasty. Generous. Close to you.') : t('Qualité. Accueil. Proximité.', 'Quality. Welcome. Close by.'),
    };
  },
  copy(ctx) {
    const t = tr(ctx);
    const d = details(ctx);
    const first = d.offers[0]?.toLowerCase();
    // Elision is decided on the word itself: "Envie de *riz gras*", "Envie d'*attiéké*".
    const hook = first
      ? { fr: `${d.food ? 'Envie' : 'Besoin'} ${de(first).replace(first, `*${first}*`)} ?`, en: d.food ? `Craving *${first}*?` : `Looking for *${first}*?` }
      : d.food
        ? { fr: 'Une petite *faim* ?', en: 'Feeling *hungry*?' }
        : { fr: `Le bon plan *${ctx.locationPhrase || 'près de chez vous'}*`, en: `The place to be *${ctx.locationPhrase || 'near you'}*` };
    const offers = [...(d.offers.length ? d.offers : d.defaults), ...d.perks].slice(0, 4);
    const more = d.perks.length && d.offers.length ? d.defaults : [...d.defaults].reverse();
    const visuals = [...d.offers, d.kindEn ?? '', ctx.location].filter(Boolean);
    return {
      hook: [{
        subheadline: cap(ctx.locationPhrase),
        headline: t(hook.fr, hook.en),
        narration: sentences(t(hook.fr, hook.en)),
        visualKeywords: visuals,
      }],
      presentation: [{
        subheadline: cap(d.kind) || t('Votre adresse', 'Your place'),
        headline: `*${ctx.subject}*`,
        body: cap(ctx.locationPhrase),
        narration: d.kind
          ? t(`${ctx.subject}, votre ${d.kind}${d.loc}.`, `${ctx.subject}, your ${d.kind}${d.loc}.`)
          : t(`${ctx.subject}, votre adresse${d.loc}.`, `${ctx.subject}, your place${d.loc}.`),
        visualKeywords: [d.kindEn ?? '', ctx.location, 'storefront'].filter(Boolean),
      }],
      offers: [
        {
          headline: d.offers.length ? (d.food ? t('Nos *spécialités*', 'Our *specialities*') : t('Ce que nous *proposons*', 'What we *offer*')) : t(`Pourquoi *${ctx.subject}* ?`, `Why *${ctx.subject}*?`),
          items: offers,
          narration: d.offers.length
            ? sentences(d.food ? t(`Au menu : ${list(ctx, d.offers)}`, `On the menu: ${list(ctx, d.offers)}`) : t(`Chez nous : ${list(ctx, d.offers)}`, `We offer ${list(ctx, d.offers)}`), d.perks.length > 0 && cap(list(ctx, d.perks)))
            : sentences(cap(list(ctx, offers))),
          visualKeywords: visuals,
        },
        {
          headline: t('Et en *plus*', 'And *more*'),
          items: more,
          narration: sentences(cap(list(ctx, more))),
        },
      ],
      proof: [{
        headline: d.food ? t('Fait *avec amour*', 'Made *with love*') : t('La qualité *avant tout*', 'Quality *first*'),
        body: d.food ? t('Des plats préparés chaque jour.', 'Dishes cooked every day.') : t('Un service soigné, à chaque visite.', 'Careful service, every visit.'),
        narration: d.food ? t('Des plats préparés chaque jour, avec amour.', 'Dishes cooked every day, with love.') : t('Un service soigné, à chaque visite.', 'Careful service, every visit.'),
        visualKeywords: visuals,
      }],
      cta: [d.phone
        ? {
          subheadline: d.food ? t('Commander', 'Order now') : t('Nous contacter', 'Contact us'),
          headline: t(`Appelez le *${d.phone}*`, `Call *${d.phone}*`),
          body: d.perks[0] ?? `${ctx.subject}${d.loc}`,
          narration: sentences(d.food ? t(`Commandez dès maintenant au ${d.phone}`, `Order now on ${d.phone}`) : t(`Contactez-nous au ${d.phone}`, `Call us on ${d.phone}`)),
        }
        : {
          subheadline: t('On vous attend', 'See you soon'),
          headline: d.food ? t('Venez *goûter* !', 'Come and *taste*!') : t('Passez nous *voir* !', 'Come and *visit*!'),
          body: `${ctx.subject}${d.loc}`,
          narration: sentences(t(`${ctx.subject}${d.loc ? ',' + d.loc : ''} : on vous attend !`, `${ctx.subject}${d.loc ? ',' + d.loc : ''}: see you soon!`)),
        }],
    };
  },
};
