#!/usr/bin/env bash
# Story 12.4 — ночной бэкап VAPS: pg_dump --clean + tar private_storage
# с живого стека → INSTALL_DIR/backups/nightly/<UTC-ts>/ + ротация.
#
# Зовётся ночной джобой (deploy/systemd/vaps-backup.* — timer с
# Persistent=true даёт catch-up семантику epic-AC: выключенный ночью сервер
# исполняет джобу при ближайшей загрузке) ЛИБО руками из INSTALL_DIR.
# Отдельный каталог nightly/: ротация не имеет права съесть pre-migrate
# бэкапы install.sh (Решение №5).
#
# Использование: bash backup-nightly.sh   (из INSTALL_DIR; env INSTALL_DIR переопределяет)
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-$(cd "$(dirname "$0")" && pwd)}"
cd "$INSTALL_DIR"
ENV_FILE="${INSTALL_DIR}/.env"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "${INSTALL_DIR}/docker-compose.yml")
STATE_FILE="${INSTALL_DIR}/installed-tag"
NIGHTLY_DIR="${INSTALL_DIR}/backups/nightly"
ALERT_FILE="${INSTALL_DIR}/backups/ALERT-backup-nightly"
LOG_FILE="${INSTALL_DIR}/backups/backup.log"

# Алерт-машина (зеркало restore-rehearsal.sh, ревью 12.4: провал БЭКАП-половины
# ночной джобы тоже обязан быть виден утренним ритуалом «есть ли ALERT-*»).
# Записи под `|| true`: полный диск не должен глушить сам exit и stderr.
_alert() {
  mkdir -p "$(dirname "$ALERT_FILE")" 2>/dev/null || true
  { echo "ts: $(date -u +%Y%m%dT%H%M%SZ)"; echo "reason: $1"; } > "$ALERT_FILE" 2>/dev/null || true
  echo "$(date -u +%Y%m%dT%H%M%SZ) FAIL $1" >> "$LOG_FILE" 2>/dev/null || true
}

# ── env_get: копия из install.sh (12.3) — правки ТОЛЬКО синхронно с ним ─────
# Читает .env по правилам compose-dotenv (CRLF, кавычки с явной закрывающей,
# inline-комменты, \n в двойных кавычках), НЕ bash-сорсинг.
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
    val = v
print(val)
PYEOF
}

exec 9>"${INSTALL_DIR}/.backup.lock"
if ! flock -n 9; then
  echo "ОТКАЗ: другой backup-nightly.sh уже работает в ${INSTALL_DIR}." >&2
  exit 1
fi

# Нет установки — нечего бэкапить: штатный выход (джоба может стоять в
# таймере до первой установки).
if [ ! -s "$STATE_FILE" ]; then
  echo "backup-nightly: installed-tag отсутствует/пуст — установки нет, бэкапить нечего."
  exit 0
fi
INSTALLED_TAG="$(cat "$STATE_FILE")"

[ -f "$ENV_FILE" ] || { echo "ОТКАЗ: нет ${ENV_FILE}." >&2; exit 1; }

TS="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${NIGHTLY_DIR}/${TS}"

# Предпосылки — те же гарды, что в install.sh 12.3 (образ N, volume).
docker image inspect "vaps-app:${INSTALLED_TAG}" >/dev/null 2>&1 \
  || { echo "ОТКАЗ: образ vaps-app:${INSTALLED_TAG} отсутствует — volume тарить нечем." >&2; exit 1; }
