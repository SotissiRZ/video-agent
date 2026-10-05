/**
 * Industry of a video, guessed from the prompt, with English stock-photo searches that fit it.
 * Without this, generic hints ("young people", "celebration") bring unrelated pictures
 * (children playing in a cybersecurity video).
 */
import { normalize } from '../prompt/parser';

export interface Domain {
  id: string;
  /** Matched against the normalized prompt (accents removed, lower case). */
  match: RegExp;
  /** Varied English searches; scenes take them in turn. */
  queries: string[];
}

// Most specific first: "application de paiement" is fintech, not generic tech.
export const DOMAINS: Domain[] = [
  {
    id: 'cybersecurity',
    match: /cyber|securite informatique|hacker|hacking|phishing|ransomware|pare-feu|firewall|antivirus|chiffrement|encryption|protection des donnees|data protection|\bsecurity\b/,
    queries: ['cybersecurity padlock digital', 'hacker code screen', 'server room data center', 'security operations center monitors', 'laptop login password', 'network cables servers', 'programmer coding dark office', 'it team office computers'],
  },
  {
    id: 'fintech',
    match: /banque|bank|paiement|payment|\bpay\b|mobile money|portefeuille|wallet|finance|financier|credit|pret\b|loan|assurance|insurance|epargne|savings|investiss|invest|comptab|accounting|facturation|invoice/,
    queries: ['mobile payment smartphone', 'online banking app', 'credit card payment terminal', 'business finance charts', 'accountant calculator desk', 'cash money hands', 'shop owner smartphone payment', 'bank office meeting'],
  },
  {
    id: 'food',
    match: /restaurant|cuisine|food|repas|\bplats?\b|chef|traiteur|boulanger|patisser|bakery|\bcafe\b|coffee|pizza|burger|gastronom|recette|recipe|maquis|street food|livraison de repas/,
    queries: ['restaurant dish plating', 'chef cooking kitchen', 'friends dinner restaurant', 'fresh ingredients table', 'waiter serving food', 'restaurant interior evening', 'food close up', 'coffee shop counter'],
  },
  {
    id: 'fashion-beauty',
    match: /\bmode\b|fashion|couture|couturier|tailleur|tailor|vetement|clothing|wax|pagne|boutique de mode|beaute|beauty|cosmet|coiffure|coiffeur|\bhair|salon de|maquillage|makeup|skincare|parfum|perfume|bijou|jewel/,
    queries: ['fashion designer studio', 'clothing boutique rack', 'model fashion portrait', 'tailor sewing machine', 'hair salon styling', 'makeup artist', 'beauty products flat lay', 'fabric textile colorful'],
  },
  {
    id: 'health',
    match: /sante|health|clinique|clinic|hopital|hospital|medec|doctor|docteur|pharmac|infirm|nurse|\bpatient|bien-etre|wellness|telemedecine|telehealth|dentist/,
    queries: ['doctor patient consultation', 'medical team hospital', 'pharmacy shelves', 'nurse caring', 'telemedicine video call', 'healthy lifestyle', 'medical equipment', 'clinic reception'],
  },
  {
    id: 'education',
    match: /formation|education|ecole|school|\bcours\b|\bcourses?\b|universite|university|etudiant|student|apprendre|learn|e-learning|elearning|enseign|teacher|professeur|bootcamp|tutorat/,
    queries: ['students classroom', 'online learning laptop', 'teacher whiteboard', 'university campus students', 'student studying books', 'workshop training adults', 'graduation', 'library study'],
  },
  {
    id: 'mobility',
    match: /transport|\bvtc\b|taxi|moto|chauffeur|driver|livraison|delivery|livreur|courier|logistique|logistics|voiture|\bcar\b|\bride\b|covoiturage|bus\b|camion|truck|flotte|fleet/,
    queries: ['motorbike taxi city', 'delivery driver package', 'car driver smartphone', 'city traffic road', 'logistics warehouse', 'delivery scooter street', 'passenger ride phone', 'truck highway'],
  },
  {
    id: 'real-estate',
    match: /immobili|real estate|appartement|apartment|maison|house|villa|location de|\brent\b|loyer|construction|batiment|building|architect|terrain|\bland\b/,
    queries: ['modern house exterior', 'apartment interior living room', 'real estate agent keys', 'construction site', 'architect blueprint', 'city buildings skyline', 'family new home', 'property visit'],
  },
  {
    id: 'travel',
    match: /voyage|travel|touris|hotel|vacances|holiday|vacation|agence de voyage|safari|plage|beach|resort|billet d'avion|flight/,
    queries: ['traveler airport', 'beach resort', 'hotel room', 'tourists landmark', 'safari landscape', 'backpacker mountain', 'airplane window', 'city tour'],
  },
  {
    id: 'sport',
    match: /\bsport|fitness|gym|salle de sport|football|basket|running|course a pied|yoga|musculation|workout|coach sportif|marathon/,
    queries: ['athlete training', 'gym workout', 'football players', 'running outdoor', 'yoga class', 'coach fitness', 'stadium crowd', 'sports equipment'],
  },
  {
    id: 'agriculture',
    match: /agricult|agro|ferme|farm|recolte|harvest|cacao|cocoa|cultiv|elevage|livestock|semence|irrigation|agriculteur|farmer/,
    queries: ['farmer field', 'harvest crops', 'cocoa beans', 'farm tractor', 'green plantation', 'agriculture drone', 'fresh vegetables market', 'livestock farm'],
  },
  {
    id: 'events',
    match: /evenement|\bevents?\b|concert|festival|mariage|wedding|conference|salon professionnel|soiree|party|gala|inauguration|ouverture/,
    queries: ['conference audience stage', 'concert crowd lights', 'wedding ceremony', 'festival people', 'event venue decoration', 'party celebration adults', 'speaker presentation', 'networking event'],
  },
  {
    id: 'retail',
    match: /e-commerce|ecommerce|boutique en ligne|online store|magasin|shop\b|commerce|commercant|vente en ligne|retail|supermarche|marketplace/,
    queries: ['online shopping laptop', 'shop owner store', 'customer shopping bags', 'package delivery door', 'retail store shelves', 'smartphone shopping app', 'market stall', 'cashier checkout'],
  },
  {
    id: 'tech',
    match: /saas|logiciel|software|application|\bapp\b|plateforme|platform|tech|digital|numerique|\bia\b|intelligence artificielle|\bai\b|\bapi\b|cloud|data|donnees|developpeur|developer|\bcode\b|startup|site web|website|automatis|crm|erp|robot/,
    queries: ['laptop software dashboard', 'developer coding screen', 'team working computers office', 'smartphone app interface', 'data center servers', 'startup team meeting', 'hands typing keyboard', 'digital technology network'],
  },
];

export const BUSINESS: Domain = {
  id: 'business',
  match: /.^/,
  queries: ['business team meeting', 'professional working laptop', 'modern office', 'entrepreneur portrait', 'handshake business', 'customer service smiling', 'small business owner', 'city business district'],
};

/** Domain of a video from its prompt (and keywords); generic business when nothing matches. */
export const detectDomain = (text: string): Domain => {
  const t = normalize(text);
  return DOMAINS.find((d) => d.match.test(t)) ?? BUSINESS;
};
