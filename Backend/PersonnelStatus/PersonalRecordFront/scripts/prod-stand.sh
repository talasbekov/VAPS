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
#   BACKEND_URL=http://localhost:8101 bash scripts/prod-stand.sh
#                                         # собрать на отдельный бэкенд (№843)
#
# Гонять по нему:
#   SMOKE_LIVE=1 SMOKE_BASE_URL=http://localhost:3108 \
#     SMOKE_APP=http://localhost:3108 \
#     npx playwright test --config playwright.smoke.config.ts
#
# ⚠️ BACKEND_URL ДЕЙСТВУЕТ НА СБОРКУ, а не на запуск: переписи запекаются в
# `routes-manifest.json` во время `next build`. С `--no-build` скрипт сверяет
# запечённый адрес с запрошенным и отказывается поднимать стенд, который
# ходил бы не туда, куда его позвали.
#
# Гасить: kill по PID, который печатает скрипт (он же лежит в
# /tmp/next-prod-<порт>.pid — путь переопределяется переменной PIDFILE).
# Смерть сервера пишется в тот же лог строкой «СЕРВЕР ОСТАНОВЛЕН» (Plane №823).
# ⚠️ Сервер уходит в СВОЮ сессию (`setsid`) и потому переживает закрытие
# терминала — забытый стенд живёт до перезагрузки, гасить его надо руками.
set -u

PORT="${PORT:-3108}"
DIST="${DIST:-.next-prod}"
LOG="${LOG:-/tmp/next-prod-$PORT.log}"
BACKEND="${BACKEND_URL:-http://localhost:8100}"

cd "$(dirname "$0")/.." || exit 1

# Порт занят — ВЫХОД, а не второй сервер: то же правило, что у `dev-guard.sh`.
# Два сервера делят машину и травят друг другу память.
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  exec 3<&- 2>/dev/null
  echo "[prod-stand] порт $PORT уже занят — второй сервер не поднимаю."
  echo "[prod-stand] кто там: ss -ltnp | grep $PORT"
  exit 1
fi

# 🔴 ПЕРЕПИСИ ЗАПЕКАЮТСЯ В СБОРКУ, А НЕ ЧИТАЮТСЯ ПРИ ЗАПУСКЕ (Plane №843).
# `rewrites()` из `next.config.js` Next исполняет во время `next build` и
# кладёт готовые адреса в `routes-manifest.json`. Поэтому `BACKEND_URL`,
# переданный ТОЛЬКО серверу, на проксирование не влияет вовсе: сервер честно
# получал переменную, а запросы всё равно уходили на тот адрес, который был у
# сборки. Замерено 06.09.2026: в `.next-prod/routes-manifest.json` стояло
# `http://127.0.0.1:8100/...` при любом значении переменной у процесса.
# Отсюда две вещи ниже — сборка идёт С этой переменной, а `--no-build`
# сверяет запечённый адрес с запрошенным и отказывается врать.
if [ "${1:-}" != "--no-build" ]; then
  echo "[prod-stand] сборка в $DIST (бэкенд $BACKEND)…"
  BACKEND_URL="$BACKEND" NEXT_DIST_DIR="$DIST" npx next build || exit 1
