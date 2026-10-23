# Chief Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Начальник ставит задачу обычным текстом; сохраняются доступный бюллетень, предложение запросов и проверяемая передача штабу.

**Architecture:** Локальный Ollama извлекает ограниченную структуру. Новые task/receipt модели сохраняют состояние, а allowlisted adapter повторно проходит существующий authenticated SecurityEventViewSet boundary под исходной аутентификацией запроса. Чтение прогресса использует текущие ОМ; отдельного жизненного цикла наряда нет.

**Tech Stack:** Django/DRF/PostgreSQL, Python urllib, Ollama /api/chat structured output, Next/React/TypeScript.

**Spec:** ../specs/2026-10-21-role-workflows-and-chief-assistant.md

## Global Constraints

- Существующий RBAC, назначение старших и текущие проверки области обязательны.
- Начальник HEAD_OPS_UNIT не получает forces.command автоматически.
- Модель предлагает только ограниченную структуру, не URL/код/SQL/права.
- Повтор с тем же ключом и телом возвращает исходную задачу/результат; другое тело —409.
- Не придумывать осмотр, отметки чек-листа, старших, подписи или подтверждения.
- Тестовые БД изолированы от сохранённой учебной базы и Digital Twin.

## Review Focus

- Истёкшее/отозванное право между подготовкой и выполнением проверяется заново.
- Модель выдала чужой ID, несуществующий объект или неоднозначное название: записи нет.
- Повтор после сохранения/timeout не создаёт второй бюллетень/запрос.
- Готов один объект из нескольких: черновые соседние посты не считаются опубликованными.
- Chief→staff задача не открывает чужим scoped пользователям текст и детали ОМ.

### Task 1: Ограниченное понимание задачи

**Files:** Create ops/assistant/__init__.py, provider.py, planning.py, tests/test_ops_assistant_planning.py (under organization_management/apps).

**Interfaces:** `interpret(message: str) -> dict`, `validate_proposal(value: object) -> dict`, `resolve_plan(proposal: dict, *, actor_id: str) -> dict`. Plan fields: title/businessDate/kind/objectId/eventId/allocations/intent/questions; provider never returns authoritative IDs or actor.

- [x] Write RED tests for malformed/extra keys, bool/float counts, ambiguous dates, unavailable provider, missing facts and names resolved only to real catalogs.
- [x] Run `pytest .../test_ops_assistant_planning.py` on isolated DB; expected failing import/assertion.
- [x] Implement urllib local-only provider with time/size bounds and strict proposal validation; deterministic fields remain usable if model unavailable. Unknown fields rejected, no inferred chief/checklist/approval.
- [x] Run same suite; expected PASS. Record RED/GREEN and provider protocol reference.

### Task 2: Durable authenticated execution

**Files:** Create operations/models_assistant.py, migration0146_om_assistant_tasks.py, ops/assistant/execution.py, ops/assistant/access.py, ops/api/views_assistant.py, tests/test_ops_assistant_api.py; modify operations/models.py and ops/api/urls.py.

**Interfaces:** `OpsAssistantTask` UUID, initiator/request-key/hash/message/plan/event/status; `OpsAssistantReceipt` unique task+operation-key, executed_by/payload-hash/result. API `/api/ops/assistant/tasks/`, detail, `continue/`; catalogs/config read. Run adapter allowlist create/retrieve/forces_split only. `draft` always explicit.

- [x] RED actual JWT tests: chief creates one bulletin, cannot send; global staff resumes; body spoof denied; foreign task404; scoped command cannot read queue; revoked permission blocks; no metadata facts produces no event.
- [x] RED retry/conflict/atomic rollback tests, preserving frozen base requests, groupDemandIds and top-ups. Existing event is read through current event boundary before linked-task writes.
- [x] Implement server tasks with same key+same payload receipt, row locks, original auth re-dispatch and current manual gates. No test authentication facilities in product. Keep external model call outside DB lock.
- [x] Return status/questions/actual event progress and IDs, queue only to global eligible staff, visible no-recipient condition. Expose actual send delivery report from matching audit receipt; never claim delivery on HTTP success alone.
- [x] Run isolated API tests and `makemigrations --check --dry-run`; expected PASS/no changes. Record results.

