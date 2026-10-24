# E30 monitoring integration — bounded next slice

Base: `630e6cc757f5d18a4381a87f653f215691ae1790` (verified current HEAD, clean worktree).

## Recommendation

Implement one **one-shot, explicitly credentialed local collector**. It reads the four accepted admin sources, validates exact aggregate-only contracts, and emits one bounded JSON record plus a monitoring-style exit code. This is independently useful for operator triage and is ready for a later host-monitor adapter, but it is not an alert-delivery system.

Do not add or enable a timer in this slice. Current auth supports human admin sessions, not a durable monitoring identity: access TTL defaults to 15 minutes; refresh tokens rotate and default to 30 days; production requires 2FA; every protected request rechecks current active state and roles. Automatically logging in, bypassing 2FA, or parking a SUPERADMIN credential would exceed the approved contract.

## Why this option

- **Chosen — bounded collector:** creates one strict, testable normalization boundary and useful local evidence without inventing delivery or auth.
- **Host-monitor integration now:** premature; no host monitor/destination, missing-run policy, escalation owner, or durable credential contract exists.
- **Existing logs only:** Docker has rotation, and the synthetic smoke writes success/failure, but there is no consumer, state retention, or alert routing. Raw API bodies in logs would also be the wrong privacy boundary.

## Evidence

- Verification runbook lines 7-15: `VERIFICATION_OPERATOR`, aggregate-only fields, source `alerting`, and non-2xx/missed/stale are not `ok`.
- Settle runbook lines 7-16: `FINANCE_CONTROL`, `alerting|unknown|ok`, both counts retained, no provider outcome or financial reconciliation, no bearer logging.
- Push runbook lines 7-19: any current staff, explicit <=24h UTC window, `observed` only, and no approved paging window/threshold/action.
- No-show runbook lines 7-15: `QUALITY_TEAM`, explicit <=24h UTC window, raw counts only; no rate, denominator, threshold, penalty, or alert.
- `infra/scripts/synthetic-smoke.py:25-27,139-178,181-228` establishes bounded bodies, transport deadlines, terse output, and fail-closed contract checks.
- `infra/systemd/smart-qoldau-synthetic-smoke.timer:4-8` is only a five-minute local scheduler; its service has no `OnFailure` or delivery hook.
- `infra/docker-compose.prod.yml:12-18` only bounds local JSON logs. The complete `infra/` inventory contains no alert/monitor consumer.
- `backend/src/admin/admin-auth.service.ts:49-120` issues expiring access tokens and single-use rotating refresh tokens.
- `backend/src/admin/admin-jwt.guard.ts:33-70` rejects unfinished 2FA, inactive staff, and production staff without TOTP; `admin-session.service.ts:38-62` refreshes active state/roles via Redis/DB.
- Endpoint role evidence: verification controller lines 56-63; payments controller lines 24-31; notifications controller lines 24-35; consultations admin controller lines 31-46.

## Proposed file ownership (future implementation; no files changed now)

- `infra/scripts/operational-signals.py`: HTTP, exact contract validation, credential-file reading, normalization, one JSON output, exit code.
- `infra/scripts/tests/operational-signals.test.py`: local fixture server; contract, timeout, auth/privacy, freshness, and exit-precedence tests.
- Obsidian `WIKI/planning/E30-MONITORING-COLLECTOR-RUNBOOK.md`: operator invocation, credential handoff, output interpretation, and explicit non-delivery boundary. Documentation remains in Obsidian, not repo docs.

## The one proposed contract: `qoldau-operational-signals/v1`

Invocation inputs:

- `--base-url <https-origin>`; origin only, no URL credentials, fragments, redirects, or non-HTTPS outside explicit localhost tests.
- `--from <UTC-Z>` and `--to <UTC-Z>` are mandatory and forwarded identically to push/no-show; collector enforces one value each, `from < to`, and window <=24h. It does not choose a business window.
- Four explicit paths: `--verification-bearer-file`, `--settle-bearer-file`, `--push-bearer-file`, `--noshow-bearer-file`. Reuse is allowed only by an operator's explicit choice; no implicit SUPERADMIN fallback.
- Each credential file must be a regular non-symlink owned by the effective UID, mode `0600`, <=8 KiB, containing one ASCII bearer. The collector opens with no-follow semantics, never creates/rotates/refreshes it, and never accepts a bearer in argv, URL, or environment.

Requests:

- GET only, fixed paths, fixed query keys, `Accept: application/json`, `Authorization: Bearer …`, no cookies, no redirects.
- Sequential requests; connect timeout 2s, total timeout 5s per source, whole-run deadline 22s, response cap 64 KiB, duplicate JSON members rejected.
- Record request start/receive time. `observedAt` must parse as UTC and fall within `[requestStart-60s, responseReceived+60s]`; otherwise source collection state is `stale`.

Single stdout record (compact JSON, newline terminated):

```json
{"schema":"qoldau-operational-signals/v1","collectedAt":"UTC","window":{"from":"UTC","to":"UTC"},"overall":"ok|alerting|unknown","sources":{"verification":{"collection":"observed|error|stale","state":"ok|alerting|null","observedAt":"UTC|null","metrics":{}},"settle":{"collection":"observed|error|stale","state":"ok|alerting|unknown|null","observedAt":"UTC|null","metrics":{}},"push":{"collection":"observed|error|stale","state":"observed|null","observedAt":"UTC|null","metrics":{}},"noshow":{"collection":"observed|error|stale","state":"observed|null","observedAt":"UTC|null","metrics":{}}}}
```

