#!/usr/bin/env bash
# Замок каталога сборки фронта (Plane №789, по образцу `pytest-lock.sh`, №107).
#
# ЗАЧЕМ. `npm run gate:front` собирает прод-сборку в `NEXT_DIST_DIR=.next-build`,
# и каталог у всех сессий ОДИН. Вторая сборка чистит и переписывает файлы
# первой — а падение выглядит НЕ как конфликт, а как поломка сборки:
#
#     ✓ Compiled successfully
#     > Build error occurred
#     [Error: ENOENT: no such file or directory, open '…/.next-build/build-manifest.json']
#
# Признак читается наоборот: «я сломал сборку». Сессия идёт искать
# несуществующий дефект в своей правке и теряет прогон, а то и два. Ровно та
# же болезнь, что была у тестовой базы до `pytest-lock.sh`.
#
# ПОЧЕМУ ЗАМОК, А НЕ СВОЙ КАТАЛОГ НА СЕССИЮ. Отдельный `NEXT_DIST_DIR` у
# каждого решает столкновение, но выбрасывает кэш сборки: каждый прогон гейта
# становится холодным (замерено: тёплая сборка ~1,5 мин). Гейт гоняется по
# нескольку раз на задачу, и эта цена платится десятки раз за заход. Замок
# сохраняет кэш и стоит только ожидания — а ждать приходится ровно столько,
# сколько идёт чужая сборка.
#
# ПОЧЕМУ ЖДЁМ ПО УМОЛЧАНИЮ, в отличие от замка pytest. Гейт фронта — часть
# закрытия КАЖДОЙ задачи, и «занято, приходите позже» здесь означало бы
# ручное повторение по десять раз за заход. Ожидание по умолчанию — 15 минут;
# сборка идёт полторы, то есть очередь из десяти сессий уложится.
#
# Использование:
#   bash scripts/build-lock.sh next build
#   BUILD_LOCK_WAIT=0 bash scripts/build-lock.sh next build   # не ждать вовсе
set -u

LOCK="${BUILD_LOCK:-/tmp/claude-1000/next-build.lock}"
WHO="${BUILD_LOCK_OWNER:-$(whoami)@$$}"
WAIT="${BUILD_LOCK_WAIT:-900}"

mkdir -p "$(dirname "$LOCK")" 2>/dev/null

waited=0
until mkdir "$LOCK" 2>/dev/null; do
  owner=$(tr '\n' ' ' < "$LOCK/owner" 2>/dev/null || echo "неизвестно кто")
  # Замок УМЕРШЕГО процесса — брошенный: сборку убили (таймаут, закрытая
  # вкладка), каталог остался и держит всех. Проверяется pid, а не срок:
  # «протух ли» — гадание, а живой процесс либо есть, либо нет.
  stale_pid=$(sed -n "s/^pid=//p" "$LOCK/owner" 2>/dev/null | head -n 1)
  if [ -n "$stale_pid" ] && ! kill -0 "$stale_pid" 2>/dev/null; then
    echo "[build-lock] замок брошен (процесс $stale_pid мёртв, держал: $owner) — снимаю"
    rm -rf "$LOCK"
    continue
  fi
  if [ "$WAIT" -le 0 ] || [ "$waited" -ge "$WAIT" ]; then
    echo "[build-lock] каталог сборки занят: $owner"
    echo "[build-lock] подождать дольше — BUILD_LOCK_WAIT=1800; снять брошенный замок — rm -rf $LOCK"
    exit 75
  fi
  if [ "$waited" = 0 ]; then
    echo "[build-lock] каталог сборки занят ($owner) — жду до ${WAIT} с"
  fi
  sleep 5
  waited=$((waited + 5))
done

printf '%s\npid=%s\nвзят=%s\n' "$WHO" "$$" "$(date '+%F %T')" > "$LOCK/owner"

# Замок снимается ДАЖЕ при падении сборки, но ТОЛЬКО СВОЙ: чужой снимать
# нельзя — так однажды и сносили общий замок соседа посреди прогона.
release_lock() {
  if [ "$(head -n 1 "$LOCK/owner" 2>/dev/null)" = "$WHO" ]; then
    rm -rf "$LOCK"
  else
    echo "[build-lock] замок держит не моя сборка — не снимаю"
  fi
}
trap release_lock EXIT INT TERM

echo "[build-lock] каталог сборки занят мной ($WHO, pid $$)"
"$@"
