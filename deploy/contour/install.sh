#!/usr/bin/env bash
# Contour-side evolution of spike-1.9/install-probe.sh: verify, load, start offline.
set -euo pipefail
cd -- "$(dirname -- "$0")"
for tool in docker sha256sum python3; do
  command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool" >&2; exit 1; }
done
docker compose version >/dev/null
echo '[1/4] Verify transferred bundle before loading anything'
sha256sum -c sha256sums.txt
sha256sum -c source-sha256sums.txt >/dev/null
[[ -f .env ]] || { echo 'Copy .env.example to .env, set LAN origin and new secrets, chmod 600 .env.' >&2; exit 1; }
chmod 600 .env
# Parse compose's resolved JSON without executing .env as shell code or printing secrets.
docker compose --env-file .env config --format json | python3 -c '
import json, sys
from urllib.parse import urlsplit
c = json.load(sys.stdin)
b = c["services"]["backend"]["environment"]
f = c["services"]["frontend"]["environment"]
secrets = [b["POSTGRES_PASSWORD"], b["DJANGO_SECRET_KEY"], f["NEXTAUTH_SECRET"]]
if any(len(s) < 32 or any(w in s.lower() for w in ("placeholder", "change-me", "django-insecure", "replace-me")) for s in secrets) or len(set(secrets)) != 3:
    sys.exit("Set three different newly generated secrets, each at least 32 characters.")
origin = urlsplit(f["NEXTAUTH_URL"])
if origin.scheme not in ("http", "https") or not origin.hostname or origin.hostname in ("192.0.2.10", "localhost", "127.0.0.1") or origin.path not in ("", "/") or origin.query or origin.fragment or origin.username:
    sys.exit("NEXTAUTH_URL must be the public LAN origin for browser acceptance.")
if origin.hostname not in b["ALLOWED_HOSTS"].split(","):
    sys.exit("ALLOWED_HOSTS must include the public LAN hostname/IP.")
for field in ("CORS_ALLOWED_ORIGINS", "CSRF_TRUSTED_ORIGINS"):
    if f["NEXTAUTH_URL"].rstrip("/") not in b[field].split(","):
        sys.exit(field + " must include the public LAN origin.")
print("Runtime configuration validated; secret values withheld.")
'
echo '[2/4] Load runtime images from the verified archive'
docker load -i runtime-images.tar.gz
echo '[3/4] Start isolated stack (no pulls, no builds)'
docker compose --env-file .env up -d --pull never --no-build --wait --wait-timeout 600
echo '[4/4] Clock observation and service state'
date -u
if command -v timedatectl >/dev/null; then timedatectl || true; fi
docker compose --env-file .env exec -T backend date -u
docker compose --env-file .env ps
echo 'Open NEXTAUTH_URL and NEXTAUTH_URL/admin/ from a LAN browser. Create a separate superuser as described in README.md.'
