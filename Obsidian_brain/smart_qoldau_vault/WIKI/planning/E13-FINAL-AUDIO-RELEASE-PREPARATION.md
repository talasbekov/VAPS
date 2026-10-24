# Smart Qoldau — local private-audio release handoff (not installed)

Restored 2026-09-19. This file and its adjacent patch/Dockerfile are outside
the Git repository. **Root review is required before any live step.** User
approval for the three shared **local** DB migrations is still **PENDING**;
do not run the maintenance commands until that existing decision is given.
No new approval request is made here.

## Evidence boundary

Fresh checks during this restoration:

- Worktree `/home/erda/.codex/worktrees/9d6d/smart_qoldau` is clean,
  detached at commit `dfe6249893356941b16a79bbf932cd5a05873eeb`, tree
  `e4ba395bca6f273a3d6f5d44815b3de59e01e6c7`.
- Live checkout `/home/erda/Музыка/smart_qoldau` remains at base
  `2236df554cee01ed43d281c48ba3262e25256574`; its unrelated untracked
  `docs/superpowers/plans/` was left alone. Seven shared containers were
  observed running; six report healthy, proxy reports running.
- Retained backend tag `qoldau-private-audio-candidate-backend:dfe624989335`
  resolves to local image ID
  `sha256:6ef92bfd9188985bfd4ff244f3397511d4566eb78efb7578dd326a2c464f5acd`.
  Labels bind candidate revision/tree, base revision `2236df5`, pinned Node
  base `node@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81`,
  and `local-private-audio-rollout` scope. A fresh read-only image check found
  exactly 31 migration directories and compiled `S3_CONTENT_PUBLIC_ENDPOINT`
  signer code; the three pending SQL hashes match candidate source.
- Admin subtree object is identical at base and candidate:
  `d9c26074a6e68456baea429f9fa3e03618d528ba`. The retained admin tag
  `qoldau-audio-candidate-admin:2236df554cee` resolves to
  `sha256:ee00f6198eddd10b4f77f1b75ca434d48e9b99f83639bf2a39790adf305bcf72`;
  it is not rebuilt.
- Exact old backend image
  `sha256:ec5ea93d5289fb91f93a8b6ffccd5ff57275d944470b80e410da8817a025ccef`
  was checked with `--network none`: its bundled `@nestjs/config` uses
  `allowUnknown:true`; runtime Joi validation accepted and retained the new
  `S3_CONTENT_PUBLIC_ENDPOINT` variable. This applies to that exact image,
  not to an arbitrary substitute.
- The 26 MiB patch and pinned Dockerfile have been restored both beside this
  report and under `/tmp`. Both copies of each have matching hashes; patch
  applicability was checked against candidate and live base without applying
  it.

Historical evidence from the previous preparation/review, **not rerun now**:

- Independent cumulative review approved `dfe6249` over `2236df5`; the
  original `/tmp` review file vanished, but the canonical
  `/home/erda/Музыка/Obsidian_brain/smart_qoldau_vault/WIKI/planning/E13-LOCAL-MIGRATION-REHEARSAL.md`
  root appendix records its verdict and the bind-mount hazard.
- Previous disposable Compose proxy regression passed; 26 MiB delta check
  observed 25 MiB multipart → HTTP 200 (26,214,611 bytes forwarded),
  26 MiB multipart → HTTP 413. No full regression was repeated here.
- A previous offline real MP3 fixture had format `mp3`, duration `1.044898 s`,
  size `8612` bytes, and decoded successfully with ffmpeg. That fixture was
  removed. It was never a shared upload or browser playback test.
- The canonical E13 rehearsal verified isolated 28 → 31 migrations, backup
  restore, and old-backend compatibility with the expanded schema. No DB
  rehearsal or shared DB query was repeated here.

Exact source: base tree `3d58c17b87ac8ba11fda3f363199cbd09b7aadc7`;
candidate backend subtree `3e45182a269c8d3b66127a2ae24867e19d43eef0`.
The candidate chain is `7c45342ee3a14f4a09d5abd8074094d90d6a4e64`,
`6d78e0f889a95c2506d0f73703d58c1de17b24ca`, then `dfe6249`.
The earlier `2236df5` backend candidate `sha256:2576b610…` supports upload
but **not** the signer change; it is not the rollout target.

