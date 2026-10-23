# Task21 — readable organization diagram and retained Task20 messages

ROOT design before implementation, 22 October 2026, 06:03 Asia/Qyzylorda.

The user authorized readability, role workflow and UI improvements until09:00.
Task20 has NOT been installed: its V3 browser passed8 functional checks, but
ROOT personally viewed all20 screenshots and placed the package on VISUAL HOLD.
The primary3380 remains delivered Task19; the clone3480 contains Task20.
No acceptance, assembly, primary update or postdeploy run was performed for Task20.

## Actual problem and source boundary

ROOT geometry diagnosis confirms193 statistics rows preceding the diagram:
chartTop11703px desktop /12394px mobile. The natural diagram has scrollWidth67616,
scrollLeft0 and root-card x33937/33665, so the initial viewport contains no card.
Root-card heights1050/1862px also make the structure difficult to scan. The new
Task20 error paragraph is371.59px wide inside a358px mobile port and is clipped.
See organization-layout/root-geometry-diagnosis.json and the personally inspected
message-states/root-visual-hold-v3.json. These are separate from functional PASS.

Three production edits are allowed: OrgChart.tsx, OrgNode.tsx and
app/organization/page.tsx. Retain Task20's statuses/page.tsx message change.
Adapt the two existing e2e setups in org-structure-view.spec.ts and
org-structure-status.spec.ts to explicitly open the relevant new disclosure;
retain their current assertions/case counts. The source diagnosis identified
these existing assumptions before their edits; no new product dependency is needed.
The combined release therefore changes exactly SIX existing frontend files
against delivered Task19 FE121db9e3. Backend888f remains byte-identical;2252
product files/1283 backend/969 frontend, no product additions or deletions.
Record separately the starting canonical Task20 FE55421959 (five edits) and
the installed Task19 parent (six-file combined release). Never call Task20
an accepted release or relabel its source, screenshots or failed attempts.

## Intended behavior

1. Give empty/error content its own responsive full-width layout outside the
   intrinsic-width tree wrappers. Both heading and detail must wrap completely
   at390px. Keep the existing loading/error/empty distinctions and native retry.
   Hide the unknown-focus hint and disable tree actions while no tree exists.
2. Give the actual tree a bounded, labelled, keyboard-scrollable viewport.
   Identify the actual OrgNode Card with data-org-unit-id. Initial load, reset
   and explicit search/modal focus place that card inside its own scrollport.
   Reset must work even when the focused ID is unchanged. Resize maintains the
   selected node; ordinary user panning must remain possible without a mutation
   observer continually resetting scroll. Keep the converter, IDs, tree,
   expand/collapse behavior and real permission checks.
3. Keep the chief/head and exact staff/vacancy counts visible on each node.
   Put the existing employee list inside native details, closed initially.
   Only summary click stops propagation, without preventDefault; native mouse
   and keyboard disclosure work, while the existing card/modal/personnel link
   retain their behavior. Search still selects the person's unit; the person
   remains available through its disclosure/modal. Do not remount details on
   scrolling/resizing or discard people.
4. Show the diagram before the detailed statistics table. Retain all193 rows,
   paths, counts, zero/null behavior and nested-level explanation inside an
   accessible disclosure with a bounded scroll region. No API, query, scope,
   statistics calculation or staff data changes.

## Verification and delivery

- Preserve exact before copies and all Task20/Task19 proofs in the approved
  outer .build location. Do not alter the frozen85a8 role-workflows plan.
- Use the actual baseline geometry as RED. Check relevant existing source/SSR
  and Node tests and fresh nonincremental types; no tests that merely match CSS.
- Independently review the exact six-file combined source boundary, new
  helper/applier lineage and target-only browser preparation before runtime.
- Build once from a new2252-file snapshot. Run817/65 frontend gate/Next and
  fresh184 current contracts. Carry7572/known1skip only for exact unchanged BE;
  do not rebuild or rerun the unchanged backend full suite/Task11/model.
- On the new clone image verify all eight Task20 cases plus real diagram
  intersection, all message text bounds, empty/error disabled actions, focus
  after pan/reset/search/resize, native employee details and complete statistics
  disclosure. Capture targets only after their rectangles and surrounding
  asynchronous layout settle. Assert viewport intersection before each PNG;
  document-width0 overflow alone is insufficient. Mark client fixtures clearly.
- ROOT personally inspects every new PNG and records an honest machine/visual
  result. Preserve partial failures; investigate before any successor attempt.
- Only after actual acceptance, perform the native quiet backup/update3380,
  verify the166-person/1240-duty/4960-exit monthly plan and existing-admin entry.
  Preserve all137 business tables/rows/files/volumes and the single launcher.
  Production, Digital Twin, cleanup, publishing, commits and external messages
  remain outside this local package.

No new permission confirmation is needed: these changes are within the user's
active UI/readability instruction. Runtime descriptors remain ROOT-owned and
are issued only for reviewed concrete artifacts and exact observed images.
