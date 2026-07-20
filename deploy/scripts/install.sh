#!/usr/bin/env bash
# Story 12.3 — установка релиза VAPS на сервере контура. РУНБУК-СКРИПТ:
# каждый шаг печатается, любой провал говорит, что уже изменено и как
# откатиться. Автоматического отката НЕТ (Решение №4): откат в air-gap —
# решение человека; скрипт печатает готовую к копипасту процедуру.
#
# МОДЕЛЬ INSTALL-КАТАЛОГА (AC-1): запускается из каталога (например /opt/vaps),
# куда носителем положены:
#   vaps-<тег>.tar  manifest-<тег>.json  sha256sums-<тег>.txt   (бандл 12.2)
#   docker-compose.yml                                           (deploy/ 12.1)
#   install.sh  smoke.sh                                         (этот и сосед)
#   .env               — секреты оператора, доставлены ОТДЕЛЬНО от бандла
# State: файл installed-tag здесь же — что установлено сейчас (источник
# «образов N-1» для отката); пишется ТОЛЬКО после зелёного smoke.
#
# Использование:
#   bash install.sh <тег> <ожидаемый-sha256-архива>
# (запуск через bash — носитель FAT/exFAT теряет exec-биты; ревью 12.3)
# Второй аргумент — pinned-hash, зачитанный из ДОВЕРЕННОГО канала (бумажный
# чек-лист переноса, 12.5): со-расположенный sha256sums.txt ловит транзитную
# порчу, но НЕ подмену пары .tar+sums (deferred :90 — закрыто здесь).
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-$(cd "$(dirname "$0")" && pwd)}"
cd "$INSTALL_DIR"

RELEASE_TAG="${1:?Использование: bash install.sh <тег> <ожидаемый-sha256>}"
PINNED_SHA_RAW="${2:?Второй аргумент обязателен: ожидаемый sha256 архива (с бумаги чек-листа)}"

TAR_NAME="vaps-${RELEASE_TAG}.tar"
MANIFEST_NAME="manifest-${RELEASE_TAG}.json"
SUMS_NAME="sha256sums-${RELEASE_TAG}.txt"
ENV_FILE="${INSTALL_DIR}/.env"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "${INSTALL_DIR}/docker-compose.yml")
STATE_FILE="${INSTALL_DIR}/installed-tag"

# ── env_get: читать .env ПО ПРАВИЛАМ COMPOSE-DOTENV, не bash ────────────────
# Ревью 12.3 (тема-доминанта): сырой grep|cut оставлял кавычки/CRLF/inline-
# комментарии («VAPS_HTTP_PORT="8080"» валил smoke malformed-URL'ом на живом
# стеке), а `set -a; . .env` исполнял bash-экспансию над операторскими
# значениями ($$→PID, $(...) — исполнение). Единственный канал чтения — этот:
# CRLF срезается, unquoted inline-`#` отрезается, обрамляющие кавычки
# снимаются, \n в двойных кавычках разворачивается (зеркало compose).
env_get() {
  python3 - "$ENV_FILE" "$1" <<'PYEOF'
import sys
path, want = sys.argv[1], sys.argv[2]
val = ""
for raw in open(path, encoding="utf-8"):
    line = raw.rstrip("\r\n")
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    if k.strip() != want:
        continue
    v = v.strip()
    # Закрывающая кавычка ищется ЯВНО: `VAR="val"  # comment` легален для
    # compose — хвост после кавычки отбрасывается (первый прогон ревью-верификации
    # поймал endswith-наивность именно на такой строке).
    if v.startswith('"'):
        end = v.find('"', 1)
        if end != -1:
            v = v[1:end].replace("\\n", "\n")
    elif v.startswith("'"):
        end = v.find("'", 1)
        if end != -1:
            v = v[1:end]
    else:
        v = v.split(" #", 1)[0].split("\t#", 1)[0].strip()
    val = v  # последнее вхождение побеждает (семантика compose)
print(val)
PYEOF
}

