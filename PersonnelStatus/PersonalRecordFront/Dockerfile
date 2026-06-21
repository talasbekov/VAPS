# Многоэтапная сборка для оптимизации размера
FROM node:18-alpine AS base

# Устанавливаем зависимости (включая dev для сборки)
FROM base AS deps
WORKDIR /app

# Копируем файлы зависимостей
COPY package.json ./
RUN npm install --legacy-peer-deps && npm cache clean --force

# Этап сборки
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Передаём переменные окружения для сборки (NEXT_PUBLIC_* встраиваются при build)
ARG NEXT_PUBLIC_MEDIA_URL=http://10.15.3.187:8100
ENV NEXT_PUBLIC_MEDIA_URL=$NEXT_PUBLIC_MEDIA_URL

# Собираем приложение
RUN npm run build

# Продакшен этап
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Создаем пользователя для безопасности
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Копируем собранное приложение
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# Порт для продакшена
ARG PORT=3100
ENV PORT=$PORT
ENV HOSTNAME="0.0.0.0"
EXPOSE $PORT

CMD ["node", "server.js"]
