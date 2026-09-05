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

# 🔴 СЕРВЕР ЗАПУСКАЕТСЯ ПОД НАДЗИРАТЕЛЕМ, А НЕ НАПРЯМУЮ (Plane №823).
#
# ЗАЧЕМ. 06.09.2026 этот стенд ИСЧЕЗ посреди часового обхода портала: замер RSS
# перед блоком показывает 317 016 КБ, замер перед следующим — уже ничего. В
# логе последняя строка — обычный вывод авторизации; в `kern.log` единственная
# запись OOM за сутки была по ЧУЖОМУ pid. То есть о смерти собственного стенда
# не осталось ни следа, а прогон прочитался как 50 красных проб с именами
# маршрутов, и час ушёл на разбор портала, к которому претензий нет.
#
# Надзиратель — `setsid`-шелл, который держит сервер СВОИМ ребёнком и потому
# может его `wait`: код возврата выше 128 означает сигнал (137 — SIGKILL, 143 —
# SIGTERM), и это ровно тот бит, которого не хватало, чтобы отличить «упал сам»
# от «его сняли». Строка уходит в тот же лог; pid сервера возвращается через
# файл — он ребёнок надзирателя, а не этого скрипта.
PIDFILE="${PIDFILE:-/tmp/next-prod-$PORT.pid}"
rm -f "$PIDFILE"
setsid bash -c '
  log="$1"; pidfile="$2"; port="$3"; secret="$4"; backend="$5"
  PORT="$port" HOSTNAME=127.0.0.1 \
    NEXTAUTH_URL="http://localhost:$port" \
    NEXTAUTH_SECRET="$secret" \
    BACKEND_URL="$backend" \
    node server.js >> "$log" 2>&1 &
  child=$!
  echo "$child" > "$pidfile"
  wait "$child"
  code=$?
  if [ "$code" -gt 128 ]; then
    why="СНЯТ СИГНАЛОМ $((code - 128))"
  else
    why="вышел сам, код возврата $code"
  fi
  printf "[prod-stand] СЕРВЕР ОСТАНОВЛЕН %s: pid=%s, %s\n" \
    "$(date "+%Y-%m-%d %H:%M:%S")" "$child" "$why" >> "$log"
  rm -f "$pidfile"
' _ "$LOG" "$PIDFILE" "$PORT" "$SECRET" "${BACKEND_URL:-http://localhost:8100}" \
  >/dev/null 2>&1 &

# Ждём, пока надзиратель объявит pid ребёнка: без файла нечего печатать и
# нечего гасить.
PID=""
for _ in 1 2 3 4 5 6 7 8; do
  sleep 1
  [ -s "$PIDFILE" ] && PID="$(cat "$PIDFILE")" && break
done

if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  echo "[prod-stand] поднят: pid=$PID, порт=$PORT, лог=$LOG"
  echo "[prod-stand] смерть сервера будет записана в тот же лог строкой «СЕРВЕР ОСТАНОВЛЕН»."
else
  echo "[prod-stand] сервер не поднялся, смотрите $LOG"
  exit 1
fi
