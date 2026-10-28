# Guided browser regressions implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline; use one independent final reviewer under superpowers:requesting-code-review.

**Goal:** Promote the9 verified guided-dialogue browser cases into permanent, typed frontend regressions.

**Architecture:** A dedicated synthetic-auth Playwright suite matches existing AI-settings tests. Its config never starts a server; execution requires an explicit loopback origin. The frontend gate lists this suite. The accepted runtime image is exercised without rebuilding/changing the delivered .sh.

**Tech Stack:** TypeScript, Playwright, next-auth JWT, existing production frontend image.

**Spec:** `docs/superpowers/specs/2026-10-27-guided-browser-regressions-design.md`.

## Global constraints

- Preserve dirty documentation and all working databases/containers; use existing linked worktree.
- No product runtime, policy, dependency, secret, migration or release-artifact changes.
- Browser stand uses synthetic authentication, intercepted API, no backend/working data.
- No implicit server startup; runtime requires explicit localhost/127.0.0.1/[::1] URL.
- Build/check snapshots only under outer `.build/guided-browser-regressions-20261027`.
- Keep failed attempts and evidence; no historical declined start/deletion retried.

## Review focus

- Button choices must be observed before explicit submission, with no automatic writes.
- Stale draft tests must prove old text survives and revision2 is sent after acknowledgement.
- API fallback rejects every unexpected mutation; no test uses genuine authentication.
- Discovery must succeed without a server; runtime must reject an unset/non-loopback origin.
- Exact existing runtime image and .sh remain distinguishable from new test-only source files.

### Task1: Promote the9 browser scenarios

**Files:** Create `PersonnelStatus/PersonalRecordFront/e2e/om-assistant-guided.spec.ts`; create `PersonnelStatus/PersonalRecordFront/playwright.guided-assistant.config.ts`; modify `PersonnelStatus/PersonalRecordFront/scripts/gate-front.mjs`.

**Interfaces:** Consume `AssistantTask` from `features/om-assistant/model.ts` and the9 already executed scenarios in `.local-review/production-update-20261027/browser-checks/guided.spec.ts`. Produce a typed dedicated suite configured by `GUIDED_ASSISTANT_BASE_URL` and a fixed synthetic-only session secret.

- [x] Transfer the nine cases using ordinary project imports, typed fixtures and explicit request-body types.
- [x] Add no-server config; `--list` works offline, execution rejects missing or non-loopback origin.
- [x] Include the config in gate discovery without changing any application runtime.
- [x] Run TypeScript and discovery; fix any test integration problems.

### Task2: Verify and preserve the regressions

**Interfaces:** Consume Task1 test/config paths. Produce a digest-bound source snapshot and receipts.

- [x] Run all9 scenarios on exact accepted frontend image `sha256:85d5153b68647eaa7c88f323b4263a2c6961e6a999fc5c63981912a5ab9a2f39`; require no skips/flaky/errors.
- [x] Exercise config refusal before browser launch for missing/non-loopback addresses.
- [x] Run complete `npm run gate:front` in a fresh snapshot; record test count and build exit.
- [x] Independent final review of changed tests/config/gate, fix any important findings, update vault/ledger, commit only owned test/spec/plan changes.

Test-only change: existing production code is already implemented and passed the new scenarios during release acceptance. No production fix is planned, so a failing product test is not manufactured.

## Evidence

`.local-review/guided-browser-regressions-20261027/acceptance.json` binds the9 permanent
browser cases, five config refusals,1072/1072 gate and production build to source hashes.
Independent reviewer `/root/guided_browser_review` found no issues. Initial snapshot
setup failures are retained separately from successful gate attempt2. Product runtime,
the delivered .sh, working data and installed stacks are unchanged.
