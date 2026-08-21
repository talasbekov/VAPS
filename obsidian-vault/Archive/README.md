---
title: Archive
module: archive
updated: 2026-08-21
tags: [archive]
---

# Archive

Снапшот старых источников документации на момент миграции в Obsidian vault (2026-08-19) и переезды консолидации (2026-08-20).

- `memory-snapshot/` — копия `/home/erda/.claude/projects/-home-erda--------VAPS/memory/*.md` (120 файлов) на дату миграции. Оригиналы НЕ удалены и харнесс может продолжать писать в них общие (не VAPS-специфичные) записи — см. корневой `CLAUDE.md`.
- `api-gaps-snapshot.md` — копия `docs/api-gaps.md` (1217 строк) на дату миграции. Оригинал НЕ удалён, но новые записи в него больше не добавляются — см. соответствующие `Known-Issues.md` по модулям.

Добавлено консолидацией 2026-08-20 (бывший `_bmad-output/` и устаревшая часть `docs/`):

- `bmad/planning-artifacts/` — PRD (10.06.2026), architecture, epics, UX-брифы, reconcile-отчёты. Целились в выведенный 12.08.2026 стек `Backend/VAPS`, отстали от кода на ~70 дней (не знают рейтинги, ГВО, боевые группы, аналитику); ценность — история решений (12 CCC, FR-разбиение).
- `bmad/implementation-artifacts/` — 137 стори-логов выполненной работы; истинный статус — в git-истории.
- `bmad/brainstorming/` — сессия 25.05.2026.
- `docs-concepts/` — ТЗ VAPS (superseded по R6), концепты PersonnelStatus/VisitX, brainstorming-сессия, PROJECT_DOCUMENTATION (as-is легаси-донора), TECHNICAL_AUDIT (снимок до перестройки).
- `ops-backend-plan.md` — план `/api/ops/*` (14 групп A–N); исполнен целиком, конспект в [[../Personnel-Records/Decisions|Personnel-Records/Decisions]].
- `superpowers-plans/` — выполненные планы 06.2026 (core-foundation, operations-rbac, fix-broken-tests).

Добавлено уборкой 2026-08-21 («в живом слое — только актуальное»):

- `bmad-process/` — бывший рабочий раздел BMAD-Process (Status/Changelog/Decisions/Known-Issues): стори-цикл спит с разворота 10.08.2026, changelog целиком — история эпиков удалённого стека. Возвращается из архива при возврате к BMAD.
- `spa/` — конспекты демонтированной SPA ([[spa/Архитектура-SPA|Архитектура-SPA]], [[spa/Тестирование-SPA|Тестирование-SPA]] — на их месте в `Frontend/` теперь актуальные доки PersonalRecordFront) и [[spa/Справки-удалённого-стека|Справки удалённого стека]] (вырезки из Infrastructure/Status и Known-Issues).
- `sessions/` — закрытые сессионные журналы и отчёты сверок ([[sessions/Ночная-смена-2026-08-20-21|ночная смена 20→21.08]], [[sessions/Сверка-прототип-код-2026-08-21|сверка прототип↔код]]); активный хендофф остаётся в `WIKI/`.

Это архив, не источник правды. Актуальное состояние — в `Status.md`/`Decisions.md`/`Known-Issues.md` каждого модуля.
