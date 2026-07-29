#!/usr/bin/env bash
# Story 12.5 — LOCAL, timed rehearsal of install.sh's sequence with a
# pause-for-confirmation gate at each deploy/CHECKLIST.md line.
#
# NOT deploy/scripts/restore-rehearsal.sh (12.4 — restores a nightly BACKUP
# into an isolated stack; different concern entirely). NOT the physical
# media rehearsal (Story 12.7, deploy/spike-1.9/RUNBOOK.md, real target
# hardware) — this practices the PROCEDURE and times it, on this machine,
# before the real transfer.
#
# Reuses install.sh itself (not a re-implementation of pg_dump/docker
# load/compose up — that logic is already written, tested, and reviewed
# there) under its OWN isolated compose project (vaps-deploy-rehearsal),
# via install.sh's COMPOSE_PROJECT override (added this same story).
#
# Review (Edge Case Hunter): install.sh brings up ALL 4 services with no
# filter (unlike restore-rehearsal.sh, which deliberately skips nginx) — on
# a machine already running the real vaps-install stack, both nginx
# containers would fight over host port 80. VAPS_NGINX_PORT (added this
# review round, deploy/docker-compose.yml) binds this rehearsal to an
# alternate port instead.
#
# Usage: deploy-rehearsal.sh <bundle-dir>
#   VAPS_REHEARSAL_AUTO=1  skip the Enter-to-continue gates (for CI/dev-story
#                          testing — a real rehearsal is meant to pause).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${DEPLOY_DIR}/rehearsal-logs"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/$(date -u +%Y%m%dT%H%M%SZ).log"

BUNDLE_DIR="${1:?Usage: deploy-rehearsal.sh <bundle-dir>}"

log_step() {
  local line="[$(date -u +%H:%M:%S)] $1"
  echo "${line}" | tee -a "${LOG_FILE}"
}

confirm() {
  local checklist_ref="$1"
  echo "  CHECKLIST.md: ${checklist_ref}" | tee -a "${LOG_FILE}"
  if [[ "${VAPS_REHEARSAL_AUTO:-0}" == "1" ]]; then
    echo "  (VAPS_REHEARSAL_AUTO=1 — авто-подтверждение)" | tee -a "${LOG_FILE}"
  elif ! read -r -p "  Отметьте пункт в CHECKLIST.md, затем Enter для продолжения... " _; then
    # Review (Edge Case Hunter): `read` fails immediately on closed/absent
    # stdin (CI, piped invocation without VAPS_REHEARSAL_AUTO=1) — swallowing
    # that silently would proceed exactly like auto-mode without saying so.
    # Log it explicitly instead of pretending a human confirmed.
    echo "  (stdin недоступен — подтверждение НЕ получено, продолжаю без него)" | tee -a "${LOG_FILE}"
  fi
}

export COMPOSE_PROJECT="vaps-deploy-rehearsal"
# Self-caught before review: without this, install.sh would overwrite the
# REAL install's .installed-sha with the rehearsal's sha — corrupting the
# exact "было/стало" tracking CHECKLIST.md relies on being accurate.
export INSTALLED_SHA_FILE="${DEPLOY_DIR}/.installed-sha-rehearsal"
# Review (Edge Case Hunter): distinct host port — see header comment above.
export VAPS_NGINX_PORT="18080"

cleanup() {
  log_step "Уборка репетиционного стека (изолирован под ${COMPOSE_PROJECT}, не трогает реальный vaps-install)..."
  if ! ( cd "${DEPLOY_DIR}" && docker compose -p "${COMPOSE_PROJECT}" -f "${DEPLOY_DIR}/docker-compose.yml" down -v ); then
    echo "WARNING: снос репетиционного стека (${COMPOSE_PROJECT}) не удался — проверьте вручную." | tee -a "${LOG_FILE}"
  fi
}
# Review (Blind Hunter/Edge Case Hunter): without a trap, install.sh failing
# partway (e.g. smoke.sh never goes green) kills this script under
# set -euo pipefail BEFORE the old inline cleanup step ever ran — leaving
# the isolated stack (and its port-18080 nginx) running indefinitely.
# restore-rehearsal.sh (12.4) already established this exact pattern.
trap cleanup EXIT

log_step "Репетиция начата: ${BUNDLE_DIR}"

log_step "Шаг 1/3: install.sh (chk-суммы → бэкап → load → up → smoke, §3.1-3.5 CHECKLIST.md)"
START="$(date -u +%s)"
"${SCRIPT_DIR}/install.sh" "${BUNDLE_DIR}"
ELAPSED=$(( $(date -u +%s) - START ))
log_step "install.sh завершён за ${ELAPSED}с"
confirm "§3.1-3.5 — все пункты отмечены"

log_step "Шаг 2/3: версия зафиксирована install.sh'ом (§1 CHECKLIST.md 'было'/'стало')"
confirm "§1 — версии переписаны из install.sh's вывода выше"

log_step "ГОТОВО (уборка — следующим шагом, через trap)."