## Retained artifact identities

| Artifact | Path/tag | SHA-256 or local image ID |
|---|---|---|
| Handoff | `/home/erda/.codex/worktrees/9d6d/qoldau-audio-final-release-preparation.md` | SHA-256 reported with final verification |
| Minimal 26 MiB patch | `/home/erda/.codex/worktrees/9d6d/qoldau-private-audio-nginx-26m.patch` and `/tmp/qoldau-private-audio-nginx-26m.patch` | `c5425ce1ab247795d49d4df8a6a43a291da326198b26b6ba3e4475e31277245f` |
| Pinned candidate Dockerfile | `/home/erda/.codex/worktrees/9d6d/qoldau-private-audio-backend-candidate.Dockerfile` and `/tmp/qoldau-private-audio-backend-candidate.Dockerfile` | `250f97f7ffe4eb121a8098c932496c15f2a643671f6cd2c06a1ad19e39f83e51` |
| Cumulative backend tag | `qoldau-private-audio-candidate-backend:dfe624989335` | `sha256:6ef92bfd9188985bfd4ff244f3397511d4566eb78efb7578dd326a2c464f5acd` |
| Reused admin tag | `qoldau-audio-candidate-admin:2236df554cee` | `sha256:ee00f6198eddd10b4f77f1b75ca434d48e9b99f83639bf2a39790adf305bcf72` |

Historical build command for the retained backend (do not rebuild just for
this handoff):

```bash
cd /home/erda/.codex/worktrees/9d6d/smart_qoldau
docker build --pull=false --provenance=false \
  -f /tmp/qoldau-private-audio-backend-candidate.Dockerfile \
  --label org.opencontainers.image.revision=dfe6249893356941b16a79bbf932cd5a05873eeb \
  --label org.opencontainers.image.source-tree=e4ba395bca6f273a3d6f5d44815b3de59e01e6c7 \
  --label org.opencontainers.image.base.name=node@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81 \
  --label io.smartqoldau.candidate.base-revision=2236df554cee01ed43d281c48ba3262e25256574 \
  --label io.smartqoldau.candidate.scope=local-private-audio-rollout \
  -t qoldau-private-audio-candidate-backend:dfe624989335 backend
```

Old local IDs to retain: backend `sha256:ec5ea93d5289fb91f93a8b6ffccd5ff57275d944470b80e410da8817a025ccef`,
admin `sha256:37340e22df5088e8789192f26c78a66f71f5ab113cae572f716b54e6e27a9852`,
proxy `sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10`,
PostgreSQL `sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685`.
These are raw local image IDs, not manufactured RepoDigests. Never retag
shared `smartqoldau-*:latest`; all creates below use `--pull never`.

The three pending SQL checksums, freshly matched between candidate source and
retained image, are:

```text
20260902120000_r27_client_display_name_and_consent  8b3cfcee630c406190103a0870c1da3030a630346f1dbe73936e8b70b3b77d54
20260916043000_notification_outbox_leases         5e3b36dcf16a79b511de53d9480cf12d15c6f36628b4a82bea19520c4ecdd708
20260916060000_chat_client_message_id             c63c953197b5e5b4e978984899734e4cae3d7195e8e03cf2d0ac531c6019cafc
```

## Read-only preflight for root

Run before any maintenance; a failed assertion aborts:

