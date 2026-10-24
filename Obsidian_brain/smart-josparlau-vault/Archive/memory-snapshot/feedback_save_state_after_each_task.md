---
name: feedback-save-state-after-each-task
description: "Bratan always starts a fresh session — persist full resumable state at the end of every completed unit of work, not just when asked"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 614e0f65-70de-4fd3-bd20-95561f8e0a90
---

After finishing any complete unit of work (a feature slice, a story, a fix —
anything with a clear "done" boundary), save resumable state BEFORE ending
the turn, without waiting to be asked.

**Why:** Bratan does not continue long-running work in the same session — he
starts a brand new session for the next increment. If state isn't persisted
at the end, the next session has to rediscover context from scratch (or
worse, drifts/repeats work). This was already the de facto pattern for
Smart Josparlau frontend work ([[project-smart-josparlau-frontend-state]])
but is now an explicit standing instruction, not just an observed habit.

**How to apply:**
- Commit the actual work (code + tests) once it's green — per-project commit
  conventions already covered by [[bmad-story-cycle-flow]] for BMAD flows.
- Update whatever the project's own "progress ledger" docs are (for Smart
  Josparlau: the 8 `docs/frontend/*.md` files — PROGRESS/DECISIONS/
  TRACEABILITY_MATRIX/TEST_MATRIX/MOCK_API_CONTRACT/ROLE_MATRIX/ROUTE_MAP/
  SOURCE_INDEX). For other projects, look for an equivalent ledger before
  assuming none exists.
- Update the durable cross-session memory file for that piece of work (e.g.
  [[project-smart-josparlau-frontend-state]]) with: latest commit SHA(s),
  what's newly done, what's explicitly NOT done, and the concrete "how to
  resume" steps for a cold-start session.
- Do this even when the user hasn't explicitly asked "save state" this
  time — the instruction is standing, triggered by reaching a natural
  completion boundary, not by a per-turn request.
- Still follow [[feedback-full-story-cycle-no-midway-questions]]: don't stop
  to ask mid-task — the save-state step happens at the END of a completed
  unit, not as an interruption during one.
