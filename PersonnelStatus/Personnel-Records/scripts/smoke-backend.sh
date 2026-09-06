#!/usr/bin/env bash
# Бэкенд ДЛЯ ПОЛНОГО СМОУКА: отдельный сервер, отдельный порт, неизменяемая
# выкладка, `--noreload`.
#
# ЗАЧЕМ (Plane №843). Рабочий стенд :8100 поднимается БЕЗ `--noreload`, и это
# правильно — с ним сервер не подхватывает правки Python вовсе, а признак
# читается наоборот («код верный, pytest зелёный, живая проба красная», №764).
# Но у автоперезагрузки есть вторая сторона: ЛЮБАЯ правка Python в дереве —
# своя, чужая, соседней сессии — перезапускает сервер и рвёт ВСЕ открытые
# соединения проб. В дереве, где работают три-четыре сессии, за восьмиминутный
# прогон это происходит гарантированно.
#
# ЗАМЕРЕНО 06.09.2026, два полных прогона подряд по одному и тому же коду:
#   прогон 1 — 443 passed, 2 failed, ECONNREFUSED ноль (обе причины смысловые);
#   прогон 2 — 443 passed, 4 failed, ВСЕ ЧЕТЫРЕ — `connect ECONNREFUSED
#              127.0.0.1:8100` / `SocketError: other side closed`.
# Совпадение по времени однозначное: во время прогона 2 в дерево уехали два
# коммита с правками Python, а потомок `runserver` имел возраст 49 секунд при
# родителе в 17 ч 59 мин.
#
# Хуже самих падений то, что прогон становится НЕЧИТАЕМЫМ: одна и та же проба
# падает в двух прогонах по РАЗНЫМ причинам и выглядит «устойчиво мигающей», а
# настоящая регрессия тонет среди обрывов.
#
# ПОЧЕМУ ИМЕННО ТАК, а не иначе (варианты разбирались в карточке):
#   • замок на дерево Python на время прогона — это договорённость между
#     сессиями, а они не работают: сообщение приходит на следующем обращении к
#     инструментам, и между «объявил» и «прочитал» помещается целый прогон;
#   • «исключать ECONNREFUSED из счёта» правилом — оставляет прогон
#     нечитаемым, просто теперь с разрешения правил.
# Прецедент того же проекта: полный смоук ФРОНТА уже переехал с `next dev`
# :3106 на прод-стенд :3108 ровно по этой причине (№173). Здесь та же болезнь
# этажом ниже и лечится она так же.
#
# 🔴 ЭТОТ СЕРВЕР ГОНЯЕТ КОММИТ, А НЕ РАБОЧЕЕ ДЕРЕВО. Незакоммиченная правка в
# него НЕ ПОПАДАЕТ — и это не недосмотр, а предмет: полный прогон
# работоспособности гоняется по тому, что уехало в историю. Для проверки
# СВОЕЙ незакоммиченной правки годится рабочий стенд :8100, а не этот.
#
#   bash scripts/smoke-backend.sh          # поднять на :8101 из HEAD
#   REF=<коммит> bash scripts/smoke-backend.sh
#   bash scripts/smoke-backend.sh --stop   # погасить и убрать выкладку
#
set -u

PORT="${PORT:-8101}"
LOG="${LOG:-/tmp/smoke-backend-$PORT.log}"
PIDFILE="${PIDFILE:-/tmp/smoke-backend-$PORT.pid}"
WORKTREE="${WORKTREE:-${TMPDIR:-/tmp}/smoke-backend-$PORT}"
SETTINGS="${DJANGO_SETTINGS_MODULE:-organization_management.config.settings.local_postgres}"

HERE="$(cd "$(dirname "$0")/.." && pwd)" || exit 1
REPO="$(git -C "$HERE" rev-parse --show-toplevel)" || exit 1
# Путь модуля внутри выкладки — тот же, что и здесь, только от её корня.
RELPATH="${HERE#"$REPO"/}"
PYTHON="${PYTHON:-$HERE/.venv/bin/python}"

stop_server() {
  if [ -s "$PIDFILE" ]; then
    pid="$(cat "$PIDFILE")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      for _ in $(seq 1 10); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      echo "[smoke-backend] сервер pid=$pid погашен."
    else
      echo "[smoke-backend] в $PIDFILE записан pid=$pid, но такого процесса нет."
    fi
    rm -f "$PIDFILE"
  else
    echo "[smoke-backend] pid-файла $PIDFILE нет — гасить нечего."
  fi
  # Выкладку убираем ТОЛЬКО свою и только по known-пути: чужие worktree этого
  # репозитория (их заводят другие сессии) не трогаем даже `prune`.
  if [ -d "$WORKTREE" ]; then
    git -C "$REPO" worktree remove --force "$WORKTREE" 2>/dev/null \
      || rm -rf "$WORKTREE"
    echo "[smoke-backend] выкладка $WORKTREE убрана."
  fi
}

if [ "${1:-}" = "--stop" ]; then
  stop_server
  exit 0
fi

# Порт занят — ВЫХОД, а не второй сервер: то же правило, что у `prod-stand.sh`
# и `dev-guard.sh`. Два сервера на одной базе делят машину и путают замеры.
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  exec 3<&- 2>/dev/null
  echo "[smoke-backend] порт $PORT уже занят — второй сервер не поднимаю."
  echo "[smoke-backend] кто там: ss -ltnp | grep $PORT"
  echo "[smoke-backend] свой прежний: bash scripts/smoke-backend.sh --stop"
  exit 1
