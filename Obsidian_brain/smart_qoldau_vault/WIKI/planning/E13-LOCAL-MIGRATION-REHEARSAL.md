# Smart Qoldau: isolated 28 -> 31 migration rehearsal and local maintenance procedure

Date: 2026-09-19 (Asia/Almaty)

## Scope and decision boundary

This was an isolated rehearsal only. It did **not** read or copy application rows from the running stand, run a migration against the shared database, recreate a shared service, change an account/credential, reload the shared proxy, or retag/replace a shared image. The repository and vault were not modified. All application records below were synthetic.

This document is **not authorization** for a live/local-stand change. A separate user decision is still required before the maintenance procedure in the last section.

Accepted source facts:

- target `main`: `2236df554cee01ed43d281c48ba3262e25256574`
- target tree: `3d58c17b87ac8ba11fda3f363199cbd09b7aadc7`
- reviewed audio source commit: `bca24a87349531e789ad66aed366cde51697a693`
- `2236df5` and `bca24a8` have the same tree
- audio parent: `719c7340591c5a9fc11d739c16769c8592bb5cc9`
- current old backend source revision remains unattested; nothing here treats the timestamp-adjacent `70f4159` as its source or authorizes a guessed-SHA backport

## Exact images and tooling used

Host Docker was `29.6.2`; Docker Compose was `v5.3.1`.

| Purpose | Exact local image ID |
|---|---|
| Existing/current old backend | `sha256:ec5ea93d5289fb91f93a8b6ffccd5ff57275d944470b80e410da8817a025ccef` |
| Rehearsal-only target backend | `sha256:05c8376e3353f88dd0e4139a27c0cc0989f7d6499ccb65073335233598dd29da` |
| Focused cached rebuild for the valid-cipher check | `sha256:7f88b2fbc447571527cf9a46041edee83f657576346d0a011b1851a34e72e76d` |
| PostgreSQL 16.15 | `sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685` |
| Redis 7 Alpine | `sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf` |
| MinIO | `sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e` |
| Resolved Node build base | `sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81` |

The rehearsal target was built under a unique, non-shared tag:

```sh
docker build --pull=false \
  --label org.opencontainers.image.revision=2236df554cee01ed43d281c48ba3262e25256574 \
  --label org.opencontainers.image.source-tree=3d58c17b87ac8ba11fda3f363199cbd09b7aadc7 \
  -t qoldau-mig-rehearsal-backend:2236df554cee01ed43d281c48ba3262e25256574 \
  backend
```

The build resolved `FROM node:24-alpine` to the Node digest shown above. This proves what this rehearsal used, but does not turn the repository's mutable `FROM` into a reproducible release recipe. A release candidate still needs immutable base digests and retained revision attestation. The focused cached rebuild had the same runtime config/layers and labels; its manifest-list ID differed because BuildKit emitted a new attestation manifest.

## Baseline reconstruction and backup/restore proof

A private Docker network and three uniquely named disposable services were used:

```sh
docker network create qoldau-mig-rehearsal-net
docker run -d --name qoldau-mig-rehearsal-pg --network qoldau-mig-rehearsal-net \
  --network-alias postgres -e POSTGRES_USER=sq_rehearsal \
  -e POSTGRES_PASSWORD='<disposable>' -e POSTGRES_DB=sq_rehearsal \
  postgres:16-alpine
docker run -d --name qoldau-mig-rehearsal-redis --network qoldau-mig-rehearsal-net \
  --network-alias redis redis:7-alpine redis-server --appendonly yes
docker run -d --name qoldau-mig-rehearsal-minio --network qoldau-mig-rehearsal-net \
  --network-alias minio -e MINIO_ROOT_USER='<disposable>' \
  -e MINIO_ROOT_PASSWORD='<disposable>' minio/minio:latest \
  server /data --console-address :9001
```

The exact current backend image contains exactly the known 28 migration directories. It reconstructed the baseline via the same deploy entry point used by Compose:

```sh
docker run --rm --name qoldau-mig-rehearsal-baseline-migrate \
  --network qoldau-mig-rehearsal-net \
  -e DATABASE_URL='postgresql://sq_rehearsal:<disposable>@postgres:5432/sq_rehearsal' \
  smartqoldau-backend@sha256:ec5ea93d5289fb91f93a8b6ffccd5ff57275d944470b80e410da8817a025ccef \
  npx prisma migrate deploy
```