### Task 3: Рабочий экран помощника

**Files:** Create features/om-assistant/{model.ts,api.ts,workspace.tsx}, app/security-ops/assistant/page.tsx, scripts/tests/om-assistant.test.cjs, e2e/om-assistant.spec.ts; modify sidebar.tsx, entities/portal-access/index.ts, events/page.tsx, gate-front.mjs.

**Interfaces:** Same API contract as Task2. Page gates event.create/event.manage/forces.command via canonical module map. Current task persists in URL. Stale permissions hide old results through protected read/write authority hooks.

- [x] RED tests for honest waiting states, operation receipts, intent/required fields, no auto-send on ambiguous input, preserved requestKey on network retry and reset only for new task.
- [x] Build readable text-first workspace: input/example, compact step progress, editable missing fields/allocations, saved document links, staff queue and current actor's next action. Show local model availability without transport jargon in business flow.
- [x] Add helper entry beside OM creation and menu. Existing event form and recon remain available.
- [x] Run focused node tests and tsc; expected PASS. Add assistant suite to gate.

### Task 4: Сквозная проверка и локальный runtime

**Files:** Isolated runners/artifacts in .local-review/project-audit-20261021 and .build, existing local launcher/compose, canonical vault journal/tasks/handoff.

**Interfaces:** New migrations and app images, existing retained database and backup process.

- [x] Run actual local model extraction for Russian chief task and missing/ambiguous facts. No real personal data sent to model.
- [x] Run frontend full gate and backend regression suite on isolated PostgreSQL; migrations check must be clean.
- [x] Create isolated app/browser fixture and run chief→staff→department request demonstration with actual JWT/API outcomes and repeat proof; role analytics/archive reads with no unauthorized writes.
- [x] Review complete diff with fresh reviewer, fix meaningful findings with RED/GREEN, then validated local image/backup/rehearsal update preserving monthly training data. Production/DT unchanged.
- [ ] Update canonical docs with paths and only actual verified outcomes; continue ranked consistency work until09:00 local as requested.

### Task 7: Осмысленное действие помощника и ручная передача ответственности

**Files:** frontend features/om-assistant/{api.ts,workspace.tsx}, scripts/tests/om-assistant.test.cjs, existing 8 mocked e2e/om-assistant.spec.ts; backend assistant canContinue calculation/tests owned by coordinator. Audit evidence: .local-review/project-audit-20261021/assistant-handoff-review.md.

**Boundary and ruling:** Coordinator accepted the generic no-op continuation as a bounded P2. `canContinue` means a meaningful POST without fields for this current actor: true only for global headquarters, intent send, ready current event with published reconnaissance, no missing questions/send receipt, and a nonclosed event. False in reconnaissance waiting, after dispatch, manual prepare, chief awaiting headquarters, unavailable or completed states. Frontend offers the operation only for explicit true; fields corrections use `canEdit` independently. Exact-request retry and API idempotent replay remain available after an uncertain write. Existing event/forces links and refresh remain. Manual reconnaissance, personnel selection, post assignment and signatures remain with their actual role owners; no grant expansion.

**Separate decision:** Missing/ambiguous active force campaign is documented as a specific W11 handoff prerequisite. Campaign auto-creation or a new assistant campaign operation is not authorized by this task. Prompt display/title limits remain deferred.

- [x] RED: DOM waiting-recon/responses/collecting/approval, chief versus staff, and manual prepare prove the misleading continuation; writer proves canContinue=false must still permit authorized fields and missing flag must not grant a no-fields write. Observed27 PASS/8 FAIL; assistant-action-red.log.
- [x] GREEN: hide inapplicable continuation; label eligible action as sending under the current actor; keep refresh/domain links and canEdit corrections; preserve captured-payload retry after flag changes.
- [x] Run focused assistant and adjacent Node suites, TypeScript and diff check; observed36 assistant +57 adjacent =93/93 PASS; tsc --noEmit --incremental false and diff check PASS. Canonical journal records the bounded ruling and pending image-specific browser check.
- [x] Run the existing8 mocked assistant browser scenarios on the next coordinator-confirmed frontend image. Previous11-case PASS covers only the earlier image81b440…/snapshot88a8de, not this change. No new live role login before final readiness.

