# syntax=docker/dockerfile:1.7
# =============================================================================
# Video Agent — image Docker (Debian, glibc : requis par le FFmpeg embarqué de Remotion)
#
#   docker compose up -d web                 # interface web + API + planificateur
#   docker compose run --rm cli "Crée une vidéo…"
#
# ARG BROWSER :
#   remotion (défaut) : Chrome Headless Shell téléchargé par Remotion au build (recommandé)
#   debian            : Chromium des dépôts Debian (si remotion.media est inaccessible)
# =============================================================================
ARG NODE_VERSION=22

# ---------- build : dépendances complètes + compilation de la CLI ----------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build

# ---------- runtime ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG BROWSER=remotion
ENV NODE_ENV=production \
    VIDEO_AGENT_HOST=0.0.0.0 \
    VIDEO_AGENT_PORT=3210 \
    VIDEO_AGENT_OUTPUT_DIR=/app/output \
    VIDEO_AGENT_ASSETS_DIR=/app/assets \
    VIDEO_AGENT_AUTH_BIND_HOST=0.0.0.0 \
    REMOTION_DISABLE_TELEMETRY=1

# Bibliothèques nécessaires à Chrome headless (+ espeak-ng pour la voix-off hors-ligne, tini pour les signaux).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl tini espeak-ng \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 \
      libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 libdrm2 libxshmfence1 fonts-liberation \
    && if [ "$BROWSER" = "debian" ]; then apt-get install -y --no-install-recommends chromium; fi \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# Les compositions Remotion sont bundlées au moment du rendu depuis les sources.
COPY src ./src
COPY tsconfig.json ./
COPY bin ./bin
COPY web ./web
COPY .env.example ./

# Navigateur de rendu.
RUN if [ "$BROWSER" = "remotion" ]; then npx remotion browser ensure; fi

# Piper : voix-off neuronale gratuite et locale (binaire + voix FR/EN préinstallés).
ARG TARGETARCH
ARG PIPER_VOICES="fr_FR-siwis-medium en_US-lessac-medium"
ENV PIPER_DATA_DIR=/opt/piper
RUN set -e; mkdir -p /opt/piper/voices; \
    case "${TARGETARCH:-amd64}" in arm64) PA=aarch64 ;; arm) PA=armv7l ;; *) PA=x86_64 ;; esac; \
    curl -fsSL "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_${PA}.tar.gz" | tar -xz -C /opt/piper; \
    for v in $PIPER_VOICES; do \
      lang="${v%%_*}"; rest="${v#*_}"; region="${rest%%-*}"; tail="${v#*-}"; name="${tail%-*}"; quality="${v##*-}"; \
      base="https://huggingface.co/rhasspy/piper-voices/resolve/main/${lang}/${lang}_${region}/${name}/${quality}/${v}.onnx"; \
      curl -fsSL -o "/opt/piper/voices/${v}.onnx" "$base"; curl -fsSL -o "/opt/piper/voices/${v}.onnx.json" "${base}.json"; \
    done; \
    chown -R node:node /opt/piper

RUN mkdir -p /app/output /app/assets /app/.video-agent /app/node_modules/.cache /app/node_modules/.remotion \
    && chown -R node:node /app/output /app/assets /app/.video-agent /app/node_modules/.cache /app/node_modules/.remotion \
    && ln -s /app/bin/video-agent.js /usr/local/bin/video-agent

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

USER node
EXPOSE 3210 8765
VOLUME ["/app/output", "/app/assets", "/app/.video-agent"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.VIDEO_AGENT_PORT||3210)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--", "entrypoint.sh"]
CMD ["web"]
