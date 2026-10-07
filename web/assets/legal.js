// Legal pages: legal notice, terms of use, terms of sale, privacy policy and AI policy.
// Filled with the publisher's details and the services actually configured on the server
// (/api/public/config), so the texts never promise or list something the platform does not do.
// They follow common practice for SaaS in francophone Africa and the EU (GDPR); have them
// reviewed by a lawyer of your country before a commercial launch.
import { $, api, escapeHtml, initChrome, onLanguageChange } from './common.js';
import { getLang } from './i18n.js';

/** Data protection authorities of the countries most likely to host the publisher. */
const AUTHORITIES = {
  'burkina faso': { fr: 'la Commission de l’Informatique et des Libertés (CIL)', en: 'the Commission de l’Informatique et des Libertés (CIL)' },
  'sénégal': { fr: 'la Commission de Protection des Données Personnelles (CDP)', en: 'the Commission de Protection des Données Personnelles (CDP)' },
  senegal: { fr: 'la Commission de Protection des Données Personnelles (CDP)', en: 'the Commission de Protection des Données Personnelles (CDP)' },
  "côte d'ivoire": { fr: 'l’Autorité de Régulation des Télécommunications/TIC de Côte d’Ivoire (ARTCI)', en: 'the ARTCI (Côte d’Ivoire)' },
  'côte d’ivoire': { fr: 'l’Autorité de Régulation des Télécommunications/TIC de Côte d’Ivoire (ARTCI)', en: 'the ARTCI (Côte d’Ivoire)' },
  mali: { fr: 'l’Autorité de Protection des Données à caractère Personnel (APDP)', en: 'the APDP (Mali)' },
  'bénin': { fr: 'l’Autorité de Protection des Données Personnelles (APDP)', en: 'the APDP (Benin)' },
  benin: { fr: 'l’Autorité de Protection des Données Personnelles (APDP)', en: 'the APDP (Benin)' },
  togo: { fr: 'l’Instance de Protection des Données à Caractère Personnel (IPDCP)', en: 'the IPDCP (Togo)' },
  niger: { fr: 'la Haute Autorité de Protection des Données à caractère Personnel (HAPDP)', en: 'the HAPDP (Niger)' },
  maroc: { fr: 'la Commission Nationale de contrôle de la protection des Données à caractère Personnel (CNDP)', en: 'the CNDP (Morocco)' },
  morocco: { fr: 'la CNDP', en: 'the CNDP (Morocco)' },
  france: { fr: 'la Commission Nationale de l’Informatique et des Libertés (CNIL)', en: 'the CNIL (France)' },
};

const PURPOSES = {
  fr: { ai_text: 'rédaction des scripts, paroles et légendes', voice_music: 'voix-off, voix clonées et chansons', ai_images: 'génération d’images', stock: 'recherche de photos et vidéos libres de droits', payment: 'paiement', email: 'envoi des e-mails de service' },
  en: { ai_text: 'writing scripts, lyrics and captions', voice_music: 'voice-over, cloned voices and songs', ai_images: 'image generation', stock: 'royalty-free photo and video search', payment: 'payment', email: 'service e-mails' },
};

const UPDATED = { fr: '7 octobre 2026', en: 'October 7, 2026' };

