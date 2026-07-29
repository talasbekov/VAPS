#!/usr/bin/env bash
# Story 12.3 — post-install smoke check: health + login-page-reachability +
# one GET per /api/<context>/ (all 6 from Backend/VAPS/config/urls.py).
#
# "Логин" scope note (create-story decision, see Dev Notes in the story
# file): VAPS verifies externally-issued JWTs, it never issues its own —
# there is no token-issuing endpoint to smoke-test a real credentialed
# round-trip against. `GET /admin/login/` returning 200 (the login FORM
# renders, same probe 12.1's own healthcheck already uses) is the closest
# available proxy: it proves Django's auth subsystem is alive, not that a
# real login succeeds. A real IdP-token check is future work.
set -euo pipefail

BASE_URL="${VAPS_SMOKE_BASE_URL:-http://localhost}"
FAILED=0

check() {
  local label="$1" path="$2" expect="$3"
  local status
  # Live-verified bug: curl's own -w already prints "000" on total failure
  # (DNS/connection refused) BEFORE its nonzero exit — appending `|| echo
  # "000"` doubled it into "000000". `|| true` only guards set -e, it
  # doesn't add output; `--max-time` bounds a hung/unresponsive server.
  status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    "${BASE_URL}${path}" 2>/dev/null || true)"
  status="${status:-000}"
  if [[ "${status}" == "${expect}" ]]; then
    echo "  OK   ${label} (${path}) -> ${status}"
  else
    echo "  FAIL ${label} (${path}) -> ${status} (expected ${expect})"
    FAILED=1
  fi
}

echo "[smoke] health..."
check "health" "/api/parallel-run/health/" "200"

echo "[smoke] login (admin-login-page reachability, see scope note above)..."
check "login" "/admin/login/" "200"

# Live-verified (install.sh dev-story run, no auth available — same reason
# "login" above is scope-narrowed): an unauthenticated request to a RBAC-
# gated list endpoint is NOT 200, it is a well-formed 403 PERMISSION_DENIED
# envelope from apps/operations/api/authz.py's EffectivePermissionsResolver
# — DEFAULT_PERMISSION_CLASSES=[] at the DRF level does not mean anonymous
# access, the app's own authz layer still enforces it. A 403 here PROVES the
# whole stack (routing, DB, RBAC) is alive; a 5xx/timeout/000 would not.
# documents/attachments only exposes POST (upload) — GET is 405, also a
# well-formed "endpoint alive, method correctly rejected" response, not a
# crash (verified: Allow: POST, OPTIONS header, clean DRF JSON body).
echo "[smoke] one request per /api/<context>/ (6 contexts — anonymous, so"
echo "        403/405 from a live RBAC/router is the expected PASS, not 200):"
check "core"          "/api/core/employees/"       "403"
check "operations"    "/api/operations/roles/"     "403"
check "audit"         "/api/audit/logs/"            "403"
check "notifications" "/api/notifications/"         "403"
check "documents"     "/api/documents/attachments/" "405"
# apps/parallel_run/api/urls.py registers exactly one route (`health/`) — not
# a stand-in, the parallel-run context genuinely has no other endpoint today.
check "parallel-run"  "/api/parallel-run/health/"    "200"

if [[ "${FAILED}" -ne 0 ]]; then
  echo "[smoke] FAILED — see FAIL lines above." >&2
  exit 1
fi

echo "[smoke] all checks passed."
