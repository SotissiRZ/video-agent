// Legal pages (terms, privacy, legal notice), filled with the operator's details from the server.
// These texts are a starting point: have them reviewed for your company and country.
import { $, api, escapeHtml, initChrome, onLanguageChange } from './common.js';
import { getLang } from './i18n.js';

const TEXT = {
  fr: {
    nav: { terms: 'Conditions d’utilisation', privacy: 'Confidentialité', notice: 'Mentions légales' },
    updated: 'Dernière mise à jour',
    terms: (c) => `
      <h2 id="terms">Conditions générales d’utilisation</h2>
      <h3>1. Objet</h3>
      <p>${c.name} (« nous ») met à disposition un service en ligne de création de vidéos assistée par intelligence artificielle et de publication sur les réseaux sociaux (le « Service »). L’utilisation du Service implique l’acceptation des présentes conditions.</p>
      <h3>2. Compte</h3>
      <p>Vous devez fournir une adresse e-mail valide et garder votre mot de passe confidentiel. Vous êtes responsable de l’activité de votre compte. Vous pouvez le supprimer à tout moment depuis « Mon compte ».</p>
      <h3>3. Offres et paiement</h3>
      <p>Le Service propose une offre gratuite limitée et des abonnements mensuels payants, décrits sur la page Tarifs. Les paiements sont traités par Stripe. Les abonnements se renouvellent chaque mois et peuvent être résiliés à tout moment depuis l’espace Abonnement ; la résiliation prend effet à la fin de la période payée. Les quotas non utilisés ne sont pas reportés.</p>
      <h3>4. Contenus</h3>
      <p>Vous conservez vos droits sur les descriptions, logos et textes que vous fournissez, et vous nous autorisez à les traiter pour produire vos vidéos. Les vidéos générées vous appartiennent, sous réserve des licences des médias tiers qu’elles contiennent (photos et clips des banques Pexels, Pixabay et Unsplash, dont les crédits sont fournis avec chaque vidéo). Vous vous engagez à ne pas créer de contenus illicites, trompeurs, haineux, portant atteinte aux droits de tiers (marques, droit à l’image, droit d’auteur) ou contraires aux règles des réseaux sociaux.</p>
      <h3>5. Publication sur les réseaux sociaux</h3>
      <p>Lorsque vous connectez un compte (YouTube, TikTok, Facebook, Instagram, LinkedIn), vous nous autorisez à y publier les vidéos que vous choisissez, aux dates que vous fixez. Vous restez responsable des publications et du respect des conditions de chaque plateforme. Vous pouvez déconnecter un compte à tout moment.</p>
      <h3>6. Intelligence artificielle</h3>
      <p>Les textes, voix et images sont produits automatiquement et peuvent comporter des erreurs. Relisez chaque vidéo avant de la publier.</p>
      <h3>7. Disponibilité et responsabilité</h3>
      <p>Nous faisons notre possible pour assurer la disponibilité du Service, sans garantie d’absence d’interruption. ${c.retention ? `Les vidéos sont conservées ${c.retention} jours, puis supprimées : téléchargez celles que vous souhaitez garder. ` : ''}Notre responsabilité est limitée aux sommes versées au cours des douze derniers mois.</p>
      <h3>8. Suspension</h3>
      <p>Nous pouvons suspendre un compte en cas de manquement grave aux présentes conditions, après notification sauf urgence.</p>
      <h3>9. Contact et droit applicable</h3>
      <p>Pour toute question : ${c.contact}. Les présentes conditions sont régies par le droit du pays du siège de l’éditeur.</p>`,
    privacy: (c) => `
      <h2 id="privacy">Politique de confidentialité</h2>
      <p>Cette politique explique quelles données ${c.name} traite et pourquoi, conformément au Règlement général sur la protection des données (RGPD).</p>
      <h3>Données traitées</h3>
      <ul>
        <li><b>Compte</b> : e-mail, nom, mot de passe (stocké haché, jamais en clair), langue, offre.</li>
        <li><b>Contenus</b> : descriptions de vidéos, kit de marque (nom, couleurs, logo), vidéos générées et légendes.</li>
        <li><b>Comptes connectés</b> : jetons d’accès aux réseaux sociaux, stockés chiffrés.</li>
        <li><b>Paiement</b> : géré par Stripe ; nous ne conservons pas vos données de carte, seulement l’identifiant client et l’état de l’abonnement.</li>
        <li><b>Technique</b> : cookie de session (connexion) et préférences d’affichage enregistrées dans votre navigateur (thème, langue). Aucun cookie publicitaire ni de mesure d’audience tierce.</li>
      </ul>
      <h3>Finalités et bases légales</h3>
      <p>Fournir le Service et gérer votre compte (exécution du contrat), facturer (obligation légale), sécuriser le Service (intérêt légitime).</p>
      <h3>Destinataires et sous-traitants</h3>
      <p>Pour produire vos vidéos, vos descriptions et textes sont transmis aux services d’intelligence artificielle (rédaction, voix, images) et de banques d’images configurés sur la plateforme ; vos vidéos sont envoyées aux réseaux sociaux que vous choisissez ; les paiements passent par Stripe ; les e-mails par notre prestataire d’envoi. Certains prestataires peuvent être situés hors de l’Union européenne, avec les garanties prévues par le RGPD (clauses contractuelles types).</p>
      <h3>Durées de conservation</h3>
      <p>Données du compte : tant que le compte existe. ${c.retention ? `Vidéos : ${c.retention} jours. ` : 'Vidéos : jusqu’à leur suppression par vous ou du compte. '}Données de facturation : durée légale. Les données sont effacées à la suppression du compte.</p>
      <h3>Vos droits</h3>
      <p>Accès, rectification, effacement (bouton « Supprimer mon compte »), limitation, opposition et portabilité : écrivez à ${c.contact}. Vous pouvez saisir l’autorité de protection des données de votre pays.</p>`,
    notice: (c) => `
      <h2 id="notice">Mentions légales</h2>
      <p><b>Éditeur</b> : ${c.name}${c.address ? `, ${c.address}` : ''}.<br>Contact : ${c.contact}${c.url ? `<br>Site : ${c.url}` : ''}</p>
      <p><b>Hébergement</b> : le Service est hébergé sur un serveur dédié opéré par l’éditeur ; les coordonnées de l’hébergeur sont disponibles sur demande.</p>
      <p><b>Médias</b> : photos et vidéos des banques Pexels, Pixabay et Unsplash, utilisées selon leurs licences ; les crédits figurent avec chaque vidéo.</p>`,
  },
  en: {
    nav: { terms: 'Terms of use', privacy: 'Privacy', notice: 'Legal notice' },
    updated: 'Last updated',
    terms: (c) => `
      <h2 id="terms">Terms of use</h2>
      <h3>1. Purpose</h3>
      <p>${c.name} (“we”) provides an online service to create videos with artificial intelligence and publish them on social networks (the “Service”). Using the Service means accepting these terms.</p>
      <h3>2. Account</h3>
      <p>You must provide a valid email address and keep your password confidential. You are responsible for your account’s activity. You can delete it at any time from “My account”.</p>
      <h3>3. Plans and payment</h3>
      <p>The Service offers a limited free plan and paid monthly subscriptions described on the Pricing page. Payments are processed by Stripe. Subscriptions renew monthly and can be cancelled at any time from the Billing page; cancellation takes effect at the end of the paid period. Unused quotas do not roll over.</p>
      <h3>4. Content</h3>
      <p>You keep your rights on the descriptions, logos and texts you provide and allow us to process them to produce your videos. Generated videos belong to you, subject to the licences of the third-party media they contain (photos and clips from Pexels, Pixabay and Unsplash, credited with each video). You agree not to create unlawful, misleading or hateful content, content infringing third-party rights (trademarks, image rights, copyright) or breaking social network rules.</p>
      <h3>5. Social media publishing</h3>
      <p>When you connect an account (YouTube, TikTok, Facebook, Instagram, LinkedIn), you allow us to publish the videos you choose, at the dates you set. You remain responsible for your posts and for complying with each platform’s terms. You can disconnect an account at any time.</p>
      <h3>6. Artificial intelligence</h3>
      <p>Texts, voices and images are generated automatically and may contain mistakes. Review each video before publishing it.</p>
      <h3>7. Availability and liability</h3>
      <p>We do our best to keep the Service available, without guaranteeing it will never be interrupted. ${c.retention ? `Videos are kept for ${c.retention} days and then deleted: download those you want to keep. ` : ''}Our liability is limited to the amounts paid in the last twelve months.</p>
      <h3>8. Suspension</h3>
      <p>We may suspend an account in case of serious breach of these terms, after notice except in emergencies.</p>
      <h3>9. Contact and governing law</h3>
      <p>Questions: ${c.contact}. These terms are governed by the law of the publisher’s country of registration.</p>`,
    privacy: (c) => `
      <h2 id="privacy">Privacy policy</h2>
      <p>This policy explains what data ${c.name} processes and why, in line with the General Data Protection Regulation (GDPR).</p>
      <h3>Data we process</h3>
      <ul>
        <li><b>Account</b>: email, name, password (stored hashed, never in clear), language, plan.</li>
        <li><b>Content</b>: video descriptions, brand kit (name, colours, logo), generated videos and captions.</li>
        <li><b>Connected accounts</b>: social network access tokens, stored encrypted.</li>
        <li><b>Payment</b>: handled by Stripe; we do not keep card details, only the customer id and subscription status.</li>
        <li><b>Technical</b>: session cookie (sign-in) and display preferences stored in your browser (theme, language). No advertising cookies or third-party analytics.</li>
      </ul>
      <h3>Purposes and legal bases</h3>
      <p>Providing the Service and managing your account (contract), billing (legal obligation), securing the Service (legitimate interest).</p>
      <h3>Recipients and processors</h3>
      <p>To produce your videos, your descriptions and texts are sent to the artificial intelligence services (copywriting, voice, images) and stock libraries configured on the platform; your videos are sent to the social networks you choose; payments go through Stripe; emails through our email provider. Some providers may be located outside the European Union, with GDPR safeguards (standard contractual clauses).</p>
      <h3>Retention</h3>
      <p>Account data: as long as the account exists. ${c.retention ? `Videos: ${c.retention} days. ` : 'Videos: until you delete them or your account. '}Billing data: legal period. Data is erased when the account is deleted.</p>
      <h3>Your rights</h3>
      <p>Access, rectification, erasure (“Delete my account” button), restriction, objection and portability: write to ${c.contact}. You can complain to your country’s data protection authority.</p>`,
    notice: (c) => `
      <h2 id="notice">Legal notice</h2>
      <p><b>Publisher</b>: ${c.name}${c.address ? `, ${c.address}` : ''}.<br>Contact: ${c.contact}${c.url ? `<br>Website: ${c.url}` : ''}</p>
      <p><b>Hosting</b>: the Service runs on a dedicated server operated by the publisher; the host’s details are available on request.</p>
      <p><b>Media</b>: photos and videos from Pexels, Pixabay and Unsplash, used under their licences; credits are provided with each video.</p>`,
  },
};

