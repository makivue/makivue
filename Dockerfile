FROM node:22-bookworm-slim AS app
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN SKIP_LOCAL_WORKERS=1 npx next build --webpack
ENV NODE_ENV=production LOCAL_DATA_DIR=/app/data
EXPOSE 3000
VOLUME ["/app/data"]
# Bind the host port to loopback: -p 127.0.0.1:3000:3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