fi

if [ ! -x "$PYTHON" ]; then
  echo "[smoke-backend] нет $PYTHON — Django ставится в .venv, системный питон его не видит."
  exit 1
fi

REF="${REF:-HEAD}"
SHA="$(git -C "$REPO" rev-parse "$REF")" || exit 1
SHORT="$(git -C "$REPO" rev-parse --short "$SHA")"

# Выкладка пересоздаётся каждый раз: «та же, что в прошлый раз» — это ровно та
# неопределённость, от которой сервер и уводится.
git -C "$REPO" worktree remove --force "$WORKTREE" 2>/dev/null
rm -rf "$WORKTREE"
git -C "$REPO" worktree prune
if ! git -C "$REPO" worktree add --detach "$WORKTREE" "$SHA" >/dev/null 2>&1; then
  echo "[smoke-backend] не удалось развернуть выкладку $SHORT в $WORKTREE."
  exit 1
fi

MANAGE="$WORKTREE/$RELPATH/manage.py"
if [ ! -f "$MANAGE" ]; then
  echo "[smoke-backend] в выкладке нет $MANAGE — проверьте RELPATH ($RELPATH)."
  exit 1
fi

: > "$LOG"
rm -f "$PIDFILE"

# Надзиратель — тот же приём, что в `prod-stand.sh` (Plane №823): он держит
# сервер СВОИМ ребёнком и потому может его `wait`, а код выше 128 отличает
# «сняли сигналом» от «упал сам». Без этого исчезнувший посреди прогона сервер
# не оставляет о себе ни строки, и полсотни красных проб читаются как дефекты
# кода.
setsid bash -c '
  set -u
  log="$1"; pidfile="$2"; port="$3"; python="$4"; manage="$5"; settings="$6"
  # 🔴 РАБОЧИЙ КАТАЛОГ — ТОЖЕ ВЫКЛАДКА, а не тот, откуда позвали скрипт.
  # Импорты Django берёт от каталога `manage.py` (`sys.path[0]`), и они были бы
  # верны и без этой строки, — но всё, что сервер открывает ОТНОСИТЕЛЬНЫМ
  # путём (статика, media, временные файлы выгрузок), уходило бы в рабочее
  # дерево, то есть ровно туда, от чего сервер и уводится. Замерено: без
  # `cd` у процесса `/proc/<pid>/cwd` показывал рабочее дерево.
  cd "$(dirname "$manage")" || exit 1
  trap "printf \"[smoke-backend] НАДЗИРАТЕЛЬ СНЯТ %s (сервер мог остаться сиротой)\\n\" \"\$(date \"+%Y-%m-%d %H:%M:%S\")\" >> \"$log\"" TERM HUP INT
  # `--noreload` здесь ОБЯЗАТЕЛЕН и безопасен: сервер живёт только на время
  # прогона, поднят из выкладки, которая не меняется по построению, и гасится
  # сразу после. Устаревать ему не от чего — это не рабочий стенд :8100.
  DJANGO_SETTINGS_MODULE="$settings" \
    "$python" "$manage" runserver --noreload "127.0.0.1:$port" >> "$log" 2>&1 &
  child=$!
  echo "$child" > "$pidfile"
  wait "$child"
  code=$?
  if [ "$code" -gt 128 ]; then
    why="СНЯТ СИГНАЛОМ $((code - 128))"
  else
    why="вышел сам, код возврата $code"
  fi
  printf "[smoke-backend] СЕРВЕР ОСТАНОВЛЕН %s: pid=%s, %s\n" \
    "$(date "+%Y-%m-%d %H:%M:%S")" "$child" "$why" >> "$log"
  rm -f "$pidfile"
' _ "$LOG" "$PIDFILE" "$PORT" "$PYTHON" "$MANAGE" "$SETTINGS" >> "$LOG" 2>&1 &

# Ждём ПОРТ, а не pid-файл: надзиратель пишет pid до того, как Django откроет
# сокет, и проверка по одному лишь процессу объявила бы «поднят» серверу,
# который умрёт на второй секунде (нет базы, нет пароля, занят порт).
PID=""
for _ in $(seq 1 40); do
  sleep 1
  [ -s "$PIDFILE" ] && PID="$(cat "$PIDFILE")"
  if [ -n "$PID" ] && (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
    exec 3<&- 2>/dev/null
    break
  fi
  if [ -n "$PID" ] && ! kill -0 "$PID" 2>/dev/null; then
    PID=""
    break
  fi
done

if [ -z "$PID" ] || ! kill -0 "$PID" 2>/dev/null; then
  echo "[smoke-backend] сервер не поднялся, смотрите $LOG"
  tail -20 "$LOG"
  stop_server >/dev/null 2>&1
  exit 1
fi

echo "[smoke-backend] поднят: pid=$PID, порт=$PORT, коммит=$SHORT"
echo "[smoke-backend] выкладка=$WORKTREE, лог=$LOG"
echo "[smoke-backend] ⚠️ гоняется КОММИТ $SHORT, незакоммиченное в дереве сюда не попало."
echo "[smoke-backend] фронт поднимать так:"
echo "    BACKEND_URL=http://localhost:$PORT npm run stand:prod"
echo "[smoke-backend] погасить и убрать выкладку: bash scripts/smoke-backend.sh --stop"
