"""Block vaps-backend.service startup until Redis and Postgres actually answer.

⚠️ MUST be run with the BACKEND'S OWN venv interpreter, not the system python3:

    /root/projects/VAPS/Backend/VAPS/.venv/bin/python .../wait-for-deps.py

That is the whole point of this file. The first attempt at this fix used a
bash script calling `redis-cli` / `pg_isready`, which are NOT installed on the
VPS — the checks failed with "command not found", the ExecStartPre exited 1,
and systemd refused to start a backend whose dependencies were in fact
perfectly healthy. The venv, by contrast, is guaranteed to have `redis` (a
channels-redis dependency) and `psycopg` (the Django DB driver), because the
backend cannot run without them. Deliberately no shebang and not executable,
so it cannot be invoked with an interpreter that lacks those imports.

Why this exists at all: on VPS reboot dockerd restarts the `db` and `redis`
containers (restart: unless-stopped) in parallel with systemd starting
vaps-backend.service. `After=docker.service` only guarantees the *daemon* is
up, not that the containers are serving, so uvicorn could start accepting WS
connections before the channel layer was reachable — a burst of
`TimeoutError: Timeout reading from 127.0.0.1:6380` on every boot, which is
what Sentry reports as PYTHON-DJANGO-1.

Connection settings are read from the SAME environment variables the unit
already sets (VAPS_REDIS_URL, VAPS_DB_*), which ExecStartPre inherits. Hosts
and ports are therefore never duplicated into the drop-in, so this check
cannot drift away from what Django itself will connect to.

Note on what "ready" means: a plain TCP-port probe is NOT sufficient here.
Docker's published ports are bound by docker-proxy as soon as the container
is created, before the server inside finishes booting — a port check would
pass instantly and leave the original race entirely unfixed. Hence a real
PING / real SELECT 1.
"""

import os
import sys
import time

# Per-attempt socket timeout. Short: a hung attempt should be retried, not
# waited out, since the overall budget below is what actually bounds us.
CONNECT_TIMEOUT = 3
DEFAULT_TIMEOUT = 60


def _wait_redis(deadline):
    """Returns None once Redis answers PING, or an error string on timeout."""
    import redis

    # Same default as config.settings.channel_layers_from_env — if the unit
    # ever stops setting the variable, both agree on where to look.
    url = os.environ.get("VAPS_REDIS_URL", "redis://127.0.0.1:6379/0")
    last_error = None
    while time.monotonic() < deadline:
        try:
            client = redis.from_url(
                url,
                socket_connect_timeout=CONNECT_TIMEOUT,
                socket_timeout=CONNECT_TIMEOUT,
            )
            if client.ping():
                return None
        except Exception as exc:  # noqa: BLE001 — any failure means "not yet"
            last_error = exc
        time.sleep(1)
    return f"redis at {url} never answered PING ({last_error})"


def _wait_postgres(deadline):
    """Returns None once Postgres serves SELECT 1, or an error string."""
    import psycopg

    host = os.environ.get("VAPS_DB_HOST", "localhost")
    port = os.environ.get("VAPS_DB_PORT", "5432")
    conninfo = {
        "host": host,
        "port": port,
        "dbname": os.environ.get("VAPS_DB_NAME", "vaps"),
        "user": os.environ.get("VAPS_DB_USER", "vaps"),
        "password": os.environ.get("VAPS_DB_PASSWORD", ""),
        "connect_timeout": CONNECT_TIMEOUT,
    }
    last_error = None
    while time.monotonic() < deadline:
        try:
            # SELECT 1, not just connect(): during recovery Postgres accepts
            # connections while still refusing queries.
            with psycopg.connect(**conninfo) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    cur.fetchone()
            return None
        except Exception as exc:  # noqa: BLE001 — any failure means "not yet"
            last_error = exc
        time.sleep(1)
    return f"postgres at {host}:{port} never became ready ({last_error})"


def main(argv):
    timeout = int(argv[1]) if len(argv) > 1 else DEFAULT_TIMEOUT
    # One shared budget rather than one per dependency: bounds the worst-case
    # delay systemd sees at `timeout`, not 2x it.
    deadline = time.monotonic() + timeout

    for check in (_wait_redis, _wait_postgres):
        error = check(deadline)
        if error:
            print(f"wait-for-deps: {error}", file=sys.stderr)
            return 1

    print("wait-for-deps: redis and postgres ready")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
