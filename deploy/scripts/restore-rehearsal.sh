#!/usr/bin/env bash
# Story 12.4 — репетиция восстановления: свежайший ночной дамп льётся в
# ЧИСТЫЙ одноразовый postgres:16-контейнер, SQL-смок доказывает «восстановимо»,
# контейнер сносится всегда (trap EXIT). Файловый бэкап — tar -tzf целостность
# (Решение №3: содержимое вложений без стека валидировать некому).
#
# АЛЕРТ (Решение №4, air-gap): провал = ненулевой exit + файл-маркер
# backups/ALERT-restore-rehearsal (ts, шаг, причина) + строка в
# backups/rehearsal.log. Успех СНИМАЕТ маркер: его существование = «последняя
# репетиция провалена». Утренняя проверка оператора — одна строка: есть ли файл.
#
# Использование: bash restore-rehearsal.sh [путь-к-db.sql]
#   (без аргумента — свежайший backups/nightly/*/db.sql)
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-$(cd "$(dirname "$0")" && pwd)}"
cd "$INSTALL_DIR"
ENV_FILE="${INSTALL_DIR}/.env"
NIGHTLY_DIR="${INSTALL_DIR}/backups/nightly"

# ── env_get: копия из install.sh (12.3) — правки ТОЛЬКО синхронно с ним ─────
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
ALERT_FILE="${INSTALL_DIR}/backups/ALERT-restore-rehearsal"
LOG_FILE="${INSTALL_DIR}/backups/rehearsal.log"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
# Имя: $$+ts — leftover от SIGKILL прошлого прогона не коллидирует по PID-reuse.
CONTAINER="vaps-rehearsal-$$-${TS}"

STEP="выбор-бэкапа"
_fail() {
  # Записи под `|| true` (ревью 12.4): полный/read-only диск — самый
  # вероятный катастрофический режим бэкап-хоста; сбой записи маркера не
  # имеет права глушить stderr-диагноз и exit 1.
  mkdir -p "$(dirname "$ALERT_FILE")" 2>/dev/null || true
  {
    echo "ts: ${TS}"
    echo "step: ${STEP}"
    echo "reason: $1"
  } > "$ALERT_FILE" 2>/dev/null || true
  echo "${TS} FAIL step=${STEP} $1" >> "$LOG_FILE" 2>/dev/null || true
  echo "REHEARSAL: FAIL (${STEP}) — $1" >&2
  echo "ALERT-маркер: ${ALERT_FILE}" >&2
  exit 1
}
trap '_fail "неожиданный сбой (см. вывод выше)"' ERR
# Контейнер сносится ВСЕГДА — и при провале, и при успехе. -v ОБЯЗАТЕЛЕН
# (ревью 12.4, High): postgres:16 декларирует VOLUME на PGDATA — без -v каждый
# прогон оставлял бы анонимный том с ПОЛНОЙ копией прод-БД.
trap 'docker rm -f -v "$CONTAINER" >/dev/null 2>&1 || true' EXIT

# ЕДИНЫЙ лок с backup-nightly.sh (ревью 12.4): ручной rehearsal во время
# идущего бэкапа читал бы недописанный свежайший каталог (ложный ALERT), а
# ротация могла бы удалить читаемый дамп. Цепочка systemd последовательна и
# не страдает.
exec 9>"${INSTALL_DIR}/.backup.lock"
if ! flock -n 9; then
  echo "ОТКАЗ: backup-nightly.sh или другой rehearsal уже работает." >&2
  exit 1
fi

# GC осиротевших rehearsal-контейнеров (SIGKILL/потеря питания обходят
# EXIT-trap): под локом безопасно — других прогонов нет.
docker ps -aq -f name='^vaps-rehearsal-' | xargs -r docker rm -f -v >/dev/null 2>&1 || true

# ── Выбор дампа ─────────────────────────────────────────────────────────────
if [ -n "${1:-}" ]; then
  DUMP="$1"
else
  # Имена-таймстампы → sort = хронология; берём свежайший, в котором есть db.sql.
  # `|| true`: find на отсутствующем nightly/ не должен ронять substitution
  # ERR-trap'ом «неожиданный сбой» — пустой DUMP уходит во внятный _fail ниже.
  DUMP="$(find "$NIGHTLY_DIR" -mindepth 2 -maxdepth 2 -name db.sql 2>/dev/null | sort | tail -1 || true)"
fi
[ -n "$DUMP" ] && [ -s "$DUMP" ] || _fail "нет ни одного ночного дампа (backups/nightly пуст?) — репетировать нечего"
BACKUP_DIR="$(dirname "$DUMP")"
echo "rehearsal: дамп ${DUMP} ($(stat -c%s "$DUMP") Б)"

# ── Файловый бэкап: целостность архива ──────────────────────────────────────
STEP="tar-целостность"
PS_TAR="${BACKUP_DIR}/private_storage.tar.gz"
if [ -f "$PS_TAR" ]; then
  tar -tzf "$PS_TAR" >/dev/null || _fail "private_storage.tar.gz бит (tar -tzf)"
  echo "  private_storage.tar.gz: цел ($(stat -c%s "$PS_TAR") Б)"