Result: Prisma reported `28 migrations found`, applied all 28, and reported success. All 28 `_prisma_migrations.checksum` values matched SHA-256 of the corresponding SQL in target `main`; all rows were finished and not rolled back.

Representative synthetic legacy data was inserted only after the 28-migration baseline existed:

- three users: ordinary client, guest, and expert user
- one topic, expert, request, completed consultation, and two opaque legacy `bytea` chat rows in the first structural pass
- two notifications/outbox jobs: one due, one scheduled for 2099

Pre-upgrade hashes over the legacy columns were:

| Rows | Count | MD5 of deterministic JSON aggregate |
|---|---:|---|
| users | 3 | `db7eda59b701b2810b1a98603201f3f9` |
| chat_messages | 2 | `b73d85edef4a1bba56f561d94960ce0b` |
| notification_outbox | 2 | `7558dcb0819e7e3482932f0531b93117` |

The baseline was backed up and restored into a second database before the upgrade:

```sh
docker exec qoldau-mig-rehearsal-pg \
  pg_dump -U sq_rehearsal -d sq_rehearsal -Fc -f /tmp/qoldau-pre31.dump
docker cp qoldau-mig-rehearsal-pg:/tmp/qoldau-pre31.dump \
  /tmp/qoldau-migration-rehearsal-pre31.dump
chmod 600 /tmp/qoldau-migration-rehearsal-pre31.dump
docker exec qoldau-mig-rehearsal-pg createdb -U sq_rehearsal sq_restorecheck
docker cp /tmp/qoldau-migration-rehearsal-pre31.dump \
  qoldau-mig-rehearsal-pg:/tmp/qoldau-restorecheck.dump
docker exec qoldau-mig-rehearsal-pg \
  pg_restore -U sq_rehearsal -d sq_restorecheck --exit-on-error \
  /tmp/qoldau-restorecheck.dump
```

Backup size was 85,857 bytes and SHA-256 was `0aa73b4b91f785dbcb39f24eb66a209207f82af5ed7ec070d05fcfad96b3e892`. The restored database had 28 finished migrations and reproduced all three counts and hashes above exactly. No real stand data was used.

To avoid treating arbitrary `bytea` as representative encrypted chat, a final focused 28 -> 31 pass was repeated from a fresh old-image baseline with two valid AES-256-GCM legacy chat ciphertexts present **before** migration. Their deterministic legacy-column aggregate hash was `919731107ac5bdc154b90003c94bc5eb` both before and after target deploy; the database finished with 31 migrations. This focused repeat did not rerun the application/audio suite. The later runtime history check used the same valid encrypted fixtures.

## Exact upgrade and database results

The three target SQL files had these checksums in both the repository and the target image:

| Migration | SHA-256 |
|---|---|
| `20260902120000_r27_client_display_name_and_consent` | `8b3cfcee630c406190103a0870c1da3030a630346f1dbe73936e8b70b3b77d54` |
| `20260916043000_notification_outbox_leases` | `5e3b36dcf16a79b511de53d9480cf12d15c6f36628b4a82bea19520c4ecdd708` |
| `20260916060000_chat_client_message_id` | `c63c953197b5e5b4e978984899734e4cae3d7195e8e03cf2d0ac531c6019cafc` |

They were applied with the standard deploy process, not manual SQL:

```sh
docker run --rm --name qoldau-mig-rehearsal-target-migrate \
  --network qoldau-mig-rehearsal-net \
  -e DATABASE_URL='postgresql://sq_rehearsal:<disposable>@postgres:5432/sq_rehearsal' \
  qoldau-mig-rehearsal-backend:2236df554cee01ed43d281c48ba3262e25256574 \
  npx prisma migrate deploy
```

Prisma found 31 migrations and applied exactly the three named migrations. Afterwards:

- finished migrations: 31
- repository-to-database checksum mismatches: 0
- pre-existing legacy-column hashes remained exactly `db7eda...`, `b73d85...`, and `7558dc...`
- all six new columns are nullable and have no default
- every pre-existing row had `NULL` in its new columns
- a new user inserted without the two R-27 fields received `NULL`, confirming default behavior
- `notification_outbox_pending_claim_idx` is `(next_attempt_at, lease_expires_at, id) WHERE sent_at IS NULL AND dead_at IS NULL`
- `chat_messages_client_message_scope_uq` is unique on `(consultation_id, sender_user_id, client_message_id)`
- four same-consultation rows with both correlation columns `NULL` coexisted
- one correlated row inserted successfully; an exact correlated duplicate raised the expected unique violation; the final correlated count was one

## Target-main application checks

The target image was started only against the isolated PG/Redis/MinIO. `SMS_PROVIDER=dev`, `PUSH_PROVIDER=mock`, and `PAYMENT_PROVIDER=mock`; no external provider was configured or contacted. Only a random loopback host port was published.

Results:

- `/v1/health`: HTTP 200, `{status: ok, db: ok, redis: ok}`; container health `healthy`
- target container image ID matched `sha256:05c837...`
- guest create (Prisma default scalar select): HTTP 200
- same-device guest read (`findFirst`, default scalar select): HTTP 200 and identical user ID
- `GET /v1/me` before consent: HTTP 200 with both R-27 fields `null`
- `POST /v1/requests` before consent: HTTP 409 `EXPERT_VISIBILITY_CONSENT_REQUIRED`
- `POST /v1/me/expert-visibility`: HTTP 200, stored `Synthetic Client` and a non-null timestamp
- same request after consent: HTTP 201, `NO_EXPERTS` (expected because no synthetic expert presence was announced)
- legacy chat history: HTTP 200, two decrypted legacy messages, neither synthesized a `clientMessageId`
- correlated Socket.IO send and exact replay: both replies had the same message ID and text; database count for that `(consultation, sender, clientMessageId)` was exactly one
- the initially due legacy outbox job was claimed and settled by the target worker: attempts `1`, `sent_at` non-null, both lease fields cleared
- the 2099 job stayed pending with attempts `2` and both lease fields null
- logs contained no missing-column, Prisma known-request, or outbox-tick error

The first correlated-send attempt correctly returned `PAYMENT_HOLD_REQUIRED` because the synthetic fixture had only the consultation mirror. After adding a synthetic `payments.status=HELD` row with a mock hold ID/time, the send/replay check above passed. This is fixture evidence, not a bypass of the payment gate.

## Application rollback compatibility

The target container was stopped and removed. Without changing or downgrading the 31-migration schema, the exact current old backend image was started against the same isolated state:

```sh
docker run ... \
  smartqoldau-backend@sha256:ec5ea93d5289fb91f93a8b6ffccd5ff57275d944470b80e410da8817a025ccef
```

With the same mock-only provider configuration:

- `/v1/health`: HTTP 200 and container health `healthy`
- guest default-select path: HTTP 200
- chat history on the expanded schema: HTTP 200, three rows including the target-created correlated message
- log scan: no missing-column, Prisma known-request, or generic error

Therefore an **application-only rollback** to the exact current old backend image is compatible with this additive expanded schema. This does not identify that image's source commit and does not authorize a guessed-SHA backport. No schema down/drop is needed or permitted for rollback.

Current shared/local-stand image identities observed read-only, for a future rollback manifest:

- backend: `sha256:ec5ea93d5289fb91f93a8b6ffccd5ff57275d944470b80e410da8817a025ccef`
- admin: `sha256:37340e22df5088e8789192f26c78a66f71f5ab113cae572f716b54e6e27a9852`
- proxy: `sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10`

Read-only `docker image inspect` also returned RepoDigests
`smartqoldau-backend@sha256:ec5ea93...` and
`smartqoldau-admin@sha256:37340e22...`. Although their hex happens to match
the local image IDs in this engine, rollout commands below deliberately use
verified raw local IDs and `--pull never`; they do not construct a RepoDigest
from an image ID.

## Cleanup

All names used by the rehearsal begin with `qoldau-mig-rehearsal-`. Cleanup removes only those exact containers/network, the unique rehearsal target image, and the synthetic dump. It never targets `smartqoldau-*`:

