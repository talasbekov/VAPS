#!/usr/bin/env bash
# Прод-стенд для гейта: собранный Next вместо `next dev`.
#
# ЗАЧЕМ. `next dev` компилирует маршруты на лету и набирает 2 ГБ за минуту,
# 2,8-3,2 ГБ под нагрузкой e2e; сторож перезапускает его каждые одну-две
# минуты, и каждый перезапуск рвёт соединения проб. Полный смоук по нему до
# конца не доходил НИ РАЗУ (Plane №155, №172). Прод-сборка того же кода держит
# 300-450 МБ и проходит весь смоук за 3,3 минуты (Plane №173).
#
#   bash scripts/prod-stand.sh            # собрать и поднять на :3108
#   bash scripts/prod-stand.sh --no-build # поднять уже собранное
#
# Гонять по нему:
#   SMOKE_LIVE=1 SMOKE_BASE_URL=http://localhost:3108 \
#     SMOKE_APP=http://localhost:3108 \
#     npx playwright test --config playwright.smoke.config.ts
#
# Гасить: kill по PID, который печатает скрипт.
set -u

PORT="${PORT:-3108}"
DIST="${DIST:-.next-prod}"
LOG="${LOG:-/tmp/next-prod-$PORT.log}"

cd "$(dirname "$0")/.." || exit 1

# Порт занят — ВЫХОД, а не второй сервер: то же правило, что у `dev-guard.sh`.
# Два сервера делят машину и травят друг другу память.
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  exec 3<&- 2>/dev/null
  echo "[prod-stand] порт $PORT уже занят — второй сервер не поднимаю."
  echo "[prod-stand] кто там: ss -ltnp | grep $PORT"
  exit 1
fi

if [ "${1:-}" != "--no-build" ]; then
  echo "[prod-stand] сборка в $DIST…"
  NEXT_DIST_DIR="$DIST" npx next build || exit 1
fi

# `output: standalone` кладёт сервер отдельно, но БЕЗ статики и public — Next
# оставляет их копирование вызывающему. Без этого шага страницы приходят без
# стилей и скриптов, и пробы падают на пустом экране.
cp -r "$DIST/static" "$DIST/standalone/$DIST/static" 2>/dev/null
cp -r public "$DIST/standalone/public" 2>/dev/null

# NEXTAUTH_URL берётся ЛОКАЛЬНЫЙ, а не из `.env.production`: там адрес боевого
# сервера, и NextAuth отверг бы вход на localhost. Секрет — оттуда же, откуда
# его берёт dev-стенд; в репозиторий он не попадает.
SECRET="$(grep '^NEXTAUTH_SECRET=' .env.local | cut -d= -f2-)"
if [ -z "$SECRET" ]; then
  echo "[prod-stand] в .env.local нет NEXTAUTH_SECRET — вход работать не будет."
  exit 1
fi

cd "$DIST/standalone" || exit 1
PORT="$PORT" HOSTNAME=127.0.0.1 \
  NEXTAUTH_URL="http://localhost:$PORT" \
  NEXTAUTH_SECRET="$SECRET" \
  BACKEND_URL="${BACKEND_URL:-http://localhost:8100}" \
  node server.js >> "$LOG" 2>&1 &
PID=$!
sleep 4
if kill -0 "$PID" 2>/dev/null; then
  echo "[prod-stand] поднят: pid=$PID, порт=$PORT, лог=$LOG"
else
  echo "[prod-stand] сервер не поднялся, смотрите $LOG"
  exit 1
fi
