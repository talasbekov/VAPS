---
name: vaps-ux-spines-donor-visual
description: "UX spine pair for PersonnelStatus and the donor-as-visual-эталон pivot (card-based SaaS, dashboard-first)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6cf40c75-2249-4932-a050-e8327373f55a
---

UX-спайны для поверхности **PersonnelStatus** созданы 2026-06-19/20 через `bmad-ux`: `DESIGN.md` (визуальная идентичность, токены поверх Mantine) + `EXPERIENCE.md` (IA/поведение/состояния/потоки) в `_bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/` (decision-log, mockups/, wireframes/, imports/, review-rubric.md). Оба `status: final`.

**Ключевой разворот сессии:** донор — не только parallel-run эталон ДАННЫХ (см. [[project_vaps_architecture]]), но и **визуальный эталон UI**. Bratan дал скриншоты донора (`spikes/Расход.png`, `Расход2.png`, `Расход3.png` → скопированы в `imports/`) со словами «вот такой дизайн должен быть» и выбрал **полный разворот**. Визуальный язык = **дружелюбный card-based SaaS**, НЕ строгое плотное серое гос-ПО: дашборд-first (приветствие «Доброе утро, {имя}! 😊» + ряд KPI-плиток счётчиков по статусам + блок «Структура организации» = оргдерево с круглыми аватарами), скруглённые карточки (radius md) + мягкие тени, тёплый тон (эмодзи на дашборде допустимы). Исключение: рабочие таблицы (грид ввода, журнал, список) остаются плотными `size="sm"` ВНУТРИ карточки.

**Поведенческое ядро сохранено** при развороте: клавиатурный слепой грид ввода (Enter↓/Tab→/Esc, преднабор «вчера»), конфликты 409 soft (ConflictDialog + причина 10–500 → аудит) / 422 hard (блок), гейт ФИНАЛ-расхода со списком отстающих + async .docx, трёхцветный светофор-каскад, RBAC scope-gating, маскировка ИИН, аудит. Стек фронта (канон): Vite + React 19.2 + TS, React Router v7, TanStack Query/Table/Virtual, **Mantine v7** (card-постура), Tailwind только лейаут (preflight off), RHF+Zod; печать = HTML+print.css.

**Донор в репо:** **API-бэкенд** = `Backend/PersonnelStatus/Personnel-Records` (Django/DRF; поведенческий эталон = его `schemas/ROLE_SCENARIOS.md`, 6 ролей). **Фронтенд донора** = `Backend/PersonnelStatus/PersonalRecordFront` (Bratan положил 2026-06-20): **Next.js 15 App Router + shadcn/ui (Radix) + Tailwind**, Feature-Sliced; FullCalendar (планирование), react-organizational-chart (оргдерево), TanStack Query, next-auth. Запустить в офлайн-песочнице чисто НЕ удалось (turbo→React useReducer-null; webpack npm/pnpm→tailwind CJS build-error из-за pnpm-стора без сетевого reinstall; бэкенд `10.115.70.56:8100` недостижим, маршруты за next-auth) — ценность бери из ИСХОДНИКОВ, не из запуска. Маршруты: `/`(логин)·/dashboard(«Обзор»)·/employees·/organization·/statuses·/reports·/feedback. Ввод статусов донора = диалог `EditStatusDialog` + `MassStatusUpdate` + `PlannedStatusesDialog` + `StatusTable` + `StatusCalendar`.

**Палитра статусов спайна = ДОНОР 1:1** (из `PersonalRecordFront/entities/status/model.ts`, Tailwind bg-100/text-800, единый light-tint): В строю=green·Отпуск=yellow·Рапорт=amber·Больничный=red·Командировка=purple·Учёба=indigo·Соревнования=pink·Иные=orange·На дежурстве=blue·После дежурства=cyan·Прикомандирован=teal·Откомандирован=gray. Донор-фронт = **shadcn/Tailwind**, VAPS осознанно строит на **Mantine** (воспроизводит вид) — расхождение известное.

**Как донор реально работает (из ROLE_SCENARIOS.md, 2026-06-20):** ввод статусов = карточка сотрудника → «Изменить статус» (период+коммент+планирование) + «Массовое действие» (выбор неск. → статус) + раздел «Планирование» (календарь). «Расход» = раздел-ПРОСМОТР статусов. Отчёты = «Отчёты→Создать» (.docx/.xlsx/.pdf, async). **У донора НЕТ:** слепого грида, «сдачи дня»+светофора, 409/422-конфликта, ФИНАЛ-гейта расхода — это всё VAPS-новое.

**Решение 2026-06-20 (бывший пробел «ввод донора» — закрыт):** VAPS-грид + светофор + сдача + конфликт-гейт ОСТАВЛЕНЫ как осознанные улучшения (тег в спайне `[VAPS-НОВОЕ vs донор]`, не `[ЭКСТРАПОЛЯЦИЯ]`); донорский карточный ввод сохранён точечным фолбэком. Т.е. визуал берём у донора, рабочий контур ввода — осознанно быстрее донора.

**Why:** естественное допущение «внутренний штабной инструмент = аскетичный плотный UI» НЕВЕРНО для VAPS — донор задаёт более дружелюбный карточный язык, который надо воспроизводить (узнаваемость для штабиста).

**How to apply:** любые будущие UX/фронтенд-решения по VAPS сверять со скриншотами донора в `spikes/Расход*.png` (= `imports/`) и со спайнами; донор — визуальный эталон, не только источник данных. Другие поверхности (VisitX, Accreditation) при проектировании — свои папки спайнов (`ux-<surface>-<date>`).

**Подтверждение 2026-07-04:** дизайн-система донора синкнута в claude.ai/design (проект «VAPS Design System», 23 компонента shadcn/ui с авторскими превью — русский контент, кадровый домен, статусная палитра донора). Bratan просмотрел `.review.html` и одобрил явно: «мне всё нравится, в таком стиле можешь делать» — стиль превью/дизайнов в этом ключе утверждён как рабочий базлайн для Claude Design и будущего фронта.

**РЕВИЗИЯ СТЕКА 2026-07-04 (решение Bratan):** фронтенд VAPS строится на **донорских shadcn/Tailwind-компонентах напрямую**, НЕ на Mantine — упоминания «Mantine v7 (канон)» выше устарели. Мотив: ДС донора синкнута/одобрена, прототипы Claude Design состоят из неё → 1:1-маппинг прототип→код без слоя перевода. Остальной стек-канон без изменений (Vite + React + TS, Router v7, TanStack Query/Table/Virtual, RHF+Zod). Стратегия реализации: **frontend-first** — фронт целиком с моками на HTTP-границе (MSW, Zod-контракты; реальные эндпоинты /api/core|operations|audit|notifications — passthrough), потыкать → замечания → потом дописать бэк под обкатанные контракты. Прототип-брифы: `_bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/prototype-briefs-claude-design.md`. Ревизия DESIGN.md под новый стек — стори будущего фронт-эпика.
