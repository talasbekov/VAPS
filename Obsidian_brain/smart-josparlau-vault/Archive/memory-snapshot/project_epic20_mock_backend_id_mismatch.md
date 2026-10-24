---
name: epic20-mock-backend-id-mismatch
description: "security-events (Smart Josparlau) is entirely mock-first with its own ID space; Epic 20 dashboard endpoints hit the real backend and never resolve against mock-created events — wiring stories must degrade honestly, not fake success"
metadata: 
  node_type: memory
  type: project
  originSessionId: 930dca3b-bd43-416a-b0a4-e3659f5db7e7
---

`frontend/src/features/security-events/` (CommandCenterPage/SecurityEventsListPage/SecurityEventDetailPage) is entirely mock-first — served by MSW at `/api/ops/security-events/...`, backend-contract-pending, no real backend rows exist for any event created there. Epic 20's dashboard/report endpoints (20.1a-e readiness, and likely 20.2-20.6's future API/frontend slices) hit the REAL backend (`/api/operations/...`). These two ID spaces never overlap — a mock-created ОМ has no real backend counterpart.

**Why:** discovered while writing Story 20.1e (wire `ReadinessPanel` into `SecurityEventDetailPage`). `frontend/src/app/mocks/browser.ts:24` sets `onUnhandledRequest: 'error'` — any real-backend path called from a mock-first page that isn't registered in `compose-handlers.ts` crashes MSW with an internal exception instead of degrading through the component's own error UI (same class of bug 19.4d hit for StatusCalendarPanel).

**How to apply:** for every future Epic 20 wiring story that mounts a real-backend-consuming component (selector→API→hook→panel chain) inside a mock-first `security-events` page:
1. Register a dev-mock MSW handler for the real path in `compose-handlers.ts` (own file under the feature's `mocks/`, separate from the mock-first CRUD handlers — mirrors the `readiness.ts`/`queries.ts` split established in 20.1c).
2. Default that handler to an honest 404/empty response — never fabricate success data for a mock event that doesn't exist on the real backend (§35 in this project's conventions: don't show success before real data).
3. Verify live in browser via `preview_start`, not just unit tests — MSW's browser `onUnhandledRequest: 'error'` is stricter than per-test `server.use()`, so a missing handler only surfaces there.
4. This is a standing limitation, not a per-story bug — until `security-events` gets real backend integration (unscoped, no story exists for it yet), every such dashboard component will permanently show "not found" in demo mode. Document it in Dev Notes each time, don't try to solve the ID-space merge inside a narrow wiring story.

See [[project_bmad_story_cycle_flow]] for the surrounding story-cycle convention.
