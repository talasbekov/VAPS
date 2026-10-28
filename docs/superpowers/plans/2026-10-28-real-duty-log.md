# Real duty-log recovery and execution verification plan

> **For agentic workers:** Use superpowers:executing-plans inline. Required independent final review is read-only; no implementation delegation.

**Goal:** Verify actual duty creation/recovery/execution and durable closure on the accepted R6 image before28.10.2026 11:30 Asia/Qyzylorda; fix only reproduced material defects.

**Architecture:** A fresh labelled loopback-only synthetic stand runs the unchanged accepted frontend757/backend3e46/proxy42a. Four ordinary scoped actors exercise the existing journal through real NextAuth/JWT/HTTP/PostgreSQL, including one deliberately lost successful201 and one request aborted before forwarding. No business HTTP response is fabricated.

**Tech Stack:** Existing Next.js/Edge/Playwright, Django/PostgreSQL16/Redis, guarded Python fixture/role-transition helpers, raw read-only model/table audits.

**Spec:** Existing contracts in ops/duty_log.py, api/views_duty_log.py, DutyLogForm.tsx, DutyRecordDialog.tsx and existing ux-duty-register.spec.ts recovery/imported-ID/closure cases. This adds actual-backend evidence to already implemented behavior under the user's authorized continuing work.

## Constraints and bindings

- Require complete R6 artifact review/bookkeeping before committing this plan or starting its stand. Preserve all6launchers,14stable working metadata sets, mixed notes and source history. No production/local installation, working DB/backup read, real LLM, publication/message/push, declined startup/deletion.
- Exact accepted R6 images/source from its receipt; source and deployment stay unchanged unless an actual material defect is reproduced. Ignored evidence .local-review/real-duty-log-20261028; any build snapshots only outer .build.
- New exact recorded IDs/verification label, explicitly unused bounded /28 pair, loopback3399. Seed only exact nonce-bound empty DB/user with explicit opt-in/origin/password guards, including existing closure/supplement sources. Normal/-O inert target/occupied-source refusals precede seeding.
- Four ordinary actors: owner has viewA + separate manageA/manageB grants; colleague manageA; reader viewA; foreign manageB. No GLOBAL/wildcard/staff/superuser. One synthetic imported employee ID9007199254740997 in childA, nullable dates, fake active duty kind; no duty/event/profile/qualification/template/closure/supplement rows. Employee creation seeds one ordinary legacy in_service status and history; preserve them exactly.
- All successful business changes occur via explicit UI actions except one explicitly guarded fixture-only revocation of owner's manageA grant. API probes are reads/replays/expected refusals. Transport-loss injections abort delivery or forwarding and never fulfill mocked business responses.
- Pending creation belongs to the original actor/UUID/body. After removing manageA, owner retains viewA/manageB and the same flat permission codes; only scope changes. Recovery uses the original-actor read lookup and must not resend a POST for the already saved row.
- Facts are explicit: creation leaves acknowledgement/start/end unknown; colleague separately acknowledges, records past start and past end. Closing an uncommitted attempt creates only its durable closure; delayed original POST must not create another row.
- Keep known nonfatal read-only Gunicorn control-server diagnostic disclosed. Clearly separate new native evidence from inherited R6/build evidence and any diagnostic attempts. No working DB data or credentials in public evidence.

## Review focus

- Imported identity/time precision: browser sends the large employee ID as an exact string, SQL preserves the integer and nullable dates/placement; planned stamps and original creation fingerprint/actor/createdAt remain stable through execution.
- Ambiguous success + partial scope withdrawal: one real201 is lost, writerA revoked before reload, same code set retained; original GET recovery finds one row with view-only actions, clears only that pending UUID and sends no second create POST.
- Scope privacy: reader cannot mutate, foreignB cannot read or write rowA, another actor cannot learn its creation receipt through the original UUID; full response bodies exclude out-of-scope fake markers.
- Execution state: PLANNED→ACKNOWLEDGED→ACTIVE→COMPLETED only through explicit actions, authors/revisions/audit/actual minutes agree, invalid/future transitions and replays preserve tables.
- Durable close: a separate colleague attempt aborts before reaching server; explicit UI close persists one closure, repeat close is a no-op and delayed original create gets409 without a second log row.

## Task: one real journal recovery/execution acceptance

- [x] Require R6 complete/committed/noted; freeze image/source/6launcher/working metadata bindings and commit only this owned plan.
- [x] Create minimal guarded fixture, normal/-O refusal checks, read-only fingerprint/audit and fixture-only partial-grant withdrawal helper with target/state checks; prove malformed/occupied inputs stop before writes.
- [x] Start fresh stand, verify ordinary identities/scopes, empty journal and initial read/authority/validation refusals with whole-table preservation.
- [x] Through real UI create one duty for the imported employee, deliberately lose real201, verify one row/revision/audit; withdraw only manageA, reload and recover through original-actor GET, with unchanged flat codes/no second POST/no pending-draft residue.
- [x] Verify full-body scope/receipt privacy and original create replay/denials. Through colleague UI separately acknowledge/start/complete with recorded past times; verify exact planned data/author/fingerprint/createdAt, revisions1→4, fact authors and actual minutes; reader/foreign/withdrawn-owner mutations refused.
- [x] Create a distinct colleague pending attempt with transport aborted before forwarding, close it through UI, verify one closure/one duty row, exact close replay and late-create409. Verify raw SQL/audit/table preservation, nullable identifiers/dates,390px layout and no unrelated domain writes.
- [x] If a material defect is reproduced, retain clean red, add meaningful permanent regression, fix minimally and verify source/build/fresh native evidence before any new packaging. Otherwise explicitly record no product change.
- [x] Obtain independent read-only evidence review, close exact owned resources, preserve14working/6launchers, update canonical notes in place and commit only owned accepted plan bookkeeping; keep goal active until deadline/final handoff.

