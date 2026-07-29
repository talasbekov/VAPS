#!/usr/bin/env bash
# Story 12.3 — install/upgrade runbook for the target (closed-LAN) contour.
# Preceded by deploy/spike-1.9/install-probe.sh (proved sha-check + docker
# load + compose up; its own header explicitly defers backup/migrate/
# rollback/API-smoke to this story — see RUNBOOK.md's "Находка → E12" table).
#
# Usage: install.sh <bundle-dir>
#   <bundle-dir> holds the transferred vaps-<date>-<sha>-{images.tar,
#   frontend.tar,manifest.json,sha256sums.txt} (bundle.sh's output, story
#   12.2) — the whole deploy/ tree (this script, docker-compose.yml,
#   nginx/, smoke.sh) travels alongside it, per RUNBOOK.md's transfer list.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${DEPLOY_DIR}/docker-compose.yml"
INSTALLED_SHA_FILE="${DEPLOY_DIR}/.installed-sha"

# Review (Edge Case Hunter): a bare `docker compose` derives its project name
# from the compose file's own directory ("deploy") regardless of invocation
# cwd — that name is GENERIC and collides with unrelated projects that also
# have a `deploy/` directory (the exact class of incident this repo already
# hit twice this session: docker compose -p deploy ... destroyed a foreign
# project's volume). Pinning an explicit, VAPS-specific project name here
# fixes both that collision risk AND a second bug it was masking: the
# backup step below referenced the volume by its BARE name
# ("private_storage"), but compose actually creates it project-prefixed
# ("deploy_private_storage" under the implicit name) — the bare reference
# silently auto-created and tarred an unrelated EMPTY volume (`docker run -v
# <nonexistent>:/data` creates it with no error), producing a 0-byte-content
# "backup" that would have satisfied the exit-code check while backing up
# nothing. Both problems close by giving the project a fixed, known name.
COMPOSE_PROJECT="vaps-install"

# Live-verified: docker compose's `env_file: .env` exports these INTO the
# containers, but nothing exports them into THIS shell — install.sh's own
# backup step (pg_dump -U ...) needs VAPS_DB_USER/VAPS_DB_NAME directly, not
# inside a container. NOT a bash `source .env`: deploy/.env.example's own
# documented convention for VAPS_JWT_KEY is an UNQUOTED multi-line PEM with
# literal "\n" — valid for docker compose's own (non-shell) .env parser, but
# invalid bash syntax that breaks `source` outright. Pull only the two plain
# identifiers this script actually needs, not the whole file.
env_var_from_dotenv() {
  local name="$1" file="${DEPLOY_DIR}/.env"
  [[ -f "${file}" ]] || return 0
  grep -m1 "^${name}=" "${file}" | cut -d= -f2-
}
: "${VAPS_DB_USER:=$(env_var_from_dotenv VAPS_DB_USER)}"
: "${VAPS_DB_NAME:=$(env_var_from_dotenv VAPS_DB_NAME)}"

# Live-verified: smoke.sh's default BASE_URL (http://localhost) is REJECTED
# by nginx's own loopback-spoof guard (added above, this same review round) —
# a request arriving via the published port with Host: localhost is, by
# design, indistinguishable from an external client spoofing that header.
# smoke.sh must be pointed at the REAL configured host, the same one
# VAPS_ALLOWED_HOSTS names — first entry if it's a comma-separated list.
VAPS_ALLOWED_HOSTS_PRIMARY="$(env_var_from_dotenv VAPS_ALLOWED_HOSTS | cut -d, -f1)"

BUNDLE_DIR="${1:?Usage: install.sh <bundle-dir>}"
BUNDLE_DIR="$(cd "${BUNDLE_DIR}" && pwd)"

SUMS_FILE="$(ls "${BUNDLE_DIR}"/*-sha256sums.txt 2>/dev/null | head -1 || true)"
MANIFEST="$(ls "${BUNDLE_DIR}"/*-manifest.json 2>/dev/null | head -1 || true)"
IMAGES_TAR="$(ls "${BUNDLE_DIR}"/*-images.tar 2>/dev/null | head -1 || true)"
for f in "${SUMS_FILE}" "${MANIFEST}" "${IMAGES_TAR}"; do
  [[ -n "${f}" ]] || {
    echo "ERROR: bundle-directory ${BUNDLE_DIR} is missing one of *-sha256sums.txt / *-manifest.json / *-images.tar" >&2
    exit 1
  }
done

echo "[1/6] sha256sum -c (AC-1: битый архив стоп ДО любых изменений)..."
if ! ( cd "${BUNDLE_DIR}" && sha256sum -c "$(basename "${SUMS_FILE}")" ); then
  echo "ERROR: чек-суммы не совпали — архив повреждён/подделан. Установка ОСТАНОВЛЕНА до любых изменений (ни бэкапа, ни docker load)." >&2
  exit 1
