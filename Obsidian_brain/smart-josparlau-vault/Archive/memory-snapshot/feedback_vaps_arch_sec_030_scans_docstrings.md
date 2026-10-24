---
name: feedback_vaps_arch_sec_030_scans_docstrings
description: "Гвард ARCH-SEC-030 ловит литерал заголовка X-User-Id в ДОКСТРИНГАХ и help-текстах — сканирует ast.Constant, не только код"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6a56d3fd-b598-4d5e-995b-bcee8cdbedb0
  modified: 2026-07-19T21:00:01.817Z
---

`apps/core/tests/test_isolation.py::test_x_user_id_literal_only_in_core_auth`
собирает ВСЕ `ast.Constant`-строки файла — то есть докстринги модуля/метода и
`help=`-тексты `add_arguments` тоже. Скоуп — `apps/**` + `config/**`, кроме
`apps/core/auth/` и путей с `tests` в частях. Ловит обе формы: `X-User-Id` и
`HTTP_X_USER_ID` (нормализует регистр и дефис→подчёркивание).

**Why:** дев-проход 10.10 упомянул заголовок в прозе новой management-команды —
`make gate` покраснел на ровном месте. `seed_e2e_lagging` (11.6) уже обходил это
формулировкой «уезжает идентифицирующим заголовком», то есть грабли повторные.

**How to apply:** в Python под `apps/`/`config/` называть заголовок описательно
(«идентифицирующий заголовок»), литерал не писать даже в комментарии. Во
фронт-коде литерал законен — гвард туда не смотрит. Смотри
[[feedback_vaps_arch_guards]].