```sh
docker rm -f qoldau-mig-rehearsal-old-api \
  qoldau-mig-rehearsal-pg qoldau-mig-rehearsal-redis \
  qoldau-mig-rehearsal-minio
docker network rm qoldau-mig-rehearsal-net
docker image rm qoldau-mig-rehearsal-backend:2236df554cee01ed43d281c48ba3262e25256574
rm /tmp/qoldau-migration-rehearsal-pre31.dump
```

Cleanup completed successfully: no `qoldau-mig-rehearsal-*` container,
network, or image remains, and the synthetic dump was removed. The existing
`smartqoldau-*` services remained running; backend/admin/PostgreSQL/Redis/
MinIO/web were healthy and the proxy remained up. `git status` stayed clean
(`## HEAD (no branch)`). Of this rehearsal's artifacts, only this `/tmp`
handoff remains.

## Prepared release artifacts (no deployment performed)

Two local candidates were built from clean accepted HEAD
`2236df554cee01ed43d281c48ba3262e25256574` / tree `3d58c17b...` under
unique task tags. Shared tags were not changed and the images are deliberately
left available for the approved rollout:

| Candidate | Exact local tag | Local image ID | Local RepoDigest |
|---|---|---|---|
| backend | `qoldau-audio-candidate-backend:2236df554cee` | `sha256:2576b61004b556628b0021de7c9ea288f9ba81250d727e6da03aac99f6e542d0` | `qoldau-audio-candidate-backend@sha256:2576b61004b556628b0021de7c9ea288f9ba81250d727e6da03aac99f6e542d0` |
| admin | `qoldau-audio-candidate-admin:2236df554cee` | `sha256:ee00f6198eddd10b4f77f1b75ca434d48e9b99f83639bf2a39790adf305bcf72` | `qoldau-audio-candidate-admin@sha256:ee00f6198eddd10b4f77f1b75ca434d48e9b99f83639bf2a39790adf305bcf72` |

The image IDs and RepoDigests currently contain the same hex values, but they
are different identity forms and are not treated as interchangeable.
Deployment should use the verified unique tags with `--pull never`; the
preflight below binds each tag to its exact local image ID.

The repository Dockerfiles were not edited. Candidate-only Dockerfiles with
resolved base identities are:

- `/tmp/qoldau-backend-candidate.Dockerfile`, SHA-256
  `250f97f7ffe4eb121a8098c932496c15f2a643671f6cd2c06a1ad19e39f83e51`
- `/tmp/qoldau-admin-candidate.Dockerfile`, SHA-256
  `980b0c4f5352cd0b88cafb5f95f4388e751f98b6cb3c9d5bc92cd705336c1b76`

Both builder stages and the backend runtime use
`node@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81`;
the admin runtime uses
`nginx@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10`.
Both images carry the full revision/tree labels and
`io.smartqoldau.candidate.scope=local-audio-rollout`; admin additionally
records `/v1` and `/admin/` build bases.

The following build commands were executed from
`/home/erda/.codex/worktrees/baf1/smart_qoldau`. They used
`--pull=false --provenance=false`, the candidate-only Dockerfile, the labels
above, and these unique tags. Admin used
`--build-arg VITE_API_BASE_URL=/v1 --build-arg VITE_BASE=/admin/`.

```sh
docker build --pull=false --provenance=false \
  -f /tmp/qoldau-backend-candidate.Dockerfile \
  --label org.opencontainers.image.revision=2236df554cee01ed43d281c48ba3262e25256574 \
  --label org.opencontainers.image.source-tree=3d58c17b87ac8ba11fda3f363199cbd09b7aadc7 \
  --label org.opencontainers.image.base.name=node@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 \
  --label io.smartqoldau.candidate.scope=local-audio-rollout \
  -t qoldau-audio-candidate-backend:2236df554cee backend

docker build --pull=false --provenance=false \
  -f /tmp/qoldau-admin-candidate.Dockerfile \
  --build-arg VITE_API_BASE_URL=/v1 --build-arg VITE_BASE=/admin/ \
  --label org.opencontainers.image.revision=2236df554cee01ed43d281c48ba3262e25256574 \
  --label org.opencontainers.image.source-tree=3d58c17b87ac8ba11fda3f363199cbd09b7aadc7 \
  --label io.smartqoldau.build-base=node@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 \
  --label org.opencontainers.image.base.name=nginx@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 \
  --label io.smartqoldau.candidate.scope=local-audio-rollout \
  --label io.smartqoldau.admin.api-base=/v1 \
  --label io.smartqoldau.admin.base=/admin/ \
  -t qoldau-audio-candidate-admin:2236df554cee admin
```