fi

VAPS_APP_SHA="$(python3 -c "import json; print(json.load(open('${MANIFEST}'))['sha'])")"
export VAPS_APP_SHA
echo "Бандл sha: ${VAPS_APP_SHA}"

PREV_SHA=""
[[ -f "${INSTALLED_SHA_FILE}" ]] && PREV_SHA="$(cat "${INSTALLED_SHA_FILE}")"

if [[ -n "${PREV_SHA}" ]]; then
  echo "[2/6] бэкап ПЕРЕД мутацией (текущая установка: ${PREV_SHA})..."
  BACKUP_DIR="${DEPLOY_DIR}/pre-install-backups/$(date -u +%Y%m%dT%H%M%SZ)-${PREV_SHA}"
  mkdir -p "${BACKUP_DIR}"
  set +e
  ( cd "${DEPLOY_DIR}" && docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" exec -T postgres \
      pg_dump -U "${VAPS_DB_USER:?VAPS_DB_USER must be set (source deploy/.env first)}" \
      "${VAPS_DB_NAME:?VAPS_DB_NAME must be set}" > "${BACKUP_DIR}/postgres.sql" )
  pg_dump_status=$?
  docker run --rm -v "${COMPOSE_PROJECT}_private_storage:/data" -v "${BACKUP_DIR}:/backup" alpine \
    tar czf /backup/private_storage.tar.gz -C /data .
  volume_status=$?
  set -e
  if [[ "${pg_dump_status}" -ne 0 || "${volume_status}" -ne 0 ]]; then
    echo "ERROR: бэкап не завершился успешно (pg_dump=${pg_dump_status}, volume=${volume_status}) — установка остановлена, ничего не мутировано." >&2
    exit 1
  fi
  echo "Бэкап: ${BACKUP_DIR}/{postgres.sql,private_storage.tar.gz}"
else
  echo "[2/6] первая установка (нет ${INSTALLED_SHA_FILE}) — бэкапировать нечего, пропущено."
fi

echo "[3/6] docker load -i ${IMAGES_TAR} (все 4 образа 12.2's бандла)..."
docker load -i "${IMAGES_TAR}"

echo "[4/6] docker compose up -d --wait (VAPS_APP_SHA=${VAPS_APP_SHA}; миграции — часть app's command, 12.1)..."
if ! ( cd "${DEPLOY_DIR}" && docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" up -d --wait ); then
  echo "ERROR: docker compose up не поднял стек здоровым (миграция могла упасть — app's healthcheck на /admin/login/ не отвечает)." >&2
  if [[ -n "${PREV_SHA}" ]]; then
    echo "ОТКАТ:" >&2
    echo "  docker compose -p ${COMPOSE_PROJECT} -f ${COMPOSE_FILE} down" >&2
    echo "  VAPS_APP_SHA=${PREV_SHA} docker compose -p ${COMPOSE_PROJECT} -f ${COMPOSE_FILE} up -d --wait" >&2
    echo "  Бэкап (если нужно восстановить БД): ${BACKUP_DIR}/{postgres.sql,private_storage.tar.gz}" >&2
  fi
  exit 1
fi

echo "[5/6] smoke.sh..."
if [[ -n "${VAPS_ALLOWED_HOSTS_PRIMARY}" ]]; then
  export VAPS_SMOKE_BASE_URL="http://${VAPS_ALLOWED_HOSTS_PRIMARY}"
fi
if ! "${SCRIPT_DIR}/smoke.sh"; then
  echo "ERROR: smoke.sh упал — стек поднялся, но не прошёл проверку." >&2
  if [[ -n "${PREV_SHA}" ]]; then
    echo "ОТКАТ (AC-5):" >&2
    echo "  docker compose -p ${COMPOSE_PROJECT} -f ${COMPOSE_FILE} down" >&2
    echo "  VAPS_APP_SHA=${PREV_SHA} docker compose -p ${COMPOSE_PROJECT} -f ${COMPOSE_FILE} up -d --wait" >&2
    echo "  Бэкап (если нужно восстановить БД): ${BACKUP_DIR}/{postgres.sql,private_storage.tar.gz}" >&2
  else
    echo "Это была первая установка — отката на предыдущую версию нет, только повторная попытка." >&2
  fi
  exit 1
fi

echo "[6/6] установка подтверждена — записываем ${INSTALLED_SHA_FILE}..."
echo "${VAPS_APP_SHA}" > "${INSTALLED_SHA_FILE}"

echo
echo "ГОТОВО: VAPS ${VAPS_APP_SHA} установлен и прошёл smoke."