```bash
set -euo pipefail
WT=/home/erda/.codex/worktrees/9d6d/smart_qoldau
LIVE=/home/erda/Музыка/smart_qoldau
ART=/home/erda/.codex/worktrees/9d6d
BASE=2236df554cee01ed43d281c48ba3262e25256574
CANDIDATE=dfe6249893356941b16a79bbf932cd5a05873eeb
PATCH="$ART/qoldau-private-audio-nginx-26m.patch"
TARGET_BACKEND=qoldau-private-audio-candidate-backend:dfe624989335
TARGET_ADMIN=qoldau-audio-candidate-admin:2236df554cee
TARGET_BACKEND_ID=sha256:6ef92bfd9188985bfd4ff244f3397511d4566eb78efb7578dd326a2c464f5acd
TARGET_ADMIN_ID=sha256:ee00f6198eddd10b4f77f1b75ca434d48e9b99f83639bf2a39790adf305bcf72
OLD_BACKEND_ID=sha256:ec5ea93d5289fb91f93a8b6ffccd5ff57275d944470b80e410da8817a025ccef
OLD_ADMIN_ID=sha256:37340e22df5088e8789192f26c78a66f71f5ab113cae572f716b54e6e27a9852
PROXY_ID=sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
POSTGRES_ID=sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685

test "$(git -C "$WT" rev-parse HEAD)" = "$CANDIDATE"
test "$(git -C "$WT" rev-parse HEAD^{tree})" = e4ba395bca6f273a3d6f5d44815b3de59e01e6c7
test -z "$(git -C "$WT" status --porcelain)"
test "$(git -C "$LIVE" rev-parse HEAD)" = "$BASE"
git -C "$WT" diff --quiet "$BASE..$CANDIDATE" -- admin
git -C "$WT" diff --check "$BASE..$CANDIDATE"
echo 'c5425ce1ab247795d49d4df8a6a43a291da326198b26b6ba3e4475e31277245f  /home/erda/.codex/worktrees/9d6d/qoldau-private-audio-nginx-26m.patch' | sha256sum -c -
echo '250f97f7ffe4eb121a8098c932496c15f2a643671f6cd2c06a1ad19e39f83e51  /home/erda/.codex/worktrees/9d6d/qoldau-private-audio-backend-candidate.Dockerfile' | sha256sum -c -
git -C "$WT" apply --check "$PATCH"
git -C "$LIVE" apply --check "$PATCH"
test "$(docker image inspect "$TARGET_BACKEND" --format '{{.Id}}')" = "$TARGET_BACKEND_ID"
test "$(docker image inspect "$TARGET_ADMIN" --format '{{.Id}}')" = "$TARGET_ADMIN_ID"
for id in "$OLD_BACKEND_ID" "$OLD_ADMIN_ID" "$PROXY_ID" "$POSTGRES_ID"; do
  test "$(docker image inspect "$id" --format '{{.Id}}')" = "$id"
done
docker image inspect "$TARGET_BACKEND" | jq -e '.[0] |
  .Config.User == "node" and
  .Config.Labels["org.opencontainers.image.revision"] == "dfe6249893356941b16a79bbf932cd5a05873eeb" and
  .Config.Labels["org.opencontainers.image.source-tree"] == "e4ba395bca6f273a3d6f5d44815b3de59e01e6c7" and
  .Config.Labels["io.smartqoldau.candidate.base-revision"] == "2236df554cee01ed43d281c48ba3262e25256574"' >/dev/null
test "$(docker run --rm --pull never --entrypoint sh "$TARGET_BACKEND" -c 'find /app/prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l')" = 31
```

## Approved maintenance only — ordered runbook

The live proxy currently binds `infra/nginx.stand.conf` **directly** to
`/etc/nginx/conf.d/default.conf`. The candidate changes that same file to an
envsubst template and changes the Compose mount plus validation hook. Thus
**stop proxy and backend before fast-forwarding the live checkout**. Reload
alone is insufficient; proxy must later be recreated. Never cherry-pick this
into running live checkout.

The following commands are future instructions, **not executed in this
preparation**. Run only after root review and the pending DB approval. The
protected backup directory is an exact proposed local path: confirm it is
appropriate before the window; do not silently substitute another path. Keep
all maintenance code blocks in the same Bash shell so variables/functions
persist.

