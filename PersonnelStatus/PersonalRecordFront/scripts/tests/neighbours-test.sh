#!/usr/bin/env bash
# Проба считающей части сторожей стенда (Plane №835).
#
# ЗАЧЕМ. «Красная проба» для скрипта, который зовёт `ps`, `ss` и `kill`, в
# буквальном виде нереалистична — и это в проекте записано честно. Но
# СЧИТАЮЩАЯ часть покрывается полностью: `scripts/neighbours.sh` берёт строки
# процессов через `NEIGHBOURS_PS`, а справку о портах — через
# `NEIGHBOURS_PORT_OF`, и проба подставляет фикстуры вместо живой машины.
# Проверяются: сумма, пустой случай, отличие сироты от чужого рабочего сервера,
# обе причины отказа и поимённый разбор «толстого» соседа.
#
# 🔴 ЧТО ЭТО СТЕРЕЖЁТ НА САМОМ ДЕЛЕ. Фильтр `comm` у Next меняется от версии
# («next-server (v15.2.4)», в усечении — «next-server (v1»). Устаревший фильтр
# НЕ ломается: он просто перестаёт видеть соседей, сумма становится нулём, и
# оба сторожа молча пропускают переполненную машину. Дефект тихий — ровно того
# вида, ради которого этот файл и заведён.
set -u

cd "$(dirname "$0")/.." || exit 1
. ./neighbours.sh

FAILED=0
check() {
  local what="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then
    echo "  ✓ $what"
  else
    echo "  ✘ $what"
    echo "      ждали: $want"
    echo "      вышло: $got"
    FAILED=$((FAILED + 1))
  fi
}

# ── Фикстуры вместо живой машины ────────────────────────────────────────
# Строки ровно того вида, что даёт `ps -eo pid=,rss=,etimes=,comm=`, включая
# усечённый `comm` и посторонние процессы, которых фильтр брать не должен.
THREE_SERVERS='  111 1048576 3600 next-server (v15.2.4)
  222  524288  120 next-server (v1
  333  102400 7200 node
  444 4194304  600 next-server (v15.2.4)'

ONLY_STRANGERS='  333 102400 7200 node
  555  20480   30 npm exec next d'

fake_ps_three() { printf '%s\n' "$THREE_SERVERS"; }
fake_ps_none() { printf '%s\n' "$ONLY_STRANGERS"; }
# Слушает только 111; у 222 и 444 порта нет — это сироты.
fake_port_of() { [ "$1" = "111" ] && echo 3106; }

NEIGHBOURS_PORT_OF=fake_port_of
NEIGHBOURS_TAG=проба

echo "neighbours.sh:"

# ── 1. Сумма и отбор ────────────────────────────────────────────────────
NEIGHBOURS_PS=fake_ps_three
check "сумма трёх серверов в МБ (1024+512+4096)" "5632" "$(neighbours_total_mb)"
check "посторонние процессы в отбор не попали" "3" "$(next_server_rows | wc -l)"

# ── 2. Пустой случай — ноль, а не ошибка ────────────────────────────────
NEIGHBOURS_PS=fake_ps_none
check "серверов нет — сумма ноль" "0" "$(neighbours_total_mb)"
check "серверов нет — список пуст" "0" "$(neighbours_report | wc -l)"

# ── 3. Сирота и чужой рабочий сервер названы ПО-РАЗНОМУ ─────────────────
NEIGHBOURS_PS=fake_ps_three
REPORT=$(neighbours_report)
check "слушающий сервер помечен «сперва спросите»" "1" \
  "$(printf '%s\n' "$REPORT" | grep -c 'слушает :3106 — может быть чужим прогоном')"
check "сироты помечены «её и гасите»" "2" \
  "$(printf '%s\n' "$REPORT" | grep -c 'ПОРТА НЕТ')"

# ── 4. Обе причины отказа, и обе — своими словами ───────────────────────
check "соседи за бюджетом — отказ" \
  "соседи держат 5632 МБ ≥ бюджета машины 5000 МБ" \
  "$(neighbours_refusal_reason 5632 5000 9000)"
check "памяти мало — отказ" \
  "свободно всего 900 МБ, а свежему стенду нужно 1800 МБ" \
  "$(neighbours_refusal_reason 1000 6000 900)"
check "места хватает — отказа НЕТ" "" "$(neighbours_refusal_reason 1000 6000 9000)"
# `available = 0` означает «померить не удалось», а не «памяти нет»: отказывать
# по неизмеренному значению — то же самое, что отказывать наугад.
check "память не померилась — не отказ" "" "$(neighbours_refusal_reason 1000 6000 0)"

# ── 5. Толстый сосед назван поимённо, свои пропущены ────────────────────
FAT=$(neighbours_fat_report "" 3500)
check "сосед выше потолка найден" "0" "$?"
check "назван именно он (444, 4096 МБ)" "1" \
  "$(printf '%s\n' "$FAT" | grep -c 'pid=444 без порта держит 4096 МБ')"
neighbours_fat_report "444" 3500 >/dev/null
check "свой процесс не обвиняется" "1" "$?"
neighbours_fat_report "" 9000 >/dev/null
check "под высоким потолком толстых нет" "1" "$?"

# ── 6. Бюджет машины считается от MemTotal ──────────────────────────────
MEM=$(mktemp)
printf 'MemTotal:       15458000 kB\nMemAvailable:    2048000 kB\n' > "$MEM"
NEIGHBOURS_MEMINFO="$MEM"
check "бюджет = 40 % от MemTotal" "6038" "$(neighbours_budget_mb)"
check "свободно — из MemAvailable" "2000" "$(neighbours_available_mb)"
NEIGHBOURS_MEMINFO=/нет/такого/файла
check "meminfo недоступен — запасной бюджет" "6000" "$(neighbours_budget_mb)"
rm -f "$MEM"

if [ "$FAILED" -gt 0 ]; then
  echo "neighbours.sh: провалено проверок — $FAILED"
  exit 1
fi
echo "neighbours.sh: все проверки пройдены"
