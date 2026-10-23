# Smart server move implementation plan

> **For agentic workers:** Execute inline with superpowers:executing-plans; use one final independent review. Steps use checkbox syntax.

**Goal:** Move the entire existing Smart Docker installation from10.15.3.187 to10.15.3.251 with its real database, uploads, accounts, settings and runtime images, beside the existing Digital Twin.

**Architecture:** A standalone Python operator tool exports a cold, complete snapshot of the six/seven-service Smart project. The source is fenced with the existing update lock and remains stopped after a successful export to avoid divergent writes. PostgreSQL's cleanly stopped physical volume and all other project volumes are restored on the same immutable runtime images; full logical database and upload fingerprints are checked in an isolated PostgreSQL and on the destination before opening ingress/workers. Existing destination resources are never overwritten.

**Tech Stack:** Python3.9+, Docker Linux/amd64, PostgreSQL16, Compose2.17.2+, standard library only.

**Spec:** User request20.10.2026 to move all Smart from10.15.3.187 to10.15.3.251; SSH target account `user`. Credentials are not embedded in scripts. Target Digital Twin at8090, expected Smart at3300. No direct access from the developer workstation.

## Global constraints

- Copy only the selected Smart compose project; preserve Digital Twin and unrelated projects.
- Preserve application code/images, database roles and ownership, locale, data, media/private/static, Redis and scheduler volumes and secrets.
- No migration, seed, reset, database cleanup or restore over a populated target.
- Use the running image identities; support classic Docker config digests and containerd IDs after image transfer.
- Source remains frozen after a completed export. Export failure resumes only the exact original containers; an uncertain forced shutdown remains fenced for review.
- Explicit empty target directory, no existing target project/volume/network/container or occupied bind port.
- New backups kept separately from temporary test/build artifacts. Existing cleanup denials remain binding.

## Review focus

1. In-flight jobs or unclean PostgreSQL shutdown: refuse the snapshot instead of treating a live filesystem copy as a backup.
2. Shared/external Docker resources or bind mounts: reject before downtime; never overwrite a target Digital Twin resource.
3. Old source resumes while the destination accepts writes: retain source fence and stopped services; source rollback requires an explicit target-stopped assertion.
4. Truncated transport, path traversal/links and image ID differences: validate archive inventory/hashes and exact images before restoration.
5. Partial installation and successful replay after manual edits: refuse ambiguous partial restore; a completed identical import must not replace current data.

### Task1: Inventory, transport and portable configuration

**Files:** create `deploy/lan/migrate-server.py`, `deploy/lan/test_migrate_server.py`.

- [x] Write failing tests for archive corruption/traversal, image config digest acceptance, address-only configuration changes and source/target ownership conflicts.
- [x] Implement validated project inventory, private manifests, hashes, extraction and destination preflight. Supported services: db/redis/backend/worker/frontend/proxy with optional beat; local named volumes only.
- [x] Verify all focused standard-library tests, including preserving credentials while rewriting only address settings.

### Task2: Frozen source export and independent restoration

**Interfaces:** `export --stack PATH --tools PACKAGE --out ARCHIVE`; `resume-source --stack PATH --destination-not-activated`.

- [x] Test lifecycle failure and source lock fencing before implementation.
- [x] Freeze ingress/backend/scheduler, gracefully stop worker, capture logical database and upload hashes, cleanly stop database/Redis and archive all volumes. Export images under migration-specific tags without replacing ordinary image tags.
- [x] Restore a copied PostgreSQL volume in a network-isolated owned container and compare the complete frozen database fingerprint. Build one private archive with a checksum; retain source frozen on success.
- [x] Verify recovery control with unit failure injection before/after publication; actual container identity/resume logic reviewed. Unclean shutdown or published archive always retains the source fence.

### Task3: Destination import, replay, operator commands

**Interfaces:** `import --bundle ARCHIVE --target NEW_PATH --ip10.15.3.251 [--project NAME]`.

- [x] Test refusal of preexisting target resources and preservation of manual changes on replay.
- [x] Load verified private images, restore only new owned volumes, update only host-address configuration, verify actual resolved compose configuration and source database fingerprint before starting the application. Verify media/private and database again before workers/proxy.
- [x] Run a real isolated seven-service export/import using the current Smart images and a restored database; include Cyrillic/binary uploads and Redis state. Compare working local database/container identities and an unrelated Docker sentinel before/after.
- [x] Independently review the whole tool, resolve Critical/Important findings with regression tests, remove only newly owned rehearsal containers/volumes/networks, preserve backup and evidence.
- [x] Export one operator file and short source→scp→destination commands to `Документация`; update the existing vault task/journal/handoff.

## Execution ledger

