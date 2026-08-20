# Frontend — Known Issues

_Открытые дефекты (перенесено из docs/api-gaps.md)._

_Миграция auto-memory (задача 4) не нашла в этом скоупе (`frontend/` — Vite/React прототип Smart Josparlau + `Smart Josparlau (Прототип HTML)/`, `Прототип/`) ни одной памяти, описывающей ОТКРЫТЫЙ нерешённый дефект самого фронтенда: все найденные записи — либо архитектурные решения/уроки тестирования (см. [[Decisions]]), либо снимки состояния (см. [[Status]]). Остаточные пункты бэклога PersonalRecordFront-аудита (контраст, react-hook-form и т.д.) относятся к Personnel-Records, не сюда — см. [[Status]] за сводкой._

## Права ops.* — формат кодов (из FRONTEND_ROLE_MATRIX, 2026-08-20)

Фронт (и матрица ролей SPA, и перенесённые в PersonalRecordFront экраны) запрашивает права в формате `ops.<resource>.<action>` (например `ops.security_event.view`, `ops.duty.manage`, `ops.settings.manage_conflict_rules`); сиды бэка исторически заводили коды **без префикса** (`status.view`, `daily_report.generate` и т.п.). Открытый вопрос: единого реестра, подтверждающего, что живые сиды Personnel-Records выдают именно `ops.*`-коды, нет. Перед любой работой по RBAC — сверить формат с живыми сидами бэка, не с документами (`FRONTEND_ROLE_MATRIX.md` — рабочий проект реестра эпохи SPA, не факт бэка). Известный смежный пробел из той же матрицы: persona `placement_approver` имела `ops.placement.approve` без `ops.security_event.view` и физически не открывала карточку ОМ — не чинить вслепую, уточнить замысел.
