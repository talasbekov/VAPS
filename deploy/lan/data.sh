#!/usr/bin/env bash
# PostgreSQL custom dump plus public/private uploads. Never restore over existing data.
set -euo pipefail
cd -- "$(dirname -- "$0")"
MODE="${1:-}"; TARGET="${2:-}"
[[ "$MODE" =~ ^(backup|restore)$ && "$TARGET" == /* ]] || { echo 'Usage: data.sh backup|restore /absolute/directory' >&2; exit 2; }
ctl() { bash ./ctl.sh "$@"; }
if [[ "$MODE" == backup ]]; then
  [[ ! -e "$TARGET" ]] || { echo 'Backup directory must not exist' >&2; exit 1; }
  CONFIGURED="$(ctl config --services)"
  mapfile -t SERVICES <<< "$CONFIGURED"
  mapfile -t ACTIVE < <(ctl ps --status running --services)
  [[ " ${ACTIVE[*]} " == *' backend '* && " ${ACTIVE[*]} " == *' worker '* ]] || { echo 'Backup expects the running application and worker to drain its queue' >&2; exit 1; }
  [[ " ${SERVICES[*]} " == *' backend '* && " ${SERVICES[*]} " == *' worker '* ]] || { echo 'Backup expects configured backend and worker services' >&2; exit 1; }
  if [[ " ${ACTIVE[*]} " == *' beat '* && " ${SERVICES[*]} " != *' beat '* ]]; then
    echo 'An orphan scheduler is running; review it before backup' >&2; exit 1
  fi
  mkdir -m 700 -p "$TARGET"
  RESUME=()
  for service in proxy frontend backend beat worker; do
    [[ " ${ACTIVE[*]} " != *" $service "* ]] || RESUME+=("$service")
  done
  # Older offline Compose releases lack start --wait. Resume existing services
  # without recreating containers, starting dependencies, building or pulling.
  resume() { ctl up -d --no-recreate --no-deps --no-build --pull never --wait --wait-timeout 180 "${RESUME[@]}" >/dev/null; }
  restart_failure() { echo 'Could not restart the original services; backup files are preserved. Restore application availability before retrying.' >&2; }
  recover() {
    backup_exit=$?
    trap - EXIT
    if ! resume; then restart_failure; backup_exit=1; fi
    exit "$backup_exit"
  }
  trap recover EXIT
  # Embedded beat (-B) stops with worker. Separate beat is optional.
  INPUT_SERVICES=()
  for service in proxy frontend backend beat; do
    [[ " ${SERVICES[*]} " != *" $service "* ]] || INPUT_SERVICES+=("$service")
  done
  ctl stop "${INPUT_SERVICES[@]}"
  ctl run --rm --no-deps --entrypoint python backend -c '
import os,time
os.environ.setdefault("DJANGO_SETTINGS_MODULE","organization_management.config.settings.lan")
import django; django.setup()
from organization_management.config.celery import app
from redis import Redis
r=Redis.from_url(app.conf.broker_url)
for attempt in range(60):
    inspect=app.control.inspect(timeout=3)
    active,reserved,scheduled=inspect.active(),inspect.reserved(),inspect.scheduled()
    known=all(value is not None for value in (active,reserved,scheduled))
    busy=any(jobs for result in (active,reserved,scheduled) if result for jobs in result.values())
    queued=sum(r.llen(k) for k in r.scan_iter() if r.type(k)==b"list")
    unacked=r.hlen("unacked")
    if known and not busy and queued==0 and unacked==0:
        print("Worker idle; broker drained; delayed tasks absent")
        break
    time.sleep(2)
else:
    raise SystemExit("Queue did not drain; backup cancelled and services will restart")
'
  ctl stop -t 600 worker
  WORKER_STATE="$(ctl ps --all --format '{{.State}} {{.ExitCode}}' worker)"
  [[ "$WORKER_STATE" == 'exited 0' ]] || { echo 'Worker did not exit cleanly; backup cancelled and services will restart' >&2; exit 1; }
  # Beat may have queued a job between the first idle check and worker stop.
  # Once worker/beat are stopped, any remaining jobs make this backup unsafe.
  ctl run --rm --no-deps --entrypoint python backend -c '
import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE","organization_management.config.settings.lan")
import django; django.setup()
from organization_management.config.celery import app
from redis import Redis
r=Redis.from_url(app.conf.broker_url)
queued=sum(r.llen(k) for k in r.scan_iter() if r.type(k)==b"list")
if queued or r.hlen("unacked"):
    raise SystemExit("Broker has pending jobs after worker shutdown; backup cancelled and services will restart")
print("Stopped worker; broker remains drained")
'
  ctl exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' > "$TARGET/database.dump"
  ctl run --rm --no-deps -T --entrypoint tar backend -czf - -C /data/media . > "$TARGET/media.tar.gz"
  ctl run --rm --no-deps -T --entrypoint tar backend -czf - -C /data/private . > "$TARGET/private.tar.gz"
  cp source-revision.txt "$TARGET/source-revision.txt"
  ctl exec -T db postgres --version > "$TARGET/postgres-version.txt"
  (cd "$TARGET" && sha256sum database.dump media.tar.gz private.tar.gz source-revision.txt postgres-version.txt > sha256sums.txt)
  chmod 600 "$TARGET"/*
  if ! resume; then restart_failure; trap - EXIT; exit 1; fi
  trap - EXIT
  echo "Backup completed: $TARGET. Broker was drained; Redis/beat runtime state is intentionally not transferred."
  exit 0
fi
[[ -d "$TARGET" ]] || { echo 'Backup directory missing' >&2; exit 1; }
(cd "$TARGET" && sha256sum -c sha256sums.txt)
python3 - "$TARGET" <<'PY'
import sys,tarfile
from pathlib import Path,PurePosixPath
folder=Path(sys.argv[1])
for name in ('media.tar.gz','private.tar.gz'):
    with tarfile.open(folder/name) as archive:
        for item in archive:
            path=PurePosixPath(item.name)
            if path.is_absolute() or '..' in path.parts or not (item.isfile() or item.isdir()):
                raise SystemExit('Refusing unsafe archive member: '+item.name)
if ' 16.' not in (folder/'postgres-version.txt').read_text():
    raise SystemExit('This bundle expects a PostgreSQL16 backup; review version compatibility before restoring')
PY
RUNNING="$(ctl ps --status running --services)"
for service in backend worker beat frontend proxy; do
  if [[ " $RUNNING " == *"$service"* ]]; then echo 'Restore requires a fresh stopped stack. Never restore into the working application.' >&2; exit 1; fi
done
ctl up -d db --pull never --no-build --wait --wait-timeout 120
TABLES="$(ctl exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname NOT IN ('"'"'pg_catalog'"'"','"'"'information_schema'"'"') AND n.nspname NOT LIKE '"'"'pg_toast%'"'"' AND c.relkind IN ('"'"'r'"'"','"'"'p'"'"');"')"
[[ "$TABLES" == 0 ]] || { echo 'Refusing restore: database is not empty' >&2; exit 1; }
ctl run --rm --no-deps --entrypoint python backend -c 'from pathlib import Path; assert not any(Path("/data/media").iterdir()) and not any(Path("/data/private").iterdir()), "Refusing restore: upload volumes are not empty"'
ctl exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl --exit-on-error --single-transaction' < "$TARGET/database.dump"
ctl run --rm --no-deps -T --entrypoint tar backend -xzf - -C /data/media < "$TARGET/media.tar.gz"
ctl run --rm --no-deps -T --entrypoint tar backend -xzf - -C /data/private < "$TARGET/private.tar.gz"
echo 'Data restored before migrations. Start with install.sh; do not run demo bootstrap. If interrupted, inspect the partially populated NEW stack; do not overwrite it.'