Bounded candidate checks (the successful migration/application suite was not
repeated): backend has exactly 31 migration directories, all three pending
SQL checksums match the table above, and compiled `dist/content` contains the
audio validator/controller/service. Admin `nginx -t` passed, its compiled
bundle contains `/audio`, `/v1`, and `/admin/`, and an isolated container
returned HTTP 200 for `/admin/` with two `/admin/assets/` references. The smoke
container was removed; only the two candidate images remain.

A review-only proxy patch is at `/tmp/qoldau-nginx-26m.patch` (SHA-256
`c5425ce1ab247795d49d4df8a6a43a291da326198b26b6ba3e4475e31277245f`).
`git apply --check` passed against `/home/erda/Музыка/smart_qoldau`; the live
bind-mounted `infra/nginx.stand.conf` was not edited or reloaded.

## Proposed local maintenance rollout (the DB step requires explicit user approval)

The active project is `smartqoldau`, with working directory
`/home/erda/Музыка/smart_qoldau/infra` and the merged Compose configuration
`docker-compose.prod.yml` + `docker-compose.stand.yml`. Preserve secrets in
the existing `.env`/vault and never print them.

Use this exact command prefix in the maintenance shell:

```bash
cd /home/erda/Музыка/smart_qoldau/infra
DC=(docker compose -p smartqoldau \
  -f docker-compose.prod.yml -f docker-compose.stand.yml \
  --env-file .env)
```

### 1. Authorized preparation before the DB decision

The two candidates are already prepared above. Bind every tag and rollback ID
to the expected local image before entering maintenance; abort if any test
fails:

```bash
TARGET_BACKEND='qoldau-audio-candidate-backend:2236df554cee'
TARGET_ADMIN='qoldau-audio-candidate-admin:2236df554cee'
TARGET_BACKEND_ID='sha256:2576b61004b556628b0021de7c9ea288f9ba81250d727e6da03aac99f6e542d0'
TARGET_ADMIN_ID='sha256:ee00f6198eddd10b4f77f1b75ca434d48e9b99f83639bf2a39790adf305bcf72'
OLD_BACKEND_ID='sha256:ec5ea93d5289fb91f93a8b6ffccd5ff57275d944470b80e410da8817a025ccef'
OLD_ADMIN_ID='sha256:37340e22df5088e8789192f26c78a66f71f5ab113cae572f716b54e6e27a9852'

test "$(docker image inspect "$TARGET_BACKEND" --format '{{.Id}}')" = "$TARGET_BACKEND_ID"
test "$(docker image inspect "$TARGET_ADMIN" --format '{{.Id}}')" = "$TARGET_ADMIN_ID"
test "$(docker image inspect "$OLD_BACKEND_ID" --format '{{.Id}}')" = "$OLD_BACKEND_ID"
test "$(docker image inspect "$OLD_ADMIN_ID" --format '{{.Id}}')" = "$OLD_ADMIN_ID"
```

Retain all four images. Do not retag `smartqoldau-*:latest`; all Compose image
operations below use `--pull never`. Confirm again that the target contains 31
migration directories and the accepted SQL checksums. The shared DB
precondition is exactly 28 finished, not-rolled-back migrations; abort on any
difference.

After review, apply `/tmp/qoldau-nginx-26m.patch` to the deployment checkout.
It adds `client_max_body_size 26m;`, transport headroom over the 25 MiB
multipart limit. While the current proxy is still running and sees the bind
mount, validate the edited file without reloading it:

```sh
git -C /home/erda/Музыка/smart_qoldau apply --check /tmp/qoldau-nginx-26m.patch
git -C /home/erda/Музыка/smart_qoldau apply /tmp/qoldau-nginx-26m.patch
"${DC[@]}" exec -T proxy nginx -t
```

