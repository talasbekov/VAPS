# Yandex and R7 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Сохранить функциональность R7 и codex/yandex в одной проверенной версии с оформлением Yandex.

**Architecture:** Трёхсторонний импорт относительно исходника `5340838c`, с сохранением монорепозитория и историй миграций. Общий чат и постоянные поручения ОМ совместно используют настройки модели, но сохраняют разные права и последствия.

**Tech Stack:** Django, PostgreSQL 16, Celery/Redis, Next.js/React/TypeScript, Docker, pytest, Node tests, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-31-yandex-r7-integration-design.md`

## Global Constraints

- Использовать оформление codex/yandex; сохранить все перечисленные в спецификации функции R7 и Yandex.
- Не изменять имена и содержимое уже опубликованных миграций обеих веток.
- Не читать и не изменять рабочие БД, media, secrets, установленные стеки и существующие резервные копии.
- Не публиковать изменения и не обновлять production этим поручением.
- Сохранить незакоммиченные AGENTS/vault и не включать их в коммиты реализации.
- Временные копии исходников размещать только во внешней `.build` текущей рабочей папки.
- Полный pytest: отдельный PostgreSQL, `--dist=load --create-db`.

## Review Focus

- Старые task/messages/retry работают вместе с mode=answer, не теряют сообщения и не выполняют ОМ до явного действия.
- Переключение или отзыв области не показывает прежние защищённые данные; чат не расширяет доступ.
- Каждая из двух ранее установленнных цепочек мигрирует к одной вершине без потери старых строк.
- Боевые назначения, отмены, отдых и исправление сданного дня согласованы с расходом и личным профилем.
- Навигация Yandex сохраняет вход по минимальным обязанностям расхода и доступ к сохранённым экранам R7.

## Task 1: Import and provenance

**Files:** `.sync/yandex-import.json`; project files mapped from `Backend/PersonnelStatus/` to `PersonnelStatus/`; `deploy/AI-LIVE-DATA-2026-10-30.md`.

**Interfaces:** Produces a merge candidate based on both pinned revisions; preserves project-only paths and foreign VAPS files by excluding them from import.

- [x] Verify source/export hashes at the shared base, identify mapping differences, and preserve existing dirty-path list.
- [x] Construct mapped import commit parented by `5340838c`; merge into `codex/merge-yandex-r7-20261031` without replacing local-only R7 additions.
- [x] Record conflicts by subsystem and pinned provenance; exclude runtime, credentials, compiled images and unrelated VAPS files.

## Task 2: Backend functional integration

**Files:** `PersonnelStatus/Personnel-Records/organization_management/apps/ops/assistant/`; `apps/ops/api/views_assistant.py`, `views.py`, `urls.py`; `apps/operations/`; `apps/core/`.

**Interfaces:** Preserve task CRUD/messages/retry; add `mode=answer`, read context and explicit confirmation; merge provider documentation methods into configured OpenAI/Ollama transport. Preserve R7 dialogue processing and multi-object briefing; place documentation dialogue in a separate module if necessary.

- [x] Retain tests from both versions; run focused assistant and access checks, recording integration failures before adapter fixes.
- [x] Resolve model/API/provider conflicts while preserving both modes, explicit execution, actor scope, persistent history and encrypted credentials.
- [x] Preserve review metadata through worker/retry/correction; test that ordinary duty.manage alone cannot review combat rosters and duty.combat.manage can within scope.
- [x] Preserve combat planning/lifecycle/projection, partial-summary freshness/rebuild, PDF and recon-map changes; preserve qualifications, inspections, templates, diagnostics and coverage.
- [x] Add behavioural regression tests for configured provider plus read chat, queued task plus confirmation, and scope changes; run focused suites to green.

## Task 3: Frontend integration with Yandex presentation

**Files:** `PersonnelStatus/PersonalRecordFront/components/`, `features/`, `hooks/`, `entities/`, `app/`; `scripts/gate-front.mjs` and tests; Playwright configs.

**Interfaces:** Mount global assistant dock and Yandex navigation; retain task conversation, daily-expense entry, AI settings, qualifications, inspections, templates and diagnostics. Both chat and task payloads remain supported by Task 2.

- [x] Keep the union of tests/configurations; run TypeScript and affected Node suites to expose incompatible interfaces.
- [x] Resolve conflicting UI and authority logic without discarding draft/denial behaviour from either side; retain `/daily-expense` independent from forces allocation.
- [x] Add regressions for both assistant entry points and preserved R7 navigation under Yandex sections; run gate with all tests and production build.

## Task 4: Migration and deployment compatibility

**Files:** `apps/operations/migrations/0155_merge_r7_combat.py`; migration integration tests; `deploy/lan/schema-transition-checks.py`, release tests and documentation.

**Interfaces:** One merged migration leaf depending on both published 0154 leaves. Existing migrations remain byte-identical. Existing single-file updater and persistent model networks remain available.

- [x] Demonstrate two unmerged leaves and migration-state/model differences before fixes.
- [x] Add the merge migration and compatible release allowlist; add tests for old R7, old Yandex and new DB paths.
- [x] Allow only the published DUTY_OFFICER/duty.manage seed-link removal and combat-type seed insertions; test rejection of all other historical row mutations/deletions.
- [x] Apply both upgrade paths on isolated populated synthetic databases, checking old model rows and combat/assistant data preservation.
- [x] Run Linux deployment tests and `makemigrations --check --dry-run`.

## Task 5: Whole-result verification and handoff

**Files:** test evidence outside Git; project README and current project journal/task entries after implementation.

- [x] Run complete merged PostgreSQL pytest, Django checks, frontend gate and Linux deployment/tool checks.
- [x] Build and run the merged application on separate temporary resources; exercise role-scoped assistant/OM and combat-duty browser paths.
- [x] Obtain independent spec and quality review; fix material findings and rerun affected checks.
- [x] Record exact source, checks, limitations and preserved installed state; commit only authorized implementation/docs, leaving unrelated dirty notes intact.

Verification evidence: outer `.build/yandex-merge-20261031/`. Final backend: 8438 passed / 1 skipped. Frontend: 1204 passed, TypeScript and production build. Contracts: 32; Linux deployment: 195; Linux tools: 52. Real browser: 1 assistant and 2 combat scenarios. Independent reviews passed. Local merge commit completes the final checkbox; installed/public states remain unchanged.