# Карта прогресса для ERR-trap: оператор ДОЛЖЕН знать, что уже изменено.
STEP="проверки-до-изменений"
BACKUP_DIR=""
PREV_TAG=""
_on_error() {
  echo "" >&2
  echo "════════ УСТАНОВКА ПРЕРВАНА на шаге: ${STEP} ════════" >&2
  case "$STEP" in
    проверки-до-изменений)
      echo "Изменений НЕ было — система в исходном состоянии." >&2 ;;
    бэкап)
      echo "Прод-состояние НЕ менялось. Незавершённый бэкап удалён: ${BACKUP_DIR:-«не создавался»}." >&2
      # Полукаталог с пустым db.sql через неделю неотличим от настоящего
      # бэкапа (ревью 12.3) — подчищаем сразу.
      [ -n "$BACKUP_DIR" ] && rm -rf "$BACKUP_DIR" ;;
    docker-load|identity-verify|тег-в-env)
      echo "Загружены образы ${RELEASE_TAG}; прод-состояние НЕ менялось." >&2 ;;
    migrate|compose-up|smoke)
      print_rollback ;;
  esac
  exit 1
}
trap _on_error ERR

print_rollback() {
  local prev="—"
  [ -s "$STATE_FILE" ] && prev="$(cat "$STATE_FILE")"
  # Значения подставляются СЕЙЧАС — у оператора в свежем шелле нет ни
  # $VAPS_*, ни .env в окружении (ревью 12.3: литеральные $VAR в печати
  # разворачивались бы в пустоту).
  local db_user db_name port
  db_user="$(env_get VAPS_DB_USER)"; db_user="${db_user:-vaps}"
  db_name="$(env_get VAPS_DB_NAME)"; db_name="${db_name:-vaps}"
  port="$(env_get VAPS_HTTP_PORT)";  port="${port:-8080}"
  echo "" >&2
  echo "──────── ПРОЦЕДУРА ОТКАТА (образы N-1) ────────" >&2
  if [ "$prev" = "—" ] || [ "$prev" = "$RELEASE_TAG" ]; then
    echo "Предыдущего тега нет (первая установка / повтор того же тега)." >&2
    echo "Остановить стек:" >&2
    echo "  ${COMPOSE[*]} down" >&2
    if [ -n "$BACKUP_DIR" ]; then
      echo "Бэкап ДО migrate: ${BACKUP_DIR}" >&2
    fi
  else
    echo "Установленный ранее тег: ${prev}" >&2
    echo "1) ${COMPOSE[*]} down" >&2
    if [ -n "$BACKUP_DIR" ]; then
      echo "2) восстановить БД ИЗ БЭКАПА (дамп снят с --clean: пересоздаёт объекты поверх мигрированной схемы):" >&2
      echo "   ${COMPOSE[*]} up -d db && \\" >&2
      echo "   cat '${BACKUP_DIR}/db.sql' | ${COMPOSE[*]} exec -T db psql -v ON_ERROR_STOP=1 -U '${db_user}' '${db_name}'" >&2
    else
      echo "2) (бэкапа этого прогона нет — БД не трогалась ИЛИ прогон прерван до бэкапа)" >&2
    fi
    echo "3) в ${ENV_FILE}: VAPS_IMAGE_TAG=${prev}" >&2
    echo "4) ${COMPOSE[*]} up -d" >&2
    echo "5) bash '${INSTALL_DIR}/smoke.sh' 'http://localhost:${port}'" >&2
  fi
  echo "───────────────────────────────────────────────" >&2
}

# Один install за раз (урок 12.2).
exec 9>"${INSTALL_DIR}/.install.lock"
if ! flock -n 9; then
  echo "ОТКАЗ: другой install.sh уже работает в ${INSTALL_DIR}." >&2
  exit 1
fi

# ═══ ШАГ 1/8. Целостность — ВСЁ до единого изменения (AC-2/AC-3) ═══
echo "[1/8] Целостность бандла ${RELEASE_TAG}..."
for f in "$TAR_NAME" "$MANIFEST_NAME" "$SUMS_NAME" "docker-compose.yml" "smoke.sh"; do
  [ -f "$f" ] || { echo "ОТКАЗ: нет файла ${f} в ${INSTALL_DIR}." >&2; exit 1; }
done
[ -f "$ENV_FILE" ] || { echo "ОТКАЗ: нет ${ENV_FILE} — секреты доставляются отдельной процедурой." >&2; exit 1; }

# Pinned-hash с бумаги: нормализуем регистр и валидируем ФОРМАТ до сравнения —
# опечатка ручного ввода не должна кричать «ПОДМЕНА» (ревью 12.3).
PINNED_SHA="$(printf '%s' "$PINNED_SHA_RAW" | tr 'A-F' 'a-f' | tr -d '[:space:]')"
if ! printf '%s' "$PINNED_SHA" | grep -qE '^[0-9a-f]{64}$'; then
  echo "ОТКАЗ: pinned-значение не похоже на sha256 (нужно 64 hex-символа) — опечатка ввода с бумаги?" >&2
  exit 1