### Task 8: Явная подготовка распределения перед подбором физического наряда

**Files:** backend ops/force_campaigns.py shared active-campaign query, assistant/execution.py read projection, assistant API tests; frontend assistant model/card and focused/browser tests. Existing campaign write endpoints and permissions stay unchanged.

**Interface:** task has optional read-only gathering context: null when reconnaissance is unpublished, event unavailable or the task has reached placement/approval/completion; otherwise {state: missing|ready|ambiguous, campaignId: string|null}. Ready means exactly one DRAFT/GATHERING/DISTRIBUTING campaign contains the authenticated readable event, using the same source as physical reserve selection. Only global headquarters receives its ID/link; chief sees only the factual preparation state. Client fields cannot write this context.

**Ruling:** the confirmed W11/P2-B prerequisite is made factual and reachable. No campaign is automatically created or chosen. Headquarters uses the existing generic campaign workspace/create entry; an existing unique campaign is reused by link. Numeric department offers may proceed while headquarters prepares the physical reserve, so this adds no new dispatch blocker and does not change department/directorate grants. The UI must not claim physical selection is ready when no unique active distribution exists. Special groups and already completed manual stages retain their existing workflow.

- [x] RED actual JWT read tests: no active campaign, exactly one, ambiguous two, chief ID redaction, permission loss, unpublished/handed-over state; verify no campaign creation and no new receipt/business mutation during reads.
- [x] Implement shared factual read and task projection without changing the physical selection invariant or adding an assistant write operation.
- [x] Frontend RED/GREEN: explicit headquarters preparation notice, role-aware generic workspace/unique campaign links, chief handoff text, ready state and unknown legacy metadata. Preserve dispatch, correction and replay. Actual RED36 PASS/5 FAIL in assistant-gathering-frontend-red.log; GREEN41 assistant +57 adjacent =98/98 PASS in assistant-gathering-frontend-green.log; tsc --noEmit --incremental false and diff check PASS. The same8 mocked assistant scenarios now cover chief missing/ready/legacy/null, HQ missing/ambiguous/ready links and Task7 no-op suppression; execution awaits the next confirmed image. No campaign write or automatic creation was added. Frontend edits are limited to the read type, task card, and focused/browser tests; coordinator owns backend projection.
- [x] Extend real clone walkthrough with separate manual headquarters campaign creation and a physical-reserve selection path; retain the chief/staff/department request/repeat proof.
- [x] Repeat appropriate backend/frontend checks and final immutable full run/build/browser before local integration.

### Task 9: Модель не задаёт непрошенный срок заявки

**Finding:** assistant-model-optional-fields-audit.md proves a malformed model HTTP response can carry manual-only `allocations[].dueAt` through provider, both grounding passes and actual chief-JWT→staff-JWT dispatch. The Ollama schema excludes it; this is a local boundary gap, not evidence of a live Ollama schema violation or an authorization bypass.

**Ruling:** keep only schema-supported departmentName/need in model-grounded allocation rows after validation and before pair-evidence grounding. Retain valid recipient/count pairs. Explicit human `fields.allocations[].dueAt` follows existing validation/make_plan/manual sender unchanged; absent deadlines follow existing domain policy. No API/schema/role/model generation changes. User's autonomous correctness work authorizes the bounded fix without another approval stop.

**Files:** assistant/planning.py and new focused actual-JWT test_ops_assistant_model_fields.py. Earlier7542PASS/1SKIP full result is preserved as the previous exact backend snapshot; the changed backend requires a new full run and image before integration.

