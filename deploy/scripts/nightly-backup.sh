#!/usr/bin/env bash
# Story 12.4 — nightly backup: pg_dump + private_storage volume tar.
# Independent of install.sh's (12.3) inline pre-mutation backup — same
# mechanics, different caller context; 12.3's Completion Notes explicitly
# calls its own backup an "inline safety-net", not a shared library.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${DEPLOY_DIR}/docker-compose.yml"

# Same project name install.sh (12.3) always uses to bring the real prod
# stack up — that IS the running stack's actual project name on the target
# machine, not an arbitrary choice made independently here.
COMPOSE_PROJECT="vaps-install"

env_var_from_dotenv() {
  local name="$1" file="${DEPLOY_DIR}/.env"
  [[ -f "${file}" ]] || return 0
  grep -m1 "^${name}=" "${file}" | cut -d= -f2-
}
: "${VAPS_DB_USER:=$(env_var_from_dotenv VAPS_DB_USER)}"
: "${VAPS_DB_NAME:=$(env_var_from_dotenv VAPS_DB_NAME)}"

BACKUP_ROOT="${DEPLOY_DIR}/backups"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${BACKUP_ROOT}/${TS}"
mkdir -p "${OUT_DIR}"

# Review (Blind Hunter): a failed run's partial OUT_DIR (empty/truncated
# postgres.sql from a mid-run crash) must not linger forever — under
# `Persistent=true` this job runs unattended, indefinitely.
trap '[[ -f "${OUT_DIR}/private_storage.tar.gz" ]] || rm -rf "${OUT_DIR}"' EXIT

echo "[1/2] pg_dump -> ${OUT_DIR}/postgres.sql..."
( cd "${DEPLOY_DIR}" && docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" exec -T postgres \
    pg_dump -U "${VAPS_DB_USER:?VAPS_DB_USER must be set (source deploy/.env first)}" \
    "${VAPS_DB_NAME:?VAPS_DB_NAME must be set}" > "${OUT_DIR}/postgres.sql" )

echo "[2/2] private_storage volume -> ${OUT_DIR}/private_storage.tar.gz..."
docker run --rm -v "${COMPOSE_PROJECT}_private_storage:/data" -v "${OUT_DIR}:/backup" alpine \
  tar czf /backup/private_storage.tar.gz -C /data .

# `latest` only moves after BOTH artifacts exist — an interrupted backup
# (crash mid-pg_dump, disk full mid-tar) must never become the pointer
# restore-rehearsal.sh trusts.
ln -sfn "${TS}" "${BACKUP_ROOT}/latest"

# Review (Blind Hunter): nothing else prunes deploy/backups/ — under
# `Persistent=true` this runs forever, unbounded growth eventually fills the
# disk (and takes the live app/postgres containers down with it). Keep the
# last 14 nightly runs; `latest` (just updated above) is always among them.
echo "[3/3] хранить последние 14 бэкапов, удалить более старые..."
( cd "${BACKUP_ROOT}" && ls -1d 2*/ 2>/dev/null | sort -r | tail -n +15 | xargs -r rm -rf -- )

echo
echo "ГОТОВО: ${OUT_DIR}/ (deploy/backups/latest -> ${TS})"
