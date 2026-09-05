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
# ПОТОЛОК СВЕРХУ ОГРАНИЧЕН И АБСОЛЮТНЫМ ЧИСЛОМ (Plane №122, 26.08.2026).
# Доли памяти машины мало: на 15 ГБ 40% дают ≈6 ГБ, и всё, что ниже, сторож
# пропускает. Наблюдалось 3,76 ГБ у одного сервера — мягкий порог не сработал
# (шёл часовой прогон, тишины не было ни секунды), жёсткий не сработал тоже
# (до 6 ГБ не дошло). Сервер при этом уже рвал соединения. Выше ~3,5 ГБ
# `next dev` сломан ПОВЕДЕНЧЕСКИ, сколько бы памяти ни было у машины, поэтому
# потолок = min(40% памяти, ABS_HARD_CAP_MB).
ABS_HARD_CAP_MB="${ABS_HARD_CAP_MB:-3500}"

default_hard_limit() {
  local total_mb
  total_mb=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null)
  [ -z "$total_mb" ] && { echo "$ABS_HARD_CAP_MB"; return; }
  local computed=$((total_mb * 40 / 100))
  [ "$computed" -lt 3000 ] && computed=3000
  [ "$computed" -gt "$ABS_HARD_CAP_MB" ] && computed="$ABS_HARD_CAP_MB"
  echo "$computed"
}
HARD_LIMIT_MB="${HARD_LIMIT_MB:-$(default_hard_limit)}"
PERIOD="${PERIOD:-30}"
IDLE="${IDLE:-20}"
LOG="${LOG:-/tmp/next-dev-$PORT.log}"

cd "$(dirname "$0")/.." || exit 1

# Порт уже занят — ВЫХОД, а не второй сервер (Plane №122). Два `next dev` на
# одном порту не уживаются вовсе, а на разных — делят машину и травят друг
# другу память: так рядом со стендом жил забытый мок-сервер на :3107, и вдвоём
# они забрали больше, чем каждому позволял бы потолок.
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  exec 3<&- 2>/dev/null
  echo "[dev-guard] порт $PORT уже занят — второй сервер не поднимаю."
  echo "[dev-guard] кто там: ps -eo pid,rss,etime,args | grep -E 'next-server|next dev' | grep -v grep"
  exit 1
fi

# 🔴 СОСЕДИ СЧИТАЮТСЯ ПО ПРОЦЕССАМ, А НЕ ПО ПОРТУ (Plane №817).
#
# Проверка выше спрашивает только «занят ли МОЙ порт». Сервер, поднятый руками
# на любом другом (не документированном :3106/:3107/:3108), ей не виден вовсе —
# и правило «один `next dev` на машину» держалось тем, что все пользуются одними
# тремя портами.
#
# Замерено 06.09.2026: три dev-сервера разом — :3109 (3 517 МБ, выше жёсткого
# потолка), :3106 (2 188), :3107 (1 800) — 7,3 ГБ на одних серверах, свободно
# 777 МБ из 15 093, OOM-killer снял фоновую команду. Признак при этом читается
# не как нехватка памяти, а как «я сломал свою правку»: мигающие живые пробы,
# `ECONNREFUSED`, обрывы `/api/auth/csrf/`.
#
# Механизм у сторожа уже был: `other_next_rss_mb` считает ЧУЖИЕ `next-server`
# машины целиком и опускает на их вес свой потолок. Не хватало ровно двух
# вещей — сказать о них при старте и не стартовать, когда машина уже за
# бюджетом.
# ОДИН фильтр на все три места (ревью №817): `comm` у Next меняется от версии
# («next-server (v15.2.4)», в усечении «next-server (v1»), и три копии этого
# awk означали бы три места, где правку забудут. Возраст нужен, чтобы отличить
# сироту от чужого рабочего сервера.
next_server_rows() {
  ps -eo pid=,rss=,etimes=,comm= | awk '$4 ~ /^next-server/ {print $1, $2, $3}'
}