### 2. Maintenance window, quiescence, and verified final backup

After the user approves the shared local DB change, close ingress **and stop
the backend**. Stopping only nginx is insufficient because the old scheduled
outbox/retention/matching workers would keep writing. Keep PostgreSQL, Redis,
and MinIO running; do not remove their containers or volumes.

```sh
"${DC[@]}" stop proxy backend
"${DC[@]}" ps postgres redis minio backend proxy
```

Require `backend` and `proxy` to be stopped and the three state services to be
up/healthy. From this point through migration verification, do not start an old
or target backend; this prevents writes between the final backup and version
switch.

Create the final custom-format backup only after quiescence. `BACKUP_FILE`
must be an absolute path in the already selected protected backup directory:

```sh
umask 077
BACKUP_FILE='<absolute-protected-path>/smartqoldau-pre31-20260919.dump'
"${DC[@]}" exec -T postgres sh -lc \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"
sha256sum "$BACKUP_FILE"
stat -c 'size=%s mode=%a' "$BACKUP_FILE"
```

Verify that exact dump by restoring it into a new disposable PostgreSQL 16.15
container, never over the shared database/volume:

```sh
RESTORE_PG=qoldau-maint-restorecheck-20260919
docker run -d --name "$RESTORE_PG" \
  -e POSTGRES_USER=restorecheck -e POSTGRES_PASSWORD=restorecheck-only \
  -e POSTGRES_DB=restorecheck \
  sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685
for i in $(seq 1 30); do
  docker exec "$RESTORE_PG" pg_isready -U restorecheck -d restorecheck && break
  sleep 1
done
docker exec "$RESTORE_PG" pg_isready -U restorecheck -d restorecheck
docker cp "$BACKUP_FILE" "$RESTORE_PG":/tmp/pre31.dump
docker exec "$RESTORE_PG" pg_restore -U restorecheck -d restorecheck \
  --exit-on-error --no-owner --no-privileges /tmp/pre31.dump
docker exec "$RESTORE_PG" psql -U restorecheck -d restorecheck -P pager=off \
  -c 'SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name' \
  -c 'SELECT count(*) AS users FROM users' \
  -c 'SELECT count(*) AS chat_messages FROM chat_messages' \
  -c 'SELECT count(*) AS notification_outbox FROM notification_outbox'
docker rm -f "$RESTORE_PG"
```

Require 28 expected migration names/checksums and recorded critical counts (and
the chosen non-PII aggregate checks) to match the quiesced source. If dump,
restore, or comparison fails, keep the old backend stopped and abort migration.

### 3. Apply and verify exactly the three migrations

Use the real project and both Compose files. `--no-deps` is mandatory so the
one-shot migration does not create/recreate neighboring services:

```sh
BACKEND_IMAGE="$TARGET_BACKEND" "${DC[@]}" run --rm --no-deps --pull never migrate
```

Require output naming exactly, in order:

1. `20260902120000_r27_client_display_name_and_consent`
2. `20260916043000_notification_outbox_leases`
3. `20260916060000_chat_client_message_id`

Then query through the existing PostgreSQL container and require 31 finished,
not-rolled-back rows, no checksum mismatch, the six nullable/no-default
columns, and the two exact indexes from this rehearsal:

```sh
"${DC[@]}" exec -T postgres sh -lc \
  "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -P pager=off -c 'SELECT migration_name,checksum,finished_at,rolled_back_at FROM \"_prisma_migrations\" ORDER BY migration_name'"
```

If any condition fails, do not start either backend version and do not edit
`_prisma_migrations` or attempt a schema down/drop.

### 4. Start target applications, reopen ingress, and run bounded smoke

```sh
BACKEND_IMAGE="$TARGET_BACKEND" "${DC[@]}" up -d --no-deps --force-recreate --pull never backend
"${DC[@]}" exec -T backend node -e \
  "fetch('http://127.0.0.1:3000/v1/health').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
ADMIN_IMAGE="$TARGET_ADMIN" "${DC[@]}" up -d --no-deps --force-recreate --pull never admin
"${DC[@]}" up -d --no-deps --force-recreate --pull never proxy
"${DC[@]}" exec -T proxy nginx -t
```