- [x] RED: replace only model HTTP, create chief task and send as staff with real JWT/manual redispatch; unsupported deadline must be absent from task and actual request. Positive explicit human deadline remains persisted.
- [x] GREEN: model-only projection, preserve authenticated execution and manual deadlines; run all assistant/campaign/scope regressions.
- [x] Capture/rebuild changed backend, rerun immutable full suite and migration dry-run; final frontend1c0a2f… remains unchanged, its build/browser verification binds that exact frontend image.
- [x] Repeat normal clone workflow/role checks as needed for changed model boundary, finalize guarded local update only after exact-release acceptance; keep monthly training data.

**20:43 verification checkpoint:** Task7/8 browser15/15+75/75 PASS on exact final images;
Task9 RED/GREEN150/150 and exact original135→137 migration PASS. Final full run2
is pending; guarded local3380 application and post-update preservation are pending.

**20:50 local integration:** finalfull7544/1skip,668gate,15+75browser, exact-original
135→137 rehearsal and guarded localapply PASS. Oldbusiness/media/private/volumes and
monthly166/1240/4960 preserved after startup. New readonly follow-ups remain separate.

### Task 10: Исправления человека действительно применяются до привязки бюллетеня

**Evidence:** assistant-recovery-followup.md RF-01/RF-02. Source-chain P2 findings accepted by coordinator as new scope; earlier reviews remain closed. Existing locally installed82c/ce51 core release and its evidence remain valid and unchanged until a separately verified recovery release is ready.

**Ruling/design:** explicit human field updates use current server canEdit; no-fields execution still requires canContinue. A durable unbound task whose mistyped event ID yielded404 can be corrected by its authorized initiator. A bound unreadable event remains canEdit=false; existing backend ownership/receipts/immutable/deleted-event checks stay unchanged. Clearing the optional object in the manual pre-bulletin editor sends objectId:null; omission remains the backend's partial-update preserve semantic. Do not add null overrides to text interpretation that would discard a valid model object. No new rights, business workflow, actor linkage or model behavior. Autonomous correctness work authorizes this bounded recovery fix without another approval stop.

**Files:** frontend features/om-assistant/{api.ts,model.ts}, existing scripts/tests/om-assistant.test.cjs and existing e2e/om-assistant.spec.ts; focused actual-JWT contract cases in existing backend test_ops_assistant_api.py. Backend product code unchanged. Source snapshots only outer.build; preserve the installed release's receipts rather than overwriting them.

- [x] RED actual writer/model behavior for editable-unbound correction and cleared object; retain bound denial/no-fields/retry/interpretation controls.
- [x] RED/GREEN bounded frontend fix; actual-JWT contract proves durable404 task is recoverable through authorized API and object null clears versus omission preserves. No backend authorization relaxation.
- [x] Focused/neighbor Node and TypeScript; fresh bounded independent review. Run updated existing recovery browser scenarios on a new exact image, plus archive/date/live-entry acceptance.
- [x] Separate immutable source/full/gate/build/rehearsal acceptance before local frontend/backend refresh; preserve all business data/monthly training and original core proof. Record actual outcomes; remaining autonomous work continues through Task11 and Task4 until09:00.

**Worker checkpoint20:59:** RF-01/RF-02 RED44PASS/2FAIL→focusedGREEN46/46; six-file neighboring Node110/110PASS4.17s; TypeScript/diff-checkPASS. Three new actual-JWT contract functions plus existing API/review25/25PASS32.87s on isolated audit_task10_contracts_20261021; backend product unchanged. Existing browser8→10 includes the two UI/capturedpayload recovery scenarios but was NOT executed by worker. Root owns fresh review/exact-image browser/build/full/integration. Report: assistant-recovery-followup.md Task10 appendix;5file manifest assistant-recovery-task10-source.sha256 SHA256 DC9DCAC5AD1354BE4B04A9C9053C936A862D0602E1FF3FD7C90DA24B99CA6153.

**Task10 browser contract correction (21:40):** exact bf57/1f8 browser run reached16/17; the new404-recovery case stopped at a strict locator matching both the real error and Next's empty route announcer. Actual error context confirms the correct product message. Accept one test-only assertion correction: select the alert containing «Мероприятие не найдено». Preserve the failed run and successful bf57 native75/paired-materialsGREEN/archive6 evidence. Product files and backend remain unchanged by this correction. Capture a separate final source, rebuild frontend, rerun current-source contracts and final17/75/pairedGREEN/archive6 before local update. Backend full7547/1skip remains exactc0; its frontend carry is now the four accepted materials files plus this single e2e assertion, explicitly checked by the new snapshot action and guarded whitelist. No broad product review is reopened.