let company = { name: 'SOVID AI', address: '', email: '', url: '' };
let retention = 0;

const render = () => {
  const lang = getLang();
  const L = TEXT[lang];
  const c = {
    name: escapeHtml(company.name),
    address: escapeHtml(company.address),
    url: escapeHtml(company.url),
    contact: company.email ? `<a href="mailto:${escapeHtml(company.email)}">${escapeHtml(company.email)}</a>` : escapeHtml(lang === 'fr' ? 'le formulaire de contact du site' : 'the website contact form'),
    retention,
  };
  document.querySelectorAll('[data-legal-link]').forEach((a) => (a.textContent = L.nav[a.dataset.legalLink]));
  $('legal').innerHTML = `<div class="card legal-card">${L.terms(c)}</div><div class="card legal-card">${L.privacy(c)}</div><div class="card legal-card">${L.notice(c)}</div>`;
  $('brandName').textContent = company.name;
  $('footerName').textContent = company.name;
  document.title = `${L.nav.terms} · ${company.name}`;
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
};

initChrome();
$('year').textContent = new Date().getFullYear();
onLanguageChange(render);
render();
api('/api/public/config')
  .then((cfg) => {
    company = { ...company, ...cfg.company };
    retention = cfg.retentionDays ?? 0;
    render();
  })
  .catch(() => undefined);