```bash
set -euo pipefail
LIVE=/home/erda/Музыка/smart_qoldau
ART=/home/erda/.codex/worktrees/9d6d
BASE=2236df554cee01ed43d281c48ba3262e25256574
CANDIDATE=dfe6249893356941b16a79bbf932cd5a05873eeb
PATCH="$ART/qoldau-private-audio-nginx-26m.patch"
TARGET_BACKEND=qoldau-private-audio-candidate-backend:dfe624989335
TARGET_ADMIN=qoldau-audio-candidate-admin:2236df554cee
OLD_BACKEND_ID=sha256:ec5ea93d5289fb91f93a8b6ffccd5ff57275d944470b80e410da8817a025ccef
OLD_ADMIN_ID=sha256:37340e22df5088e8789192f26c78a66f71f5ab113cae572f716b54e6e27a9852
PROXY_ID=sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
POSTGRES_ID=sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685
BACKUP_DIR=/home/erda/Музыка/smart_qoldau-backups/20260919-private-audio
BACKUP_FILE="$BACKUP_DIR/smartqoldau-pre31.dump"
RESTORE_PG=qoldau-maint-restorecheck-20260919
cd "$LIVE/infra"
DC=(docker compose -p smartqoldau -f docker-compose.prod.yml -f docker-compose.stand.yml --env-file .env)

wait_backend() {
  for i in $(seq 1 60); do
    if "${DC[@]}" exec -T backend node -e \
      "fetch('http://127.0.0.1:3000/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo 'backend readiness timed out after 60 seconds' >&2; return 1
}
wait_edge() {
  for i in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:8080/v1/health | \
      jq -e '.status == "ok" and .db == "ok" and .redis == "ok"' \
      >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo 'edge readiness timed out after 60 seconds' >&2; return 1
}

test "$(git -C "$LIVE" rev-parse HEAD)" = "$BASE"
test ! -e "$BACKUP_DIR"
test ! -e "$BACKUP_FILE"
umask 077
install -d -m 700 "$BACKUP_DIR"
install -m 600 "$LIVE/infra/docker-compose.stand.yml" "$BACKUP_DIR/docker-compose.stand.yml.old"
install -m 600 "$LIVE/infra/nginx.stand.conf" "$BACKUP_DIR/nginx.stand.conf.old"
sha256sum "$BACKUP_DIR/docker-compose.stand.yml.old" "$BACKUP_DIR/nginx.stand.conf.old" > "$BACKUP_DIR/config.sha256"
sha256sum -c "$BACKUP_DIR/config.sha256"

# Quiesce both ingress and background-writing backend before template edit or dump.
"${DC[@]}" stop proxy backend
test -z "$("${DC[@]}" ps --status running -q proxy backend)"
for service in postgres redis minio; do
  cid=$("${DC[@]}" ps -q "$service")
  test -n "$cid"
  test "$(docker inspect "$cid" --format '{{.State.Health.Status}}')" = healthy
done

# 28 rows, with exact SQL checksums, before the final dump.
docker run --rm --pull never --entrypoint sh "$TARGET_BACKEND" -eu -c '
  for f in /app/prisma/migrations/*/migration.sql; do
    name=${f%/migration.sql}; name=${name##*/}
    case "$name" in
      20260902120000_r27_client_display_name_and_consent|20260916043000_notification_outbox_leases|20260916060000_chat_client_message_id) continue ;;
    esac
    printf "%s|" "$name"; sha256sum "$f" | cut -d" " -f1
  done
' | sort > "$BACKUP_DIR/expected-pre31.txt"
test "$(wc -l < "$BACKUP_DIR/expected-pre31.txt")" = 28
"${DC[@]}" exec -T postgres sh -lc \
  'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|"' \
  > "$BACKUP_DIR/source-pre31.txt" <<'SQL'
SELECT migration_name,checksum FROM "_prisma_migrations"
WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;
SQL
cmp "$BACKUP_DIR/expected-pre31.txt" "$BACKUP_DIR/source-pre31.txt"

# Non-PII count/ID-hash manifest, then custom-format dump and isolated restore.
"${DC[@]}" exec -T postgres sh -lc \
  'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|"' \
  > "$BACKUP_DIR/source-rows.txt" <<'SQL'
SELECT 'users',count(*),coalesce(md5(string_agg(id::text,',' ORDER BY id::text)),md5('')) FROM users;
SELECT 'chat_messages',count(*),coalesce(md5(string_agg(id::text,',' ORDER BY id::text)),md5('')) FROM chat_messages;
SELECT 'notification_outbox',count(*),coalesce(md5(string_agg(id::text,',' ORDER BY id::text)),md5('')) FROM notification_outbox;
SQL
"${DC[@]}" exec -T postgres sh -lc \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_FILE"
test -s "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
sha256sum -c "$BACKUP_FILE.sha256"
test -z "$(docker ps -aq --filter name="^/${RESTORE_PG}$")"
docker run -d --pull never --name "$RESTORE_PG" \
  -e POSTGRES_USER=restorecheck -e POSTGRES_PASSWORD=restorecheck-only \
  -e POSTGRES_DB=restorecheck "$POSTGRES_ID"
for i in $(seq 1 30); do
  if docker exec "$RESTORE_PG" pg_isready -U restorecheck -d restorecheck >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$RESTORE_PG" pg_isready -U restorecheck -d restorecheck
docker cp "$BACKUP_FILE" "$RESTORE_PG:/tmp/pre31.dump"
docker exec "$RESTORE_PG" pg_restore -U restorecheck -d restorecheck \
  --exit-on-error --no-owner --no-privileges /tmp/pre31.dump
docker exec "$RESTORE_PG" psql -v ON_ERROR_STOP=1 -U restorecheck -d restorecheck -At -F '|' \
  > "$BACKUP_DIR/restore-pre31.txt" <<'SQL'
SELECT migration_name,checksum FROM "_prisma_migrations"
WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;
SQL
docker exec "$RESTORE_PG" psql -v ON_ERROR_STOP=1 -U restorecheck -d restorecheck -At -F '|' \
  > "$BACKUP_DIR/restore-rows.txt" <<'SQL'
SELECT 'users',count(*),coalesce(md5(string_agg(id::text,',' ORDER BY id::text)),md5('')) FROM users;
SELECT 'chat_messages',count(*),coalesce(md5(string_agg(id::text,',' ORDER BY id::text)),md5('')) FROM chat_messages;
SELECT 'notification_outbox',count(*),coalesce(md5(string_agg(id::text,',' ORDER BY id::text)),md5('')) FROM notification_outbox;
SQL
cmp "$BACKUP_DIR/source-pre31.txt" "$BACKUP_DIR/restore-pre31.txt"
cmp "$BACKUP_DIR/source-rows.txt" "$BACKUP_DIR/restore-rows.txt"
docker container rm --force "$RESTORE_PG"
```

