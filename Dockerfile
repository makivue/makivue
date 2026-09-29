# Node 22 LTS: Prisma 7 requires Node 20.19+ / 22.12+ / 24.0+.
ARG NODE_IMAGE=node:22-alpine3.21

# CI builds and uploads the environment-specific Next.js output. Install only
# production dependencies here, including the Prisma CLI and PM2 used at startup.
FROM ${NODE_IMAGE} AS runtime-dependencies

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY scripts/prune-runtime-swc.mjs ./scripts/prune-runtime-swc.mjs

RUN npm ci --omit=dev \
    && node scripts/prune-runtime-swc.mjs \
    && npm cache clean --force


FROM ${NODE_IMAGE} AS runtime

# fluent-ffmpeg is only a Node wrapper; ffmpeg/ffprobe must be present in the
# runtime image. PM2 and Prisma are supplied by the dependency stage above.
RUN apk add --no-cache curl ffmpeg

ENV FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    PATH=/app/node_modules/.bin:$PATH

WORKDIR /app

COPY --from=runtime-dependencies /app/node_modules ./node_modules
# .dockerignore removes build caches and the separate Next.js dev output before
# COPY, so they never occupy a layer in the final image.
COPY .next ./.next
COPY public ./public
COPY prisma ./prisma
COPY scripts ./scripts
COPY skills ./skills
COPY bin ./bin
COPY package.json next.config.ts prisma.config.ts tsconfig.json ./
COPY oss.js docker-entrypoint.sh pm2.config.js healthcheck.js ./

RUN mkdir -p logs \
    && chmod +x docker-entrypoint.sh \
    && if [ -f ./bin/start.sh ]; then chmod +x ./bin/start.sh; fi

# Application traffic and internal Prometheus scraping (Grafana datasource).
EXPOSE 3000 9100

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node healthcheck.js || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