const TEXT = {
  fr: {
    title: 'Informations légales',
    nav: { notice: 'Mentions légales', terms: 'Conditions d’utilisation', sales: 'Conditions de vente', privacy: 'Confidentialité', ai: 'IA et voix' },
    updated: 'Dernière mise à jour',
    notice: (c) => `
      <h2 id="notice">Mentions légales</h2>
      <p><b>Éditeur du service</b> : ${c.name}${c.registration ? `, ${c.registration}` : ''}${c.address ? `<br>Siège : ${c.address}` : ''}${c.country ? `, ${c.country}` : ''}.</p>
      ${c.director ? `<p><b>Directeur de la publication</b> : ${c.director}.</p>` : ''}
      <p><b>Contact</b> : ${c.contact}${c.url ? `<br><b>Site</b> : ${c.url}` : ''}</p>
      ${c.hosting ? `<p><b>Hébergement</b> : ${c.hosting}.</p>` : ''}
      <p><b>Propriété intellectuelle</b> : la marque, le site, son code et ses textes appartiennent à l’éditeur. Les vidéos et chansons créées par les utilisateurs leur sont attribuées selon les conditions ci-dessous.</p>`,
    terms: (c) => `
      <h2 id="terms">Conditions générales d’utilisation</h2>
      <h3>1. Objet et acceptation</h3>
      <p>${c.name} (« nous ») fournit un service en ligne de création de vidéos et de chansons assistée par intelligence artificielle, avec téléchargement et, selon l’offre, publication sur les réseaux sociaux (le « Service »). La création d’un compte vaut acceptation des présentes conditions, des conditions de vente et de la politique de confidentialité, dans leur version en vigueur.</p>
      <h3>2. Accès au Service</h3>
      <p>Le Service est réservé aux personnes âgées d’au moins 18 ans, ou agissant pour le compte d’une entreprise. Vous fournissez une adresse e-mail valide, gardez votre mot de passe confidentiel et répondez de l’activité de votre compte. Vous pouvez supprimer votre compte à tout moment depuis « Mon compte ».</p>
      <h3>3. Utilisation acceptable</h3>
      <p>Il est interdit d’utiliser le Service pour créer ou diffuser des contenus :</p>
      <ul>
        <li>illicites, haineux, discriminatoires, violents, à caractère sexuel impliquant des mineurs ou portant atteinte à la dignité humaine ;</li>
        <li>trompeurs : fausses promotions, faux témoignages, arnaques, usurpation d’identité d’une personne, d’une marque ou d’une institution ;</li>
        <li>imitant la voix, l’image ou le nom d’une personne réelle sans son autorisation écrite, ou présentant de faux propos comme authentiques (« deepfakes ») ;</li>
        <li>portant atteinte aux droits de tiers : marques, droit d’auteur (paroles, musiques ou œuvres existantes), droit à l’image, secrets d’affaires ;</li>
        <li>relevant de la publicité réglementée sans respecter la loi applicable (santé, médicaments, alcool, jeux d’argent, produits financiers, politique) ;</li>
        <li>contraires aux règles des réseaux sociaux sur lesquels vous publiez.</li>
      </ul>
      <p>Vous ne devez pas contourner les quotas, les filigranes ou les mesures de sécurité, ni créer plusieurs comptes pour multiplier l’offre gratuite.</p>
      <h3>4. Vos contenus</h3>
      <p>Vous conservez vos droits sur ce que vous fournissez (descriptions, photos de produits, logos, textes, enregistrements de voix) et garantissez disposer des droits nécessaires. Vous nous autorisez à les traiter, uniquement pour produire vos vidéos et chansons.</p>
      <h3>5. Vidéos et chansons générées</h3>
      <p>Dans la mesure permise par la loi, les vidéos et chansons que vous générez vous sont attribuées et vous pouvez les utiliser, y compris à des fins commerciales, une fois l’export obtenu (offre payante ou export payé). Les médias tiers qu’elles contiennent (photos et clips des banques d’images, dont les crédits sont fournis) restent soumis à leurs licences. Le filigrane de l’offre gratuite ne doit pas être retiré. Des contenus générés par IA peuvent ressembler à des contenus existants : vous vérifiez avant usage qu’ils ne portent atteinte aux droits de personne.</p>
      <h3>6. Publication sur les réseaux sociaux</h3>
      <p>Lorsque vous connectez un compte, vous nous autorisez à y publier les vidéos que vous choisissez, aux dates que vous fixez. Vous restez responsable de vos publications, du respect des règles de chaque plateforme et de l’indication « contenu généré par IA » qu’elles exigent. Vous pouvez déconnecter un compte à tout moment.</p>
      <h3>7. Disponibilité et conservation</h3>
      <p>Nous faisons notre possible pour assurer la disponibilité du Service, sans garantie d’absence d’interruption ni de résultat. ${c.retention ? `Les vidéos et chansons sont conservées ${c.retention} jours après leur création, puis supprimées : téléchargez celles que vous voulez garder.` : 'Téléchargez et sauvegardez les vidéos que vous voulez garder : le Service n’est pas un espace d’archivage.'}</p>
      <h3>8. Responsabilité</h3>
      <p>Les contenus générés automatiquement peuvent comporter des erreurs ; vous les relisez avant toute diffusion et en êtes responsable. Sauf faute lourde ou disposition légale contraire, notre responsabilité est limitée aux sommes que vous nous avez versées au cours des douze derniers mois. Vous nous garantissez contre toute réclamation liée à un contenu que vous avez créé ou publié en violation des présentes conditions.</p>
      <h3>9. Suspension</h3>
      <p>Nous pouvons supprimer un contenu ou suspendre un compte en cas de manquement grave aux présentes conditions ou sur demande d’une autorité, après notification sauf urgence.</p>
      <h3>10. Modifications</h3>
      <p>Nous pouvons faire évoluer ces conditions ; la version en vigueur est datée en haut de cette page. En cas de changement important, vous en êtes informé par e-mail ou dans l’application.</p>
      <h3>11. Droit applicable</h3>
      <p>Les présentes conditions sont régies par le droit ${c.country ? `en vigueur au ${c.country}` : 'du pays du siège de l’éditeur'}. En cas de litige, une solution amiable est recherchée en priorité (${c.contact}) ; à défaut, les tribunaux compétents ${c.country ? `du ${c.country}` : 'du siège de l’éditeur'} sont saisis, sous réserve des règles protectrices des consommateurs.</p>`,
    sales: (c) => `
      <h2 id="sales">Conditions générales de vente</h2>
      <h3>1. Offres</h3>
      <ul>
        <li><b>Offre gratuite</b> : quotas mensuels limités, vidéos avec filigrane, écoute et visionnage sur la plateforme ; téléchargement et publication soumis à un paiement à l’unité.</li>
        ${c.passes ? '<li><b>Pass Créateur et Pro (30 jours)</b> : quotas et fonctionnalités décrits sur la page Tarifs, exports inclus, sans reconduction automatique : rien n’est prélevé à l’expiration.</li>' : ''}
        ${c.card ? '<li><b>Abonnements mensuels par carte</b> : renouvelés chaque mois jusqu’à résiliation depuis l’espace Abonnement ; la résiliation prend effet à la fin de la période payée.</li>' : ''}
        <li><b>Export à l’unité</b> : déblocage du téléchargement et de la publication d’une vidéo ou d’une chanson précise, sans filigrane.</li>
        <li><b>Packs de vidéos</b> : vidéos supplémentaires au-delà du quota, utilisables tant que le compte existe.</li>
      </ul>
      <h3>2. Prix et paiement</h3>
      <p>Les prix sont affichés en francs CFA (FCFA) ou en dirhams (MAD), toutes taxes applicables comprises le cas échéant, avant toute commande. Le paiement est exigible immédiatement et traité par ${c.paymentNames || 'nos prestataires de paiement'} ; nous ne recevons ni ne conservons vos données de carte ou de compte mobile money. Les quotas non utilisés à l’expiration d’un pass ne sont pas reportés.</p>
      <h3>3. Fourniture et droit de rétractation</h3>
      <p>Les contenus et services numériques sont fournis immédiatement après le paiement. En validant le paiement, vous demandez cette exécution immédiate et reconnaissez perdre, lorsque la loi qui vous est applicable le prévoit, votre droit de rétractation dès que le contenu est mis à disposition.</p>
      <h3>4. Remboursements</h3>
      <p>Une génération qui échoue n’est pas décomptée : le quota ou le crédit utilisé est restitué automatiquement. Si un paiement a été débité sans que le service correspondant soit fourni, contactez-nous (${c.contact}) dans les 30 jours : il est alors remboursé ou le service est fourni.</p>
      <h3>5. Corrections incluses</h3>
      <p>Chaque vidéo et chanson inclut le nombre de corrections indiqué dans l’application. Les corrections de prononciation sont limitées par vidéo.</p>`,
    privacy: (c) => `
      <h2 id="privacy">Politique de confidentialité</h2>
      <p>Cette politique explique quelles données personnelles ${c.name} traite, pourquoi et comment exercer vos droits. Elle s’applique conformément à la loi de protection des données ${c.country ? `en vigueur au ${c.country}` : 'du pays de l’éditeur'} et, pour les personnes situées dans l’Union européenne, au Règlement général sur la protection des données (RGPD). Responsable du traitement : ${c.name} (${c.contact}).</p>
      <h3>Données traitées</h3>
      <ul>
        <li><b>Compte</b> : e-mail, nom, mot de passe (stocké haché, jamais en clair), langue, offre, date d’acceptation des conditions.</li>
        <li><b>Contenus</b> : descriptions, scripts, paroles, kit de marque (nom, couleurs, logo), photos de produits, vidéos et chansons générées, légendes.</li>
        <li><b>Voix</b> : si vous clonez votre voix, l’enregistrement est transmis directement au service de synthèse vocale pour créer votre modèle de voix ; nous ne conservons pas l’enregistrement, seulement l’identifiant du modèle. Votre dictionnaire de prononciation est conservé dans votre compte.</li>
        <li><b>Comptes connectés</b> : jetons d’accès aux réseaux sociaux, stockés chiffrés.</li>
        <li><b>Paiement</b> : montant, offre, statut et référence de transaction ; les données de carte ou de mobile money restent chez le prestataire de paiement.</li>
        <li><b>Technique</b> : cookie de session (connexion), préférences d’affichage dans votre navigateur (thème, langue), adresse IP traitée temporairement pour la sécurité (limitation des tentatives de connexion), journaux techniques.</li>
      </ul>
      <h3>Finalités et bases légales</h3>
      <ul>
        <li>Fournir le Service, produire vos contenus, gérer votre compte et vos paiements : exécution du contrat.</li>
        <li>Cloner votre voix : votre consentement explicite, retirable à tout moment en supprimant la voix.</li>
        <li>Comptabilité et facturation : obligation légale.</li>
        <li>Sécurité, prévention des abus et de la fraude, mesure interne des coûts du Service : intérêt légitime.</li>
      </ul>
      <p>Nous ne vendons pas vos données, n’affichons pas de publicité et n’utilisons aucun traceur publicitaire ni outil de mesure d’audience tiers. Vos contenus ne sont pas utilisés pour entraîner nos propres modèles.</p>
      <h3>Destinataires et sous-traitants</h3>
      <p>Pour produire vos contenus, les données strictement nécessaires sont transmises aux prestataires suivants :</p>
      <ul>${c.processors || '<li>prestataires d’intelligence artificielle, de banques d’images et de paiement configurés sur la plateforme</li>'}</ul>
      <p>Les vidéos sont envoyées aux réseaux sociaux que vous connectez (YouTube, TikTok, Facebook, Instagram, LinkedIn). Certains prestataires sont situés hors de votre pays, notamment aux États-Unis et dans l’Union européenne ; ces transferts sont encadrés par leurs engagements contractuels de protection des données.</p>
      <h3>Durées de conservation</h3>
      <ul>
        <li>Compte, kit de marque, voix et prononciations : tant que le compte existe.</li>
        <li>Vidéos et chansons : ${c.retention ? `${c.retention} jours après leur création` : 'jusqu’à leur suppression par vous ou celle du compte'}.</li>
        <li>Paiements : durée imposée par les obligations comptables.</li>
        <li>Journaux techniques : quelques semaines au plus.</li>
      </ul>
      <p>À la suppression du compte, les données et fichiers sont effacés, la voix clonée est supprimée chez le prestataire de synthèse vocale et les comptes connectés sont déconnectés ; seules les données de paiement sont conservées le temps légal.</p>
      <h3>Sécurité</h3>
      <p>Connexion chiffrée (HTTPS), mots de passe hachés, jetons des réseaux sociaux chiffrés, accès aux contenus limité à leur propriétaire.</p>
      <h3>Vos droits</h3>
      <p>Vous disposez des droits d’accès, de rectification, d’effacement, de limitation, d’opposition et de portabilité. Vous pouvez télécharger vos données (« Mon compte › Télécharger mes données ») et supprimer votre compte vous-même ; pour toute autre demande, écrivez à ${c.contact}. Vous pouvez introduire une réclamation auprès de ${c.authority}.</p>
      <h3>Mineurs</h3>
      <p>Le Service n’est pas destiné aux personnes de moins de 18 ans.</p>`,
    ai: (c) => `
      <h2 id="ai">Intelligence artificielle, voix et transparence</h2>
      <ul>
        <li><b>Contenus générés</b> : scripts, voix, images, musiques et chansons sont produits automatiquement par des modèles d’IA et peuvent contenir des erreurs ou des inexactitudes. Relisez chaque vidéo avant de la diffuser.</li>
        <li><b>Transparence</b> : les principaux réseaux sociaux demandent d’indiquer les contenus réalistes générés ou modifiés par IA. Utilisez l’option prévue par chaque réseau ou mentionnez-le dans la légende.</li>
        <li><b>Clonage de voix</b> : vous ne pouvez cloner que votre propre voix, ou celle d’une personne qui vous a donné son accord écrit. Toute imitation d’une personne réelle, d’un artiste ou d’une personnalité sans autorisation est interdite et entraîne la suppression de la voix et du compte.</li>
        <li><b>Chansons</b> : ne demandez pas d’imiter un artiste existant ni de reprendre des paroles ou mélodies protégées.</li>
        <li><b>Prononciation</b> : les corrections de prononciation ne modifient que la voix ; le texte affiché et les sous-titres gardent l’orthographe d’origine.</li>
        <li><b>Signalement</b> : pour signaler un contenu illicite ou une utilisation abusive de votre voix ou de votre image, écrivez à ${c.contact} ; nous traitons les signalements dans les meilleurs délais.</li>
      </ul>`,
  },
  en: {
    title: 'Legal information',
    nav: { notice: 'Legal notice', terms: 'Terms of use', sales: 'Terms of sale', privacy: 'Privacy', ai: 'AI & voice' },
    updated: 'Last updated',
    notice: (c) => `
      <h2 id="notice">Legal notice</h2>
      <p><b>Publisher</b>: ${c.name}${c.registration ? `, ${c.registration}` : ''}${c.address ? `<br>Registered office: ${c.address}` : ''}${c.country ? `, ${c.country}` : ''}.</p>
      ${c.director ? `<p><b>Publication director</b>: ${c.director}.</p>` : ''}
      <p><b>Contact</b>: ${c.contact}${c.url ? `<br><b>Website</b>: ${c.url}` : ''}</p>
      ${c.hosting ? `<p><b>Hosting</b>: ${c.hosting}.</p>` : ''}
      <p><b>Intellectual property</b>: the brand, website, code and texts belong to the publisher. Videos and songs created by users are attributed to them under the terms below.</p>`,
    terms: (c) => `
      <h2 id="terms">Terms of use</h2>
      <h3>1. Purpose and acceptance</h3>
      <p>${c.name} (“we”) provides an online service to create videos and songs with artificial intelligence, with download and, depending on the plan, social media publishing (the “Service”). Creating an account means accepting these terms, the terms of sale and the privacy policy in force.</p>
      <h3>2. Access</h3>
      <p>The Service is for people aged 18 or over, or acting on behalf of a business. You provide a valid email address, keep your password confidential and are responsible for your account’s activity. You can delete your account at any time from “My account”.</p>
      <h3>3. Acceptable use</h3>
      <p>You may not use the Service to create or share content that is:</p>
      <ul>
        <li>unlawful, hateful, discriminatory, violent, sexual involving minors or degrading;</li>
        <li>misleading: fake promotions, fake testimonials, scams, impersonation of a person, brand or institution;</li>
        <li>imitating the voice, likeness or name of a real person without their written permission, or presenting fabricated statements as genuine (“deepfakes”);</li>
        <li>infringing third-party rights: trademarks, copyright (existing lyrics, music or works), image rights, trade secrets;</li>
        <li>regulated advertising that does not comply with applicable law (health, medicines, alcohol, gambling, financial products, politics);</li>
        <li>against the rules of the social networks you publish on.</li>
      </ul>
      <p>You may not circumvent quotas, watermarks or security measures, or create several accounts to multiply the free plan.</p>
      <h3>4. Your content</h3>
      <p>You keep your rights on what you provide (descriptions, product photos, logos, texts, voice recordings) and warrant you hold the necessary rights. You allow us to process it only to produce your videos and songs.</p>
      <h3>5. Generated videos and songs</h3>
      <p>To the extent permitted by law, the videos and songs you generate are attributed to you and you may use them, including commercially, once exported (paid plan or paid export). Third-party media they contain (stock photos and clips, credited) remain under their licences. The free plan watermark must not be removed. AI-generated content may resemble existing works: check before use that it does not infringe anyone’s rights.</p>
      <h3>6. Social media publishing</h3>
      <p>When you connect an account, you allow us to publish the videos you choose, at the dates you set. You remain responsible for your posts, for each platform’s rules and for the “AI-generated” labels they require. You can disconnect an account at any time.</p>
      <h3>7. Availability and retention</h3>
      <p>We do our best to keep the Service available, without guaranteeing uninterrupted service or results. ${c.retention ? `Videos and songs are kept for ${c.retention} days after creation, then deleted: download those you want to keep.` : 'Download and back up the videos you want to keep: the Service is not an archive.'}</p>
      <h3>8. Liability</h3>
      <p>Automatically generated content may contain mistakes; you review it before sharing and are responsible for it. Except for gross negligence or where the law provides otherwise, our liability is limited to the amounts you paid us in the last twelve months. You indemnify us against claims arising from content you created or published in breach of these terms.</p>
      <h3>9. Suspension</h3>
      <p>We may remove content or suspend an account for a serious breach of these terms or at the request of an authority, after notice except in emergencies.</p>
      <h3>10. Changes</h3>
      <p>We may update these terms; the version in force is dated at the top of this page. Significant changes are announced by email or in the app.</p>
      <h3>11. Governing law</h3>
      <p>These terms are governed by the law ${c.country ? `of ${c.country}` : 'of the publisher’s country'}. Disputes are first settled amicably (${c.contact}); failing that, the competent courts ${c.country ? `of ${c.country}` : 'of the publisher’s registered office'} have jurisdiction, subject to consumer protection rules.</p>`,
    sales: (c) => `
      <h2 id="sales">Terms of sale</h2>
      <h3>1. Offers</h3>
      <ul>
        <li><b>Free plan</b>: limited monthly quotas, watermarked videos, viewing and listening on the platform; download and publishing require a one-off payment.</li>
        ${c.passes ? '<li><b>Creator and Pro passes (30 days)</b>: quotas and features shown on the Pricing page, exports included, no automatic renewal: nothing is charged at expiry.</li>' : ''}
        ${c.card ? '<li><b>Monthly card subscriptions</b>: renewed every month until cancelled from the Billing page; cancellation takes effect at the end of the paid period.</li>' : ''}
        <li><b>One-off export</b>: unlocks download and publishing of one video or song, without watermark.</li>
        <li><b>Video packs</b>: extra videos beyond the quota, usable as long as the account exists.</li>
      </ul>
      <h3>2. Prices and payment</h3>
      <p>Prices are shown in CFA francs (FCFA) or dirhams (MAD), including applicable taxes where relevant, before any order. Payment is due immediately and processed by ${c.paymentNames || 'our payment providers'}; we never receive or keep your card or mobile money details. Quotas unused when a pass expires do not roll over.</p>
      <h3>3. Delivery and withdrawal</h3>
      <p>Digital content and services are provided immediately after payment. By confirming payment you request immediate performance and acknowledge that, where the law applicable to you provides so, you lose your right of withdrawal once the content is made available.</p>
      <h3>4. Refunds</h3>
      <p>A failed generation is not counted: the quota or credit used is restored automatically. If you were charged without receiving the corresponding service, contact us (${c.contact}) within 30 days: it is refunded or delivered.</p>
      <h3>5. Included corrections</h3>
      <p>Each video and song includes the number of corrections shown in the app. Pronunciation fixes are limited per video.</p>`,
    privacy: (c) => `
      <h2 id="privacy">Privacy policy</h2>
      <p>This policy explains what personal data ${c.name} processes, why, and how to exercise your rights. It applies in line with the data protection law ${c.country ? `of ${c.country}` : 'of the publisher’s country'} and, for people in the European Union, the General Data Protection Regulation (GDPR). Controller: ${c.name} (${c.contact}).</p>
      <h3>Data we process</h3>
      <ul>
        <li><b>Account</b>: email, name, password (hashed, never stored in clear), language, plan, date the terms were accepted.</li>
        <li><b>Content</b>: descriptions, scripts, lyrics, brand kit (name, colours, logo), product photos, generated videos and songs, captions.</li>
        <li><b>Voice</b>: if you clone your voice, the recording is sent directly to the speech provider to build your voice model; we do not keep the recording, only the model identifier. Your pronunciation dictionary is stored in your account.</li>
        <li><b>Connected accounts</b>: social network access tokens, stored encrypted.</li>
        <li><b>Payment</b>: amount, plan, status and transaction reference; card and mobile money details stay with the payment provider.</li>
        <li><b>Technical</b>: session cookie (sign-in), display preferences in your browser (theme, language), IP address processed temporarily for security (sign-in rate limiting), technical logs.</li>
      </ul>
      <h3>Purposes and legal bases</h3>
      <ul>
        <li>Providing the Service, producing your content, managing your account and payments: contract.</li>
        <li>Cloning your voice: your explicit consent, withdrawn at any time by deleting the voice.</li>
        <li>Accounting and invoicing: legal obligation.</li>
        <li>Security, abuse and fraud prevention, internal measurement of the Service’s costs: legitimate interest.</li>
      </ul>
      <p>We do not sell your data, show no ads and use no advertising trackers or third-party analytics. Your content is not used to train our own models.</p>
      <h3>Recipients and processors</h3>
      <p>To produce your content, only the necessary data is sent to the following providers:</p>
      <ul>${c.processors || '<li>artificial intelligence, stock media and payment providers configured on the platform</li>'}</ul>
      <p>Videos are sent to the social networks you connect (YouTube, TikTok, Facebook, Instagram, LinkedIn). Some providers are located outside your country, notably in the United States and the European Union; these transfers are covered by their contractual data protection commitments.</p>
      <h3>Retention</h3>
      <ul>
        <li>Account, brand kit, voice and pronunciations: as long as the account exists.</li>
        <li>Videos and songs: ${c.retention ? `${c.retention} days after creation` : 'until you delete them or your account'}.</li>
        <li>Payments: as required by accounting obligations.</li>
        <li>Technical logs: a few weeks at most.</li>
      </ul>
      <p>When the account is deleted, data and files are erased, the cloned voice is deleted at the speech provider and connected accounts are disconnected; only payment records are kept for the legal period.</p>
      <h3>Security</h3>
      <p>Encrypted connection (HTTPS), hashed passwords, encrypted social network tokens, content access limited to its owner.</p>
      <h3>Your rights</h3>
      <p>You have the rights of access, rectification, erasure, restriction, objection and portability. You can download your data (“My account › Download my data”) and delete your account yourself; for any other request, write to ${c.contact}. You can lodge a complaint with ${c.authority}.</p>
      <h3>Minors</h3>
      <p>The Service is not intended for people under 18.</p>`,
    ai: (c) => `
      <h2 id="ai">Artificial intelligence, voice and transparency</h2>
      <ul>
        <li><b>Generated content</b>: scripts, voices, images, music and songs are produced automatically by AI models and may contain errors or inaccuracies. Review each video before sharing it.</li>
        <li><b>Transparency</b>: major social networks ask you to disclose realistic content generated or altered by AI. Use each network’s option or mention it in the caption.</li>
        <li><b>Voice cloning</b>: you may only clone your own voice, or the voice of someone who gave you written consent. Imitating a real person, artist or public figure without permission is forbidden and leads to the deletion of the voice and the account.</li>
        <li><b>Songs</b>: do not ask to imitate an existing artist or to reuse protected lyrics or melodies.</li>
        <li><b>Pronunciation</b>: pronunciation fixes only change the voice; on-screen text and subtitles keep the original spelling.</li>
        <li><b>Reporting</b>: to report unlawful content or misuse of your voice or likeness, write to ${c.contact}; reports are handled promptly.</li>
      </ul>`,
  },
};

