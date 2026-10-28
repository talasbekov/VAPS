# Afternoon audit follow-up implementation plan

> **For agentic workers:** Execute the independent access/workload/diagnostics streams with focused parallel agents; root implements credential storage and integrates/reviews.

**Goal:** Continue approved audit improvements autonomously until16:00 Asia/Qyzylorda on27October2026; finish reviewed, tested source changes and report any remaining acceptance limits.
**Architecture:** Existing Django scopes/roles, Next workspaces, additive read-only coverage and diagnostics; encrypted credentials use the already pinned cryptography library. Preserve existing verified non-OM/AI work.
**Spec:** docs/vault/Аудит-проекта-2026-10-27.md and user's autonomous continuation instruction.

## Constraints

- Start13:06 local, deadline16:00. Reserve final time for tests, review and cleanup; do not start an unfinishable broad migration near deadline.
- Work in current isolated worktree. Keep all94 pre-existing changed/untracked files and current .sh; no production deployment, external notifications or Git publication.
- Existing background dev-server rejection (`blocked by policy`) remains in force; do not retry/circumvent that launch. Browser acceptance stays unverified.
- No global grants or implied departmental OM isolation. Exact employee/division boundaries enforced server-side.
- No invented OM duration, no automatic assignments, no positive integration/backup status without evidence.
- Tests use dedicated smart-audit-afternoon-tests-20261027 container and separate PostgreSQL database per stream; keep small evidence in .local-review/afternoon-20261027.

## Daily workflow and scope — daily_access_scope

- [x] Reproduce ancestor exact-division leak in OpsDailyEmployeesViewSet; enforce canonical scoped membership for every requested exact division.
- [x] Add /daily-expense using existing DailyExpenseBoard/ResponsibleDailyExpense and status.view plus existing daily_report mark/generate/correct permissions.
- [x] Keep /employees force-only; redirect explicit old daily links, repoint existing daily entry rather than adding menu clutter.
- [x] Explain actual OM scope in appropriate role/registry UI without changing the shared-registry policy.
- [x] Test denied parent/sibling reads, repeated query parameters, temporary/revoked grants, daily-only/force-only routes. No new permissions/migration.
- [x] Review finding: isolate all reused daily reads by actor/authority, clear denied sibling payloads, hide sent-by/reasons/employee snapshots after403, and revalidate after same-account scope changes. Preserve prefix mutation invalidation and working retry; include nested daily history where needed.

## Workload coverage — workload_coverage

- [x] Add bounded coverageFrom/coverageTo (max31days) to existing load analytics and a separate factual coverage payload.
- [x] Read canonical duty/status intervals, union overlapping known time, keep legacy duration estimates separate.
- [x] Use recorded OpsStatusParticipation as date-only OM evidence; never infer24hours from a date. Fold explicit duplicate mirrors only.
- [x] Respect existing analytics/personnel/status scopes; require global analytics.operations for OM source, explicitly mark inaccessible/missing sources.
- [x] Show coverage/date/source limitations in existing analytics workspace; no new navigation section. Test intervals, timezone clipping, duplicates and denied scope.

## Diagnostics — integration_diagnostics

- [x] Add actor-scoped AI task state counts, bounded1000-row stale pending scan and unknown/future timestamps; no outbound probes in GET.
- [x] Record sanitized explicit probe evidence in OpsAssistantConnectionCheck, migration0153 after0152; no URL/key/error body stored.
- [x] Mark probe as checking a saved revision only when its full draft equals that configuration; compare current revision to detect stale evidence.
- [x] Show actual catalog import receipt as catalog import; DigitalTwin acknowledgement/currentness remain unknown when not recorded.
- [x] Protect frontend cache by account/authority, global settings.manage, missing/error/revocation tests.

## Credential storage — root

- [x] Red tests: new saved keys differ from database bytes, legacy read compatibility, tamper/wrong-key failure, explicit replacement/clear, rotation dry-run/apply and key-ring fallback.
- [x] Add explicit api_key_format metadata (migration0154 after0153) so ciphertext is never guessed from token prefix.
- [x] Encrypt new writes with authenticated Fernet. Prefer optional dedicated OPS_ASSISTANT_CREDENTIAL_KEYS; otherwise derive a domain-specific key from server SECRET_KEY. Retain configured old keys/SECRET_KEY_FALLBACKS for controlled recovery/rotation.
- [x] Keep API/audit output redacted; corrupt encrypted values must never be sent as credentials. Settings page must still allow explicit replacement or removal.
- [x] Add dry-run-default rotate_assistant_credentials command; --apply transforms legacy/old-key data with a row lock and no plaintext output. Preserve connection semantics and revision when only storage rotates.
- [x] Document key backup/rotation and legacy upgrade limits. No existing production data is rewritten in this task.

Fernet API/rotation reference: https://cryptography.io/en/latest/fernet/ .
Django key rotation reference: https://docs.djangoproject.com/en/5.1/ref/settings/#secret-key-fallbacks .

## Integration and delivery — root

- [x] Integrate model imports, readonly Admin categories, schemas and frontend gate entries.
- [x] Fresh independent review of scope, aggregate semantics, probe evidence and credential recovery; resolve material findings.
- [x] Full frontend gate/build, complete isolated PostgreSQL collection and migration check; relevant deployment tests.
- [x] Retain first-run failures: declare existing pinned cryptography as a direct base dependency; investigate external LibreOffice PDF failure without speculative product changes. Repeat the final acceptance against a new snapshot.
- [x] Update role guide/tasks/journal/handoff and source manifests; retain truthful source-only status.
- [x] Remove task-owned test containers, isolated databases and Redis volume; retain app data, current package and evidence.
- [ ] Remove generated .next-build payload: automatic review rejected deletion (blocked by policy). Retain this directory; no retry/workaround was attempted after denial.
- [ ] Browser acceptance/live production checks (requires a permitted stand; not executed by code/unit checks).

## Accepted result

Source-only implementation and independent reviews completed. Frontend 1048 checks
and build; PostgreSQL 7989 passed/1 skipped across all 7990 nodes;
migration consistency,0152→0154 rehearsal and real Redis/Celery retry passed.
Deployment 144 passed/9 platform skips. Evidence and original failed run
retained in .local-review/afternoon-20261027; 2372 source hashes match.
Task-owned test containers/databases and isolated Redis volume removed.
Generated .next-build payload remains: automatic review rejected deletion
(blocked by policy); no retry/workaround after denial.
Browser/live-provider acceptance remains unexecuted. No installation, publication
or new update package was performed. The external LibreOffice failure from the
first run did not recur; its underlying trigger remains undetermined.
