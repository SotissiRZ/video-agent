import { forAudience, tr } from '../helpers';
import type { TemplateDefinition } from '../types';

/** App demo: problem → app reveal → how it works (steps) → features → download CTA. */
export const appDemo: TemplateDefinition = {
  id: 'app-demo',
  name: 'Démonstration d’application',
  description: 'Démo d’application mobile/web : problème, présentation, parcours en étapes, fonctionnalités, téléchargement.',
  keywords: ['application', 'app', 'appli', 'demo', 'demonstration', 'interface', 'logiciel', 'software', 'saas', 'mobile app', 'application mobile', 'plateforme', 'platform', 'telecharger', 'download', 'android', 'ios', 'web app', 'dashboard'],
  strongKeywords: ['demo', 'demonstration', 'application mobile', 'mobile app'],
  defaultStyle: 'tech',
  defaultDurationSec: 45,
  scenes: [
    { role: 'hook', kind: 'title', weight: 1, purpose: 'Name the job the app does for the user.' },
    { role: 'problem', kind: 'text', weight: 1, optional: true, purpose: 'The friction users face without the app.' },
    { role: 'reveal', kind: 'image', weight: 1.2, purpose: 'App reveal (screenshot / UI visual if available).' },
    { role: 'how', kind: 'steps', weight: 1.6, repeatable: true, purpose: 'User journey in 3 steps (tap, choose, done).' },
    { role: 'features', kind: 'bullets', weight: 1.3, optional: true, purpose: 'Three standout features.' },
    { role: 'cta', kind: 'cta', weight: 1, purpose: 'Download / sign up call to action.' },
  ],
  guidance: 'Product-led, show the user journey concretely, short UI-style labels.',
  concept(ctx) {
    const t = tr(ctx);
    return {
      title: t(`Démo — ${ctx.subject}`, `Demo — ${ctx.subject}`),
      idea: t(`Montrer ${ctx.subject} en action, ${forAudience(ctx)}.`, `Show ${ctx.subject} in action, ${forAudience(ctx)}.`),
      angle: t('Le parcours utilisateur en trois gestes.', 'The user journey in three taps.'),
      tone: t('Moderne, clair, efficace', 'Modern, clear, efficient'),
      keyMessage: t(`Tout se fait en quelques clics avec ${ctx.subject}.`, `Everything takes a few taps with ${ctx.subject}.`),
      callToAction: t(`Téléchargez ${ctx.subject}`, `Download ${ctx.subject}`),
      tagline: t('Tout, dans votre poche.', 'Everything, in your pocket.'),
    };
  },
  copy(ctx) {
    const t = tr(ctx);
    return {
      hook: [{ subheadline: t('Application', 'App'), headline: t('Tout se fait *en quelques clics*', 'Everything in *a few taps*'), narration: t('Et si tout se faisait en quelques clics ?', 'What if everything took just a few taps?') }],
      problem: [{ headline: t('Fini les *complications*', 'No more *hassle*'), body: t('Plus besoin de jongler entre plusieurs outils.', 'No more juggling between tools.'), narration: t('Fini les complications : plus besoin de jongler entre plusieurs outils.', 'No more hassle, no more juggling between tools.') }],
      reveal: [{ headline: t(`Voici *${ctx.subject}*`, `Meet *${ctx.subject}*`), body: t(`L’application ${forAudience(ctx)}.`, `The app ${forAudience(ctx)}.`), narration: t(`Voici ${ctx.subject}, l’application ${forAudience(ctx)}.`, `Meet ${ctx.subject}, the app ${forAudience(ctx)}.`), visualKeywords: ['app', 'screenshot', 'phone', 'mobile', ctx.brand] }],
      how: [
        { headline: t('Comment ça *marche*', 'How it *works*'), items: t('Ouvrez l’application|Choisissez votre service|C’est fait !', 'Open the app|Pick your service|Done!').split('|'), narration: t('Ouvrez l’application, choisissez votre service, et c’est fait.', 'Open the app, pick your service, and you’re done.') },
        { headline: t('Et ensuite ?', 'What next?'), items: t('Suivez en temps réel|Recevez une notification|Donnez votre avis', 'Track in real time|Get notified|Leave feedback').split('|'), narration: t('Suivez en temps réel, recevez une notification et donnez votre avis.', 'Track in real time, get notified and leave feedback.') },
      ],
      features: [{ headline: t('Les *fonctionnalités*', 'Key *features*'), items: t('Interface intuitive|Notifications utiles|Données sécurisées', 'Intuitive interface|Useful notifications|Secure data').split('|'), narration: t('Une interface intuitive, des notifications utiles et des données sécurisées.', 'An intuitive interface, useful notifications and secure data.') }],
      cta: [{ headline: t(`Téléchargez *${ctx.subject}*`, `Download *${ctx.subject}*`), subheadline: t('Télécharger', 'Download'), body: t('Tout, dans votre poche.', 'Everything, in your pocket.'), narration: t(`Téléchargez ${ctx.subject} dès maintenant.`, `Download ${ctx.subject} now.`) }],
    };
  },
};
