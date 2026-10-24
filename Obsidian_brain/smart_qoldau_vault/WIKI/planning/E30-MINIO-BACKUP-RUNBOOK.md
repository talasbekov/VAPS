# Smart Qoldau E30 — MinIO backup and restore-validation runbook

## Chosen approach and boundary

`infra/scripts/minio-backup.sh` performs a logical S3-level mirror from an
explicitly selected running MinIO container into a new, owned temporary MinIO.
The temporary target shares the source container's network namespace but uses
different, explicitly supplied service and console ports. It has no host port.
The source container and its `/data` volume are never stopped or copied.
The source endpoint is restricted to `127.0.0.1` or `localhost` with an
explicit port, so credentials cannot be forwarded outside the selected
container's network namespace.

After `mc mirror --preserve` completes, the script inventories the target,
stops that exact target container, confirms it is quiesced, and streams its
cold `/data` as `minio-data.tar`. It publishes the backup directory atomically
and without overwrite only after inventories, a manifest, and strict SHA-256
checks verify.

The consistency point is per object, at the time `mc` reads that object. There
is no atomic multi-object snapshot and no cross-PostgreSQL/MinIO point-in-time
guarantee. If a business operation spans database rows and several objects,
the operator must quiesce application writers before running both independent
backup procedures and retain their timestamps/run records together. The
backup script itself never stops the source.

## Verified coverage

- Current object bytes across multiple buckets, including nested keys.
- Binary bytes through an explicit SHA-256 expectation.
- Object `Content-Type` and selected user metadata through `mc stat`.
- Complete restored bucket and current-object inventories against the backup.
- Artifact checksums before any restore container is created.
- Backup and restore resolve a local MinIO image ID, create by that immutable
  ID, and verify the created container's `.Image` before start or data copy.
- Restore only into a new `--network none` disposable MinIO using the exact
  local MinIO image ID recorded in the artifact; the scripts never pull.
- Exact container ID plus unique run-label ownership checks before cleanup.
- Backup failure, checksum corruption, pre-existing output, publication-time
  races, concurrent publication, and TERM cleanup during mirror, cold backup
  copy, and restore copy without stopping the source.
- Docker/`mc` phases run as tracked children with a configurable bounded
  timeout (300 seconds by default, maximum 86400 seconds).
- Retained logs redact bucket/key values from expectation failures and identify
  only the stable expectation index.

## Explicitly unverified or excluded

- Historical object versions and delete markers: only current objects are
  guaranteed.
- Bucket policies and object-lock configuration: `mc --preserve` may transfer
  some of these, but they are not inventoried or asserted, so they are outside
  the verified contract.
- Server-side/client-side encryption recovery, KMS keys, and KMS availability.
- IAM users/service accounts, lifecycle rules, replication configuration,
  notifications, audit configuration, and other MinIO server configuration.
- Recovery with a different MinIO image ID.
- Full disaster recovery and database/object point-in-time consistency.

## Credential handling

Source credentials are read only from `MINIO_ROOT_USER` and
`MINIO_ROOT_PASSWORD` already present inside the explicitly selected source
container. They enter a unique temporary `mc` config via stdin and are removed
after the owned mirror exits. The endpoint is validated as explicit loopback
before Docker or `mc` runs. Temporary target and restore credentials are
kept in mode-0600 temporary files and transient disposable-container
environment. They are not passed in command arguments or written to logs.
Natural mirror timeout and caller-signal paths both perform bounded
token-owned process termination and verify removal of the source-side control
directory and temporary `mc` credential config before returning.
Before publication, the backup script scans the candidate artifact for the
temporary target credential patterns and refuses publication if found.
Successful and failed validation logs are tested not to contain credentials,
bucket names, or object keys.

## Operator procedure

1. Resolve and record the intended source container ID. Do not infer it from a
   production default. Confirm it is the expected MinIO and that its root
   credential environment is present.
2. Pick two unused ports in that container's network namespace for the owned
   temporary target. These ports are not published to the host.
3. Resolve the already-local MinIO image to an immutable `sha256:...` image ID.
   Both scripts create by that ID, verify the created container image, and do
   not pull. The artifact records the ID and validation requires an exact match.
4. If an application-consistent multi-object set is required, quiesce writers
   outside the script and record that operational window. Do not stop the
   source container or copy its live volume.
5. Run a backup with explicit values:

   ```bash
   infra/scripts/minio-backup.sh \
     --container '<resolved-source-container-id>' \
     --endpoint 'http://127.0.0.1:9000' \
     --target-port 9100 \
     --target-console-port 9101 \
     --minio-image 'sha256:<local-image-id>' \
     --operation-timeout 300 \
     --output '/absolute/new/backup-directory'
   ```

6. Create an expectations JSON file containing at least one important object.
   Include its bucket, key, independently known SHA-256, content type, and the
   metadata subset that must survive. Example schema:

   ```json
   {
     "objects": [
       {
         "bucket": "expert-documents",
         "key": "cases/example/document.pdf",
         "sha256": "<64-lowercase-hex-digits>",
         "contentType": "application/pdf",
         "metadata": {"X-Amz-Meta-Owner": "verification-team"}
       }
     ]
   }
   ```

7. Validate only into the disposable target:

   ```bash
   infra/scripts/minio-restore-validate.sh \
     --backup '/absolute/backup-directory' \
     --minio-image 'sha256:<same-local-image-id>' \
     --operation-timeout 300 \
     --expectations '/absolute/expectations.json'
   ```

8. Retain the immutable artifact, its output log, expectations file, validation
   result, source container ID, image ID, and any writer-quiescence evidence.
   Store the MinIO artifact alongside—but do not describe it as transactionally
   synchronized with—the corresponding PostgreSQL backup.

## Local verification evidence

The disposable end-to-end suite completed all 17 checks:

```text
PASS: source endpoint is explicit loopback and rejected before Docker use
PASS: backup create uses the inspected immutable image ID
PASS: atomic logical MinIO backup artifact
PASS: restore create uses the inspected immutable image ID
PASS: TERM during cold backup copy is bounded and owned-only
PASS: TERM during restore copy is bounded and owned-only
PASS: restore copy operation timeout is enforced
PASS: backup refuses overwrite
PASS: publication-time race is rejected without mutation
PASS: concurrent publication is atomic and no-clobber
PASS: failed backup leaves no artifact or runtime
PASS: isolated restore verifies nested, binary, content-type, and metadata invariants
PASS: failing expectations redact bucket, key, and credentials
PASS: checksum corruption is rejected before restore
PASS: natural mirror timeout removes owned source state and target
PASS: TERM cleanup is bounded to owned mirror and target
PASS: MinIO backup and isolated restore validation
```

Post-test cleanup queries found no containers with backup, restore-validation,
or test ownership labels and no test-owned Docker volumes. One stale `/tmp`
fixture from the initial red test was removed separately after exact path
verification; it contained only disposable synthetic MinIO data.

## Acceptance — 2026-09-17

Independent followup2 APPROVE: `/tmp/qoldau-minio-backup-review/followup2-report.md`. Sources26b6a714/8176eacc/4156ee2 integrated as8fe1ece/434fc78/1918b2b. Main1918b2b4b41c380992a9236ff3ccef3d75d59507 equals reviewed tree. Main syntax and17-check integration suite passed, exit0: `/tmp/qoldau-minio-main-check.log`. No deployment or scheduler activation. Offsite, encryption, retention, Redis and production restore drill remain open.