If anything above fails, **do not migrate or integrate the template**.
If the disposable restore-check container exists, remove only that exact
container with `docker container rm --force "$RESTORE_PG"` after collecting
needed diagnostics. Diagnose the backup, then restart unchanged old backend/proxy with
`BACKEND_IMAGE="$OLD_BACKEND_ID" "${DC[@]}" up -d --no-deps --force-recreate --pull never backend`
and `"${DC[@]}" up -d --no-deps --force-recreate --pull never proxy`; use
`wait_backend` and `wait_edge`. Do not leave a healthy stand down indefinitely.

Only after the backup has been restored and compared, integrate the reviewed
candidate while proxy/backend remain stopped:

```bash
git -C "$LIVE" merge --ff-only "$CANDIDATE"
test "$(git -C "$LIVE" rev-parse HEAD)" = "$CANDIDATE"
git -C "$LIVE" apply --check "$PATCH"
git -C "$LIVE" apply "$PATCH"
git -C "$LIVE" diff --check
test "$(git -C "$LIVE" diff --name-only)" = infra/nginx.stand.conf
git -C "$LIVE" add infra/nginx.stand.conf
git -C "$LIVE" diff --cached --check
git -C "$LIVE" commit -m 'fix(infra): allow 25 MiB audio uploads'

# Compose equality/mount correspondence; never print full config (contains secrets).
CONFIG_JSON=$("${DC[@]}" config --format json)
printf '%s' "$CONFIG_JSON" | jq -e --arg live "$LIVE" '
  (.services.backend.environment.S3_BUCKET_CONTENT == .services.proxy.environment.S3_BUCKET_CONTENT) and
  (.services.backend.environment.S3_CONTENT_PUBLIC_ENDPOINT | test("^https?://[^/?#]+/?$")) and
  (.services.proxy.environment.NGINX_ENVSUBST_FILTER == "^S3_BUCKET_CONTENT$$") and
  ([.services.proxy.volumes[] | select(.target == "/etc/nginx/templates/default.conf.template") | .source] == [$live + "/infra/nginx.stand.conf"]) and
  ([.services.proxy.volumes[] | select(.target == "/docker-entrypoint.d/19-validate-content-bucket.sh") | .source] == [$live + "/infra/nginx-stand-validate-bucket.sh"])
' >/dev/null
BUCKET=$(printf '%s' "$CONFIG_JSON" | jq -er '.services.proxy.environment.S3_BUCKET_CONTENT')
docker run --rm --pull never --network none --name qoldau-maint-proxy-preflight-20260919 \
  --add-host backend:127.0.0.1 --add-host admin:127.0.0.1 \
  --add-host web:127.0.0.1 --add-host minio:127.0.0.1 \
  -e "S3_BUCKET_CONTENT=$BUCKET" -e 'NGINX_ENVSUBST_FILTER=^S3_BUCKET_CONTENT$' \
  -v "$LIVE/infra/nginx.stand.conf:/etc/nginx/templates/default.conf.template:ro" \
  -v "$LIVE/infra/nginx-stand-validate-bucket.sh:/docker-entrypoint.d/19-validate-content-bucket.sh:ro" \
  "$PROXY_ID" nginx -T 2>&1 | \
  grep -E 'configuration file .* test is successful|client_max_body_size 26m|location (=|\^~) /[^/]+/'

# The one approved DB-changing step: no dependencies recreated.
BACKEND_IMAGE="$TARGET_BACKEND" "${DC[@]}" run --rm --no-deps --pull never migrate \
  2>&1 | tee "$BACKUP_DIR/migrate-28-to-31.log"
for name in 20260902120000_r27_client_display_name_and_consent \
  20260916043000_notification_outbox_leases \
  20260916060000_chat_client_message_id; do
  grep -F "$name" "$BACKUP_DIR/migrate-28-to-31.log"
done
docker run --rm --pull never --entrypoint sh "$TARGET_BACKEND" -eu -c '
  for f in /app/prisma/migrations/*/migration.sql; do
    name=${f%/migration.sql}; name=${name##*/}
    printf "%s|" "$name"; sha256sum "$f" | cut -d" " -f1
  done
' | sort > "$BACKUP_DIR/expected-post31.txt"
test "$(wc -l < "$BACKUP_DIR/expected-post31.txt")" = 31
"${DC[@]}" exec -T postgres sh -lc \
  'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|"' \
  > "$BACKUP_DIR/actual-post31.txt" <<'SQL'
SELECT migration_name,checksum FROM "_prisma_migrations"
WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;
SQL
cmp "$BACKUP_DIR/expected-post31.txt" "$BACKUP_DIR/actual-post31.txt"
"${DC[@]}" exec -T postgres sh -lc \
  'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<'SQL' | grep -qx t
SELECT count(*) = 6 AND bool_and(is_nullable = 'YES' AND column_default IS NULL)
FROM information_schema.columns
WHERE (table_name,column_name) IN (VALUES
  ('users','display_name'),('users','expert_visibility_accepted_at'),
  ('notification_outbox','lease_token'),('notification_outbox','lease_expires_at'),
  ('chat_messages','sender_user_id'),('chat_messages','client_message_id'));
SQL
"${DC[@]}" exec -T postgres sh -lc \
  'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<'SQL' | grep -qx t
SELECT EXISTS (
  SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
  WHERE c.relname='notification_outbox_pending_claim_idx'
    AND NOT i.indisunique
    AND pg_get_expr(i.indpred,i.indrelid) = '((sent_at IS NULL) AND (dead_at IS NULL))'
    AND ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
              JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
              ORDER BY k.ord) = ARRAY['next_attempt_at','lease_expires_at','id']
) AND EXISTS (
  SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
  WHERE c.relname='chat_messages_client_message_scope_uq'
    AND i.indisunique AND i.indpred IS NULL
    AND ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
              JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
              ORDER BY k.ord) = ARRAY['consultation_id','sender_user_id','client_message_id']
);
SQL
```

