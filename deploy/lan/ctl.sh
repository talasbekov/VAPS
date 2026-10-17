#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
exec docker compose --env-file images.env --env-file .env -f docker-compose.yml "$@"
