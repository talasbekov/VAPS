# Non-OM production-image browser acceptance

> **For agentic workers:** Execute inline; use one read-only independent review of final evidence and any source fixes.

**Goal:** Close the outstanding browser acceptance of implemented non-OM workflows, using existing scenarios and the accepted production frontend.

**Spec:** `2026-10-27-non-om-workflows.md`, `2026-10-27-afternoon-audit.md` and the current audit in `docs/vault/Аудит-проекта-2026-10-27.md`. User delegated continued improvements until28.10 11:30.

**Approach:** Existing `ux-fixture.signIn` needs NextAuth credentials. A temporary
stdlib-only HTTP fixture returns clearly synthetic tokens for one fixture account;
it is not a Django service and has no database. This allows existing object,
qualification, daily-status and duty-register API-intercepting tests to run without
copying them or changing their authentication helpers. No dev server is launched.

## Constraints

- Exact frontend image FE85d5153b from accepted .sh; .sh and installed stacks unchanged.
- Test HTTP fixture runs from a read-only mounted script, no DB/media/config mounts.
- Browser mutations are handled by existing scenario routes; ux-fixture blocks unexpected business writes.
- A separate checked subnet, unique labelled containers, only frontend loopback port3394; no working-stack network joins.
- Outbound networking is not asserted blocked. No real user, password, LLM, production API or business data is used.
- Preserve failed attempts and all working data. Do not retry a declined dev launch or historical deletion.

## Work

- [x] Start bounded synthetic login fixture and exact read-only frontend; verify container/network/mount identities.
- [x] Discover and run existing `ux-object-inspections`, `ux-non-om-qualifications`, `ux-duty-register`, `ux-daily-status-catalog` suites; no skips/flaky/errors.
- [x] Investigate any failure before a fix; distinguish stale fixtures from product bugs. Product fixes require failing regression and appropriate gate/backend checks.
- [x] Add focused browser coverage for actual administration diagnostics if the existing suites do not cover it.
- [x] Remove only owned temporary containers/network, retain evidence, independently review, update canonical notes and record a scoped local commit if source changed.

This phase does not claim backend authorization or live model/production verification from mocked UI tests.

## Results

Final attempt13:61 passed,0 skipped/flaky/unexpected, no report errors. Breakdown:
daily status4, duty register/templates40, qualifications5, inspections3, diagnostics9.
Focused final attempt12:17/17 for qualification/inspection/diagnostics.
Fresh frontend gate:1072/1072 and production build. Independent review found no
remaining issues in the4 E2E files or verification tooling.

Test-only fixes: the daily fixture now supplies the real native empty leadership
response; qualification/inspection locators use accessible roles rather than
implicit-label text that includes options/textarea content; inspection alerts
are scoped away from the Next route announcer. New diagnostics routes enforce
GET-only mocks, distinguish import receipts from DT acknowledgement and test
reads after confirmed global-authority revocation. The application runtime is
unchanged. Early failed attempts are retained separately from final acceptance.

Evidence: `.local-review/non-om-browser-20261027/acceptance.json`.
Full daily submission with a real backend remains a separate next stage.