- Verification `metrics`: `thresholdHours`, `overdueCount`, `oldestPendingAgeSeconds`, `missingSubmittedAtCount`.
- Settle `metrics`: `maxAttempts`, `currentExhaustedCount`, `unexpectedContextCount`, `providerOutcome`.
- Push `metrics`: `completedFanoutCount`, `deviceAckCount`, `unacknowledgedCount`, `latencySampleCount`, `negativeLatencyCount`, `ackLatencyP95Ms`, `outboxDeadCount`, `closedWithoutRecordedFanoutCount`, `missingNotificationForClosedOutboxCount`, `providerAcceptance`, `delivery`.
- No-show `metrics`: `cohortCompletedCount`, `clientNoShowOutcomeCount`, exact four-key `outcomeCounts`, `completedWithoutOutcomeCount`, `completedWithoutEndedAtCountAllTime`.
- The response `signal` must equal the fixed endpoint signal and the response window must exactly equal the requested window; they are validated, not duplicated into `metrics`.
- Output never contains IDs, URLs, headers, bearer material, response bodies, stack traces, or free-form server errors.
- `overall=unknown` if any request is non-2xx, times out, is skipped, malformed, contract-mismatched, stale, or settle is `unknown`; this takes precedence over `alerting`, while per-source states preserve simultaneous alerts.
- Otherwise `overall=alerting` if verification or settle is source-state `alerting`; otherwise `overall=ok`.
- Exit `0=ok`, `1=alerting`, `2=unknown/configuration`. Stderr is `<source>: request_failed|http_status|contract_mismatch|stale` or `collector: configuration_error`, with no status body or credential content.
- Verification `alerting` opens/maintains and a later successful source `ok` may clear. Settle `alerting` is local investigation only; `providerOutcome` remains `not_determined_by_source` and the collector performs no reconciliation or money action.
- Push/no-show can only be `observed|error|stale`; their numbers never change `overall` to `alerting`, and the collector calculates no ratios, thresholds, SLOs, or paging decisions.

## Cadence and state ownership

This slice owns one invocation only. The caller owns cadence, durable last-success/last-alert state, missed-run detection, retention, routing, acknowledgement, and escalation. A future five-minute cadence may reuse the synthetic-smoke pattern only after the gates below; until then this is manual/opt-in and an expired bearer correctly yields `unknown`, never healthy.

## Acceptance

- Fixture tests cover every exact DTO, wrong/missing/duplicate fields, malformed JSON/UTC, oversize body, redirects, 401/403/429/5xx, connection/DNS/body stalls, stale/future `observedAt`, and mixed alert+failure precedence.
- Tests prove only the four fixed GETs occur, supplied query windows are unchanged, every request uses the matching credential, and stdout/stderr never contain fixture secrets, headers, raw bodies, IDs, amounts, or free-form errors.
- Tests prove verification/settle source states pass through; settle `unknown` and every error/stale path exit 2; push/no-show counts alone never alert; successful all-source observation exits 0.
- Static review confirms no login/refresh/TOTP calls, writes, DB access, scheduler, service enablement, external send, provider, secret creation, or global log ingestion.

## External gates before unattended operation

1. Security/ops approve a durable least-privilege credential and renewal/revocation owner compatible with 2FA and role separation; the current contract does not supply one.
2. Product/ops approve push and no-show window, sample/grace rules, thresholds, and response actions if they are ever to page.
3. Finance defines a separately authorized reconciliation process; settle output alone cannot close a financial incident.
4. Ops selects a host-monitor/destination, five-minute (or other) cadence, missed-run/staleness policy, retention, routing, escalation, and credential injection mechanism.
5. Separate reviewed deployment enables any service/timer and proves production reachability/load. This plan claims no delivered alert.

## Root implementation clarifications

Validate all configuration and credential files before network. Explicit literal-loopback HTTP test opt-in only; ignore environment proxy/netrc/cookies, verify TLS. Required window to<=collectorNow. Error/stale observations emit null state/observedAt and empty metrics, never stale metrics as fresh. Overall ok is collector/source-state result only, not product health, delivery or reconciliation. Actual DNS/header/body wall-clock timeouts must be demonstrated. Predictable safe configfailure record/exit2. Browser walkthrough task owns separate infrastructure; collector tests may not touch it.

### Root clarification after independent review (2026-09-18)

Configuration failures use the same `qoldau-operational-signals/v1` envelope: `collectedAt`, `window:null`, `overall:unknown`, and all four source entries with `collection:error`, `state:null`, `observedAt:null`, `metrics:{}`. No extra code field or second schema. Never echo invalid user input. Stderr remains only `collector: configuration_error`; exit 2 and zero requests. A null window is permitted only for configuration failure. The whole-run 22-second wall-clock bound includes configuration/credential reading and TLS trust setup; source deadlines include their TLS context setup. Reject special credential files without blocking. Verified TLS must never enable inherited key logging or create/change an SSLKEYLOGFILE target.
