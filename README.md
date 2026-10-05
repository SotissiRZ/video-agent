# 🎬 Video Agent

**Agent autonome de génération vidéo.** Décrivez la vidéo en une phrase et l'agent fait le reste, du concept au fichier MP4 final. Le rendu est effectué localement avec [Remotion](https://www.remotion.dev).

```bash
video-agent "Crée une vidéo verticale de 30 secondes pour promouvoir Sirago auprès des chauffeurs au Burkina Faso."
```

Il produit `output/<job>/video.mp4` (1080×1920, 30 s, 30 fps), avec animations, transitions, sous-titres incrustés, musique et, en option, une voix-off. Il génère aussi le script, le storyboard, un projet Remotion éditable, les sous-titres SRT/VTT et une miniature.

- **Fonctionne sans aucune clé API** (mode local/procédural) sur Windows, macOS et Linux.
- **Multi-fournisseurs, tous optionnels** : Claude, OpenAI, Groq, tout serveur compatible OpenAI (Ollama, LM Studio…), images (OpenAI, Replicate), voix (ElevenLabs, OpenAI, voix système), clips vidéo (Replicate).
- **Vrais visuels** : vos photos (`assets/`), banques gratuites de photos et vidéos (Pexels, Pixabay, Unsplash), images IA (OpenAI, Replicate, Stability AI), avec crédits automatiques.
- **Publication automatique** sur TikTok, Instagram, Facebook, YouTube et LinkedIn : légendes et hashtags par plateforme, publication immédiate ou programmée.
- **CLI + interface web locale** avec progression en direct et prévisualisation, **ou Docker** (`docker compose up`).

![Images de la vidéo de démonstration Sirago](docs/demo/storyboard-frames.jpg)

*Démo générée hors-ligne, sans aucune clé API : [`docs/demo/sirago-demo.mp4`](docs/demo/sirago-demo.mp4) (version allégée), avec son [script](docs/demo/script.md) et son [storyboard](docs/demo/storyboard.json).*

---

## Sommaire

