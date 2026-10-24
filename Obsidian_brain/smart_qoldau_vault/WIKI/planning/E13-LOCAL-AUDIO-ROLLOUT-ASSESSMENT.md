# Smart Qoldau localhost:8080 — corrected audio rollout assessment

## Decision

**Do not execute a full `main` backend rollout from this plan.** The previously proposed image-build/recreate commands are withdrawn and are explicitly **not authorized** by this assessment. Audio’s zero-schema diff is insufficient to replace the complete backend while the shared DB is behind target `main`.

The accepted main `2236df554cee01ed43d281c48ba3262e25256574` and reviewed source commit `bca24a87349531e789ad66aed366cde51697a693` have the identical tree (`3d58c17b...`). The 14-file audio diff itself has no Prisma migration, Dockerfile, Compose, or environment-contract delta from parent `719c734`.

## Why the full image is unsafe without the three migrations

The shared DB has 28 finished Prisma migrations, no unfinished migration, and is missing these three target-main migrations:

- `20260902120000_r27_client_display_name_and_consent`
- `20260916043000_notification_outbox_leases`
- `20260916060000_chat_client_message_id`

The live schema metadata confirms that all six resulting columns are absent: `users.display_name`, `users.expert_visibility_accepted_at`, `notification_outbox.lease_token`, `notification_outbox.lease_expires_at`, `chat_messages.sender_user_id`, and `chat_messages.client_message_id`.

This is an active runtime incompatibility, not merely future functionality:

- Target `AuthService` has default Prisma `user.create`, `findUnique`, `findFirst`, and `update` calls. With target schema, Prisma’s default scalar return includes the two absent R-27 user columns, so ordinary sign-in/guest flows are at risk.
- Target request creation explicitly selects `expertVisibilityAcceptedAt`; the new account-profile/consent paths read and write both missing user columns. Those calls will fail against the current DB.
- `NestScheduleModule.forRoot()` starts `OutboxSweepService`; its `@Interval(1000)` first query references `lease_expires_at` and updates `lease_token`/`lease_expires_at`. The service catches the error, so health may appear good, but the outbox worker fails and logs every second.
- Target chat creates both missing chat columns (even when the correlation values are null), uses the new composite selector, and default-selects chat rows in history. New sends and history are therefore incompatible.

Audio’s `content_items` prerequisites are present and the audio commit has no Prisma delta. That only proves the narrow endpoint could use the existing content schema; it does **not** make the target process safe to start.

## Established non-secret operational facts

- Current running backend/admin lack the accepted compiled audio markers. Image labels do not contain a VCS revision.
- PostgreSQL is 16.15; current runtime Prisma is 6.19.3.
- Required candidate backend environment *names* are already present: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `CHAT_ENCRYPTION_KEY`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `PAYOUT_WEBHOOK_SECRET`; `MOBIZON_API_KEY` is conditional only for `SMS_PROVIDER=mobizon`. The audio diff adds none.
- An authenticated read-only `HeadBucket` for the configured content bucket succeeds; an anonymous `HEAD` receives 403. MinIO is ready and the bucket is private without listing objects or exposing credentials.
- Backend startup connects Prisma and runs bucket checks. It does not run migrations; Compose owns a separate `migrate` service. Startup also retains its pre-existing avatar-policy write side effect.

## Independent required proxy change

The active proxy comes from `/home/erda/Музыка/smart_qoldau/infra` and its effective nginx config has no `client_max_body_size`. nginx therefore retains its 1 MiB default, so a 25 MiB multipart upload cannot reach Nest/Multer.

For any future authorized audio deployment, add `client_max_body_size 26m;` inside the active `server` block, validate with `nginx -t`, then reload nginx. `26m` leaves room above a 25 MiB file for multipart framing; Nest remains the file-size authority. This proxy-only correction does not resolve the full-image compatibility blocker above.

## Can the exact deployed source be recovered now?

**No, not to the evidentiary standard needed for a safe backport.** The strongest clue is temporal only: the backend image was created at `2026-09-02T04:09:29+05:00`, and the deployment checkout reflog has `70f4159` at `04:09:05+05:00`. It is plausible, but not proof, that its build context was that clean commit.

Why it is not proof:

- The image has no source/revision label or build attestation; its repo digest is only the local image digest.
- Runtime includes `dist`, declarations, Prisma schema/migrations and source maps, but no `.git`; all inspected maps have `sourcesContent: false`.
- Package, lockfile and Prisma-schema hashes match **14** historical Git commits. They narrow a source window but do not determine the source tree or exclude uncommitted build-context changes.

Consequently, no exact base exists from which to construct or review a minimal audio-only backport. Do not cherry-pick the audio commit onto the guessed `70f4159` baseline, and do not infer a base from image timestamp, tag, or migration list.

## Separate decisions needed before any backend deployment

Choose one of these paths explicitly; neither is authorized by this read-only review:

1. **Full-main path:** approve the three named migrations through the normal DB-change process, then evaluate and deploy target `main` as a complete release. This plan does not suggest silently applying them or disabling the affected workers/routes.
2. **Minimal-backport path:** provide an attested source revision/build record for the currently deployed backend (or an archived clean checkout that can be cryptographically matched to the image). Then create a separate audio-only release candidate from that proven base, manually review every conflict and generated Prisma artifact, and verify it in an isolated disposable PostgreSQL/Redis/MinIO stack with the current DB schema. Only after that independent compatibility result may an authorized rollout plan name images or deployment commands.

If neither proof nor a migration decision is available, the backend update is blocked. The admin bundle alone cannot deliver upload because the route must exist server-side.

## Build reproducibility correction

`docker build --pull=false` does **not** prove a pinned or reproducible base image and does not by itself guarantee a safe failure mode: it can use whatever mutable base tag/image is locally cached. A future approved build needs immutable `FROM` digests (or a documented, verified build cache/base provenance) plus a revision label/attestation. This is an additional release-control requirement, not a workaround for the missing DB compatibility.

## Browser-playback boundary remains separate

Upload readiness is established only for admin -> backend -> private MinIO. `contentUrl()` signs `S3_ENDPOINT`; the stand Compose uses MinIO’s internal service address and the current proxy has no MinIO route. That does not prevent upload, but it does not establish browser-reachable private audio playback through `localhost:8080`. Resolve this in a disposable stand stack before claiming end-to-end playback; do not silently expand this uploader rollout to change media routing.
