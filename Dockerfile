# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S drawsync -u 1001 -G nodejs

USER drawsync

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "dist/server.js"]