### Task 11: Проверка полного учебного наряда после сбора резерва

**Purpose/design:** Continue the user's existing chief task through the actual manual responsibilities, rather than treating reserve selection as post placement. Read-only source/evidence preparation is recorded in `.local-review/project-audit-20261021/reserve-to-placement-followup.md`; it found no new P1/P2. This is acceptance work on the existing synthetic clone, with no product changes or model-generated people/signatures. The installed working monthly training and production/DT are outside this fixture.

**Boundary:** Preserve event63/campaign8/object7 and its existing post/need10. Add only the four missing synthetic D2 people and scoped demo accounts/bindings where needed, obtaining generated IDs from actual responses. Use ordinary JWT/manual endpoints for D2 response/split/selection, headquarters campaign assignments/handover, object-chief placement and actual bound demo approvers' sequential decisions. Never substitute admin override for a missing manual step. Approval-route preparation, if required, is explicitly synthetic and recorded separately. Existing accounts' passwords and real employees remain unchanged. New runner/evidence only in ignored `.local-review`; do not alter existing immutable release proofs.

- [x] Prepare a bounded driver/prerequisite inventory; wait for root READY after exact recovery browser acceptance/local integration before any clone fixture write. Read-only discovery may continue independently.
- [x] Complete D2 four-person reserve and all ten headquarters assignments/handover; verify distinct reserve10, final statuses10 and roster10 against published need10.
- [x] Complete ten post placements and the configured manual approval route with ordinary scoped demo JWTs; record actual final stage, refusals, snapshots and sequential decisions. Do not claim unavailable signatures or unfinished stages.
- [x] Verify meaningful replay/foreign-actor guards without duplicate assignments/signatures, preserve all pre-existing business rows outside the exact synthetic fixture, and update canonical docs with actual outcomes.

**Task11 prerequisite ruling (21:41):** use four new ordinary scoped synthetic accounts, four new D2 reserve employees plus one separate synthetic HEAD candidate. Do not use/reset existing users39/32/64/69 or rebind them to invented personnel. Only in the disposable clone, the existing settings.manage UI actor may replace global approval-template rows12/13 through the normal settings API with two synthetic signer rows. Preserve exact before/after and returned new IDs; do not promise old-PK restoration. These two rows are an explicit intended fixture exception alongside event63/visit47/campaign8; every other pre-existing row remains protected. New independent StaffUnit roots are append-only setup with old-row hashes preserved; all duty/placement/signature business actions use ordinary JWT/manual API. Writer preparation is authorized now; actual writes still wait for ROOT READY after final browser acceptance/localapply and a fresh quiet baseline.

**Task11 runtime defaults ruling (22:01):** first authorized apply stopped after fixture and before JWT/business API. All old rows in137 tables stayed identical; only4 new accounts,5 Employees/StaffUnit and their normal5 legacy `in_service` statuses plus5 CREATED history rows were added. Source/snapshot diagnosis is `runtime-default-status-followup.md`. Accept one bounded ownership extension for exact Employee5194→status6485→history7836 through5198→6489→7840: signed v2 descriptor binds fixed21Oct date, exact PostgreSQL row hashes/timestamps, null system authors, default field shape and one-to-one links. No table exemptions, signal suppression, new fixture or baseline replacement. Preserve original attempt/credentials/READY; root signs a new descriptor/source revision and resumes the same run against the original baseline after targeted review. These5 defaults are separate from the required10 final `IN_EVENT` statuses. Chief69 may only read its own original task with existing credentials; no business write/reset/rebinding is permitted.

