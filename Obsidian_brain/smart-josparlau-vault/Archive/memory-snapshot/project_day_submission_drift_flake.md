---
name: project-day-submission-drift-flake
description: Pre-existing vitest failure in DailyUpdatePage.test.tsx (day-submission-drift testid) unrelated to Button.tsx contrast fix
metadata: 
  node_type: memory
  type: project
  originSessionId: 736602c6-85c4-4ae3-acf3-d4908b36e0c6
---

`src/features/daily-grid/DailyUpdatePage.test.tsx:1191` (`day-submission-drift` testid, `waitFor(...).not.toBeInTheDocument()`) fails 2/34 tests in that file on worktree `exciting-vaughan-3e478b` (branch `claude/gifted-hertz-ebe729`), both with and without the Button.tsx hover-contrast fix applied (verified via `git stash`/`stash pop` A-B test).

**Why:** confirms it's a pre-existing flake/bug in that file, not a regression from any Button change — distinct from the already-known [[project_tz_flake_vacancies_test]] and [[project_test_full_concurrency_teardown]] flakes.

**How to apply:** when `npm run gate` fails only on this test in this worktree, don't block unrelated work on it — it needs its own investigation (looks like a timer/waitFor race around day-submission drift banner dismissal).