let config = { company: { name: 'SOVID AI', address: '', email: '', url: '' }, retentionDays: 0, features: {}, processors: [] };

const render = () => {
  const lang = getLang();
  const L = TEXT[lang];
  const company = config.company ?? {};
  const country = (company.country ?? '').trim();
  const authority = AUTHORITIES[country.toLowerCase()]?.[lang] ?? (lang === 'fr' ? 'l’autorité de protection des données de votre pays' : 'your country’s data protection authority');
  const purposes = PURPOSES[lang];
  const payments = (config.processors ?? []).filter((p) => p.purpose === 'payment').map((p) => p.name);
  const c = {
    name: escapeHtml(company.name || 'SOVID AI'),
    address: escapeHtml(company.address ?? ''),
    url: escapeHtml(company.url ?? ''),
    registration: escapeHtml(company.registration ?? ''),
    director: escapeHtml(company.director ?? ''),
    country: escapeHtml(country),
    hosting: escapeHtml(company.hosting ?? ''),
    contact: company.email ? `<a href="mailto:${escapeHtml(company.email)}">${escapeHtml(company.email)}</a>` : escapeHtml(lang === 'fr' ? 'l’adresse de contact de l’éditeur' : 'the publisher’s contact address'),
    retention: config.retentionDays ?? 0,
    passes: Boolean(config.features?.mobileMoney || config.features?.moroccoPayments),
    card: Boolean(config.features?.cardSubscriptions),
    paymentNames: escapeHtml(payments.join(', ')),
    processors: (config.processors ?? []).map((p) => `<li>${escapeHtml(p.name)} : ${escapeHtml(purposes[p.purpose] ?? p.purpose)}</li>`).join(''),
    authority,
  };
  document.querySelectorAll('[data-legal-link]').forEach((a) => (a.textContent = L.nav[a.dataset.legalLink]));
  $('legal').innerHTML = `<p class="muted small">${escapeHtml(L.updated)} : ${escapeHtml(UPDATED[lang])}</p>`
    + ['notice', 'terms', 'sales', 'privacy', 'ai'].map((section) => `<div class="card legal-card">${L[section](c)}</div>`).join('');
  $('brandName').textContent = company.name || 'SOVID AI';
  $('footerName').textContent = company.name || 'SOVID AI';
  document.title = `${L.title} · ${company.name || 'SOVID AI'}`;
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
};

initChrome();
$('year').textContent = new Date().getFullYear();
onLanguageChange(render);
render();
api('/api/public/config')
  .then((cfg) => {
    config = { ...config, ...cfg };
    render();
  })
  .catch(() => undefined);
