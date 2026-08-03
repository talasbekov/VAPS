# systemd deploy artifacts (VPS 81.17.99.96, `/root/projects/VAPS`)

## Why these files exist

Sentry issue `PYTHON-DJANGO-1` fires a burst of
`redis.exceptions.TimeoutError: Timeout reading from 127.0.0.1:6380` on
every server reboot. Root cause: `vaps-backend.service` (uvicorn) starts as
soon as `docker.service` is up, but the `vaps-redis-1` container (channel
layer, host port 6380) needs a few more seconds to actually accept
connections. The first WS `connect()`/`group_add()` calls during that window
hit `channels_redis` before Redis is listening. It's self-healing — retries
stop once Redis comes up — but it floods Sentry every restart. `vaps-db-1`
(Postgres, host port 5433) races identically.

`wait-for-deps.py` closes the gap: an `ExecStartPre` gate that blocks until
Redis answers `PING` and Postgres serves `SELECT 1`, rather than relying on
`After=`/`Requires=` ordering alone — that only guarantees the Docker
*daemon* is up, not the *containers*.

## Two mistakes already made here — don't repeat them

**1. Do not check with `redis-cli` / `pg_isready`.** The first version of
this fix did, and neither binary is installed on the VPS. The checks failed
with "command not found", `ExecStartPre` exited 1, and systemd refused to
start a backend whose Redis and Postgres were both perfectly healthy — a
working service taken down by its own readiness check. `wait-for-deps.py`
uses the backend venv's `redis` and `psycopg` instead; those are guaranteed
present because the backend itself cannot run without them.

**2. Do not check "is the TCP port open".** Docker binds published ports via
docker-proxy as soon as the container is created, *before* the server inside
finishes booting. A port probe passes instantly and leaves the original race
completely unfixed.

## Install

```bash
cd /root/projects/VAPS && git pull origin main

# sanity-check the interpreter has what the script imports
/root/projects/VAPS/Backend/VAPS/.venv/bin/python -c "import redis, psycopg; print('ok')"

# run the gate by hand FIRST — with everything already up it must exit 0 fast.
# Never wire an ExecStartPre into systemd before seeing it pass manually.
set -a; . <(systemctl show vaps-backend.service -p Environment --value | tr ' ' '\n'); set +a
/root/projects/VAPS/Backend/VAPS/.venv/bin/python /root/projects/VAPS/deploy/systemd/wait-for-deps.py 10
echo "exit=$?"

# only then install the drop-in
sudo mkdir -p /etc/systemd/system/vaps-backend.service.d
sudo cp deploy/systemd/10-wait-for-deps.conf \
        /etc/systemd/system/vaps-backend.service.d/10-wait-for-deps.conf
sudo systemctl daemon-reload
sudo systemctl restart vaps-backend.service
sudo systemctl status vaps-backend.service --no-pager
```

The drop-in only appends `ExecStartPre`; the live
`/etc/systemd/system/vaps-backend.service` — its `WorkingDirectory`,
`ExecStart`, and every `Environment=` line including the Sentry DSN — stays
untouched. `wait-for-deps.py` reads `VAPS_REDIS_URL` and `VAPS_DB_*` from
that same unit environment, so the check can never drift away from what
Django itself connects to.

## Rollback

If the gate ever blocks startup, this restores service immediately:

```bash
sudo rm -f /etc/systemd/system/vaps-backend.service.d/10-wait-for-deps.conf
sudo systemctl daemon-reload
sudo systemctl restart vaps-backend.service
```

## Verify

```bash
sudo reboot
# once it's back:
journalctl -u vaps-backend.service --since "-5 min"
```

Expect `wait-for-deps: redis and postgres ready` before uvicorn's startup
line, and no `PYTHON-DJANGO-1` burst in Sentry afterwards. If the gate times
out on a slow boot, raise the argument in the drop-in (seconds, default 60).