- Scope: only Smart. Target251 is already running Digital Twin; installing a second Smart project beside it is the requested move.
- Method: existing user authorization for autonomous implementation; no production action is executed from this workstation. Operator performs SSH commands. Direct probes to both SSH addresses timed out.
- PostgreSQL method: cold physical copy on the exact running PostgreSQL image preserves roles, ownership and locale as well as rows. A matching logical fingerprint is the restore proof.
- Reviewed maintenance package20.10 is included by its exact pinned SHA256SUMS inventory; arbitrary neighboring files are not copied. Corrected optional import helpers retain their relative directory layout. No data import is executed as part of the move.
- Verification:19 focused tests pass; full LAN standard-library suite131 tests,130 pass/1 Windows skip. Real case02: complete cold export, isolated restore, seven-service destination startup, exact database/files/Redis, manual-change replay, foreign stopped volume consumer and existing-project refusal, ordinary source launcher fence, corrupted transport refusal all pass. Working Smart database and Smart/Digital Twin container identities before/after match.
- Independent review:four initial findings fixed (publication/restart boundary, outside volume consumers, ctl.sh fence, classic/containerd image identity). Focused follow-up reports no remaining Critical/Important findings.
- Cleanup:owned fixture containers, volumes, networks and both exports' private image tags removed. Small evidence copied to `Резервные-копии/2026-10-20-server-move/evidence`. Automatic approval review rejected recursive deletion of `.build/server-move20261020/case01` and `case02` with `blocked by policy`; both retained, no alternate deletion/move attempted.
- Production migration is not executed. Full production archive will be generated on187 by the operator, then transferred directly to251; its checksum comes from that export, not from the test archive.

## Incident21.10: source Compose2.17.2 / destination2.40.3

- User confirmed EXPORT PASSED, original archive SHA256 OK and completed scp of all three files (production archive1547MiB). Import failed on configuration comparison before images/volumes/containers were created; source remains fenced. No source re-export or archive retransmission is required.
- [x] Reproduce the original failure on the identical frozen snapshot using the official checksum-verified Compose2.40.3 plugin. Differences are explicit/omitted equivalent defaults: depends_on.required:true and volume/network external:false.
- [x] Normalize only these defaults; retain strict comparison of real dependency/storage/network/restart/security settings. Remaining mismatches report key paths without secret values.
- [x] Add --resume-preflight only for the same original archive/migration/project, recovery-required with no activation/resource-creation history and no actual project resources. Verify cached manifest bytes against the checksum-verified original bundle, exact cached file inventory/hashes and exact destination configuration bytes; preserve manual edits and original failure evidence. Hold an OS lock to prevent concurrent attempts.
- [x] Independent focused review: two initial retry findings (mutable cached manifest and activation-history reset on rejection) resolved with regressions. Final review has no remaining Critical/Important findings.
- [x]26 focused tests PASS; LAN138 tests,137PASS/1WindowsSKIP. Real Compose2.40.3 original failure → retry → seven healthy services → exact original database → manual edit → rejected activated/concurrent retry without evidence/service mutation → completed replay preserving edit PASS. Working local database and Smart/Digital Twin identities unchanged.
- [x] Remove only new rehearsal containers/volumes/networks/private tags and new target cache after ownership checks. Old denied case01/case02 of20.10 untouched. Small evidence retained in Резервные-копии/2026-10-21-server-move/evidence.
- [x] Publish corrected standalone Smart-Josparlau-migrate-servers-2026-10-21.py,58002bytes, SHA25606f36338e7d24bdd4baa0cdf5594986393569b0f14506d06a784e87e38879728 and concise recovery commands. User still must run the corrected import on251; no production IMPORT PASSED yet.

### Follow-up21.10: raw YAML root extensions (v2)

- Server error now identified exactly7 differing paths only under root x-backend/x-backend-env. Previous integration fixture had dropped root x-* when expanding YAML, so it missed the production anchor/template representation.
- [x] RED→GREEN28tests; ignore only inert root x-* AFTER Compose resolves anchors into effective services. Preserve strict comparisons inside actual services/environment/labels/volumes, including x-prefixed domain names. Docker spec: https://docs.docker.com/reference/compose-file/extension/.
- [x] Rehearse with actual raw YAML anchors/merge, old2.17.2 source/new2.40.3 destination and changed187→251 addresses. Old21.10 script reproduces EXACTLY the server's7 paths. v2 retry/startup7healthy/exact database/manual edit/replay and concurrent/activated refusal pass; working database and unrelated Smart/Digital Twin identities unchanged.
- [x] LAN140tests139PASS/1WindowsSKIP; focused independent review no Critical/Important. Remove only new fixture Docker resources/cache/synthetic bundle; retain small evidence under Резервные-копии/2026-10-21-server-move/evidence/yaml-extensions. Old denied directories remain untouched.
- [x] Publish v2 standalone58239bytes, SHA2561348e7409d3e75d1f9663814fda31ec5db0cb5d593dcf0eb00086d4d1bb58977 and commands using existing production archive with --resume-preflight. Production success remains unconfirmed.