## Reproduced defect and bounded correction

On accepted FE757/backend3e46 the real acknowledgement form offered RECORDED time and sent an explicit past at value, but backend deliberately used current server time. Separate one-action diagnostic attempt3/ack-only confirms the ignored input and exact SQL/API identity; its terminal postcondition failed only because login changed the auth token table after the baseline. This is diagnostic evidence, never full workflow acceptance. The strengthened existing UX acknowledgement/start/completion case gives a clean red on757: the acknowledgement time selector exists when it should be absent,1failed/0skipped/0flaky.

Treat acknowledgement as server-time in the existing dialog, with explicit confirmation wording. Keep manual recorded times for actual start/end. Change only DutyRecordDialog.tsx and the existing UXcase; backend/permissions/planning/pending UUID contracts remain unchanged. Require independent source review, TypeScript, frozen1076offline tests+production build, permanent green and a fresh full actual workflow on the new image. Runner diagnostics remain disclosed: attempt1 storage lookup/race, attempt2 automatic legacy status expectation, attempt3 cross-language audit ID precision and separate ack-only auth-baseline assertion. The latter now serializes the cross-language core employee identity as a string while SQL still checks the exact integer. New final foreign list/detail/choices checks exclude all private markers from entire response bodies.

## Second reproduced defect during the fresh full run

First corrected image4d58/source80fafe passed1076offline tests/build and TypeScript. Fresh attempt4 actually completed lost201/replay/grant2withdrawal/reload/GET-only recovery, then its390px detail check exposed real long-note overflow1824px. A separate read-only DOM diagnostic reproduces1820px and adding only grid-cols-1 to the existing description dl reduces overflow to0 while preserving all140non-auth/non-audit tables and sending0business mutations. The existing320px journal/detail UXcase now supplies180unbroken characters, checks the full note and inner dialog width: clean red1/0skip/0flaky on4d58.

Add that one base-grid class to the same dialog, leaving sm:grid-cols-2 intact. Source changes remain exactly two files: dialog and existing UXspec. Preserve v1 candidate/source/build/reviews/diagnostic evidence, create separate v2 candidate/source/build/review files and fresh attempt5 for complete final acceptance. Both original acknowledgement and strengthened layout cases must pass on the final image; compare unchanged acknowledgement-case content separately because the whole spec now also contains the layout strengthening. R7 may use only the final accepted v2 image;4d58 is a partial diagnostic runtime, never a release acceptance.

## Accepted result

Minimal server-time acknowledgement and mobile description grid corrections accepted on exact frontend sha256:ffa6b1b532c65096bb48907f23c426cf1782eecdf8b63fedeccca585624a13be; backend/proxy unchanged. Existing acknowledgement UXcase clean red on757; strengthened320px detail case clean red on4d58; both green on the new image, TypeScript and frozen1076offline tests+production build passed. Source1066FE/1342BE. Independent source/helper/final evidence reviews have no open material findings.

Fresh attempt6/browser1 terminal0: four ordinary scoped actors/no GLOBAL; one real successful201 deliberately lost, exact pre-withdrawal replay200/noop, only owner manageA revoked while flat codes remain unchanged, reload recovers through original-actor GET without another create POST and clears only its pending UUID. Colleague independently acknowledges with server time and records actual start/end; one log row revision4/four domain audits,30actual minutes, original creator/fingerprint/planned data/createdAt and large employee ID/null dates/placement preserved. Separate unsent attempt explicitly closed: one closure and delayed create409. Six UI mutation attempts, 68 successful page API responses, 21 API replays/refusals,18full-body foreign-marker checks;390px fits.

Seed6/82 and revoke-metadata3/118 inert normal/-O checks; actual24revoke-helper and6read-helper refusals, whole-table preservation. Replay/refusal checks preserve142non-audit tables; native positive actions intentionally change log/closure/one role and audit,137other non-auth/non-audit/nonfixture tables stay equal. Post-mocked green140non-auth/non-audit tables and exact raw audit remain equal. Automatic legacy in_service status/history preserved; duty-log audit includes the serialized synthetic note by contract.

All failed runner attempts remain diagnostics and are excluded from complete native acceptance; separate real ignored-input proof discloses its terminal auth-baseline postcondition failure. All exact owned resources removed;14working containers and six prior launchers preserved. R6 remains latest accepted installer until separately reviewed packaging. No working DB/backup reads, production/local installation, live model, publication, push or declined actions. Known read-only Gunicorn control-server diagnostic unchanged. Overarching goal stays active until11:30local/final handoff.
