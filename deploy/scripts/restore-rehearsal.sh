#!/usr/bin/env bash
# Story 12.4 — restore rehearsal: prove deploy/backups/latest is actually
# restorable, not just present. architecture.md#L644: "a backup that was
# never restored doesn't exist."
#
# Runs under its OWN compose project (vaps-restore-rehearsal) — distinct
# from install.sh's real prod stack (vaps-install) and from the generic
# "deploy" name that has already collided with an unrelated project's
# volumes twice this session. Restoring into the LIVE prod project would
# destroy real data; a shared generic name risks destroying someone else's.
#
# nginx is deliberately NOT started here — it would fight the real prod
# nginx for port 80 on the same host. The full nginx-fronted request path
# (Host guard, X-Accel, WS Origin) is already proven live by Stories 12.1/
# 12.3; this rehearsal's job is narrower and more specific: prove the
# RESTORED DATA boots a working app. Smoke runs INSIDE the app container,
# hitting 127.0.0.1:8000 directly — the exact mechanism Story 12.1's own
# app healthcheck already uses, and a path config/settings.py's
# allowed_hosts_from_env explicitly keeps open in prod for this reason
# (Story 12.3 review fix).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${DEPLOY_DIR}/docker-compose.yml"
COMPOSE_PROJECT="vaps-restore-rehearsal"
BACKUP_ROOT="${DEPLOY_DIR}/backups"
LATEST="${BACKUP_ROOT}/latest"

env_var_from_dotenv() {
  local name="$1" file="${DEPLOY_DIR}/.env"
  [[ -f "${file}" ]] || return 0
  grep -m1 "^${name}=" "${file}" | cut -d= -f2-
}
: "${VAPS_DB_USER:=$(env_var_from_dotenv VAPS_DB_USER)}"
: "${VAPS_DB_NAME:=$(env_var_from_dotenv VAPS_DB_NAME)}"

[[ -L "${LATEST}" ]] || {
  echo "ERROR: no backup at ${LATEST} (run nightly-backup.sh first)." >&2
  exit 1
}
BACKUP_DIR="$(cd "${BACKUP_ROOT}/$(readlink "${LATEST}")" && pwd)"
[[ -f "${BACKUP_DIR}/postgres.sql" && -f "${BACKUP_DIR}/private_storage.tar.gz" ]] || {
  echo "ERROR: ${BACKUP_DIR} is missing postgres.sql or private_storage.tar.gz." >&2
  exit 1
}

cleanup() {
  # Review (Blind Hunter): `|| true` correctly stops a failed teardown from
  # masking the rehearsal's own exit code, but was swallowing the failure
  # completely — an unattended run leaving the rehearsal stack (ports,
  # volumes) behind with zero operator-visible trace. Log it instead.
  if ! ( cd "${DEPLOY_DIR}" && docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" down -v ); then
    echo "WARNING: снос репетиционного стека (${COMPOSE_PROJECT}) не удался — проверьте вручную (docker ps -a / docker volume ls)." >&2
  fi
}
# Runs on success AND failure — a rehearsal stack must never linger.
trap cleanup EXIT

echo "[0/4] снос стейл-остатков предыдущей репетиции (если есть)..."
cleanup

echo "[1/4] docker compose up -d --wait postgres redis (БЕЗ nginx — избегает коллизии :80)..."
# On the real target contour there is no Backend/VAPS source tree to build
# from — the currently-installed image (install.sh's own marker, 12.3) is
# the only one available. On a dev machine with source present, "dev"
# falls back to `build:` producing something usable for the rehearsal.
if [[ -z "${VAPS_APP_SHA:-}" && -f "${DEPLOY_DIR}/.installed-sha" ]]; then
  VAPS_APP_SHA="$(cat "${DEPLOY_DIR}/.installed-sha")"
fi
export VAPS_APP_SHA="${VAPS_APP_SHA:-dev}"
( cd "${DEPLOY_DIR}" && docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" \
    up -d --wait postgres redis )

echo "[2/4] восстановление postgres.sql..."
( cd "${DEPLOY_DIR}" && docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" exec -T postgres \
    psql -U "${VAPS_DB_USER:?VAPS_DB_USER must be set (source deploy/.env first)}" \
    -d "${VAPS_DB_NAME:?VAPS_DB_NAME must be set}" -v ON_ERROR_STOP=1 \
    < "${BACKUP_DIR}/postgres.sql" )

echo "[3/4] восстановление private_storage.tar.gz..."
docker run --rm -v "${COMPOSE_PROJECT}_private_storage:/data" -v "${BACKUP_DIR}:/backup" alpine \
  sh -c "cd /data && tar xzf /backup/private_storage.tar.gz"

echo "[4/4] app на восстановленных данных + smoke изнутри контейнера..."
( cd "${DEPLOY_DIR}" && docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" \
    up -d --wait app )
if ! ( cd "${DEPLOY_DIR}" && docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}" exec -T app \
    python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/parallel-run/health/')" ); then
  echo "ERROR: приложение на восстановленных данных не отвечает на health-проверку." >&2
  exit 1
fi

echo
echo "ГОТОВО: восстановление ${BACKUP_DIR} доказанно рабочее (${COMPOSE_PROJECT} снесён)."