PROJECT_NAME="$("${COMPOSE[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"
PS_VOLUME="${PROJECT_NAME}_private_storage"
docker volume inspect "$PS_VOLUME" >/dev/null 2>&1 \
  || { echo "ОТКАЗ: volume ${PS_VOLUME} не найден." >&2; exit 1; }
"${COMPOSE[@]}" up -d --wait db

# KEEP валидируется ДО снятия бэкапа (ревью-проба 12.4: отказ валидации в
# хвосте триггерил EXIT-cleanup и удалял только что снятый честный бэкап).
# ≥1 и без ведущих нулей: KEEP=0 удалял бы сегодняшний каталог, 014 — октал.
KEEP="$(env_get VAPS_BACKUP_KEEP)"; KEEP="${KEEP:-14}"
if ! [[ "$KEEP" =~ ^[1-9][0-9]{0,3}$ ]]; then
  echo "ОТКАЗ: VAPS_BACKUP_KEEP='${KEEP}' — нужно целое 1..9999." >&2; exit 1
fi

# Очистка частичного каталога на ЛЮБОМ неуспешном выходе (ревью 12.4):
# ERR-trap не покрывал `[ -s … ] || exit` и сигналы; EXIT-trap с флагом
# успеха + перехват TERM/INT (systemctl stop, reboot) кроют всё.
BACKUP_OK=0
trap '[ "$BACKUP_OK" = 1 ] || { echo "backup-nightly: ПРЕРВАН — незавершённый каталог удалён: ${DEST}" >&2; rm -rf "$DEST"; _alert "прерван (см. журнал юнита)"; }' EXIT
trap 'exit 143' TERM INT

# Родитель — идемпотентно; ЛИСТ — строго без -p: коллизия TS одной секунды
# обязана упасть громко, а не молча перезаписать соседний бэкап (ревью 12.4;
# перво-прогонная поправка: голый mkdir валился на свежем nightly/).
mkdir -p "$NIGHTLY_DIR"
mkdir "$DEST"
DB_USER="$(env_get VAPS_DB_USER)"; DB_USER="${DB_USER:-vaps}"
DB_NAME="$(env_get VAPS_DB_NAME)"; DB_NAME="${DB_NAME:-vaps}"
# --clean --if-exists: восстановление обязано работать поверх непустой БД
# (канон 12.3).
"${COMPOSE[@]}" exec -T db pg_dump --clean --if-exists -U "$DB_USER" "$DB_NAME" > "${DEST}/db.sql"
[ -s "${DEST}/db.sql" ] || { echo "ОТКАЗ: pg_dump дал пустой файл." >&2; exit 1; }
# Том живой (app пишет в 02:30 легально): GNU tar exit 1 = «file changed as
# we read it» — warning, НЕ провал (ревью 12.4); exit >1 — настоящая ошибка.
# Скос дамп↔tar benign-направленный: файл ложится на диск ДО коммита строки,
# а дамп снят ДО tar — худший случай = сирота-файл в архиве, никогда
# «строка без файла».
TAR_RC=0
docker run --rm \
  -v "${PS_VOLUME}:/src:ro" \
  -v "${DEST}:/dst" \
  "vaps-app:${INSTALLED_TAG}" tar -czf /dst/private_storage.tar.gz -C /src . || TAR_RC=$?
[ "$TAR_RC" -le 1 ] || { echo "ОТКАЗ: tar упал (rc=${TAR_RC})." >&2; exit 1; }
[ -s "${DEST}/private_storage.tar.gz" ] || { echo "ОТКАЗ: volume-архив пуст." >&2; exit 1; }
echo "backup-nightly OK: ${DEST}"
echo "  db.sql: $(stat -c%s "${DEST}/db.sql") Б; private_storage.tar.gz: $(stat -c%s "${DEST}/private_storage.tar.gz") Б"

# ── Ротация: KEEP провалидирован ещё до снятия бэкапа (fail-fast) ───────────
# Имена = UTC-таймстампы → лексикографический sort = хронология.
mapfile -t ALL < <(find "$NIGHTLY_DIR" -mindepth 1 -maxdepth 1 -type d | sort)
COUNT="${#ALL[@]}"
if [ "$COUNT" -gt "$KEEP" ]; then
  for ((i=0; i<COUNT-KEEP; i++)); do
    echo "  ротация: удаляю $(basename "${ALL[$i]}")"
    rm -rf "${ALL[$i]}"
  done
fi

BACKUP_OK=1
rm -f "$ALERT_FILE"
echo "$(date -u +%Y%m%dT%H%M%SZ) OK ${DEST}" >> "$LOG_FILE"
