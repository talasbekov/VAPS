#!/usr/bin/env bash
# Blocks vaps-backend.service until Postgres actually accepts connections,
# not just until docker.service is up.
#
# Same race as wait-for-redis.sh (see that file for the full explanation):
# on VPS reboot, dockerd restarts the `db` container (docker-compose
# restart: unless-stopped) in parallel with systemd starting
# vaps-backend.service. `After=docker.service` only guarantees the *daemon*
# is up, not that Postgres has finished its startup/recovery — so uvicorn
# (and any Django code that touches the DB on startup) could run before
# Postgres is reachable, e.g. `OperationalError: could not connect to
# server: Connection refused`.
#
# Same check docker-compose.yml's db healthcheck uses (`pg_isready`), so
# "ready" here means the same thing it means there.
set -euo pipefail

host="${1:?usage: wait-for-postgres.sh HOST PORT USER DB [TIMEOUT_SECONDS]}"
port="${2:?usage: wait-for-postgres.sh HOST PORT USER DB [TIMEOUT_SECONDS]}"
user="${3:?usage: wait-for-postgres.sh HOST PORT USER DB [TIMEOUT_SECONDS]}"
db="${4:?usage: wait-for-postgres.sh HOST PORT USER DB [TIMEOUT_SECONDS]}"
timeout="${5:-60}"

for _ in $(seq 1 "$timeout"); do
    if pg_isready -h "$host" -p "$port" -U "$user" -d "$db" >/dev/null 2>&1; then
        exit 0
    fi
    sleep 1
done

echo "wait-for-postgres: $host:$port did not become ready within ${timeout}s" >&2
exit 1