If migration/post-check fails, keep ingress/backend stopped. Do not edit
Prisma history, down-migrate, drop additive columns/indexes, or overwrite the
shared DB. Diagnose under a separate incident decision.

After all post-checks pass, start exact images and recreate proxy with the
new template/hook (reload alone does not activate changed mounts/env/network):

```bash
BACKEND_IMAGE="$TARGET_BACKEND" "${DC[@]}" up -d --no-deps --force-recreate --pull never backend
wait_backend
ADMIN_IMAGE="$TARGET_ADMIN" "${DC[@]}" up -d --no-deps --force-recreate --pull never admin
"${DC[@]}" up -d --no-deps --force-recreate --pull never proxy
"${DC[@]}" exec -T proxy nginx -t
wait_edge
test "$(docker inspect "$("${DC[@]}" ps -q backend)" --format '{{.Image}}')" = sha256:6ef92bfd9188985bfd4ff244f3397511d4566eb78efb7578dd326a2c464f5acd
test "$(docker inspect "$("${DC[@]}" ps -q admin)" --format '{{.Image}}')" = sha256:ee00f6198eddd10b4f77f1b75ca434d48e9b99f83639bf2a39790adf305bcf72
docker inspect "$("${DC[@]}" ps -q proxy)" | jq -e --arg live "$LIVE" '.[0] |
  ([.Mounts[] | select(.Destination == "/etc/nginx/templates/default.conf.template") | .Source] == [$live + "/infra/nginx.stand.conf"]) and
  ([.Mounts[] | select(.Destination == "/docker-entrypoint.d/19-validate-content-bucket.sh") | .Source] == [$live + "/infra/nginx-stand-validate-bucket.sh"])' >/dev/null
```