port_of() {
  ss -ltnp 2>/dev/null | awk -v p="pid=$1," '$0 ~ p {split($4, a, ":"); print a[length(a)]; exit}'
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
      echo "[dev-guard]   pid=$pid  $((rss / 1024)) МБ  возраст ${age} мин  ПОРТА НЕТ — похоже на сироту, её и гасите"
    else
      echo "[dev-guard]   pid=$pid  $((rss / 1024)) МБ  возраст ${age} мин  слушает :$port — может быть чужим прогоном, сперва спросите"
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

# 🔴 МЕРКА ОТКАЗА — ПАМЯТЬ МАШИНЫ, А НЕ ПОТОЛОК ОДНОГО СЕРВЕРА (ревью №817).
# Здесь стоял `HARD_LIMIT_MB`, и это была подмена величины: он равен
# min(40 % памяти, ABS_HARD_CAP_MB), а ABS_HARD_CAP_MB=3500 взят по
# ПОВЕДЕНЧЕСКОЙ причине — выше ~3,5 ГБ сломан САМ `next dev`. О том, сколько
# памяти есть у машины, это число не говорит ничего. Замерено при ревью: на
# машине 15 093 МБ, свободно 5204 МБ, соседи держали 2794 МБ — а отказ по
# прежней мерке сработал бы уже на 3500, то есть при пяти свободных гигабайтах.
# И на машине с 64 ГБ он сработал бы там же.
default_neighbour_limit() {
  local total_mb
  total_mb=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null)
  [ -z "$total_mb" ] && { echo 6000; return; }
  echo $((total_mb * 40 / 100))
}
NEIGHBOUR_LIMIT_MB="${NEIGHBOUR_LIMIT_MB:-$(default_neighbour_limit)}"
# Сколько памяти нужно оставить свободной, чтобы новый стенд не начал отбирать
# её у чужих прогонов: свежий `next dev` стартует на 1,3-1,6 ГБ (замер №323).
START_NEED_MB="${START_NEED_MB:-1800}"

available_mb() {
  awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0
}

NEIGHBOURS=$(neighbours_total_mb)
if [ "$NEIGHBOURS" -gt 0 ]; then
  echo "[dev-guard] на машине уже живут dev-серверы на ${NEIGHBOURS} МБ:"
  neighbours_report
fi
# Отказ, а не предупреждение, ТОЛЬКО когда соседи уже съели весь общий бюджет:
# мок-сервер и прод-стенд поднимаются НАМЕРЕННО и ненадолго, и запрещать их
# соседство значило бы сломать документированный порядок работы. А вот
# четвёртый гигабайтный сервер на машине, которая уже за потолком, — это то
# самое положение, из которого OOM-killer и начинает убивать чужие прогоны.
AVAILABLE=$(available_mb)
REFUSE=""
if [ "${DEV_GUARD_ALLOW_NEIGHBOURS:-0}" != "1" ]; then
  if [ "$NEIGHBOURS" -ge "$NEIGHBOUR_LIMIT_MB" ]; then
    REFUSE="соседи держат ${NEIGHBOURS} МБ ≥ бюджета машины ${NEIGHBOUR_LIMIT_MB} МБ"
  elif [ "$AVAILABLE" -gt 0 ] && [ "$AVAILABLE" -lt "$START_NEED_MB" ]; then
    REFUSE="свободно всего ${AVAILABLE} МБ, а свежему стенду нужно ${START_NEED_MB} МБ"
  fi
fi
if [ -n "$REFUSE" ]; then
  echo "[dev-guard] ${REFUSE} — сервер НЕ поднимаю."
  echo "[dev-guard] что делать: погасить СИРОТУ из списка выше (у неё нет порта), а сервер"
  echo "[dev-guard]   со слушающим портом может быть чужим прогоном — сперва спросите владельца."
  # 🔴 ВЫХОД ДОЛЖЕН БЫТЬ СВОЙ, А НЕ ЧЕРЕЗ ГЛАВНУЮ ЗАЩИТУ (ревью №817). Прежде
  # обойти отказ можно было только задрав `HARD_LIMIT_MB` — а это ЖЁСТКИЙ
  # потолок перезапуска в цикле, то есть человек выключал ровно ту защиту, ради
  # которой заведён `ABS_HARD_CAP_MB` (№122).
  echo "[dev-guard] перекрыть намеренно: DEV_GUARD_ALLOW_NEIGHBOURS=1 (или NEIGHBOUR_LIMIT_MB=<МБ>)."
  exit 1
fi

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

