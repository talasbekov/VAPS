# E30 — PostgreSQL backup и изолированная проверка восстановления

Принято 2026-09-17: independent APPROVE `/tmp/qoldau-backup-review/followup3-report.md`; main `16d4d8d9e7f03be1195460230a22259102c15c9f`. На main control и real PostgreSQL 16 integration PASS, exit 0.

## Условия запуска

Команды выполняются оператором из корня репозитория в Bash, не sh. Нужны Docker и локальный PostgreSQL 16 image, доступ к явно выбранному контейнеру и существующий защищённый каталог backup. Пароль — отдельный regular non-symlink файл mode 0400 или 0600; в argv и журнал его не помещать. Значения-заглушки ниже обязательно заменить проверенными идентификаторами. Production запуск этим документом не подтверждён.


`POSTGRES_DB` and `POSTGRES_USER` are operator-approved identifiers, not values
implicitly exported by Compose. Obtain them from trusted deployment
configuration, assign and export them explicitly. Do not `source` a deployment
`.env`: shell sourcing executes the file as code.

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

# Replace these placeholders interactively or through the platform's trusted
# configuration injection. Do not place the database password in this block.
POSTGRES_DB='<operator-approved-database-name>'
POSTGRES_USER='<operator-approved-backup-role>'
export POSTGRES_DB POSTGRES_USER

: "${POSTGRES_DB:?set POSTGRES_DB explicitly}"
: "${POSTGRES_USER:?set POSTGRES_USER explicitly}"

mapfile -t SOURCE_CONTAINER_IDS < <(
  docker compose \
    -f infra/docker-compose.prod.yml \
    --env-file infra/.env \
    ps --quiet postgres
)

if (( ${#SOURCE_CONTAINER_IDS[@]} != 1 )) || [[ -z "${SOURCE_CONTAINER_IDS[0]}" ]]; then
  printf 'Expected exactly one running PostgreSQL source container\n' >&2
  exit 1
fi
SOURCE_CONTAINER_ID="${SOURCE_CONTAINER_IDS[0]}"

PASSWORD_FILE=/run/secrets/smartqoldau-postgres-backup
[[ -f "$PASSWORD_FILE" && ! -L "$PASSWORD_FILE" && -r "$PASSWORD_FILE" ]] || {
  printf 'Password file is missing, unreadable, or a symlink\n' >&2
  exit 1
}

BACKUP_OUTPUT="/srv/backups/smartqoldau/postgres-$(date -u +%Y%m%dT%H%M%SZ)"

infra/scripts/postgres-backup.sh \
  --container "$SOURCE_CONTAINER_ID" \
  --host 127.0.0.1 \
  --port 5432 \
  --database "$POSTGRES_DB" \
  --user "$POSTGRES_USER" \
  --password-file "$PASSWORD_FILE" \
  --output "$BACKUP_OUTPUT"
```

Prepare a read-only SQL invariant file through the operator-controlled runbook.
Validation has no target-database option and always creates its own isolated
PostgreSQL 16 container:

```bash
infra/scripts/postgres-restore-validate.sh \
  --backup "$BACKUP_OUTPUT" \
  --check-sql /secure/operator/smartqoldau-restore-check.sql
```

If interrupted backup reports that owned-backend cancellation could not be
confirmed, or validation reports that cleanup ownership could not be
confirmed, treat the operation as failed and investigate the exact run/container
from Docker audit data. Never remove a similarly named container without
matching its full ID and run label.

## Explicit DB-only limits

- Only PostgreSQL schema/data backup and isolated restore validation are
  implemented and verified.
- MinIO and Redis are not backed up or restored.
- Offsite storage, encryption/key management, retention, scheduler, alerting
  and production deployment are not implemented or confirmed.
- This is not a generic or production restore command. Production restore
  remains a separate change-controlled runbook.

## Прерывание и пределы проверки

При TERM код 143 допустим только после подтверждения отсутствия собственного backend/client/control files. Если Docker/control/verification недоступен, код 1 и non-secret run/application identifiers требуют точечного расследования оператором; автоматическую очистку в этом случае считать неподтверждённой. Не завершать чужие процессы или source container. Успешный SQL exit сам по себе не доказывает отмену: принимается только точный sentinel для одного backend и true.

Независимо и на main проверены normal dump/restore, no-clobber/concurrent publication, checksum/SQL failures, TERM и cancel refusal (exit77, false+exit0, duplicate sentinel). shellcheck недоступен.