Then perform only bounded health, existing-user auth/default-select, R-27
consent/request, legacy chat plus one correlated replay, lease-outbox, and
narrow audio checks from canonical E13. Do not rerun broad suites. For an
audio smoke, use existing authorized admin/user tokens without printing them.
The fixture is a genuinely decodable MP3; the trap removes the test content
and file even when an assertion fails:

```bash
: "${QOLDAU_SMOKE_ADMIN_BEARER:?existing CONTENT_EDITOR or SUPERADMIN bearer required}"
: "${QOLDAU_SMOKE_USER_BEARER:?existing user bearer required}"
EDGE_API=http://127.0.0.1:8080/v1
SMOKE_MP3=/tmp/qoldau-private-audio-smoke.mp3
test ! -e "$SMOKE_MP3"
SMOKE_ID=
cleanup_audio_smoke() {
  if test -n "$SMOKE_ID"; then
    curl -fsS -X DELETE -H "Authorization: Bearer $QOLDAU_SMOKE_ADMIN_BEARER" \
      "$EDGE_API/admin/content/$SMOKE_ID" >/dev/null || true
  fi
  test ! -e "$SMOKE_MP3" || unlink "$SMOKE_MP3"
}
trap cleanup_audio_smoke EXIT
ffmpeg -hide_banner -loglevel error -f lavfi \
  -i 'sine=frequency=440:sample_rate=44100:duration=1' \
  -map_metadata -1 -c:a libmp3lame -b:a 64k -y "$SMOKE_MP3"
test "$(ffprobe -v error -show_entries format=format_name -of default=nw=1:nk=1 "$SMOKE_MP3")" = mp3
ffmpeg -hide_banner -loglevel error -i "$SMOKE_MP3" -f null -
SLUG="release-private-audio-$(date +%s)-$(openssl rand -hex 4)"
CREATE_JSON=$(jq -nc --arg slug "$SLUG" '{kind:"MEDITATION",access:"FREE",slug:$slug,category:"release-smoke",titleRu:"Release smoke",titleKk:"Release smoke",summaryRu:"",summaryKk:"",payload:{},published:false}')
CREATED=$(curl -fsS -X POST \
  -H "Authorization: Bearer $QOLDAU_SMOKE_ADMIN_BEARER" \
  -H 'Content-Type: application/json' --data "$CREATE_JSON" \
  "$EDGE_API/admin/content")
SMOKE_ID=$(printf '%s' "$CREATED" | jq -er '.id')
curl -fsS -X POST -H "Authorization: Bearer $QOLDAU_SMOKE_ADMIN_BEARER" \
  -F "file=@$SMOKE_MP3;type=audio/mpeg" \
  "$EDGE_API/admin/content/$SMOKE_ID/audio" | \
  jq -e --arg id "$SMOKE_ID" '.id == $id and (.payload.audioKey | startswith("content/" + $id + "/"))' >/dev/null
curl -fsS -X PATCH \
  -H "Authorization: Bearer $QOLDAU_SMOKE_ADMIN_BEARER" \
  -H 'Content-Type: application/json' --data '{"published":true}' \
  "$EDGE_API/admin/content/$SMOKE_ID" | jq -e '.publishedAt != null' >/dev/null
MEDIA=$(curl -fsS -H "Authorization: Bearer $QOLDAU_SMOKE_USER_BEARER" \
  "$EDGE_API/content/$SMOKE_ID/media")
SIGNED_URL=$(printf '%s' "$MEDIA" | jq -er '.url')
case "$SIGNED_URL" in http://*|https://*) ;; *) exit 1 ;; esac
test "$(curl -sS -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-1' "$SIGNED_URL")" = 206
cleanup_audio_smoke
trap - EXIT
```

