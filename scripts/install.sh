#!/usr/bin/env bash
# Installation de Video Agent (Linux / macOS).
# Usage : ./scripts/install.sh [--link]
set -euo pipefail
cd "$(dirname "$0")/.."

green() { printf '\033[32m%s\033[0m\n' "$1"; }
red() { printf '\033[31m%s\033[0m\n' "$1"; }

echo "🎬 Installation de Video Agent"

if ! command -v node >/dev/null 2>&1; then
  red "Node.js est introuvable. Installez Node.js 20 LTS ou plus récent : https://nodejs.org"
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 3 ]; }; then
  red "Node.js $(node -v) détecté : la version 20.3 ou plus récente est requise."
  exit 1
fi
green "✔ Node.js $(node -v)"

echo "→ Installation des dépendances…"
if [ -f package-lock.json ]; then npm ci; else npm install; fi

if [ ! -f .env ]; then
  cp .env.example .env
  green "✔ Fichier .env créé (à compléter avec vos clés API si besoin)"
else
  green "✔ Fichier .env existant conservé"
fi

echo "→ Compilation…"
npm run build

if [ "${1:-}" = "--link" ]; then
  echo "→ Installation de la commande globale video-agent (npm link)…"
  npm link
fi

echo
node bin/video-agent.js doctor || true
echo
green "Installation terminée !"
echo "Essayez :"
echo "  npm run demo"
echo "  node bin/video-agent.js \"Crée une vidéo de 20 secondes pour présenter mon application\""
echo "  npm run web   (interface web sur http://127.0.0.1:3210)"
