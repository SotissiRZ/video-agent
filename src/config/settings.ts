/**
 * Settings catalogue for the web UI: which variables can be edited, how to present them,
 * which ones are free, where to get a key. Secret values are never sent back to the browser.
 */
import fs from 'node:fs';
import { ConfigError } from '../core/errors';
import { updateEnvFile } from '../publish/auth';
import { loadConfig, type AppConfig, type Env } from './config';

export interface SettingField {
  key: keyof Env & string;
  label: string;
  secret?: boolean;
  /** Account identifier (URL, id): counted as a configured service, like secrets. */
  credential?: boolean;
  /** Free service (or free tier). */
  free?: boolean;
  help?: string;
  link?: string;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export interface SettingGroup {
  id: string;
  title: string;
  description: string;
  fields: SettingField[];
}

const opt = (...pairs: Array<[string, string]>) => pairs.map(([value, label]) => ({ value, label }));

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: 'llm',
    title: 'Textes et script (LLM)',
    description: 'Écrit le concept, le script et les légendes. Plusieurs fournisseurs = relais automatique si l’un échoue (crédit épuisé, clé invalide). Sans LLM : textes génériques.',
    fields: [
      { key: 'VIDEO_AGENT_LLM_PROVIDER', label: 'Fournisseur', options: opt(['auto', 'Automatique (tous ceux configurés, avec relais)'], ['groq', 'Groq'], ['ollama', 'Ollama (local)'], ['openai-compatible', 'Compatible OpenAI (Gemini, OpenRouter…)'], ['anthropic', 'Claude'], ['openai', 'OpenAI'], ['local', 'Aucun (textes génériques)']) },
      { key: 'GROQ_API_KEY', label: 'Clé Groq', secret: true, free: true, link: 'https://console.groq.com/keys', help: 'Offre gratuite avec quotas, très rapide.' },
      { key: 'OLLAMA_BASE_URL', label: 'URL Ollama', credential: true, free: true, placeholder: 'http://ollama:11434 (Docker) ou http://localhost:11434', help: 'LLM 100 % local et gratuit. Avec Docker : ajoutez COMPOSE_PROFILES=ollama dans .env puis relancez.' },
      { key: 'OLLAMA_MODEL', label: 'Modèle Ollama', free: true, placeholder: 'qwen2.5:3b', help: 'Téléchargé automatiquement au premier usage (≈2 Go). Plus précis : qwen2.5:7b ou llama3.1:8b (8 Go de RAM).' },
      { key: 'OPENAI_COMPATIBLE_BASE_URL', label: 'URL compatible OpenAI', credential: true, free: true, placeholder: 'https://generativelanguage.googleapis.com/v1beta/openai/', help: 'Google Gemini (gratuit), OpenRouter (modèles « :free »), Mistral…' },
      { key: 'OPENAI_COMPATIBLE_API_KEY', label: 'Clé (compatible OpenAI)', secret: true, free: true, link: 'https://aistudio.google.com/apikey' },
      { key: 'OPENAI_COMPATIBLE_MODEL', label: 'Modèle (compatible OpenAI)', placeholder: 'gemini-2.5-flash' },
      { key: 'ANTHROPIC_API_KEY', label: 'Clé Claude (Anthropic)', secret: true, link: 'https://console.anthropic.com/' },
      { key: 'OPENAI_API_KEY', label: 'Clé OpenAI', secret: true, link: 'https://platform.openai.com/api-keys', help: 'Sert aussi à la voix-off et aux images OpenAI.' },
    ],
  },
  {
    id: 'stock',
    title: 'Photos et vidéos réelles',
    description: 'Banques gratuites de photos et clips libres de droits. Une clé suffit pour illustrer chaque scène.',
    fields: [
      { key: 'PEXELS_API_KEY', label: 'Clé Pexels', secret: true, free: true, link: 'https://www.pexels.com/api/', help: 'Photos et vidéos — recommandé.' },
      { key: 'PIXABAY_API_KEY', label: 'Clé Pixabay', secret: true, free: true, link: 'https://pixabay.com/api/docs/' },
      { key: 'UNSPLASH_ACCESS_KEY', label: 'Clé Unsplash', secret: true, free: true, link: 'https://unsplash.com/developers' },
      { key: 'VIDEO_AGENT_MEDIA_COVERAGE', label: 'Scènes illustrées', options: opt(['all', 'Toutes les scènes'], ['visual', 'Scènes visuelles seulement'], ['none', 'Aucune (fonds animés)']) },
      { key: 'VIDEO_AGENT_STOCK_VIDEOS', label: 'Clips vidéo', options: opt(['true', 'Oui (photos + vidéos)'], ['false', 'Non (photos seulement)']) },
    ],
  },
  {
    id: 'images',
    title: 'Images générées par IA',
    description: 'Utilisées quand aucune photo ne correspond à une scène.',
    fields: [
      { key: 'VIDEO_AGENT_IMAGE_PROVIDER', label: 'Fournisseur', options: opt(['auto', 'Automatique (gratuits d’abord)'], ['cloudflare', 'Cloudflare Workers AI'], ['huggingface', 'Hugging Face'], ['replicate', 'Replicate'], ['stability', 'Stability AI'], ['openai', 'OpenAI'], ['none', 'Aucun']) },
      { key: 'CLOUDFLARE_ACCOUNT_ID', label: 'Cloudflare : Account ID', credential: true, free: true, link: 'https://dash.cloudflare.com/', help: 'Allocation gratuite quotidienne (FLUX). Account ID visible sur le tableau de bord.' },
      { key: 'CLOUDFLARE_API_TOKEN', label: 'Cloudflare : jeton API (Workers AI)', secret: true, free: true, link: 'https://dash.cloudflare.com/profile/api-tokens' },
      { key: 'HF_TOKEN', label: 'Jeton Hugging Face', secret: true, free: true, link: 'https://huggingface.co/settings/tokens', help: 'Crédits gratuits mensuels.' },
      { key: 'REPLICATE_API_TOKEN', label: 'Jeton Replicate', secret: true, link: 'https://replicate.com/account/api-tokens' },
      { key: 'STABILITY_API_KEY', label: 'Clé Stability AI', secret: true, link: 'https://platform.stability.ai/account/keys' },
      { key: 'VIDEO_AGENT_MAX_GENERATED_IMAGES', label: 'Images IA max par vidéo' },
    ],
  },
  {
    id: 'voice',
    title: 'Voix-off',
    description: 'Piper fournit gratuitement des voix naturelles, en local (préinstallé dans Docker).',
    fields: [
      { key: 'VIDEO_AGENT_VOICE_PROVIDER', label: 'Fournisseur', options: opt(['auto', 'Automatique'], ['piper', 'Piper (gratuit, local)'], ['elevenlabs', 'ElevenLabs'], ['openai', 'OpenAI'], ['system', 'Voix du système'], ['none', 'Aucune']) },
      { key: 'PIPER_VOICE_FR', label: 'Voix Piper française', free: true, options: opt(['fr_FR-siwis-medium', 'Siwis (femme)'], ['fr_FR-tom-medium', 'Tom (homme)'], ['fr_FR-upmc-medium', 'UPMC (femme/homme)'], ['fr_FR-gilles-low', 'Gilles (homme)']), link: 'https://rhasspy.github.io/piper-samples/' },
      { key: 'PIPER_VOICE_EN', label: 'Voix Piper anglaise', free: true, options: opt(['en_US-lessac-medium', 'Lessac (US, femme)'], ['en_US-ryan-medium', 'Ryan (US, homme)'], ['en_GB-alba-medium', 'Alba (UK, femme)']) },
      { key: 'PIPER_LENGTH_SCALE', label: 'Débit Piper (1 = normal, 1.2 = plus lent)' },
      { key: 'ELEVENLABS_API_KEY', label: 'Clé ElevenLabs', secret: true, link: 'https://elevenlabs.io/app/settings/api-keys', help: 'Nécessaire pour la voix-off ElevenLabs et la génération de chansons chantées (offre Music payante).' },
      { key: 'ELEVENLABS_VOICE_ID', label: 'Voix ElevenLabs (id)' },
    ],
  },
  {
    id: 'render',
    title: 'Musique et rendu',
    description: 'Valeurs par défaut des vidéos.',
    fields: [
      { key: 'VIDEO_AGENT_MUSIC', label: 'Musique', options: opt(['auto', 'Vos pistes (assets/music) sinon synthèse'], ['procedural', 'Synthèse automatique'], ['assets', 'Vos pistes uniquement'], ['none', 'Aucune']) },
      { key: 'VIDEO_AGENT_MUSIC_PROVIDER', label: 'Musique composée par IA', options: opt(['none', 'Désactivée'], ['auto', 'Automatique (selon les clés)'], ['elevenlabs', 'ElevenLabs Music'], ['stability', 'Stable Audio (Stability AI)'], ['replicate', 'MusicGen (Replicate)']), help: 'Une musique originale, adaptée au sujet et à l’ambiance demandée, est composée pour chaque vidéo. Payant chez le fournisseur ; en cas d’échec la synthèse automatique prend le relais.' },
      { key: 'VIDEO_AGENT_SUBTITLES', label: 'Sous-titres par défaut', options: opt(['true', 'Oui'], ['false', 'Non']) },
      { key: 'VIDEO_AGENT_RENDER_CONCURRENCY', label: 'Images rendues en parallèle', placeholder: 'auto (moitié des cœurs)', help: 'Augmentez jusqu’au nombre de cœurs du processeur pour accélérer le rendu (plus de mémoire utilisée).' },
      { key: 'VIDEO_AGENT_X264_PRESET', label: 'Vitesse d’encodage MP4', options: opt(['veryfast', 'Rapide (recommandé)'], ['ultrafast', 'Très rapide (fichiers plus lourds)'], ['medium', 'Équilibré'], ['slow', 'Lent (fichiers plus légers)']) },
    ],
  },
  {
    id: 'payments',
    title: 'Paiements (pass de 30 jours)',
    description: 'GeniusPay : Wave, Orange Money, MTN, Moov et cartes en FCFA. YouCan Pay : cartes et CashPlus en dirhams. Webhooks : <PUBLIC_URL>/api/payments/geniuspay/webhook et /api/payments/youcanpay/webhook.',
    fields: [
      { key: 'GENIUSPAY_API_KEY', label: 'GeniusPay : clé API (pk_…)', secret: true, link: 'https://geniuspay.ci/dashboard', help: 'pk_sandbox_… pour tester, pk_live_… pour encaisser.' },
      { key: 'GENIUSPAY_API_SECRET', label: 'GeniusPay : secret API (sk_…)', secret: true },
      { key: 'GENIUSPAY_WEBHOOK_SECRET', label: 'GeniusPay : secret du webhook', secret: true, help: 'Obligatoire : sans lui, les paiements ne peuvent pas être confirmés automatiquement.' },
      { key: 'YOUCANPAY_PRIVATE_KEY', label: 'YouCan Pay : clé privée (pri_…)', secret: true, link: 'https://youcanpay.com', help: 'Sert aussi à vérifier la signature des webhooks.' },
      { key: 'YOUCANPAY_SANDBOX', label: 'YouCan Pay : mode test', options: opt(['false', 'Non (paiements réels)'], ['true', 'Oui (sandbox)']) },
      { key: 'PLAN_CREATOR_PRICE_XOF', label: 'Prix Créateur (FCFA / 30 jours)' },
      { key: 'PLAN_PRO_PRICE_XOF', label: 'Prix Pro (FCFA / 30 jours)' },
      { key: 'PLAN_CREATOR_PRICE_MAD', label: 'Prix Créateur (MAD / 30 jours)' },
      { key: 'PLAN_PRO_PRICE_MAD', label: 'Prix Pro (MAD / 30 jours)' },
      { key: 'CREDIT_PACK_VIDEOS', label: 'Vidéos par pack supplémentaire', help: 'Vidéos utilisables au-delà du quota mensuel, sans date d’expiration.' },
      { key: 'CREDIT_PACK_PRICE_XOF', label: 'Prix d’un pack (FCFA)' },
      { key: 'CREDIT_PACK_PRICE_MAD', label: 'Prix d’un pack (MAD)' },
      { key: 'PASS_REMINDER_DAYS', label: 'Rappel avant la fin d’un pass (jours)', help: 'E-mail envoyé avant l’expiration, puis le jour où le pass expire. 0 = désactivé.' },
    ],
  },
  {
    id: 'security',
    title: 'Sécurité',
    description: 'Mot de passe facultatif devant tout le site (préproduction) : le navigateur le demande avant même la page de connexion.',
    fields: [
      { key: 'VIDEO_AGENT_WEB_PASSWORD', label: 'Mot de passe de l’interface', secret: true },
    ],
  },
  {
    id: 'publish',
    title: 'Publication (applications développeur)',
    description: 'Vos applications développeur : chaque client connecte ensuite ses propres comptes dans « Comptes connectés ». URL de retour OAuth : <PUBLIC_URL>/api/connections/<youtube|tiktok|linkedin|meta>/callback.',
    fields: [
      { key: 'VIDEO_AGENT_PUBLISH_PLATFORMS', label: 'Plateformes par défaut', placeholder: 'tiktok,instagram,youtube' },
      { key: 'YOUTUBE_CLIENT_ID', label: 'YouTube : Client ID', credential: true, free: true, link: 'https://console.cloud.google.com/apis/credentials' },
      { key: 'YOUTUBE_CLIENT_SECRET', label: 'YouTube : Client secret', secret: true },
      { key: 'YOUTUBE_PRIVACY', label: 'YouTube : visibilité', options: opt(['public', 'Publique'], ['unlisted', 'Non répertoriée'], ['private', 'Privée']) },
      { key: 'TIKTOK_CLIENT_KEY', label: 'TikTok : Client key', credential: true, free: true, link: 'https://developers.tiktok.com/' },
      { key: 'TIKTOK_CLIENT_SECRET', label: 'TikTok : Client secret', secret: true },
      { key: 'TIKTOK_MODE', label: 'TikTok : mode', options: opt(['draft', 'Brouillon dans l’app (sans audit)'], ['direct', 'Publication directe (audit requis)']) },
      { key: 'META_APP_ID', label: 'Meta : App ID', credential: true, free: true, link: 'https://developers.facebook.com/apps/' },
      { key: 'META_APP_SECRET', label: 'Meta : App secret', secret: true },
      { key: 'LINKEDIN_CLIENT_ID', label: 'LinkedIn : Client ID', credential: true, free: true, link: 'https://www.linkedin.com/developers/apps' },
      { key: 'LINKEDIN_CLIENT_SECRET', label: 'LinkedIn : Client secret', secret: true },
    ],
  },
];