fi

ACTUAL_SHA="$(sha256sum "$TAR_NAME" | awk '{print $1}')"
SUMS_OK=1
sha256sum -c "$SUMS_NAME" >/dev/null 2>&1 || SUMS_OK=0
if [ "$ACTUAL_SHA" != "$PINNED_SHA" ]; then
  if [ "$SUMS_OK" = 1 ]; then
    # Самосогласованная пара .tar+sums при неверном pinned — сигнатура ПОДМЕНЫ.
    echo "ОТКАЗ: sha архива НЕ совпал с pinned-значением с бумаги, при этом" >&2
    echo "sha256sums.txt внутренне сходится — похоже на ПОДМЕНУ пары .tar+sums." >&2
  else
    echo "ОТКАЗ: sha архива не совпал ни с pinned, ни с sums — транзитная порча носителя." >&2
  fi
  echo "  pinned:  ${PINNED_SHA}" >&2
  echo "  фактич.: ${ACTUAL_SHA}" >&2
  exit 1
fi
if [ "$SUMS_OK" != 1 ]; then
  echo "ОТКАЗ: sha256sums-чек не прошёл (манифест бит?) — установка прервана ДО изменений." >&2
  exit 1
fi

# Манифест: sanity + чтение полей. Отдельный захват ошибки — битый/неполный
# манифест обязан дать «ОТКАЗ: …», а не сырой traceback (ревью 12.3).
if ! MANIFEST_FIELDS="$(python3 - "$MANIFEST_NAME" "$RELEASE_TAG" <<'PYEOF' 2>&1
import json, sys
m = json.load(open(sys.argv[1], encoding="utf-8"))
tag = sys.argv[2]
for img in m["images"]:
    # Бандл, переименованный под чужой тег, обязан умереть здесь, а не на
    # migrate «image not found» после бэкапа/load (ревью 12.3).
    if not img["name"].endswith(":" + tag):
        raise SystemExit(f"образ {img['name']} в манифесте не соответствует тегу {tag}")
print(m["bundle_sha256"], m["bundle_size_bytes"], m["git_sha"], m.get("min_upgrade_from") or "-")
PYEOF
)"; then
  echo "ОТКАЗ: манифест повреждён/неполон/не от этого релиза: ${MANIFEST_FIELDS}" >&2
  exit 1
fi
read -r M_SHA M_SIZE M_GIT_SHA M_MIN_UPGRADE <<< "$MANIFEST_FIELDS"
ACTUAL_SIZE="$(stat -c%s "$TAR_NAME")"
if [ "$M_SHA" != "$ACTUAL_SHA" ] || [ "$M_SIZE" != "$ACTUAL_SIZE" ]; then
  echo "ОТКАЗ: манифест описывает другой архив (sha/size не сходятся) — ДО изменений." >&2
  exit 1
fi
echo "  sha/размер/манифест сходятся; git_sha релиза: ${M_GIT_SHA}"

# State: существующий-но-пустой файл = повреждение, НЕ «первая установка»
# (пустой PREV молча пропустил бы бэкап и min_upgrade-гейт — ревью 12.3).
if [ -f "$STATE_FILE" ]; then
  PREV_TAG="$(cat "$STATE_FILE")"
  if [ -z "$PREV_TAG" ]; then
    echo "ОТКАЗ: ${STATE_FILE} существует, но пуст — state повреждён; восстановите вручную (тег работающего релиза)." >&2
    exit 1
  fi
fi