else
  MANIFEST="$DIST/routes-manifest.json"
  if [ -f "$MANIFEST" ]; then
    BAKED="$(node -e '
      const fs = require("fs");
      const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const rw = m.rewrites;
      const all = Array.isArray(rw)
        ? rw
        : [...(rw?.beforeFiles ?? []), ...(rw?.afterFiles ?? []), ...(rw?.fallback ?? [])];
      const hit = all.map((r) => r.destination)
        .filter((d) => typeof d === "string" && /^https?:\/\//.test(d))
        .map((d) => d.match(/^https?:\/\/[^/]+/)[0]);
      process.stdout.write([...new Set(hit)].join(",") );
    ' "$MANIFEST" 2>/dev/null)"
    # Сравниваем по хосту и порту: `localhost` и `127.0.0.1` — один адрес.
    want="$(printf '%s' "$BACKEND" | sed -E 's#^https?://##; s#/$##; s#^localhost#127.0.0.1#')"
    got="$(printf '%s' "$BAKED" | sed -E 's#https?://##g; s#localhost#127.0.0.1#g')"
    if [ -n "$got" ] && [ "$got" != "$want" ]; then
      echo "[prod-stand] СБОРКА ЗАПЕЧЕНА НА ДРУГОЙ БЭКЕНД: в $MANIFEST — $got, запрошен $want."
      echo "[prod-stand] это не настраивается при запуске: пересоберите без --no-build."
      exit 1
    fi
  fi
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
# 🔴 СЕКРЕТ ИДЁТ ОКРУЖЕНИЕМ, А НЕ АРГУМЕНТОМ (ревью №823, 06.09.2026).
# Первая редакция передавала `$SECRET` пятым позиционным параметром — и он
# оказывался в `/proc/<pid>/cmdline`, который читает ЛЮБОЙ пользователь машины
# (права `-r--r--r--`), тогда как `/proc/<pid>/environ` читает только владелец
# (`-r--------`). Проверено на живом стенде: `ps -eo args | grep server.js`
# печатал значение `NEXTAUTH_SECRET` целиком. А CLAUDE.md прямо предписывает
# снимать `ps` при каждом замере памяти и вставлять вывод в vault, карточки и
# переписку — то есть правило «секреты в текст команд не попадают» нарушал бы
# не автор скрипта, а любой, кто выполнит замер.
NEXTAUTH_SECRET="$SECRET" setsid bash -c '
  set -u
  log="$1"; pidfile="$2"; port="$3"; backend="$4"
  # Надзирателя тоже могут снять — тогда о смерти сервера не напишет никто.
  # `trap` переживает всё, кроме SIGKILL по самому надзирателю: эта дыра
  # остаётся по построению, и здесь она названа вслух, чтобы отсутствие строки
  # в логе не читалось как «стенд жив».
  trap "printf \"[prod-stand] НАДЗИРАТЕЛЬ СНЯТ %s (сервер мог остаться сиротой)\\n\" \"\$(date \"+%Y-%m-%d %H:%M:%S\")\" >> \"$log\"" TERM HUP INT
  # 🔴 NEXT_MANUAL_SIG_HANDLE=1 (ревью №823). Без него Next ставит собственный
  # обработчик SIGTERM (`next/dist/server/lib/start-server.js`) и выходит через
  # `process.exit(0)` — то есть обычный `kill`, которым по правилам проекта
  # стенд и гасят, давал `wait` = 0 и строку «вышел сам, код возврата 0».
  # Карточка №823 ровно про «кто снял процесс», и в самом частом сценарии лог
  # отвечал не на тот вопрос. С этой переменной сигнал доходит до ядра, `wait`
  # возвращает 143, и в логе стоит «СНЯТ СИГНАЛОМ 15». Мягкое завершение
  # прод-стенду для проб не нужно.
  PORT="$port" HOSTNAME=127.0.0.1 \
    NEXT_MANUAL_SIG_HANDLE=1 \
    NEXTAUTH_URL="http://localhost:$port" \
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
' _ "$LOG" "$PIDFILE" "$PORT" "$BACKEND" \
  >> "$LOG" 2>&1 &

# 🔴 ЖДЁМ ПОРТ, А НЕ PID-ФАЙЛ (ревью №823). Надзиратель пишет pid сразу после
# `&`, то есть ДО того, как node откроет порт: проверка по одному лишь наличию
# процесса объявляла бы «поднят» и тому серверу, который умрёт на второй
# секунде (занятый порт, битый `.env`, не скопированная статика). Прежняя
# редакция скрипта ждала `sleep 4` и проверяла `kill -0` — новая проверка была
# СЛАБЕЕ старой, пока не смотрела на порт.
PID=""
for _ in $(seq 1 30); do
  sleep 1
  [ -s "$PIDFILE" ] && PID="$(cat "$PIDFILE")"
  if [ -n "$PID" ] && (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
    exec 3<&- 2>/dev/null
    break
  fi
  # Ребёнок умер, не открыв порта, — ждать больше нечего.
  if [ -n "$PID" ] && ! kill -0 "$PID" 2>/dev/null; then
    PID=""
    break
  fi
done

if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  echo "[prod-stand] поднят: pid=$PID, порт=$PORT, лог=$LOG"
  echo "[prod-stand] смерть сервера будет записана в тот же лог строкой «СЕРВЕР ОСТАНОВЛЕН»."
else
  echo "[prod-stand] сервер не поднялся, смотрите $LOG"
  exit 1
fi
