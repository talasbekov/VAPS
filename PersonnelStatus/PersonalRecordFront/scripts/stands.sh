#!/usr/bin/env bash
# Что за стенды сейчас живы и сколько они едят — ОДНОЙ командой.
#
# ЗАЧЕМ ЭТО СКРИПТ, А НЕ ПРАВИЛО В CLAUDE.md. Правило «мерить `next-server`, а
# не ноду» живёт с Plane №44 — и за 29.08.2026 нас поймали ТРИ ловушки на одной
# и той же цифре:
#   1) чужой процесс — `next-server` с `cwd=/app` оказался контейнером Plane, и
#      его чуть не погасили как забытый стенд (в нём лежат наши карточки);
#   2) обёртка вместо сервера — «87 МБ сразу после подъёма» были `npm exec`, а
#      сам сервер рядом весил 1,6 ГБ, и из разницы вывели несуществующий рост;
#   3) одиночный замер вместо уровня — RSS колеблется на сотни мегабайт в обе
#      стороны (2,59 → 2,30 без единой пробы), и одна цифра не значит ничего.
#
# Правило, которое человек обязан помнить в момент усталости, не работает;
# работает команда, которая печатает нужное. Ровно то, что мы весь день чинили
# в пробах — «проверка, которую надо не забыть, не проверка», — оказалось
# верным и про процедуру.
#
#   bash scripts/stands.sh          # снимок: кто живёт, сколько ест, чей
#   bash scripts/stands.sh --watch  # три замера с паузой: виден УРОВЕНЬ, а не точка
set -u

PROJECT_MARK="Smart Josparlau"

row() {
  local pid=$1
  local comm rss cwd port kind
  comm=$(ps -p "$pid" -o comm= 2>/dev/null | tr -d ' ')
  rss=$(ps -p "$pid" -o rss= 2>/dev/null | tr -d ' ')
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || echo '?')
  port=$(ss -ltnp 2>/dev/null | grep -o "[0-9.:*]*:[0-9]*.*pid=$pid," | grep -o ':[0-9]*' | head -1 | tr -d ':')
  # ЧЕЙ процесс — по рабочему каталогу, а не по имени: имя у чужого контейнера
  # ровно такое же.
  case "$cwd" in
    *"$PROJECT_MARK"*) kind="наш" ;;
    *) kind="ЧУЖОЙ — не гасить" ;;
  esac
  printf '  %-8s %-18s %12s КБ  порт %-6s %s\n' "$pid" "${comm:0:18}" "${rss:-?}" "${port:-—}" "$kind"
  [ "$kind" = "наш" ] && [ -n "${cwd:-}" ] && printf '           %s\n' "$cwd"
}

# Отбор идёт по `comm`, а не по строке запуска: `pgrep -f` находит СЕБЯ (свой
# же шелл с этим шаблоном в аргументах) и печатает его как стенд — так в первой
# редакции скрипта в списке серверов оказался `bash`. Дубли снимаются `sort -u`:
# два разных pgrep по одному процессу давали его дважды.
pids_by_comm() {
  ps -eo pid,comm= 2>/dev/null | awk -v pat="$1" '$2 ~ pat {print $1}' | sort -un
}

snapshot() {
  echo "── серверы Next (это и есть настоящий расход; обёртки ниже) ──"
  local found=0
  for pid in $(pids_by_comm '^next-server'); do
    row "$pid"; found=1
  done
  [ "$found" = 0 ] && echo "  ни одного next-server не запущено"
  echo "── обёртки: их RSS НИ О ЧЁМ не говорит, не путать с сервером ──"
  local wrappers=0
  for pid in $(pids_by_comm '^(npm|node|MainThread)'); do
    ps -p "$pid" -o args= 2>/dev/null | grep -qE 'next dev|npm exec next' || continue
    row "$pid"; wrappers=1
  done
  [ "$wrappers" = 0 ] && echo "  обёрток нет"
  echo "── Django ──"
  local dj=0
  for pid in $(pids_by_comm '^python'); do
    ps -p "$pid" -o args= 2>/dev/null | grep -q 'manage.py runserver' || continue
    row "$pid"; dj=1
  done
  [ "$dj" = 0 ] && echo "  runserver не запущен"
  # Возврат ноль явно: последняя проверка выше отдаёт 1, когда сервер НАЙДЕН,
  # и скрипт-снимок читался бы как упавший.
  return 0
}

if [ "${1:-}" = "--watch" ]; then
  # Три замера: одна цифра не отличает рост от колебания.
  for i in 1 2 3; do
    echo "== замер $i =="
    snapshot
    [ "$i" -lt 3 ] && sleep 10
  done
else
  snapshot
fi
exit 0
