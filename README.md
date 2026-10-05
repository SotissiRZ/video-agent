# 🎬 Video Agent

**Agent autonome de génération vidéo.** Décrivez la vidéo en une phrase et l'agent fait le reste, du concept au fichier MP4 final. Le rendu est effectué localement avec [Remotion](https://www.remotion.dev).

```bash
video-agent "Crée une vidéo verticale de 30 secondes pour promouvoir Sirago auprès des chauffeurs au Burkina Faso."
```

Il produit `output/<job>/video.mp4` (1080×1920, 30 s, 30 fps), avec animations, transitions, sous-titres incrustés, musique et, en option, une voix-off. Il génère aussi le script, le storyboard, un projet Remotion éditable, les sous-titres SRT/VTT et une miniature.

- **Fonctionne sans aucune clé API** (mode local/procédural) sur Windows, macOS et Linux.
- **Multi-fournisseurs, tous optionnels** : Claude, OpenAI, Groq, tout serveur compatible OpenAI (Ollama, LM Studio…), images (OpenAI, Replicate), voix (ElevenLabs, OpenAI, voix système), clips vidéo (Replicate).
- **CLI + interface web locale** avec progression en direct et prévisualisation.

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
| `VIDEO_AGENT_HOST` / `VIDEO_AGENT_PORT` | `127.0.0.1` / `3210` | Interface web |

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

Ouvrez **http://127.0.0.1:3210**. Depuis l'interface, vous pouvez :

- saisir le prompt ;
- choisir le format, la durée, le style, le template, les fps, le conteneur, la langue et une résolution personnalisée ;
- activer ou désactiver les sous-titres, la musique, la voix-off et le mode hors-ligne ;
- lancer la génération et suivre les 12 étapes en direct (Server-Sent Events) ;
- prévisualiser la vidéo et la télécharger, ainsi que le storyboard, le script et les sous-titres ;
- parcourir l'historique des vidéos générées.

Les tâches sont mises en file et exécutées une à la fois, car le rendu sollicite fortement le processeur. Le serveur écoute sur `127.0.0.1` par défaut. Ne l'exposez pas sur un réseau public sans protection.

API : `GET /api/options`, `GET|POST /api/jobs`, `GET|DELETE /api/jobs/:id`, `GET /api/jobs/:id/events` (SSE), `GET /api/jobs/:id/video[?download=1]`, `GET /api/jobs/:id/poster`, `GET /api/jobs/:id/files/{storyboard.json|script.md|subtitles.srt|subtitles.vtt}`.

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
| Rendu lent | Réduisez la résolution ou les fps, augmentez `VIDEO_AGENT_RENDER_CONCURRENCY` (≈ nombre de cœurs), utilisez `--no-render` pour itérer sur le storyboard. |
| `LLM concept failed, using procedural concept` | Clé invalide, quota atteint ou réponse non conforme. La vidéo est quand même produite. Vérifiez avec `video-agent providers`. |
| Pas de voix-off | Aucun fournisseur de voix configuré. Ajoutez `ELEVENLABS_API_KEY` ou `OPENAI_API_KEY`, ou `VIDEO_AGENT_VOICE_PROVIDER=system` (installez `espeak-ng` sous Linux). |
| Polices différentes de l'aperçu | Les polices (Montserrat, Inter) sont embarquées. Vérifiez qu'aucune erreur `could not load font` n'apparaît avec `VIDEO_AGENT_LOG_LEVEL=debug`. |
| Port 3210 occupé | `video-agent web --port 8080` ou `VIDEO_AGENT_PORT`. |
| `Invalid storyboard` après édition manuelle | `video-agent validate output/<job>/storyboard.json` liste les erreurs (durées incohérentes, assets manquants…). |
| PowerShell refuse le script | `powershell -ExecutionPolicy Bypass -File scripts\install.ps1` |

Pour tout autre problème : `VIDEO_AGENT_LOG_LEVEL=debug` affiche le détail de chaque étape et la pile d'erreur.

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