**Task11 ledger ruling (22:14):** guarded v2 resume reached ordinary auth/settings and D2 response4, then correctly stopped on NEW department-ledger snapshot68. Full16-stage read-only source checklist in `runtime-forces-ledger-followup.md` proves exactly3 additional NEW classes: D2 department snapshots seq2/DRAFT68 and futureseq3/NOTIFIED;4 unit snapshots19/22/25/28 with needs4/0/0/0 whose provenance remains68/seq2;4 new physical reserve members attached to the actual NOTIFIED snapshot. Accept one bounded semantic extension with exact event63/force_request43/visit47/allocation/department18/due/count/FK/phase/cardinality and pool membership checks. Generated future PKs are derived from actual rows; no invented latest-parent link. Source/12 row hashes prove old D6 pool17..22 and members37..42 do not change, so the old-row guard receives NO new exceptions. Defaults/10 IN_EVENT relations remain separate and strict. Preserve original baseline/run/fixture/private credentials and both prior READY artifacts; new source/review/READYv3 required before resume. No product changes or additional grants.

### Task 12: Начальник видит вход к поручению на домашнем экране

**Product ruling/design:** Promote the previously deferred W10 design B after the verified role/assistant recovery release. The user's readability request and autonomous work authorize this small presentation choice. Evidence/design is `chief-entry-followup.md`; this is a new product priority, not a reopened permission finding. Add one compact «Работа по ОМ» block below the existing `/statuses` header. Main link opens the existing assistant to create/continue a task; secondary opens the ordinary event registry when separately permitted. Explain that the task shows the next step and linked event. Use current capability/module guards; unknown or missing assistant access hides the block. Do not infer personal event ownership from names/canEdit.

**Files:** only frontend `app/statuses/page.tsx` and new `features/om-assistant/home-entry.tsx`. No new queries/counts, routes, home redirects, roles, service logic, auto-create/send or changes to staff/department default entry. Preserve calendar/statusDate, expense businessDate and personnel controls. Keep the block compact at1440/390; wrap long action text instead of overflow. Task11 remains independent API verification of the currently installed backend.

- [x] Implement the two-file presentation change and run existing portal/assistant/access neighbors plus TypeScript/diff check. No new wording/markup-mirroring tests for this reversible low-impact block; verify actual positive/negative capability states in the existing isolated browser acceptance instead.
- [x] One bounded P1/P2 review, separate exact frontend snapshot/gate/build and frozen frontend-contract checks. Backend c0/image1f8 remains unchanged and may carry only with exhaustive accepted frontend delta and exact evidence.
- [x] Verify real role home entry and1440/390, existing assistant/analytics/role/archive behavior on the new image; guarded local update with fresh backup/data preservation and canonical docs. No browser/DB activity may overlap Task11 writes without a root window.

**Task12 local outcome:** exactly two FE files: statuses imports/renders the new compact home-entry immediately after PageHeader; the new component receives already checked host permissions, adds no hook/query and uses current moduleOpenFor for assistant plus separate event-registry visibility. accessReady=false or absent assistant capability hides the whole block; event.view alone remains insufficient. The approved copy points to a task's next step/linked event without claiming a personal event list or adding a redirect/write. Existing9-file portal/assistant/access/date neighbors142/142 PASS,0fail/0skip; fresh tsc --noEmit --incremental false and diff-check exit0. No new tests or fixture edits. CSS permits wrapped action text at narrow widths; actual1440/390 and positive/negative DOM/browser acceptance remain coordinator work after bounded review/freeze/build. Task8's4 source hashes unchanged. Report/two-file manifest: `.local-review/project-audit-20261021/chief-home-entry-task12-*`. No API/DB/browser/full/build/image/runtime/backend/commit activity by worker; source stable for coordinator capture.

### Task 13: Фактический этап ОМ виден после завершения подготовки

**New evidence/design:** `assistant-linked-stage-readability-followup.md` ALS-01 P2 is a separate observation from the completed Task11 and actual Task12 screenshot. Bound chief/staff GET already contains completed preparation plus event63 stage ACKNOWLEDGEMENT. The badge correctly describes the assistant's preparation boundary; the prominent permanent placement=current marker contradicts the linked stage, which is currently hidden in collapsed details. No backend/stored stage/signature defect is alleged, and closed reviews remain closed.

