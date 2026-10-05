import { sentences, tr } from '../helpers';
import type { TemplateDefinition } from '../types';

/** Tutorial: intro → what you'll learn → numbered steps → tip → recap. */
export const tutorial: TemplateDefinition = {
  id: 'tutorial',
  name: 'Tutoriel',
  description: 'Explication pas à pas : objectif, étapes numérotées, astuce, récapitulatif.',
  keywords: ['tutoriel', 'tuto', 'tutorial', 'comment', 'how to', 'guide', 'etapes', 'etape', 'steps', 'step by step', 'pas a pas', 'apprendre', 'learn', 'expliquer', 'explique', 'expliquant', 'explain', 'explaining', 'formation', 'mode d emploi', 'installer', 'configurer'],
  strongKeywords: ['tutoriel', 'tuto', 'tutorial', 'how to', 'comment', 'expliquant', 'explaining', 'pas a pas', 'step by step'],
  defaultStyle: 'corporate',
  defaultDurationSec: 60,
  scenes: [
    { role: 'intro', kind: 'title', weight: 1, purpose: 'State what the viewer will be able to do at the end.' },
    { role: 'overview', kind: 'bullets', weight: 1.2, optional: true, purpose: 'What you need / what you will learn (3 items).' },
    { role: 'steps', kind: 'steps', weight: 2, repeatable: true, purpose: 'Concrete numbered steps (3 per scene, imperative verbs, max 5 words).' },
    { role: 'tip', kind: 'text', weight: 1, optional: true, purpose: 'One pro tip or common mistake to avoid.' },
    { role: 'recap', kind: 'cta', weight: 1, purpose: 'Recap and invitation to try / follow for more.' },
  ],
  guidance: 'Pedagogical, precise, imperative verbs. Each step must be actionable. Use the real steps implied by the brief.',
  concept(ctx) {
    const t = tr(ctx);
    return {
      title: t(`Tutoriel : ${ctx.topic}`, `Tutorial: ${ctx.topic}`),
      idea: t(`Expliquer pas à pas : ${ctx.topic}.`, `Explain step by step: ${ctx.topic}.`),
      angle: t('Simple, progressif, sans jargon.', 'Simple, progressive, no jargon.'),
      tone: t('Pédagogique et rassurant', 'Educational and reassuring'),
      keyMessage: t('En quelques étapes, c’est fait.', 'A few steps and you’re done.'),
      callToAction: t('À vous de jouer', 'Your turn'),
      tagline: t('Simple comme 1, 2, 3.', 'Easy as 1, 2, 3.'),
    };
  },
  copy(ctx) {
    const t = tr(ctx);
    return {
      intro: [{ subheadline: t('Tutoriel', 'Tutorial'), headline: t(`*${ctx.topic}*`, `*${ctx.topic}*`), body: t('En quelques étapes simples.', 'In a few simple steps.'), narration: sentences(t(`Dans ce tutoriel : ${ctx.topic}, en quelques étapes simples`, `In this tutorial: ${ctx.topic}, in a few simple steps`)) }],
      overview: [{ headline: t('Ce dont vous avez *besoin*', 'What you *need*'), items: t('Quelques minutes|Votre appareil|Un peu de curiosité', 'A few minutes|Your device|A little curiosity').split('|'), narration: t('Il vous faut quelques minutes, votre appareil et un peu de curiosité.', 'All you need is a few minutes, your device and a little curiosity.') }],
      steps: [
        { headline: t('Les *étapes*', 'The *steps*'), items: t('Préparez votre espace|Suivez les instructions|Vérifiez le résultat', 'Get set up|Follow the instructions|Check the result').split('|'), narration: t('Préparez votre espace, suivez les instructions, puis vérifiez le résultat.', 'Get set up, follow the instructions, then check the result.') },
        { headline: t('Pour *aller plus loin*', 'Going *further*'), items: t('Personnalisez|Enregistrez|Partagez', 'Customize|Save|Share').split('|'), narration: t('Ensuite, personnalisez, enregistrez et partagez.', 'Then customize, save and share.') },
      ],
      tip: [{ subheadline: t('Astuce', 'Pro tip'), headline: t('Prenez votre *temps*', 'Take your *time*'), body: t('Chaque étape compte : vérifiez avant de passer à la suivante.', 'Every step matters: check before moving on.'), narration: t('Astuce : vérifiez chaque étape avant de passer à la suivante.', 'Pro tip: check each step before moving on.') }],
      recap: [{ headline: t('Et voilà, *c’est fait* !', 'And you’re *done*!'), subheadline: t('À vous de jouer', 'Your turn'), narration: t('Et voilà, c’est fait ! À vous de jouer.', 'And you’re done! Your turn.') }],
    };
  },
};