After ingress returns, run only bounded checks: health, existing-user
auth/default select, R-27 profile/consent gate, one request, legacy chat
history plus one correlated replay, lease outbox settlement, and a narrow audio
upload smoke. Scan backend logs for missing-column/outbox errors. Do not repeat
the accepted full audio suite.

### 5. Application rollback if smoke fails

Close ingress again and stop the target backend, then recreate the exact old
applications with `--no-deps`:

```sh
"${DC[@]}" stop proxy backend
test "$(docker image inspect "$OLD_BACKEND_ID" --format '{{.Id}}')" = "$OLD_BACKEND_ID"
test "$(docker image inspect "$OLD_ADMIN_ID" --format '{{.Id}}')" = "$OLD_ADMIN_ID"
BACKEND_IMAGE="$OLD_BACKEND_ID" \
  "${DC[@]}" up -d --no-deps --force-recreate --pull never backend
ADMIN_IMAGE="$OLD_ADMIN_ID" \
  "${DC[@]}" up -d --no-deps --force-recreate --pull never admin
"${DC[@]}" up -d --no-deps --force-recreate --pull never proxy
```

These rollback values are raw verified **local image IDs**, not constructed
`repository@sha256:<image-id>` references. A read-only Compose `config --images`
check confirmed the merged project accepts both raw IDs. `--pull never` makes
absence of either local image a hard stop instead of resolving a mutable tag.

Leave the additive 31-migration schema in place. Verify old-image health,
guest/existing auth, and legacy chat before reopening normal use; this exact
old backend was proven compatible with the expanded schema. Do **not** run down
migrations, drop columns/indexes, edit `_prisma_migrations`, or overwrite the
shared DB. A DB restore is a separate incident-recovery action: restore into a
new DB/volume, validate, and switch only under a separate recovery plan.

## Separate unresolved browser boundary

This rehearsal does not close browser playback. `contentUrl()` signs `S3_ENDPOINT`; the stand uses MinIO's internal service address and the current proxy exposes no MinIO route. Upload readiness and the 26 MiB proxy limit do not prove a browser can reach a signed private audio URL. Resolve and test that routing separately in a disposable stack before claiming end-to-end playback; do not silently fold it into this maintenance approval.

## One decision still required from the user

Approve or reject the shared **local** DB change from 28 to the three named
migrations under the maintenance procedure above: proxy and backend stopped,
final backup restored and verified before migration, target smoke bounded, and
application rollback leaving the additive schema expanded. Candidate builds,
the 26 MiB proxy correction, and selecting the protected backup path are
routine preparation for that approved operation rather than separate gates.

Browser-reachable private-media routing remains separate follow-up work. It is
not an approval condition for the uploader rollout, but browser playback must
not be claimed until that follow-up is solved and tested.

Root clarification: the restore-check PostgreSQL reference is also a raw local image ID, not a repository digest. Inspect its presence before maintenance and use --pull never. If backup verification fails BEFORE any migration, resume the unchanged old backend/proxy after diagnosing the backup failure; do not leave the healthy stand down indefinitely.

## Pending private-playback candidate — 2026-09-19 04:26 +05

Independent review APPROVE: cumulative dfe6249893356941b16a79bbf932cd5a05873eeb, based on2236df5. Not integrated or deployed. Root verified the running proxy directly bind-mounts main infra/nginx.stand.conf to /etc/nginx/conf.d/default.conf. The candidate converts this file to an envsubst template and changes Compose mounts/startup. Therefore do NOT cherry-pick into the live checkout before the approved maintenance transition: even a normal reload/restart of the old proxy against the new unrendered template could fail. Keep reviewed worktree intact.

Prepared2236df5 backend/admin images support upload only; they do not include the signer change. If approved rollout includes playback, first build and verify an exact reviewed cumulative backend candidate, reconcile26m patch with new template and include validation-hook mount, then transition proxy in maintenance. Admin source is unchanged. Do not silently claim prepared old candidate includes playback. No repeated DB rehearsal needed for this schema-neutral delta, but revised image/config preflight is necessary.