const FIELDS = new Map(SETTING_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f] as const)));

/** View for the browser: secrets are reported as configured/not configured only. */
export const settingsView = (config: AppConfig) =>
  SETTING_GROUPS.map((g) => ({
    ...g,
    fields: g.fields.map((f) => {
      const raw = config.env[f.key];
      const value = raw === undefined || raw === null ? '' : Array.isArray(raw) ? raw.join(',') : String(raw);
      return { ...f, configured: value !== '', value: f.secret ? '' : value };
    }),
  }));

/**
 * Write settings into the .env file after validating the resulting configuration.
 * Empty strings for secrets mean "keep the current value"; use null to clear a value.
 */
export const saveSettings = (envFile: string, updates: Record<string, string | null>, reload: () => AppConfig): AppConfig => {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(updates)) {
    const field = FIELDS.get(key as keyof Env & string);
    if (!field) throw new ConfigError(`Réglage inconnu ou non modifiable : ${key}`);
    if (value === '' && field.secret) continue;
    if (value !== null && /[\r\n]/.test(value)) throw new ConfigError(`Valeur invalide pour ${key}`);
    values[key] = value === null ? '' : value.trim();
  }
  const backup = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : null;
  updateEnvFile(envFile, values);
  try {
    return reload();
  } catch (err) {
    // Invalid value: restore the previous file.
    if (backup === null) fs.rmSync(envFile, { force: true });
    else fs.writeFileSync(envFile, backup);
    throw err;
  }
};

export { loadConfig };
