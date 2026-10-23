#!/usr/bin/env bash
# SMART_SERVER_MIGRATION_FENCE_V1
case "${1:-}" in
  ps|config|logs|images|version|top|ls|port|--help|-h) ;;
  *)
    if ! python3 - "$(dirname -- "$0")/.offline-update-lock/owner.json" <<'SMART_MIGRATION_LOCK'
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
if not path.parent.exists():
    raise SystemExit(0)
owner = json.loads(path.read_text(encoding='utf-8'))
raise SystemExit(1 if owner.get('mode') == 'server-migration' else 0)
SMART_MIGRATION_LOCK
    then
      echo "Smart source is frozen for server migration. Use the migration tool's controlled resume-source command." >&2
      exit 1
    fi
    ;;
esac
set -euo pipefail
cd -- "$(dirname -- "$0")"
exec docker compose --env-file images.env --env-file .env -f docker-compose.yml "$@"