Do not log/print the signed URL: its query is
a bearer credential. HTTP 206 proves signed range transport, **not** browser
decode/UI playback. Claim browser playback only after a real browser emits
`loadedmetadata`/`canplay` and `playing` after a user gesture.

## Rollback, no schema downgrade

Application rollback after 31 migrations: leave the additive schema and new
template/hook config in place. Exact old backend accepts the new env key, as
freshly validated above. Stop proxy/backend, recreate old app images, then
recreate proxy and wait for readiness:

```bash
"${DC[@]}" stop proxy backend
BACKEND_IMAGE="$OLD_BACKEND_ID" "${DC[@]}" up -d --no-deps --force-recreate --pull never backend
ADMIN_IMAGE="$OLD_ADMIN_ID" "${DC[@]}" up -d --no-deps --force-recreate --pull never admin
"${DC[@]}" up -d --no-deps --force-recreate --pull never proxy
wait_backend
"${DC[@]}" exec -T proxy nginx -t
wait_edge
test "$(docker inspect "$("${DC[@]}" ps -q backend)" --format '{{.Image}}')" = "$OLD_BACKEND_ID"
test "$(docker inspect "$("${DC[@]}" ps -q admin)" --format '{{.Image}}')" = "$OLD_ADMIN_ID"
```

The old signer still emits its internal MinIO origin: this rollback restores
prior application behavior, not browser playback. Verify old-image auth and
legacy chat after readiness. If the template itself must be withdrawn, use a
**coupled config rollback** while proxy/backend are stopped: restore both old
Compose mount and old nginx direct-bind file and remove the hook, commit only
those three changes, then recreate proxy. Never leave the candidate template
direct-mounted to `/etc/nginx/conf.d/default.conf`:

```bash
"${DC[@]}" stop proxy backend
git -C "$LIVE" restore --source="$BASE" -- infra/docker-compose.stand.yml infra/nginx.stand.conf
git -C "$LIVE" rm --ignore-unmatch infra/nginx-stand-validate-bucket.sh
git -C "$LIVE" add infra/docker-compose.stand.yml infra/nginx.stand.conf
git -C "$LIVE" diff --cached --check
test "$(git -C "$LIVE" diff --cached --name-only | sort | tr '\n' ' ')" = 'infra/docker-compose.stand.yml infra/nginx-stand-validate-bucket.sh infra/nginx.stand.conf '
git -C "$LIVE" commit -m 'revert(infra): restore direct stand proxy bind'
BACKEND_IMAGE="$OLD_BACKEND_ID" "${DC[@]}" up -d --no-deps --force-recreate --pull never backend
ADMIN_IMAGE="$OLD_ADMIN_ID" "${DC[@]}" up -d --no-deps --force-recreate --pull never admin
"${DC[@]}" up -d --no-deps --force-recreate --pull never proxy
wait_backend
wait_edge
docker inspect "$("${DC[@]}" ps -q proxy)" | jq -e --arg live "$LIVE" '.[0] |
  ([.Mounts[] | select(.Destination == "/etc/nginx/conf.d/default.conf") | .Source] == [$live + "/infra/nginx.stand.conf"]) and
  ([.Mounts[] | select(.Destination == "/etc/nginx/templates/default.conf.template")] | length == 0) and
  ([.Mounts[] | select(.Destination == "/docker-entrypoint.d/19-validate-content-bucket.sh")] | length == 0)' >/dev/null
"${DC[@]}" exec -T proxy nginx -t
if "${DC[@]}" exec -T proxy nginx -T 2>&1 | grep -F '${S3_BUCKET_CONTENT}'; then
  echo 'unrendered template in direct-bind nginx config' >&2; exit 1
fi
```

No rollback path runs down migrations, drops columns/indexes, edits
`_prisma_migrations`, restores over the shared DB, or removes stateful volumes.
DB restore is a separate incident-recovery plan. No production Caddy, public
deploy, E29/Redis blocked-review work, shared credentials, repository source
docs, or vault files are included here.
