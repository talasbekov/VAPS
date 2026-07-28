#!/usr/bin/env bash
# Blocks vaps-backend.service until the channel-layer Redis actually answers
# PING, not just until docker.service is up.
#
# Why this exists: on VPS reboot, dockerd restarts the `redis` container
# (docker-compose restart: unless-stopped) in parallel with systemd starting
# vaps-backend.service. `After=docker.service` only guarantees the *daemon*
# is up, not that the container has finished booting redis-server — so
# uvicorn could start accepting WS connections before Redis is reachable.
# The first channels_redis calls then hit `TimeoutError: Timeout reading
# from 127.0.0.1:6380`, which Sentry captures as PYTHON-DJANGO-1 (a burst
# of events that stops once Redis comes up on its own — harmless but noisy).
#
# Same check docker-compose.yml's redis healthcheck uses (`redis-cli ping`),
# so "ready" here means the same thing it means there.
set -euo pipefail

host="${1:?usage: wait-for-redis.sh HOST PORT [TIMEOUT_SECONDS]}"
port="${2:?usage: wait-for-redis.sh HOST PORT [TIMEOUT_SECONDS]}"
timeout="${3:-60}"

for _ in $(seq 1 "$timeout"); do
    if redis-cli -h "$host" -p "$port" ping 2>/dev/null | grep -q PONG; then
        exit 0
    fi
    sleep 1
done

echo "wait-for-redis: $host:$port did not answer PING within ${timeout}s" >&2
exit 1
