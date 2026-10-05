import { forAudience, sentences, tr } from '../helpers';
import type { TemplateDefinition } from '../types';

/** Product showcase: intro → what it is → key features → how it works → CTA. */
export const productPresentation: TemplateDefinition = {
  id: 'product-presentation',
  name: 'Présentation produit',
  description: 'Mise en valeur d’un produit ou service : présentation, fonctionnalités clés, fonctionnement.',
  keywords: ['presentation produit', 'presenter', 'presentation', 'produit', 'product', 'fonctionnalites', 'features', 'showcase', 'decouvrir', 'nouveau produit', 'gamme', 'collection', 'offre', 'service'],
  defaultStyle: 'modern',
  defaultDurationSec: 45,
  scenes: [
    { role: 'intro', kind: 'title', weight: 1, purpose: 'Introduce the product name with a promise.' },
    { role: 'overview', kind: 'text', weight: 1.1, purpose: 'One sentence: what the product is and for whom.' },
    { role: 'features', kind: 'bullets', weight: 1.5, repeatable: true, purpose: 'Key features, 3 items, max 5 words each.' },
    { role: 'highlight', kind: 'image', weight: 1.1, optional: true, repeatable: true, purpose: 'Visual highlight of one standout feature.' },
    { role: 'how', kind: 'steps', weight: 1.4, optional: true, purpose: 'How it works in 3 steps.' },
    { role: 'cta', kind: 'cta', weight: 1, purpose: 'Where to get it / call to action.' },
  ],
  guidance: 'Clear, informative and confident. Concrete feature names. No invented numbers.',
  concept(ctx) {
    const t = tr(ctx);
    return {
      title: t(`Présentation de ${ctx.subject}`, `Introducing ${ctx.subject}`),
      idea: t(`Présenter ${ctx.subject} et ses atouts ${forAudience(ctx)}.`, `Present ${ctx.subject} and its strengths ${forAudience(ctx)}.`),
      angle: t('Clair et concret : ce que c’est, ce que ça fait, comment l’obtenir.', 'Clear and concrete: what it is, what it does, how to get it.'),
      tone: t('Confiant et informatif', 'Confident and informative'),
      keyMessage: t(`${ctx.subject} : l’essentiel, sans compromis.`, `${ctx.subject}: everything that matters.`),
      callToAction: t(`Découvrez ${ctx.subject}`, `Discover ${ctx.subject}`),
      tagline: t('Conçu pour durer.', 'Built to last.'),
    };
  },
  copy(ctx) {
    const t = tr(ctx);
    return {
      intro: [{ subheadline: t('Nouveau', 'New'), headline: `*${ctx.subject}*`, body: t('Conçu pour durer.', 'Built to last.'), narration: t(`Voici ${ctx.subject}.`, `This is ${ctx.subject}.`), visualKeywords: [ctx.brand, 'product', 'logo'] }],
      overview: [{ headline: t(`L’essentiel, *${forAudience(ctx)}*`, `Everything that matters, *${forAudience(ctx)}*`), body: t(`${ctx.subject} réunit tout ce dont vous avez besoin, au même endroit.`, `${ctx.subject} brings everything you need together in one place.`), narration: t(`${ctx.subject} réunit tout ce dont vous avez besoin, au même endroit.`, `${ctx.subject} brings everything you need together in one place.`) }],
      features: [
        { headline: t('Fonctionnalités *clés*', 'Key *features*'), items: t('Prise en main immédiate|Performances fiables|Design soigné', 'Instant to pick up|Reliable performance|Thoughtful design').split('|'), narration: t('Une prise en main immédiate, des performances fiables et un design soigné.', 'Instant to pick up, reliable performance and a thoughtful design.') },
        { headline: t('Et ce n’est *pas tout*', 'And that’s *not all*'), items: t('Support réactif|Mises à jour régulières|Prix transparent', 'Responsive support|Regular updates|Transparent pricing').split('|'), narration: t('Un support réactif, des mises à jour régulières et un prix transparent.', 'Responsive support, regular updates and transparent pricing.') },
      ],
      highlight: [{ headline: t('Pensé dans *les moindres détails*', 'Designed down to *the last detail*'), narration: t('Chaque détail a été pensé pour vous.', 'Every detail was designed with you in mind.'), visualKeywords: ['product', 'detail', ctx.brand] }],
      how: [{ headline: t('Comment ça *marche* ?', 'How does it *work*?'), items: t('Choisissez|Configurez|Profitez', 'Choose|Set up|Enjoy').split('|'), narration: t('Choisissez, configurez, profitez. C’est aussi simple que ça.', 'Choose, set up, enjoy. It’s that simple.') }],
      cta: [{ headline: t(`Découvrez *${ctx.subject}*`, `Discover *${ctx.subject}*`), subheadline: t('En savoir plus', 'Learn more'), narration: sentences(t(`Découvrez ${ctx.subject} dès maintenant`, `Discover ${ctx.subject} now`)) }],
    };
  },
};
