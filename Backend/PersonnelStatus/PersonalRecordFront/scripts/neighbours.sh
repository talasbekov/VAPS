#!/usr/bin/env bash
# Соседи по машине: кто ещё держит `next-server`, сколько это памяти и можно ли
# поднимать ещё один сервер (Plane №817, вынесено в общий дом по №835).
#
# ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Логика родилась в `dev-guard.sh`, а нужна ОБОИМ
# сторожам: прод-стенд берёт памяти реально (145-320 МБ на стенд, во время
# сборки — гигабайты) и до №835 поднимался в переполненную машину без единого
# слова, спрашивая только «занят ли мой порт». Копия этой логики во втором
# скрипте означала бы два места, где правку забудут: `comm` у Next меняется от
# версии («next-server (v15.2.4)», в усечении «next-server (v1»), и один
# устаревший фильтр молча перестал бы видеть соседей вовсе.
#
# 🔴 ЧТО ЗДЕСЬ ПОДМЕНЯЕМО И ЗАЧЕМ. Скрипт, который зовёт `ps`, `ss` и `kill`,
# «красной пробой» в буквальном виде не покрыть. Но считающая часть покрывается
# полностью, если источник строк и справка о портах приходят ПЕРЕМЕННОЙ:
# `NEIGHBOURS_PS` и `NEIGHBOURS_PORT_OF` подменяются в
# `scripts/tests/neighbours-test.sh`, и проба проверяет сумму, пустой случай,
# отличие сироты от чужого рабочего сервера и обе причины отказа — не трогая ни
# одного живого процесса. До №835 всё это держалось на ручных прогонах,
# записанных в журнал.

#: Источник строк процессов: `pid rss etimes comm`. Подменяется пробой.
NEIGHBOURS_PS="${NEIGHBOURS_PS:-ps -eo pid=,rss=,etimes=,comm=}"
#: Имя в квадратных скобках у каждой строки вывода — своё у каждого сторожа.
NEIGHBOURS_TAG="${NEIGHBOURS_TAG:-neighbours}"
#: Откуда берётся память машины. Подменяется пробой на файл-фикстуру.
NEIGHBOURS_MEMINFO="${NEIGHBOURS_MEMINFO:-/proc/meminfo}"
#: Сколько памяти нужно оставить свободной под свежий стенд: `next dev`
#: стартует на 1,3-1,6 ГБ (замер Plane №323).
START_NEED_MB="${START_NEED_MB:-1800}"

# Порт процесса или пустая строка. Отдельной функцией, потому что подменяется.
neighbours_port_of_default() {
  ss -ltnp 2>/dev/null | awk -v p="pid=$1," '$0 ~ p {split($4, a, ":"); print a[length(a)]; exit}'
}
NEIGHBOURS_PORT_OF="${NEIGHBOURS_PORT_OF:-neighbours_port_of_default}"

port_of() {
  "$NEIGHBOURS_PORT_OF" "$1"
}

# ОДИН фильтр на все места (ревью №817): три копии этого awk означали бы три
# места, где правку забудут. Возраст нужен, чтобы отличить сироту от чужого
# рабочего сервера.
next_server_rows() {
  $NEIGHBOURS_PS | awk '$4 ~ /^next-server/ {print $1, $2, $3}'
}

# 🔴 СПИСОК РАЗЛИЧАЕТ СИРОТУ И ЧУЖОЙ РАБОЧИЙ СЕРВЕР (ревью №817). Плоский совет
# «kill <pid>» одинаково указывал и на восьмичасовую сироту без порта, и на
# прод-стенд соседа под часовым обходом — а правила проекта требуют в таком
# случае сперва списаться, а не гасить.
neighbours_report() {
  local pid rss etimes port age
  while read -r pid rss etimes; do
    [ -z "$pid" ] && continue
    port=$(port_of "$pid")
    age=$((etimes / 60))
    if [ -z "$port" ]; then
      echo "[$NEIGHBOURS_TAG]   pid=$pid  $((rss / 1024)) МБ  возраст ${age} мин  ПОРТА НЕТ — похоже на сироту, её и гасите"
    else
      echo "[$NEIGHBOURS_TAG]   pid=$pid  $((rss / 1024)) МБ  возраст ${age} мин  слушает :$port — может быть чужим прогоном, сперва спросите"
    fi
  done <<EOF_NEIGH
$(next_server_rows)
EOF_NEIGH
}

