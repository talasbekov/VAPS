---
name: project_frontend_perfsmoke_virtual_flake
description: Пред-существующий флейк фронт-гейта — «window is not defined» из react-virtual в DailyGrid.perfsmoke; не регресс твоей стори
metadata: 
  node_type: memory
  type: project
  originSessionId: cfda91b0-75ad-453a-99fd-c53f37e31f7a
  modified: 2026-07-19T12:22:22.791Z
---

`npm run gate` во фронте VAPS иногда падает **не на тесте, а на unhandled error**: `ReferenceError: window is not defined` из `@tanstack/react-virtual` (`virtual-core/utils.js` → таймер виртуализатора срабатывает после сноса jsdom-окружения), источник — `src/features/daily-grid/DailyGrid.perfsmoke.test.tsx`. Все тесты при этом «passed», но vitest возвращает ненулевой код и гейт валится fail-fast до `vite build`.

Замерено на дев-проходе 11.4 (2026-07-19): изолированно файл зелёный 3/3; под полной нагрузкой ~1 падение на 5-6 полных прогонов; **воспроизведено на дереве ДО стори** (6 прогонов baseline → 1 падение), то есть латентная гонка существовала раньше.

**Why:** без этого знания следующий дев-агент увидит красный гейт на ровном месте, решит, что сломал что-то своё, и уйдёт чинить не туда — либо, хуже, объявит регресс и заблокирует стори.

**How to apply:** (1) увидел эту ошибку — **сначала проверь достижимость**: `DailyGrid.perfsmoke.test.tsx` импортирует только `DailyGrid`, а `react-virtual` используется единственным файлом `DailyGrid.tsx`; если твоя стори туда не входит, это не твоё; (2) подтверди перезапуском гейта и, если нужна строгость, прогоном на откаченном дереве (бэкап `cp`, не `git checkout` — [[feedback_red_probe_backup]]); (3) не чини походя, если `features/**` вне скоупа стори — адрес deferred-work / отдельная стори гигиены тестов. Родственный, но ДРУГОЙ сюжет на бэке — [[project_test_full_concurrency_teardown]]. Гейт гонится из `frontend/` — [[project_vaps_gate_location]].
