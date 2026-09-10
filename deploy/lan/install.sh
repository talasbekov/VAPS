#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
for tool in docker sha256sum python3; do
  command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool" >&2; exit 1; }
done
MODE="${1:-}"
if [[ -n "$MODE" && "$MODE" != --restore ]]; then
  echo 'Usage: bash install.sh [--restore /absolute/backup-directory]' >&2; exit 2
fi
[[ "$MODE" != --restore || $# == 2 ]] || { echo 'Provide backup directory' >&2; exit 2; }
sha256sum -c sha256sums.txt
sha256sum -c source-sha256sums.txt >/dev/null
[[ -f .env ]] || { echo 'First run: python3 configure.py'; exit 1; }
chmod 600 .env
[[ "$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')" == "$(cat platform.txt)" ]] || {
  echo 'Docker platform differs from the bundle; rebuild for the destination CPU/OS.' >&2; exit 1;
}
bash ctl.sh config --format json | python3 -c '
import json,sys
from urllib.parse import urlsplit
c=json.load(sys.stdin); b=c["services"]["backend"]["environment"]; f=c["services"]["frontend"]["environment"]
s=[b["POSTGRES_PASSWORD"],b["DJANGO_SECRET_KEY"],f["NEXTAUTH_SECRET"]]
if len(set(s))!=3 or any(len(x)<32 or any(t in x.lower() for t in ("change-me","placeholder","django-insecure")) for x in s):
 sys.exit("Set three different secrets of at least 32 characters")
u=urlsplit(f["NEXTAUTH_URL"])
if u.scheme!="http" or not u.hostname or u.path not in ("","/") or u.query or u.fragment or u.username:
 sys.exit("This profile requires a plain HTTP LAN origin; TLS needs a separate configuration")
if u.hostname not in b["ALLOWED_HOSTS"].split(","): sys.exit("ALLOWED_HOSTS does not include portal IP")
for name in ("CORS_ALLOWED_ORIGINS","CSRF_TRUSTED_ORIGINS"):
 if f["NEXTAUTH_URL"].rstrip("/") not in b[name].split(","): sys.exit(name+" does not include portal origin")
ports=c["services"]["proxy"]["ports"]
front=next(p for p in ports if p["target"]==80)
if int(front["published"])!=(u.port or 80) or front["host_ip"]!=u.hostname: sys.exit("Portal URL differs from published IP/port")
if any(s.get("build") or s.get("pull_policy")!="never" for s in c["services"].values()): sys.exit("Offline services must never build or pull")
print("Configuration and platform validated; secret values withheld")
'
docker load -i runtime-images.tar.gz
if [[ "$MODE" == --restore ]]; then
  bash data.sh restore "$2"
fi
bash ctl.sh up -d --pull never --no-build --wait --wait-timeout 600
bash ctl.sh ps
echo 'Application started. Clean install: run bootstrap_contour and create/grant the first administrator as described in the guide. Restored DB: do not seed demo data.'