else
  _fail "рядом с дампом нет private_storage.tar.gz — ночной бэкап неполон"
fi

# ── Чистый контейнер ТОГО ЖЕ мажора, что compose (postgres:16) ──────────────
STEP="чистый-контейнер"
# Роль и имя БД — ПРОДОВЫЕ из .env: дамп несёт «OWNER TO <роль>», и контейнер
# с чужой ролью честно валится на ON_ERROR_STOP (поймано первым живым
# прогоном 12.4). Пароль одноразовый и несекретный: контейнер живёт минуты,
# портов наружу нет, анонимный volume умирает вместе с ним (trap EXIT).
DB_USER="$(env_get VAPS_DB_USER)"; DB_USER="${DB_USER:-vaps}"
DB_NAME="$(env_get VAPS_DB_NAME)"; DB_NAME="${DB_NAME:-vaps}"
# Образ БД — ИЗ COMPOSE-ФАЙЛА, не хардкод (ревью 12.4): бамп мажора в
# compose не оставит репетицию молча на старом. Residency-гард — в air-gap
# отсутствие образа значит зависший pull, а не понятную ошибку; доставка
# базовых образов в контур — чек-лист 12.5 (deferred-work).
PG_IMAGE="$(grep -oE 'image: *postgres:[^ ]+' "${INSTALL_DIR}/docker-compose.yml" | head -1 | awk '{print $2}')"
[ -n "$PG_IMAGE" ] || _fail "в docker-compose.yml не найден образ postgres — сверка мажора невозможна"
docker image inspect "$PG_IMAGE" >/dev/null 2>&1 \
  || _fail "образ ${PG_IMAGE} не резидентен — в air-gap пулл невозможен (доставка базовых образов — чек-лист 12.5)"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=rehearsal \
  -e POSTGRES_USER="$DB_USER" -e POSTGRES_DB="$DB_NAME" "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" -h 127.0.0.1 >/dev/null 2>&1; then
    READY=1; break
  fi
  sleep 1
done
[ "${READY:-0}" = 1 ] || _fail "чистый postgres:16 не поднялся за 60с"

# ── Restore: ON_ERROR_STOP — битый дамп обязан УРОНИТЬ, не прожевать ────────
STEP="restore"
# --clean-дамп на пустой БД даёт benign «does not exist, skipping» NOTICE-ы
# (--if-exists) — это не ошибки; ON_ERROR_STOP ловит настоящие. stdout псql
# глушится (болтовня set_config/SET), stderr остаётся — там настоящие ошибки.
docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -q -U "$DB_USER" -d "$DB_NAME" < "$DUMP" >/dev/null \
  || _fail "psql ON_ERROR_STOP: дамп не восстановился"

# ── SQL-смок: дискриминирующий (AC-3) ───────────────────────────────────────
STEP="sql-смок"
# Имена таблиц — ЖИВЫЕ db_table из моделей (сверено grep'ом по apps/**;
# первый прогон уронил угаданные имена — смок дискриминирует, как и задуман).
SMOKE_OUT="$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -F'|' -c "
SELECT 'migrations', COUNT(*) FROM django_migrations
UNION ALL SELECT 'migrations_ops', COUNT(*) FROM django_migrations WHERE app IN ('ops_submissions','ops_statuses')
UNION ALL SELECT 'core_employees', COUNT(*) FROM core_employees
UNION ALL SELECT 'ops_employee_statuses', COUNT(*) FROM ops_employee_statuses
UNION ALL SELECT 'ops_daily_submissions', COUNT(*) FROM ops_daily_submissions
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'documents_attachments', COUNT(*) FROM documents_attachments
UNION ALL SELECT 'ops_user_roles', COUNT(*) FROM ops_user_roles
")" || _fail "SQL-смок: ключевая таблица отсутствует в восстановленной БД"
echo "$SMOKE_OUT" | sed 's/^/  восстановлено: /'
# Гейт (а): миграции применённой системы не могут быть пусты — пустая/чужая
# БД в контейнере обязана дать FAIL, а не «0 строк = зелёно».
MIG_OPS="$(echo "$SMOKE_OUT" | awk -F'|' '$1=="migrations_ops"{print $2}')"
[ -n "$MIG_OPS" ] && [ "$MIG_OPS" -gt 0 ] || _fail "django_migrations без ops_*-записей — это не БД VAPS"

# ── Успех: снять маркер, записать журнал ────────────────────────────────────
trap - ERR
rm -f "$ALERT_FILE"
COUNTS="$(echo "$SMOKE_OUT" | tr '\n' ' ')"
echo "${TS} OK dump=${DUMP} ${COUNTS}" >> "$LOG_FILE"
echo "REHEARSAL: OK — бэкап доказанно восстановим."