**Bounded choice:** retain the preparation badge and ordinary event-card actions. Show the already available known linked event stage in the main summary. Placement is current only for an actual PLACEMENT stage and done only when a known subsequent stage proves it was passed; completed/awaiting_approval status alone must not invent placement/signatures. Unknown/null stage is neutral and asks the user to check the event card; event_unavailable must not reveal hidden event information. Preserve earlier preparation steps, owner/capability rules, receipts, counts, query/API behavior and the manual signature boundary. No new request, field, role, grant, automatic action or backend edit. The user's ongoing correctness/readability instruction authorizes this routine follow-up without another permission stop.

**Files after root source window:** frontend features/om-assistant/model.ts and workspace.tsx; extend existing scripts/tests/om-assistant.test.cjs using the real model/TSX. No new suite/gate entry or Task12 home-entry edit. Current Navigation source stays frozen until its actual browser/local update/monthly/postdeploy is complete. An independently discovered route-tour product finding may be batched only after its own concrete evidence/design ruling.

- [x] After Navigation installation/preservation, RED actual completed+ACKNOWLEDGEMENT, awaiting_approval+APPROVAL, positive placement+PLACEMENT and completed+unknown/null fixtures. Assert real aria-current behavior and visible linked-stage summary; preserve no false signature/event completion and event-unavailable controls.
- [x] GREEN bounded presentation change; existing assistant/access/workflow neighbors, fresh TypeScript and diff check. One bounded independent P1/P2 review and frozen source manifest against Navigation.
- [x] Separate exact frontend gate/build/current contracts and new-image targeted stage/1440/390 checks plus existing assistant/role/archive regressions. The accepted role-workflows Task11 now changes six backend files: use the new combined immutable BE+FE full run and new backend image; c0/1f8 proofs remain historical. Extract the184 current frontend contracts from the new passing full JUnit rather than repeating them separately.
- [x] Guarded local update with fresh backup, unchanged monthly training/business/files/volumes and actual postdeploy check; update the canonical vault with observed results. No production/DT/Task11 replay or external publication.

**Task13 coordinator integration01:12 Oct22:** installed primary3380/API18380 at20:09:00UTC: BE/worker1a0/source192a, FE7cd/source6fde, exact2251 files. New full7572PASS/1knownoptionalSKIP/9warnings1907.88s, before/after Linux hashes unchanged;184 current contracts from same JUnit, no separate contract rerun. Actual frontend758/64/type/Next; original135→137/clone137→137 preserve old rows. One new-image browser exit0 UI9/spec17/native75/archive6, aggregate12/12/17artifact hashes/4child exits0/49layouts0overflow. Root personally reviewed4current1440/390PNG. Task11 event63 autoallocated10/requested10/ALLOCATED and event-specific deficit0; roster10/placements10/ACK/two signatures/v1 unchanged, no business replay. Fresh quiet backup1506946bytes SHAe5d68625785257e4ac07f2de401c2bd873bf28b5317ba738e5d2a6f1cc64fcbb;137tables/media/private/volumes/startup preserved/0newtables/4HTTP200. Primary root inspect6services healthy/current images, training-after verify-only166/1240/4960, existing-admin postdeploy7/7/44reads/1login/0errors/4layouts0overflow. Canonical vault updated; original work continues until09:00 local, no new source pass without accepted finding.

**Task13 source outcome23:56:** exactly model.ts/workspace.tsx/existing om-assistant.test.cjs frozen; canonical STAGE_ORDER/STAGE_LABEL reused. Initial RED57=47PASS/10FAIL, legacy-neutral RED59=57PASS/2FAIL, final GREEN59/59; neighbors76/76, fresh tsc/diff exit0. Thirteen added registrations, no new suite/API/query. FINAL SOURCE FREEZE manifest SHA aa3f3e366992dc682b99d85dd6945c1c4eebac9ecf69ff151c2d2e46021354f0; independent ASSISTANT-STAGE CLOSED. Full frontend758/64 is still expected, not executed. Combined release is on HOLD for role-workflows CAR-01 concurrency fix/recheck; no new snapshot/build/runtime/install yet.