neighbours_total_mb() {
  local total=0 rss
  while read -r _pid rss _etimes; do
    [ -n "$rss" ] && total=$((total + rss))
  done <<EOF_NEIGH
$(next_server_rows)
EOF_NEIGH
  echo $((total / 1024))
}

neighbours_available_mb() {
  awk '/MemAvailable/{print int($2/1024)}' "$NEIGHBOURS_MEMINFO" 2>/dev/null || echo 0
}

# 🔴 МЕРКА ОТКАЗА — ПАМЯТЬ МАШИНЫ, А НЕ ПОТОЛОК ОДНОГО СЕРВЕРА (ревью №817).
# `ABS_HARD_CAP_MB=3500` взят по ПОВЕДЕНЧЕСКОЙ причине — выше ~3,5 ГБ сломан
# сам `next dev`; о том, сколько памяти у машины, это число не говорит ничего.
neighbours_budget_mb() {
  local total_mb
  total_mb=$(awk '/MemTotal/{print int($2/1024)}' "$NEIGHBOURS_MEMINFO" 2>/dev/null)
  [ -z "$total_mb" ] && { echo 6000; return; }
  echo $((total_mb * 40 / 100))
}

# Причина отказа поднимать ещё один сервер — или пусто, если можно.
#
# Отказ, а не предупреждение, ТОЛЬКО когда соседи уже съели весь общий бюджет:
# мок-сервер и прод-стенд поднимаются НАМЕРЕННО и ненадолго, и запрещать их
# соседство значило бы сломать документированный порядок работы. А вот
# четвёртый гигабайтный сервер на машине, которая уже за потолком, — это то
# самое положение, из которого OOM-killer начинает убивать чужие прогоны.
neighbours_refusal_reason() {
  local total="$1" limit="$2" available="$3"
  if [ "$total" -ge "$limit" ]; then
    echo "соседи держат ${total} МБ ≥ бюджета машины ${limit} МБ"
  elif [ "$available" -gt 0 ] && [ "$available" -lt "$START_NEED_MB" ]; then
    echo "свободно всего ${available} МБ, а свежему стенду нужно ${START_NEED_MB} МБ"
  fi
}

# 🔴 СОСЕД, ВЫРОСШИЙ ПРИ УЖЕ РАБОТАЮЩЕМ СТОРОЖЕ (предмет №817: правка закрывала
# только СТАРТ). Агрегат в цикле называет только сумму — по ней нельзя понять,
# КОГО гасить. Здесь смотрим КАЖДОГО соседа отдельно и называем поимённо того,
# кто сам перевалил абсолютный потолок.
#
# `$1` — список pid через пробел, которые считать СВОИМИ и пропускать.
neighbours_fat_report() {
  local mine=" ${1:-} " cap="${2:-3500}" pid rss port
  while read -r pid rss _etimes; do
    [ -z "$pid" ] && continue
    case "$mine" in *" $pid "*) continue ;; esac
    if [ $((rss / 1024)) -gt "$cap" ]; then
      port=$(port_of "$pid")
      echo "[$NEIGHBOURS_TAG] 🔴 СОСЕД pid=$pid $( [ -n "$port" ] && echo "порт=:$port" || echo "без порта" ) держит $((rss / 1024)) МБ — выше абсолютного потолка ${cap}."
      echo "[$NEIGHBOURS_TAG]    Это НЕ мой сервер, погасить его я не могу: выше ~3,5 ГБ next dev рвёт соединения, и падать будут ЧУЖИЕ пробы тоже."
      return 0
    fi
  done <<EOF_FAT
$(next_server_rows)
EOF_FAT
  return 1
}
