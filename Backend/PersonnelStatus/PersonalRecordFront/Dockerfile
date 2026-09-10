# syntax=docker/dockerfile:1
# Многоэтапная сборка: deps → builder → runner.
# В образ прода уезжает ТОЛЬКО standalone-вывод (.next/standalone, .next/static,
# public) — полного node_modules в рантайме нет.
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------- deps
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps && npm cache clean --force

# ---------------------------------------------------------------- builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* встраиваются в бандл на этапе сборки
ARG NEXT_PUBLIC_MEDIA_URL=http://10.15.3.187:8100
ENV NEXT_PUBLIC_MEDIA_URL=$NEXT_PUBLIC_MEDIA_URL
ENV NODE_ENV=production
# Сборке нужен запас кучи (рантайму — нет, см. runner)
ENV NODE_OPTIONS=--max-old-space-size=2048
# NextAuth fail-closed config is evaluated during prerender too. Use a
# non-secret value only for this build command; runtime receives the real
# NEXTAUTH_SECRET from the deployment environment.
# Dependencies are already complete in the deps stage. Calling the host-facing
# npm wrapper here would require bash on Alpine and would try to bootstrap a
# second tree after NODE_ENV=production has hidden build-time devDependencies.
RUN NEXTAUTH_SECRET=build-only-placeholder ./node_modules/.bin/next build

# ---------------------------------------------------------------- prod-deps
# sharp и его нативные зависимости ставятся из зафиксированного package-lock.
# Нужен весь production-граф: standalone не несёт sharp, а npm ci гарантирует
# версии его транзитивных пакетов в рантайм-образе.
FROM base AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

# ---------------------------------------------------------------- runner
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Рантайм standalone-сервера: 512 МБ кучи под mem_limit=1g (V8 + RSS-накладные
# ~1.6x). Поднимать вместе с лимитом контейнера, не по отдельности.
ENV NODE_OPTIONS=--max-old-space-size=512

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Каталог кеша ISR/изображений — точка монтирования tmpfs из compose
RUN mkdir -p .next/cache && chown -R nextjs:nodejs .next/cache

USER nextjs

ARG PORT=3100
ENV PORT=$PORT
ENV HOSTNAME="0.0.0.0"
EXPOSE $PORT

# standalone-сервер, не `next dev` и не `next start`
CMD ["node", "server.js"]
