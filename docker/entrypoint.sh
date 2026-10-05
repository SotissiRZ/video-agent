#!/bin/sh
# Point d'entrée : "web" (défaut) lance l'interface, sinon les arguments sont passés à la CLI.
set -e

# Image construite avec BROWSER=debian : utiliser Chromium du système si rien n'est configuré.
if [ -z "$VIDEO_AGENT_BROWSER_EXECUTABLE" ] && [ -x /usr/bin/chromium ] && [ ! -d /app/node_modules/.remotion/chrome-headless-shell ]; then
  export VIDEO_AGENT_BROWSER_EXECUTABLE=/usr/bin/chromium
fi

if [ "$#" -eq 0 ]; then set -- web; fi
exec node /app/bin/video-agent.js "$@"
