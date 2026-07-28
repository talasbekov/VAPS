# systemd deploy artifacts (VPS 81.17.99.96)

## Why these files exist

Sentry issue `PYTHON-DJANGO-1` fires a burst of
`redis.exceptions.TimeoutError: Timeout reading from 127.0.0.1:6380` on
every server reboot. Root cause: `vaps-backend.service` (uvicorn) starts as
soon as `docker.service` is up, but the `redis` container (channel layer,
`docker-compose.yml`) needs a few more seconds to actually accept
connections. The first WS `connect()`/`group_add()` calls during that
window hit `channels_redis` before Redis is listening. It's self-healing —
retries stop once Redis comes up — but it floods Sentry every restart.

`wait-for-redis.sh` closes that gap by blocking the unit's start until
`redis-cli ping` succeeds (same check `docker-compose.yml`'s `redis`
healthcheck already uses), instead of relying on `After=`/`Requires=`
ordering alone, which only guarantees the *daemon* is up, not the
*container*.

The `db` (Postgres) container races the same way, so `wait-for-postgres.sh`
applies the identical fix using `pg_isready` (same check `docker-compose.yml`'s
`db` healthcheck uses) — without it, Django could start before Postgres
accepts connections after a reboot.

## This was written without VPS access

This session has repo/GitHub access only, not SSH to 81.17.99.96 — these
files were **not** diffed against whatever is actually installed at
`/etc/systemd/system/vaps-backend.service` today. `WorkingDirectory`,
`User`, and the `.venv`/checkout paths here are best-effort guesses that
match the earlier deployment session's notes (backend on :8000,
`redis` container on :6380 mapped to host). **Before installing, compare
against the live unit** (`systemctl cat vaps-backend.service`) and adjust
paths/user to match.

## Install

```bash
# on the VPS, as a user that can write to /etc/systemd/system and reload systemd
sudo cp deploy/systemd/wait-for-redis.sh /opt/vaps/deploy/systemd/wait-for-redis.sh
sudo cp deploy/systemd/wait-for-postgres.sh /opt/vaps/deploy/systemd/wait-for-postgres.sh
sudo chmod +x /opt/vaps/deploy/systemd/wait-for-redis.sh /opt/vaps/deploy/systemd/wait-for-postgres.sh

# compare with what's live before overwriting:
systemctl cat vaps-backend.service
# reconcile any differences (paths, User=, extra Environment=) into
# deploy/systemd/vaps-backend.service, then:
sudo cp deploy/systemd/vaps-backend.service /etc/systemd/system/vaps-backend.service
sudo systemctl daemon-reload
sudo systemctl restart vaps-backend.service
sudo systemctl status vaps-backend.service
```

## Verify the fix

```bash
sudo reboot
# after it comes back:
journalctl -u vaps-backend.service --since "-5 min"   # should show the wait, then a clean uvicorn start
```

Sentry should stop receiving `PYTHON-DJANGO-1` bursts on subsequent
reboots. If it still fires, increase the timeout in `ExecStartPre` (third
arg to `wait-for-redis.sh`, default 60s) or check that the `redis`
container itself has `restart: unless-stopped` and starts promptly on
`docker.service` boot.