1. [Présentation](#1-présentation)
2. [Architecture](#2-architecture)
3. [Prérequis](#3-prérequis)
4. [Installation Windows](#4-installation-windows)
5. [Installation macOS / Linux](#5-installation-macos--linux)
6. [Configuration](#6-configuration)
7. [Utilisation CLI](#7-utilisation-cli)
8. [Utilisation de l'interface web](#8-utilisation-de-linterface-web)
9. [Ajouter un provider](#9-ajouter-un-provider)
10. [Ajouter un template](#10-ajouter-un-template)
11. [Génération d'une vidéo : ce qui se passe](#11-génération-dune-vidéo--ce-qui-se-passe)
12. [Résolution des problèmes courants](#12-résolution-des-problèmes-courants)
13. [Docker](#13-docker)
14. [Visuels : photos, vidéos et images IA](#14-visuels--photos-vidéos-et-images-ia)
15. [Publication sur les réseaux sociaux](#15-publication-sur-les-réseaux-sociaux)

---

## 1. Présentation

À partir d'une demande en langage naturel (français ou anglais), l'agent enchaîne 12 étapes :

| # | Étape | Ce qui est fait |
|---|---|---|
| 1 | Analyse | Durée, format, fps, marque, cible, lieu, langue, style, options voix/musique/sous-titres. L'analyse est déterministe et fonctionne sans LLM. |
| 2 | Concept | Idée, angle, ton, message clé, appel à l'action, signature |
| 3 | Script | Texte à l'écran et narration de chaque scène, calés sur la structure du template |
| 4 | Storyboard | Scènes, durées exactes en frames, thème visuel |
| 5 | Scènes | Choix du composant de chaque scène (titre, liste, étapes, chiffre, visuel, citation, CTA) et de la mise en page selon le format |
| 6 | Assets | Logo et visuels tirés de `assets/`, sinon générés par IA (optionnel), sinon visuels procéduraux |
| 7 | Animations | Entrées de texte, fonds animés et transitions selon le style |
| 8 | Textes et sous-titres | Découpage équilibré et calage des sous-titres |
| 9 | Voix-off et musique | Synthèse vocale par scène (optionnelle), ajustement des durées, musique (asset ou synthèse locale) avec atténuation sous la voix |
| 10 | Projet Remotion | `storyboard.json`, `props.json`, script, SRT/VTT, README |
| 11 | Rendu | Bundle Remotion puis rendu local (MP4/H.264, WebM, MOV/ProRes, GIF) |
| 12 | Fichier final | Vidéo, miniature, `job.json` |

**Formats** : 1920×1080 (16:9), 1080×1920 (9:16), 1080×1080 (1:1), 1080×1350 (4:5) ou toute résolution `LxH`. La durée, le nombre de fps et le conteneur de sortie (`mp4`, `webm`, `mov`, `gif`) sont réglables.

**Templates** : publicité, présentation produit, tutoriel, annonce, réseaux sociaux, démonstration d'application, storytelling.

**Styles** : modern, vibrant, minimal, corporate, elegant, playful, tech, warm.

## 2. Architecture

```
┌──────────────┐   ┌──────────────────────────── agent/orchestrator ───────────────────────────┐
│ CLI  (cli/)  │──▶│ prompt/ ─▶ planning/ ─▶ storyboard/ ─▶ assets/ ─▶ subtitles/ ─▶ audio/    │
│ Web (server/)│   │  analyse    concept      builder,       sélection   cues SRT    voix,     │
└──────────────┘   │             + script     animations,    + images    /VTT        musique   │
                   │   │            │          validator      IA                               │
                   │   ▼            ▼                                                           │
                   │ config/     llm/ (Claude, OpenAI, Groq, OpenAI-compatible, procédural)     │
                   │             providers/ image · voice · video (tous optionnels)            │
                   └─────────────────────────────────┬──────────────────────────────────────────┘
                                                      │ storyboard.json (contrat zod partagé)
                                                      ▼
                   ┌──────────── remotion/ (React + TypeScript) ────────────┐   render/
                   │ contract/ (schéma, timeline, styles)                   │◀── bundle → renderMedia
                   │ VideoComposition → TransitionSeries → scènes           │    (Chrome headless +
                   │ components/ (fonds, texte animé, médias, sous-titres)  │     FFmpeg embarqué)
                   └────────────────────────────────────────────────────────┘
```

| Dossier | Rôle |
|---|---|
| `src/agent/` | Orchestrateur des 12 étapes, layout des dossiers de job, diagnostics (`doctor`) |
| `src/prompt/` | Analyse déterministe du brief (FR/EN) |
| `src/planning/` | Brief résolu, choix des scènes, planificateur LLM et planificateur procédural (repli automatique) |
| `src/llm/` | Abstraction `LLMProvider` et registre : Anthropic (SDK officiel), OpenAI/Groq/compatibles (HTTP) |
| `src/providers/` | Abstractions et implémentations image, voix et vidéo, avec leurs registres |
| `src/templates/` | Templates (structure narrative + rédaction hors-ligne FR/EN) et sélection |
| `src/storyboard/` | Construction, répartition des durées, animations, validation |
| `src/subtitles/` | Découpage équilibré, calage et export SRT/VTT |
| `src/audio/` | WAV, synthétiseur de musique procédurale |
| `src/assets/` | Bibliothèque locale (`assets/`), tags, logo, musique |
| `src/media/` | `MediaDirector` : choix d'un visuel par scène (assets → banques → IA), crédits |
| `src/providers/stock/` | Pexels, Pixabay, Unsplash (photos et clips libres de droits) |
| `src/publish/` | Publication : légendes, contraintes, connecteurs TikTok/Instagram/Facebook/YouTube/LinkedIn, jetons OAuth, planificateur |
| `src/remotion/` | **Moteur vidéo** : compositions React/Remotion. Code compatible navigateur uniquement |
| `src/render/` | Bundle et rendu Remotion, détection du navigateur |
| `src/config/` | Variables d'environnement validées par zod |
| `src/server/` + `web/` | Serveur HTTP local (API JSON + SSE) et interface web sans build |
| `src/cli/` | Commandes `video-agent` |

**Principes de conception**

- **Le storyboard est le contrat.** Toutes les décisions de l'agent aboutissent dans un JSON validé par zod (`src/remotion/contract/storyboard.ts`). La composition Remotion ne fait que l'afficher. Vous pouvez éditer ce fichier et relancer le rendu.
- **Chaque capacité externe est optionnelle et injectable.** Sans LLM, le planificateur procédural prend le relais. Sans images, les scènes visuelles dessinent des motifs animés. Sans voix, la vidéo reste sous-titrée. Une erreur de fournisseur ne casse jamais le rendu : elle produit un avertissement.
- **Bonnes pratiques Remotion** : animations pilotées par `useCurrentFrame()`, `spring()` et `interpolate()` (pas d'animations CSS), `<TransitionSeries>` pour les transitions, `calculateMetadata` pour adapter dimensions et durée aux props, `staticFile()` pour les assets, `<Img>`/`<OffthreadVideo>`/`<Audio>`, polices chargées via `@remotion/fonts` (fournies hors-ligne par `@fontsource`), rendu déterministe (pas de `Math.random()`).

## 3. Prérequis

- **Node.js 20.3 ou plus récent** (LTS 20 ou 22 recommandées) et npm.
- Environ 1 Go d'espace disque pour les dépendances.
- **Aucun FFmpeg à installer** : Remotion embarque le sien.
- **Navigateur headless** : au premier rendu, Remotion télécharge automatiquement *Chrome Headless Shell* (accès Internet nécessaire une seule fois). Le Chromium de Playwright est utilisé automatiquement s'il est présent. Vous pouvez aussi indiquer un exécutable via `VIDEO_AGENT_BROWSER_EXECUTABLE`.
- Optionnel : des clés API (voir [Configuration](#6-configuration)) et, sous Linux, `espeak-ng` pour une voix-off hors-ligne.
- Linux : les bibliothèques système de Chrome (sur Debian/Ubuntu : `sudo apt install libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2`).

## 4. Installation Windows

Dans PowerShell :

```powershell
git clone https://github.com/SotissiRZ/video-agent.git
cd video-agent
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
# Optionnel : commande globale "video-agent"
powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Link
```

Le script vérifie Node.js, installe les dépendances, crée `.env` à partir de `.env.example`, compile le projet et lance `doctor`.

Installation manuelle équivalente :

```powershell
npm ci
copy .env.example .env
npm run build
node bin\video-agent.js doctor
```

## 5. Installation macOS / Linux

```bash
git clone https://github.com/SotissiRZ/video-agent.git
cd video-agent
./scripts/install.sh          # ou ./scripts/install.sh --link pour la commande globale
```

Installation manuelle équivalente :

```bash
npm ci
cp .env.example .env
npm run build
node bin/video-agent.js doctor
```

## 6. Configuration

### Configuration 100 % gratuite (recommandée pour commencer)

| Besoin | Service gratuit | Réglage |
|---|---|---|
| Photos et vidéos réelles | [Pexels](https://www.pexels.com/api/), [Pixabay](https://pixabay.com/api/docs/), [Unsplash](https://unsplash.com/developers) | `PEXELS_API_KEY`… |
| Textes (script, légendes) | [Groq](https://console.groq.com/keys) (offre gratuite), [Google Gemini](https://aistudio.google.com/apikey) via `OPENAI_COMPATIBLE_*`, ou **Ollama** (local, sans clé) | `GROQ_API_KEY` ou `OLLAMA_BASE_URL` |
| Voix-off | **Piper** : voix neuronales locales, préinstallées dans Docker et téléchargées automatiquement sinon | rien à faire (`VIDEO_AGENT_VOICE_PROVIDER=auto` ou `piper`) |
| Images IA | [Cloudflare Workers AI](https://dash.cloudflare.com/) (allocation quotidienne), [Hugging Face](https://huggingface.co/settings/tokens) (crédits mensuels) | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` ou `HF_TOKEN` |
| Musique | synthèse procédurale intégrée | rien à faire |
| Publication | API officielles de TikTok, Meta, YouTube, LinkedIn (gratuites) | § 15 |

Tout se règle aussi depuis l'onglet **Réglages** de l'interface web, sans éditer de fichier.

**Ollama (LLM local)** : avec Docker, ajoutez `COMPOSE_PROFILES=ollama` et `OLLAMA_BASE_URL=http://ollama:11434` dans `.env`, puis `docker compose up -d`. Sans Docker, installez [Ollama](https://ollama.com) et mettez `OLLAMA_BASE_URL=http://localhost:11434`. Le modèle (`OLLAMA_MODEL`, par défaut `qwen2.5:3b`, environ 2 Go) est téléchargé automatiquement au premier usage. Comptez 8 Go de RAM pour les modèles de 7-8 milliards de paramètres, plus précis.

**Piper (voix-off)** : choix de la voix avec `PIPER_VOICE_FR` / `PIPER_VOICE_EN` ([écouter les voix](https://rhasspy.github.io/piper-samples/)), débit avec `PIPER_LENGTH_SCALE`.

### Variables

Toute la configuration passe par des **variables d'environnement**, lues aussi depuis un fichier `.env` à la racine. Les vraies variables d'environnement sont prioritaires sur `.env`. Le fichier [`.env.example`](.env.example) documente chaque variable. **Aucune clé n'est versionnée** : `.env` est ignoré par git.

| Variable | Par défaut | Rôle |
|---|---|---|
| `VIDEO_AGENT_LLM_PROVIDER` | `auto` | `auto`, `anthropic`, `openai`, `groq`, `openai-compatible`, `local` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` / `ANTHROPIC_EFFORT` | — / `claude-opus-5-5` / `medium` | Claude |
| `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL` | — / `gpt-4.1-mini` / API OpenAI | OpenAI (LLM, TTS, images) |
| `GROQ_API_KEY` / `GROQ_MODEL` | — / `llama-3.3-70b-versatile` | Groq |
| `OPENAI_COMPATIBLE_BASE_URL` / `_MODEL` / `_API_KEY` | — | Ollama, LM Studio, OpenRouter, vLLM… |
| `VIDEO_AGENT_IMAGE_PROVIDER` | `none` | `none`, `auto`, `openai`, `replicate` |
| `REPLICATE_API_TOKEN` / `REPLICATE_IMAGE_MODEL` | — / `black-forest-labs/flux-schnell` | Images Replicate |
| `VIDEO_AGENT_VOICE_PROVIDER` | `auto` | `auto` (ElevenLabs puis OpenAI si une clé existe), `none`, `openai`, `elevenlabs`, `system` |
| `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` | — | Voix ElevenLabs |
| `VIDEO_AGENT_VIDEO_PROVIDER` / `REPLICATE_VIDEO_MODEL` | `none` / `minimax/video-01` | Clips IA (avec `--ai-video`) |
| `VIDEO_AGENT_MUSIC` | `auto` | `auto` (piste de `assets/music`, sinon synthèse), `procedural`, `assets`, `none` |
| `VIDEO_AGENT_DEFAULT_FORMAT` / `_DURATION` / `_FPS` / `_OUTPUT_FORMAT` | `landscape` / template / `30` / `mp4` | Valeurs par défaut |
| `VIDEO_AGENT_OUTPUT_DIR` / `VIDEO_AGENT_ASSETS_DIR` | `output` / `assets` | Dossiers |
| `VIDEO_AGENT_BROWSER_EXECUTABLE` | auto | Chrome/Chromium headless à utiliser |
| `VIDEO_AGENT_RENDER_CONCURRENCY` / `VIDEO_AGENT_CRF` | Remotion | Performance et qualité du rendu |
| `VIDEO_AGENT_X264_PRESET` / `VIDEO_AGENT_RENDER_GL` | `veryfast` / `auto` | Vitesse d'encodage et moteur graphique de Chrome |
| `VIDEO_AGENT_HOST` / `VIDEO_AGENT_PORT` | `127.0.0.1` / `3210` | Interface web |
| `VIDEO_AGENT_WEB_PASSWORD` | vide | Mot de passe de l'interface (nom d'utilisateur libre) |

Vérifier ce qui est actif :

```bash
node bin/video-agent.js providers   # fournisseurs résolus (sans afficher les clés)
node bin/video-agent.js doctor      # diagnostic complet
```

**Assets** : déposez logos, images, clips et musiques dans `assets/` (voir [`assets/README.md`](assets/README.md)). Les noms de fichiers servent de tags : `assets/images/chauffeur-moto-ouagadougou.jpg` sera choisi pour une scène qui parle de chauffeurs. Un `assets/sirago-logo.png` sera utilisé automatiquement pour la marque « Sirago ».

## 7. Utilisation CLI

Après `npm run build`, utilisez `node bin/video-agent.js …`, `npx video-agent …` ou `video-agent …` si vous avez fait `npm link`. En développement, sans build : `npm run dev -- "…"`.

```bash
# Le plus simple : tout est déduit de la phrase
video-agent "Crée une vidéo verticale de 30 secondes pour promouvoir Sirago auprès des chauffeurs au Burkina Faso."

# Tout forcer
video-agent "Présente notre application de livraison" \
  --format square --duration 20 --fps 60 --style tech --template app-demo \
  --output-format webm --language fr --no-voice --out output/livraison

# Résolution exacte, GIF
video-agent "Annonce de l'ouverture du restaurant Chez Awa à Dakar" -r 720x720 -o gif

# Sans appel LLM, sans rendu (génère seulement le projet Remotion)
video-agent "Tutoriel : installer l'application" --offline --no-render
```

| Option | Description |
|---|---|
| `-f, --format` | `landscape`, `vertical`, `square`, `portrait` ou `LxH` |
| `-r, --resolution` | Résolution exacte `LxH` |
| `-d, --duration` | Durée en secondes |
| `--fps` | Images par seconde |
| `-s, --style` / `-t, --template` / `-l, --language` | Style, template, langue (`auto` par défaut) |
| `-o, --output-format` | `mp4`, `webm`, `mov`, `gif` |
| `--[no-]voice`, `--[no-]music`, `--[no-]subtitles` | Activer ou désactiver voix-off, musique, sous-titres |
| `--no-images`, `--ai-video` | Désactiver la génération d'images / activer les clips IA |
| `--llm <provider>`, `--offline` | Choisir le LLM / planification procédurale uniquement |
| `--no-render`, `--out <dir>`, `--json` | Projet seul / dossier de sortie / résultat JSON |

Autres commandes :

```bash
video-agent templates | styles | formats | providers | doctor
video-agent render output/<job>            # re-rendre après avoir édité storyboard.json
video-agent render output/<job> -o webm
video-agent validate output/<job>/storyboard.json
video-agent studio output/<job>            # ouvrir le job dans Remotion Studio
video-agent web                            # interface web
```

Raccourcis npm : `npm run demo` (génère la vidéo Sirago dans `output/demo`), `npm run web`, `npm run studio`, `npm run doctor`.

## 8. Utilisation de l'interface web

```bash
npm run web            # ou : video-agent web --port 8080
```

Ouvrez **http://127.0.0.1:3210**. L'interface comporte quatre onglets :

- **🎬 Créer** :
  - le prompt, avec des exemples en un clic ;
  - le format choisi visuellement (9:16, 16:9, 1:1, 4:5), la durée (3 s à 10 min), le style et le template ;
  - des interrupteurs pour la voix-off, les sous-titres, la musique et les photos réelles ;
  - des options avancées : fps, conteneur, langue, résolution exacte, couverture en visuels.

  La progression des 12 étapes s'affiche en direct, puis l'aperçu, les téléchargements et le panneau de publication.
- **⚙️ Réglages** : toutes les clés et options, groupées par usage, avec les services **gratuits** signalés et un lien pour obtenir chaque clé. Les valeurs sont écrites dans `.env` et appliquées sans redémarrage. Les clés ne sont jamais réaffichées. Pour désactiver cette page : `VIDEO_AGENT_SETTINGS_UI=false`.
- **🗓 Programmées** : les publications en attente, annulables.
- **📁 Historique** : les vidéos déjà générées.

Les badges en haut à droite indiquent l'état des fournisseurs. Un point bleu signale un service gratuit, un point vert un service payant configuré.

Les tâches sont mises en file et exécutées une à la fois, car le rendu sollicite fortement le processeur. Le serveur écoute sur `127.0.0.1` par défaut et refuse les requêtes d'écriture venant d'un autre site. Pour y accéder depuis un autre appareil (téléphone, autre PC), définissez d'abord `VIDEO_AGENT_WEB_PASSWORD` (ou dans **Réglages → Sécurité**) : le navigateur demandera ce mot de passe, avec un nom d'utilisateur libre. Sans mot de passe, le serveur affiche un avertissement s'il écoute sur le réseau.

**Durée** : jusqu'à 10 minutes. Pour les vidéos longues, l'agent ajoute des scènes (chaque type de scène répétable apparaît au plus 3 fois), puis allonge les scènes. Avec un LLM, chaque scène reçoit un texte différent ; sans LLM, les textes génériques se répètent davantage. Le rendu prend environ 1 minute pour 10 s de vidéo en 1080p sur 4 cœurs.

API : `GET /api/options`, `GET|PUT /api/settings`, `GET|POST /api/jobs`, `GET|DELETE /api/jobs/:id`, `GET /api/jobs/:id/events` (SSE), `GET /api/jobs/:id/video[?download=1]`, `GET /api/jobs/:id/poster`, `GET /api/jobs/:id/files/{storyboard.json|script.md|subtitles.srt|subtitles.vtt}`.

## 9. Ajouter un provider

Chaque famille (LLM, image, voix, vidéo) a une interface et un registre. Un provider est une *factory* qui renvoie `null` quand il n'est pas configuré.

**LLM** : implémentez `LLMProvider` (`src/llm/types.ts`) :

```ts
import { registerLLMProvider, type LLMProvider } from 'video-agent';

class MistralProvider implements LLMProvider {
  readonly id = 'mistral';
  constructor(readonly model: string, private apiKey: string) {}
  async generate(req) {
    // appelez l'API, renvoyez { text, provider: this.id, model: this.model }
  }
}

registerLLMProvider('mistral', ({ env }) =>
  process.env.MISTRAL_API_KEY ? new MistralProvider('mistral-large-latest', process.env.MISTRAL_API_KEY) : null);
```

Si le service parle le protocole OpenAI Chat Completions, aucun code n'est nécessaire : utilisez `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_MODEL` et `OPENAI_COMPATIBLE_API_KEY`.

**Image / voix / vidéo** : implémentez `ImageProvider`, `VoiceProvider` (doit écrire un WAV PCM 16 bits et renvoyer sa durée) ou `VideoProvider`, puis appelez `registerImageProvider`, `registerVoiceProvider` ou `registerVideoProvider`.

Pour intégrer un provider au dépôt :

1. Ajoutez le fichier dans `src/llm/providers/` ou `src/providers/<famille>/`.
2. Enregistrez-le dans le `registry.ts` correspondant.
3. Ajoutez ses variables à `src/config/config.ts` et à `.env.example` (un test vérifie que les deux sont synchronisés).
4. Ajoutez un test avec un double (aucun appel réseau dans les tests).

## 10. Ajouter un template

Un template décrit une **structure narrative** (scènes, poids de durée, scènes optionnelles ou répétables), des **mots-clés** pour la sélection automatique, une **direction créative** pour le LLM et une **rédaction hors-ligne** FR/EN.

```ts
// src/templates/builtin/webinar.ts
import { tr } from '../helpers';
import type { TemplateDefinition } from '../types';

export const webinar: TemplateDefinition = {
  id: 'webinar',
  name: 'Webinaire',
  description: 'Invitation à un webinaire : sujet, intervenants, programme, inscription.',
  keywords: ['webinaire', 'webinar', 'conference en ligne', 'live'],
  defaultStyle: 'corporate',
  defaultDurationSec: 25,
  scenes: [
    { role: 'hook', kind: 'title', weight: 1, purpose: 'Annoncer le sujet.' },
    { role: 'agenda', kind: 'bullets', weight: 1.5, repeatable: true, purpose: '3 points du programme.' },
    { role: 'speaker', kind: 'quote', weight: 1, optional: true, purpose: "Citation de l'intervenant." },
    { role: 'cta', kind: 'cta', weight: 1, purpose: "Lien d'inscription." },
  ],
  guidance: 'Professionnel, concret, date et heure si présentes dans la demande.',
  concept: (ctx) => { const t = tr(ctx); return { title: t(`Webinaire ${ctx.subject}`, `${ctx.subject} webinar`), /* … */ } as any; },
  copy: (ctx) => ({ hook: [/* … */], agenda: [/* … */], speaker: [/* … */], cta: [/* … */] }),
};
```

Enregistrez-le ensuite dans `src/templates/registry.ts`, ou depuis votre code avec `registerTemplate(webinar)`. Les tests vérifient automatiquement que chaque rôle a un texte en français et en anglais.

**Nouveau type de scène** : ajoutez le type dans `SCENE_KINDS` (`src/remotion/contract/storyboard.ts`), créez le composant dans `src/remotion/scenes/` et ajoutez-le à `SCENE_COMPONENTS`. **Nouveau style** : ajoutez une entrée dans `src/remotion/contract/styles.ts`.

## 11. Génération d'une vidéo : ce qui se passe

```bash
npm run demo
```

```
[ 1/12]   1% ✔ advertisement · 1080×1920 · 30s · 30 fps · style vibrant · fr · marque Sirago · cible chauffeurs
[ 2/12]   9% ✔ « Sirago — publicité » — Sirago, pensé pour les chauffeurs.
[ 3/12]  20% ✔ 6 scènes écrites
…
[11/12]  98% ✔ video.mp4 (30.0s)
[12/12] 100% ✔ …/output/demo/video.mp4
```

Contenu de `output/<job>/` :

| Fichier | Contenu |
|---|---|
| `video.mp4` | Vidéo finale |
| `poster.jpg` | Miniature |
| `storyboard.json` / `props.json` | Projet Remotion (props de la composition `VideoAgent`) |
| `script.md` | Concept et script scène par scène |
| `subtitles.srt` / `subtitles.vtt` | Sous-titres |
| `public/` | Médias, voix-off, musique utilisés |
| `brief.json`, `concept.json`, `job.json` | Traçabilité (options, fournisseurs, avertissements, durées) |

**Retoucher puis re-rendre** : éditez `storyboard.json` (textes, durées, couleurs, ordre des scènes…), puis lancez `video-agent render output/<job>`. Pour une prévisualisation en direct, utilisez `video-agent studio output/<job>`.

**Avec un LLM**, le concept et le script sont écrits par le modèle, qui respecte la structure du template. La sortie est validée et, en cas d'échec, l'agent revient au planificateur procédural avec un avertissement.

## 12. Résolution des problèmes courants

| Symptôme | Solution |
|---|---|
| `Node.js … 20.3 ou plus récente est requise` | Installez Node.js LTS (`winget install OpenJS.NodeJS.LTS`, `brew install node@22`, nvm…). |
| `Video Agent is not built yet` | Lancez `npm run build`, ou utilisez `npm run dev -- "…"`. |
| Échec du téléchargement de Chrome Headless Shell (403, proxy, hors-ligne) | Indiquez un Chromium existant : `VIDEO_AGENT_BROWSER_EXECUTABLE=/chemin/vers/chrome-headless-shell`. Le Chromium de Playwright est détecté automatiquement. |
| Linux : `error while loading shared libraries` au rendu | Installez les bibliothèques listées dans les [Prérequis](#3-prérequis). |
| Docker sous Windows : `entrypoint.sh: not found` ou `\r: command not found` | Fins de ligne Windows (CRLF). Le dépôt force maintenant LF (`.gitattributes`). Sur un clone existant : `git rm --cached -r . -q` puis `git reset --hard`, puis `docker compose build --no-cache`. |
| Rendu lent | Comptez environ 1 min pour 30 s en 1080x1920 sur 4 cœurs. Vérifiez `VIDEO_AGENT_RENDER_GL=auto` (le mode `swangle` est ~3,5 fois plus lent), augmentez `VIDEO_AGENT_RENDER_CONCURRENCY` jusqu'au nombre de cœurs, gardez `VIDEO_AGENT_X264_PRESET=veryfast`, ou utilisez `--no-render` pour itérer sur le storyboard. |
| `LLM concept failed, using procedural concept` | Clé invalide, quota atteint ou réponse non conforme. La vidéo est quand même produite. Vérifiez avec `video-agent providers`. |
| Aucune photo/vidéo réelle dans la vidéo | Ajoutez au moins une clé gratuite (`PEXELS_API_KEY`…) ou des fichiers dans `assets/`. `video-agent doctor` affiche les sources actives, `credits.md` celles utilisées. |
| Publication : `HTTP 401` | Jeton expiré ou révoqué : relancez `video-agent auth <plateforme> --save`. |
| Publication : `HTTP 403` | Permission ou scope manquant, ou app non approuvée pour cette action (voir le tableau du § 15). |
| Vidéo YouTube restée privée | Normal tant que le projet Google Cloud n'a pas passé l'audit YouTube API. |
| Publication programmée non envoyée | Le planificateur doit tourner : `video-agent web`, le service Docker `web` ou `video-agent scheduler`. Vérifiez avec `video-agent schedule`. |
| Pas de voix-off | Aucun fournisseur de voix configuré. Ajoutez `ELEVENLABS_API_KEY` ou `OPENAI_API_KEY`, ou `VIDEO_AGENT_VOICE_PROVIDER=system` (installez `espeak-ng` sous Linux). |
| Polices différentes de l'aperçu | Les polices (Montserrat, Inter) sont embarquées. Vérifiez qu'aucune erreur `could not load font` n'apparaît avec `VIDEO_AGENT_LOG_LEVEL=debug`. |
| Port 3210 occupé | `video-agent web --port 8080` ou `VIDEO_AGENT_PORT`. |
| `Invalid storyboard` après édition manuelle | `video-agent validate output/<job>/storyboard.json` liste les erreurs (durées incohérentes, assets manquants…). |
| PowerShell refuse le script | `powershell -ExecutionPolicy Bypass -File scripts\install.ps1` |

Pour tout autre problème : `VIDEO_AGENT_LOG_LEVEL=debug` affiche le détail de chaque étape et la pile d'erreur.

---

## 13. Docker

L'architecture conteneurisée contient tout le nécessaire : Node.js, Chrome headless, le FFmpeg de Remotion, les polices et `espeak-ng`. Rien d'autre n'est à installer sur la machine hôte que Docker Desktop (Windows/macOS) ou Docker Engine (Linux).

```
┌──────────────────────── docker compose ────────────────────────┐
│  web  (toujours actif)                cli  (à la demande)      │
│  ├─ interface web + API  :3210        ├─ génération / rendu    │
│  ├─ file de rendu                     ├─ publish / captions    │
│  └─ planificateur de publications     └─ auth (port 8765)      │
│                 même image : video-agent:latest                 │
└───────────────┬───────────────┬───────────────┬────────────────┘
          ./output        ./assets       ./.video-agent      ./.env
       (vidéos, jobs)   (vos médias)   (jetons OAuth)   (configuration)
```

```bash
cp .env.example .env                 # obligatoire avant le premier lancement, puis complétez vos clés
docker compose build                 # construit l'image (télécharge Chrome Headless Shell)
docker compose up -d web             # http://localhost:3210

# Commandes ponctuelles (même image, mêmes volumes)
docker compose run --rm cli "Crée une vidéo verticale de 30 secondes pour promouvoir Sirago…"
docker compose run --rm cli publish output/<job> --to tiktok,instagram --yes
docker compose run --rm cli doctor
docker compose run --rm --service-ports cli auth youtube --save   # --service-ports : expose le port 8765 du retour OAuth

docker compose logs -f web           # journaux (dont le planificateur)
docker compose down                  # arrêt
```

- **Windows** : utilisez PowerShell dans le dossier du projet, avec les mêmes commandes. `copy .env.example .env` remplace `cp`.
- **`.env` doit exister** avant `docker compose up`. Sinon, Docker crée un *dossier* `.env` à sa place.
- **Navigateur** : si `remotion.media` est inaccessible (proxy d'entreprise), construisez avec le Chromium de Debian : `VIDEO_AGENT_DOCKER_BROWSER=debian docker compose build`.
- **Sécurité** : l'interface n'est exposée que sur `127.0.0.1` de l'hôte. Pour l'ouvrir au réseau, remplacez `127.0.0.1:` par `0.0.0.0:` dans `ports` **et** définissez `VIDEO_AGENT_WEB_PASSWORD` ; sur un serveur public, ajoutez un reverse proxy HTTPS devant.
- **Ressources** : `shm_size: 1gb` est requis par Chrome. Réglez `VIDEO_AGENT_RENDER_CONCURRENCY` selon les cœurs alloués à Docker.
- **Planificateur** : il tourne dans le service `web`, qui doit rester démarré (`restart: unless-stopped`) pour que les publications programmées partent à l'heure.

## 14. Visuels : photos, vidéos et images IA

Pour chaque scène, l'agent cherche un visuel dans l'ordre de `VIDEO_AGENT_MEDIA_SOURCES` (par défaut `assets,stock,ai`) :

1. **`assets`** : vos fichiers dans `assets/` (logo, photos, clips), sélectionnés selon les mots de leur nom. C'est le meilleur choix pour une vraie marque : vos produits, vos clients, votre ville.
2. **`stock`** : banques gratuites, avec des clés gratuites à créer en quelques minutes :
   - [Pexels](https://www.pexels.com/api/) (photos et vidéos) → `PEXELS_API_KEY`
   - [Pixabay](https://pixabay.com/api/docs/) (photos et vidéos) → `PIXABAY_API_KEY`
   - [Unsplash](https://unsplash.com/developers) (photos) → `UNSPLASH_ACCESS_KEY`

   Les requêtes vont du plus précis au plus général : mots-clés de la scène, puis public et lieu, puis une idée générique liée au rôle de la scène. Les clips vidéo et les photos sont alternés. Un média n'est jamais réutilisé dans la même vidéo.
3. **`ai`** : génération d'images si rien n'a été trouvé : Cloudflare Workers AI et Hugging Face (gratuits), puis Replicate (FLUX), Stability AI ou OpenAI. Le nombre d'images est limité par `VIDEO_AGENT_MAX_GENERATED_IMAGES`. Les clips IA (Replicate) s'activent avec `--ai-video`.
4. **Sinon** : fond animé procédural, comme dans le mode hors-ligne.

**Photos animées** : chaque photo reçoit un mouvement de caméra lent (zoom avant ou arrière avec un panoramique), différent d'une photo à l'autre. Une vidéo faite uniquement de photos, gratuite, paraît ainsi filmée, sans générateur de clips payant.

`VIDEO_AGENT_MEDIA_COVERAGE=all` met un visuel dans chaque scène, avec un voile sombre pour garder le texte lisible. `visual` le limite aux scènes « image ». Options CLI : `--media all|visual|none`, `--no-stock`, `--no-images`.

**Crédits** : `credits.md` liste l'auteur et la source de chaque média. Avec `VIDEO_AGENT_CAPTION_CREDITS=true`, ils sont ajoutés aux descriptions YouTube, Facebook et LinkedIn, comme le demandent les conditions d'Unsplash.

## 15. Publication sur les réseaux sociaux

```bash
video-agent platforms                                   # ce qui est configuré
video-agent captions output/<job>                       # génère captions.json (modifiable) et l'affiche
video-agent publish output/<job> --to tiktok,instagram,facebook,youtube,linkedin
video-agent publish output/<job> --to all --at "2026-10-06 18:30"   # programmation
video-agent publish output/<job> --to youtube --dry-run             # vérifier sans publier

# Tout en une commande : générer, puis publier
video-agent "Crée une vidéo verticale de 30 s pour Sirago…" --publish tiktok,instagram,youtube --yes
```

- **Légendes** : un texte, des hashtags et un titre par plateforme, rédigés par le LLM avec le ton de chaque réseau, ou construits à partir du concept en mode hors-ligne. Ils sont enregistrés dans `output/<job>/captions.json`, que vous pouvez modifier avant de publier. Dans l'interface web, ils sont modifiables directement avant l'envoi.
- **Vérifications** : avant tout envoi, l'agent contrôle le format (MP4), la durée, le poids et l'orientation. Il signale par exemple une vidéo horizontale destinée à TikTok.
- **Programmation** : YouTube et Facebook gèrent la programmation eux-mêmes. Pour TikTok, Instagram et LinkedIn, la publication est mise en file dans `output/schedule.json` et envoyée à l'heure par le planificateur local (`video-agent web`, le service Docker `web` ou `video-agent scheduler`).
- **Historique** : chaque tentative est consignée dans `output/<job>/publish.json`.
- **Confirmation** : la CLI demande confirmation avant de publier (`--yes` pour l'automatisation).

### Configurer chaque plateforme

Les identifiants vont dans `.env`. L'assistant `video-agent auth <plateforme> --save` réalise la connexion OAuth et écrit les jetons obtenus. Les jetons qui se renouvellent sont conservés dans `.video-agent/tokens.json`.

| Plateforme | À créer | Variables | Particularités |
|---|---|---|---|
| **YouTube** | Projet [Google Cloud](https://console.cloud.google.com/) → activer *YouTube Data API v3* → écran de consentement OAuth → identifiant OAuth de type **Application de bureau** | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, puis `video-agent auth youtube --save` | Tant que le projet n'a pas passé l'audit de Google, les vidéos envoyées par l'API restent **privées**. Une vidéo verticale de 3 min maximum devient un Short. |
| **TikTok** | App sur [developers.tiktok.com](https://developers.tiktok.com/) avec *Login Kit* et *Content Posting API*, et redirect URI `http://localhost:8765/callback` | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, puis `video-agent auth tiktok --save` | `TIKTOK_MODE=draft` (défaut) : la vidéo arrive dans votre boîte de réception TikTok, à publier en 2 clics. `direct` : publication directe, mais forcée en privé tant que l'app n'est pas auditée par TikTok. |
| **Facebook** | App [Meta for Developers](https://developers.facebook.com/) (type Business), Page Facebook dont vous êtes admin | `META_APP_ID`, `META_APP_SECRET`, puis `video-agent auth meta --token <jeton> --save` | Générez le jeton dans le *Graph API Explorer* avec `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `instagram_basic`, `instagram_content_publish`. L'assistant le convertit en jeton de Page permanent. Une vidéo verticale de 90 s maximum est publiée en Reel. |
| **Instagram** | Compte Instagram **professionnel** (Business ou Créateur) **lié à la Page Facebook** | `INSTAGRAM_USER_ID`, rempli par `auth meta` | Publié en Reel, envoi direct du fichier, sans URL publique. |
| **LinkedIn** | App sur [developer.linkedin.com](https://developer.linkedin.com/) avec les produits *Sign In with LinkedIn (OpenID)* et *Share on LinkedIn* (profil), ou *Community Management API* (page entreprise), et redirect URI `http://localhost:8765/callback` | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, puis `video-agent auth linkedin --save` (ajoutez `--organization <id>` pour une page entreprise) | Le jeton d'accès dure 60 jours ; relancez `auth linkedin` à l'expiration si votre app n'a pas de refresh token. |

Si le retour automatique sur `localhost` n'est pas possible (machine distante, redirect URI imposée), utilisez `--manual` pour coller l'URL de retour, ou `--redirect-uri <uri>`.

> ⚠️ Les plateformes imposent leurs propres règles : vérification ou audit des applications, quotas d'envoi, droits sur la musique et les images. Les médias des banques intégrées et la musique synthétisée sont libres de droits. Si vous utilisez votre propre musique, assurez-vous d'en avoir les droits.

---

## Développement

```bash
npm run typecheck     # TypeScript strict
npm test              # tests unitaires et d'intégration (rapides, sans réseau)
npm run test:render   # rendu Remotion réel (navigateur requis)
npm run build         # compile la CLI dans dist/
npm run studio        # Remotion Studio sur le storyboard de démonstration
```

Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Code de Video Agent : MIT. **Remotion a sa propre licence** : gratuite pour les particuliers, les associations et les entreprises de 3 personnes au plus, licence d'entreprise payante au-delà. Voir [remotion.dev/license](https://www.remotion.dev/license).
