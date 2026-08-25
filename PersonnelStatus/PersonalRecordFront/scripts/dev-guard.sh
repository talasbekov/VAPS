#!/usr/bin/env bash
# Запуск dev-сервера фронта под присмотром за памятью.
#
# ЗАЧЕМ. `next dev` копит память на каждой пересборке HMR и не отдаёт её:
# замер 25.08.2026 — +48 МБ за цикл, 2,67 ГБ → 3,15 ГБ за десять правок подряд,
# рост монотонный. За рабочий день правок процесс уходит в 6-8 ГБ, начинает
# рвать соединения (падения на /api/auth/csrf/ — это он, а не дефект кода) и
# вешает машину. Настройки в next.config.js снижают БАЗУ (старт 1,8 → 0,78 ГБ),
# но накопление не лечат — его лечит только перезапуск процесса.
#
# ЧТО ДЕЛАЕТ. Поднимает `next dev`, раз в PERIOD секунд смотрит RSS и, когда тот
# перевалил за LIMIT, перезапускает сервер. Состояние dev-сервера одноразовое
# (кэш сборки, HMR), терять там нечего, подъём занимает секунды.
#
# ПОЧЕМУ НЕ ПРОСТО --max-old-space-size. Лимит кучи V8 не ограничивает RSS:
# замер показал 2,89 ГБ RSS при лимите кучи 2 ГБ — растёт и вне кучи.
#
# НЕ ПЕРЕЗАПУСКАЕТ ПОД НАГРУЗКОЙ: если в лог сервера что-то писалось за
# последние IDLE секунд, значит идёт прогон или человек кликает по стенду —
# перезапуск откладывается до затишья. Иначе сторож рвал бы e2e на середине.
#
# Использование:
#   npm run dev:guard              # порт 3106, лимит 2500 МБ
#   PORT=3200 LIMIT_MB=1800 npm run dev:guard
set -u

PORT="${PORT:-3106}"
LIMIT_MB="${LIMIT_MB:-2500}"
# Жёсткий потолок: выше него сервер перезапускается НЕ ДОЖИДАЯСЬ затишья.
# Нужен потому, что мягкий порог ждёт тишины, а длинный прогон e2e тишины не
# даёт часами — за это время процесс успевает уйти в 8 ГБ и подвесить машину.
# Оборванный прогон дешевле зависшей машины: прогон повторяется, а память,
# которую забрал dev-сервер, до перезапуска не возвращается никому.
#
# Считается ДОЛЕЙ ПАМЯТИ МАШИНЫ, а не круглым числом: «6 ГБ» — щедрый запас на
# 64 ГБ и приговор на 16 ГБ. На машине разработки (15 ГБ, из них под нагрузкой
# свободно меньше 4 ГБ) 40% дают ≈6 ГБ, и это ровно та граница, за которой
# наблюдалось зависание.
default_hard_limit() {
  local total_mb
  total_mb=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null)
  [ -z "$total_mb" ] && { echo 6000; return; }
  local computed=$((total_mb * 40 / 100))
  [ "$computed" -lt 3000 ] && computed=3000
  echo "$computed"
}
HARD_LIMIT_MB="${HARD_LIMIT_MB:-$(default_hard_limit)}"
PERIOD="${PERIOD:-30}"
IDLE="${IDLE:-20}"
LOG="${LOG:-/tmp/next-dev-$PORT.log}"

cd "$(dirname "$0")/.." || exit 1

start_server() {
  : > "$LOG"
  npx next dev -p "$PORT" >> "$LOG" 2>&1 &
  SERVER_PID=$!
  echo "[dev-guard] сервер поднят: pid=$SERVER_PID, порт=$PORT, лимит=${LIMIT_MB} МБ, лог=$LOG"
}

# Все потомки процесса, а не только прямые дети.
#
# 🔴 Цепочка dev-сервера — ЧЕТЫРЕ звена: `npm exec next dev` → sh → node →
# next-server, и всю память держит последнее. Первая редакция сторожа считала
# только детей, намеряла ~90 МБ вместо двух гигабайт и молчала, пока сервер
# рос. Ошибка тихая: сторож при этом «работает», просто никогда не срабатывает.
descendants() {
  local frontier="$1" all="" next
  while [ -n "$frontier" ]; do
    all="$all $frontier"
    next=""
    for p in $frontier; do
      next="$next $(pgrep -P "$p" 2>/dev/null | tr '\n' ' ')"
    done
    frontier=$(echo "$next" | tr -s ' ')
    frontier=${frontier# }
    frontier=${frontier% }
  done
  echo "$all"
}

tree_rss_mb() {
  local total=0 rss
  for p in $(descendants "$SERVER_PID"); do
    rss=$(ps -o rss= -p "$p" 2>/dev/null | tr -d ' ')
    [ -n "$rss" ] && total=$((total + rss))
  done
  echo $((total / 1024))
}

seconds_since_log() {
  local mtime now
  mtime=$(stat -c %Y "$LOG" 2>/dev/null || echo 0)
  now=$(date +%s)
  echo $((now - mtime))
}

stop_server() {
  # Список СНИМАЕТСЯ ДО убийства и гасится снизу вверх: убив родителя первым,
  # теряешь дорогу к детям, и next-server остаётся сиротой держать гигабайты.
  local pids
  pids=$(descendants "$SERVER_PID" | tr ' ' '\n' | tac)
  for p in $pids; do kill "$p" 2>/dev/null; done
  sleep 3
  for p in $pids; do kill -9 "$p" 2>/dev/null; done
  sleep 1
}

trap 'echo "[dev-guard] выход"; stop_server; exit 0' INT TERM

start_server
restarts=0
while true; do
  sleep "$PERIOD"
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[dev-guard] сервер умер сам — поднимаю заново"
    start_server
    continue
  fi
  rss=$(tree_rss_mb)
  if [ "$rss" -gt "$HARD_LIMIT_MB" ]; then
    restarts=$((restarts + 1))
    echo "[dev-guard] ${rss} МБ > жёсткого потолка ${HARD_LIMIT_MB} — перезапуск #${restarts} НЕ ДОЖИДАЯСЬ затишья (идущий прогон оборвётся)"
    stop_server
    start_server
    continue
  fi
  if [ "$rss" -gt "$LIMIT_MB" ]; then
    idle=$(seconds_since_log)
    if [ "$idle" -lt "$IDLE" ]; then
      echo "[dev-guard] ${rss} МБ > ${LIMIT_MB}, но сервер занят (${idle}с с последней записи) — жду затишья"
      continue
    fi
    restarts=$((restarts + 1))
    echo "[dev-guard] ${rss} МБ > ${LIMIT_MB} и тишина ${idle}с — перезапуск #${restarts}"
    stop_server
    start_server
  fi
done
