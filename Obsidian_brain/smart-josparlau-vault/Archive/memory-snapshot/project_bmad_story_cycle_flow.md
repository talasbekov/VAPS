---
name: bmad-story-cycle-flow
description: "Подтверждённый Bratan конвейер стори-цикла VAPS — коммит-канон, graphify, baseline, same-model caveat"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3e695685-bf43-4f27-9c17-db0c7d7a1c7d
---

Конвейер стори-цикла VAPS (E5, подтверждён Bratan 2026-07-02 полным проходом 5.8b→5.8c→5.9): `sprint-status` → `code-review` висящей review-стори → патчи применяются по выбору «1» → стори done → **feat-коммит стори** → `create-story` следующей → `dev-story` → `code-review` → снова коммит.

**Why:** цикл шёл без единого уточняющего вопроса — выбор «1» в меню каждый раз означал «продолжай конвейер», включая пререквизит-коммиты.

**How to apply:**
- Коммит стори — ПОСЛЕ code-review (канон «Артефакты НЕ закоммичены» до ревью): `feat(E5): X.Y … + code-review` + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; в коммит входят код+тесты+стори-md+sprint-status+deferred-work.
- `graphify update .` (AST-only) после значимого изменения app-кода → ОТДЕЛЬНЫЙ `chore(graphify): …` коммит (стори-коммиты graphify-out не включают — проверено по истории).
- `baseline_commit` в frontmatter следующей спеки = SHA HEAD на момент старта dev-story (спека создаётся с TBD, если предыдущая стори ещё не закоммичена); сама спека остаётся untracked до feat-коммита СВОЕЙ стори.
- Ревью: 3 слоя (Blind/Edge/Auditor) параллельными агентами; дифф для Blind — в scratchpad-файл (экономия контекста); отмечать **same-model caveat**, когда dev и ревью — одна модель; активити-ноты sprint-status ротируются (last → prior).
- Связано: [[vaps-arch-guards]], [[vaps-ruff-format-scoping]], [[test-full-concurrency-teardown]].