# AC-4: политика минимальной версии апгрейда. Формат тегов YYYYMMDD-sha:
# упорядочены только ДАТЫ; однодневные релизы по тегу не упорядочить —
# fail-closed на человека (ревью 12.3: молчаливый пропуск same-day дыры).
if [ "$M_MIN_UPGRADE" != "-" ] && [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$M_MIN_UPGRADE" ]; then
  PREV_DATE="${PREV_TAG%%-*}"; MIN_DATE="${M_MIN_UPGRADE%%-*}"
  if [ "$PREV_DATE" \< "$MIN_DATE" ]; then
    echo "ОТКАЗ: установлен ${PREV_TAG}, а релиз требует минимум ${M_MIN_UPGRADE}." >&2
    echo "Сначала установите промежуточный релиз ${M_MIN_UPGRADE}." >&2
    exit 1
  fi
  if [ "$PREV_DATE" = "$MIN_DATE" ]; then
    echo "ОТКАЗ: установленный ${PREV_TAG} и требуемый минимум ${M_MIN_UPGRADE} — релизы одного дня:" >&2
    echo "по тегу их не упорядочить. Сверьте вручную, что установленный НЕ старше требуемого," >&2
    echo "и при подтверждении установите сперва ${M_MIN_UPGRADE}." >&2
    exit 1
  fi
fi

# ═══ ШАГ 2/8. Бэкап (только при обновлении; AC-5) ═══
STEP="бэкап"
if [ -n "$PREV_TAG" ]; then
  BACKUP_DIR="${INSTALL_DIR}/backups/$(date -u +%Y%m%dT%H%M%SZ)-${PREV_TAG}"
  echo "[2/8] Бэкап ДО migrate → ${BACKUP_DIR} (установлен ${PREV_TAG})..."

  # Предпосылки бэкапа проверяются ДО каких-либо действий — каждая даёт
  # понятный ОТКАЗ вместо криптичной ошибки глубже (ревью 12.3):
  # (а) образ N-1 резидентен (иначе docker run уйдёт в pull в air-gap'е);
  docker image inspect "vaps-app:${PREV_TAG}" >/dev/null 2>&1 \
    || { echo "ОТКАЗ: образ vaps-app:${PREV_TAG} (N-1) отсутствует — volume-бэкап снимать нечем." >&2; exit 1; }
  # (б) имя volume — из compose-конфига; stderr compose НЕ глушится
  #     (пропавшая ${VAR:?}-переменная должна назвать себя, а не превращаться
  #     в json-traceback);
  PROJECT_NAME="$("${COMPOSE[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"
  PS_VOLUME="${PROJECT_NAME}_private_storage"
  # (в) volume существует — docker run с несуществующим именем МОЛЧА создал
  #     бы пустой и «бэкап» из ничего прошёл бы зелёным.
  docker volume inspect "$PS_VOLUME" >/dev/null 2>&1 \
    || { echo "ОТКАЗ: volume ${PS_VOLUME} не найден (чистка? другой проект?) — «бэкап» пустого тома был бы ложью." >&2; exit 1; }
  # (г) БД поднята (idempotent) — upgrade при остановленном стеке легален.
  "${COMPOSE[@]}" up -d --wait db

  mkdir -p "$BACKUP_DIR"
  DB_USER="$(env_get VAPS_DB_USER)"; DB_USER="${DB_USER:-vaps}"
  DB_NAME="$(env_get VAPS_DB_NAME)"; DB_NAME="${DB_NAME:-vaps}"
  # --clean --if-exists: восстановление обязано РАБОТАТЬ поверх мигрированной
  # непустой БД (ревью 12.3: plain-дамп сыпал бы «already exists» при psql
  # exit 0 — ложно-успешный restore).
  "${COMPOSE[@]}" exec -T db pg_dump --clean --if-exists -U "$DB_USER" "$DB_NAME" > "${BACKUP_DIR}/db.sql"
  [ -s "${BACKUP_DIR}/db.sql" ] || { echo "ОТКАЗ: pg_dump дал пустой файл." >&2; exit 1; }
  docker run --rm \
    -v "${PS_VOLUME}:/src:ro" \
    -v "${BACKUP_DIR}:/dst" \
    "vaps-app:${PREV_TAG}" tar -czf /dst/private_storage.tar.gz -C /src .
  [ -s "${BACKUP_DIR}/private_storage.tar.gz" ] || { echo "ОТКАЗ: volume-архив пуст." >&2; exit 1; }
  echo "  db.sql: $(stat -c%s "${BACKUP_DIR}/db.sql") Б; private_storage.tar.gz: $(stat -c%s "${BACKUP_DIR}/private_storage.tar.gz") Б"
else
  echo "[2/8] Первая установка (installed-tag отсутствует) — бэкапить нечего."
fi

# ═══ ШАГ 3/8. docker load (AC-6) ═══
STEP="docker-load"
echo "[3/8] docker load -i ${TAR_NAME}..."
# Повтор того же тега: load ПЕРЕВЕСИТ тег на образ из архива; если резидентный
# id отличался (пересборка того же sha) — старый уходит в dangling. Не блок,
# но оператор должен это ВИДЕТЬ (ревью 12.3).
if [ "$PREV_TAG" = "$RELEASE_TAG" ] && docker image inspect "vaps-app:${RELEASE_TAG}" >/dev/null 2>&1; then
  RESIDENT_ID="$(docker image inspect --format '{{.Id}}' "vaps-app:${RELEASE_TAG}")"
else
  RESIDENT_ID=""
fi
docker load -i "$TAR_NAME" >/dev/null
if [ -n "$RESIDENT_ID" ]; then
  NEW_ID="$(docker image inspect --format '{{.Id}}' "vaps-app:${RELEASE_TAG}")"
  if [ "$RESIDENT_ID" != "$NEW_ID" ]; then
    echo "  ⚠ Повтор тега ${RELEASE_TAG}: резидентный образ (${RESIDENT_ID:7:12}…) снят с тега," >&2
    echo "    тег теперь указывает на образ из бандла (${NEW_ID:7:12}…). Откат «на тот же тег» невозможен." >&2
  fi
fi

# ═══ ШАГ 4/8. Image-identity-verify (deferred :103 — закрыто; AC-6) ═══
STEP="identity-verify"
echo "[4/8] Сверка id загруженных образов с манифестом..."
python3 - "$MANIFEST_NAME" <<'PYEOF'
import json, subprocess, sys
m = json.load(open(sys.argv[1], encoding="utf-8"))
bad = []
for img in m["images"]:
    actual = subprocess.run(
        ["docker", "image", "inspect", "--format", "{{.Id}}", img["name"]],
        capture_output=True, text=True,
    ).stdout.strip()
    if actual != img["image_id"]:
        bad.append((img["name"], img["image_id"], actual or "<нет образа>"))
if bad:
    print("ОТКАЗ: id образа не совпал с манифестом — резидентный чужой образ "
          "под тем же тегом или манифест от другого бандла:", file=sys.stderr)
    for name, want, got in bad:
        print(f"  {name}\n    манифест: {want}\n    фактич.:  {got}", file=sys.stderr)
    sys.exit(1)
print("  оба образа соответствуют манифесту.")
PYEOF

# ═══ ШАГ 5/8. Тег в .env должен указывать на устанавливаемый релиз ═══
STEP="тег-в-env"
echo "[5/8] Сверка VAPS_IMAGE_TAG в .env..."
ENV_TAG="$(env_get VAPS_IMAGE_TAG)"
if [ "$ENV_TAG" != "$RELEASE_TAG" ]; then
  echo "ОТКАЗ: в ${ENV_FILE} VAPS_IMAGE_TAG='${ENV_TAG}', а устанавливается '${RELEASE_TAG}'." >&2
  echo "Поставьте VAPS_IMAGE_TAG=${RELEASE_TAG} и перезапустите install.sh." >&2
  exit 1
fi

# ═══ ШАГ 6/8. migrate (AC-7) ═══
STEP="migrate"
echo "[6/8] migrate (отдельный явный шаг — канон 12.1)..."
"${COMPOSE[@]}" run --rm app python manage.py migrate --no-input

STEP="compose-up"
echo "[7/8] compose up -d..."
"${COMPOSE[@]}" up -d

# ═══ ШАГ 8/8. smoke → state (AC-7/AC-8) ═══
STEP="smoke"
echo "[8/8] smoke..."
ENV_PORT="$(env_get VAPS_HTTP_PORT)"
bash "${INSTALL_DIR}/smoke.sh" "http://localhost:${ENV_PORT:-8080}"

# Только после зелёного smoke — атомарная фиксация состояния (Решение №1).
printf '%s\n' "$RELEASE_TAG" > "${STATE_FILE}.tmp"
mv "${STATE_FILE}.tmp" "$STATE_FILE"
trap - ERR
echo ""
echo "УСТАНОВЛЕНО: ${RELEASE_TAG} (git ${M_GIT_SHA}). Предыдущий тег: ${PREV_TAG:-—}."
# НЕ `[ -n ] && echo` последней командой: пустой BACKUP_DIR дал бы статус 1
# всему скрипту на зелёной первой установке (ревью 12.3, HIGH).
if [ -n "$BACKUP_DIR" ]; then
  echo "Бэкап: ${BACKUP_DIR}"
fi