# RSS ЧУЖИХ dev-серверов (мок-сервер на другом порту, забытый стенд соседа).
# Память у машины общая: пока сторож считает только свой процесс, два сервера
# по 3 ГБ каждый проходят любой персональный порог и вместе вешают машину.
other_next_rss_mb() {
  local mine total=0 rss pid
  mine=" $(descendants "$SERVER_PID") "
  while read -r pid rss _etimes; do
    [ -z "$pid" ] && continue
    case "$mine" in *" $pid "*) continue ;; esac
    total=$((total + rss))
  done <<EOF_OTHERS
$(next_server_rows)
EOF_OTHERS
  echo $((total / 1024))
}

# 🔴 СОСЕД, ВЫРОСШИЙ ПРИ УЖЕ РАБОТАЮЩЕМ СТОРОЖЕ, — ЭТО И ЕСТЬ ПРЕДМЕТ №817
# (найдено ревью: правка закрывала только СТАРТ). Проверка при старте такой
# сценарий не ловит по построению, а агрегат в цикле называет только сумму —
# по ней нельзя понять, КОГО гасить, и он к тому же вырождается: `budget`
# опущен полом `LIMIT_MB`, и при соседях от 1000 МБ (на этой машине — всегда)
# перестаёт менять что-либо вовсе.
# Поэтому здесь смотрим КАЖДОГО соседа отдельно и называем поимённо того, кто
# сам перевалил абсолютный потолок: выше ~3,5 ГБ `next dev` сломан
# поведенчески, и это уже не «много памяти», а «рядом сломанный сервер».
report_fat_neighbour() {
  local mine pid rss port
  mine=" $(descendants "$SERVER_PID") "
  while read -r pid rss _etimes; do
    [ -z "$pid" ] && continue
    case "$mine" in *" $pid "*) continue ;; esac
    if [ $((rss / 1024)) -gt "$ABS_HARD_CAP_MB" ]; then
      port=$(port_of "$pid")
      echo "[dev-guard] 🔴 СОСЕД pid=$pid $( [ -n "$port" ] && echo "порт=:$port" || echo "без порта" ) держит $((rss / 1024)) МБ — выше абсолютного потолка ${ABS_HARD_CAP_MB}."
      echo "[dev-guard]    Это НЕ мой сервер, погасить его я не могу: выше ~3,5 ГБ next dev рвёт соединения, и падать будут ЧУЖИЕ пробы тоже."
      return 0
    fi
  done <<EOF_FAT
$(next_server_rows)
EOF_FAT
  return 1
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
# Вес соседних dev-серверов на прошлой проверке: нужен, чтобы не повторять
# строку о них каждые PERIOD секунд.
last_others=0
fat_tick=0
while true; do
  sleep "$PERIOD"
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[dev-guard] сервер умер сам — поднимаю заново"
    start_server
    continue
  fi
  rss=$(tree_rss_mb)
  others=$(other_next_rss_mb)
  budget="$HARD_LIMIT_MB"
  if [ "$others" -gt 0 ]; then
    # Чужие серверы съедают ОБЩИЙ бюджет: свой потолок опускается на их долю,
    # но не ниже мягкого порога — иначе перезапуск шёл бы по кругу.
    budget=$((HARD_LIMIT_MB - others))
    [ "$budget" -lt "$LIMIT_MB" ] && budget="$LIMIT_MB"
    # Говорим о соседе, только когда его вес ЗАМЕТНО изменился: строка раз в
    # PERIOD секунд утопила бы в шуме сообщения о перезапусках.
    if [ $((others > last_others ? others - last_others : last_others - others)) -gt 100 ]; then
      echo "[dev-guard] рядом ещё next dev на ${others} МБ — мой потолок опущен до ${budget} МБ"
      neighbours_report
      last_others="$others"
    fi
    # Толстого соседа называем не по изменению веса, а по факту — но не чаще
    # раза в 10 периодов, иначе строка утопит сообщения о перезапусках.
    fat_tick=$((fat_tick + 1))
    if [ "$fat_tick" -ge 10 ]; then
      fat_tick=0
      report_fat_neighbour || true
    fi
  fi
  if [ "$rss" -gt "$budget" ]; then
    restarts=$((restarts + 1))
    echo "[dev-guard] ${rss} МБ > жёсткого потолка ${budget} — перезапуск #${restarts} НЕ ДОЖИДАЯСЬ затишья (идущий прогон оборвётся)"
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
