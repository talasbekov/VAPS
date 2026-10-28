# Обновление одним файлом 27 октября — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent release work and review. Preserve prior verified source.

**Goal:** Передать один проверенный Linux .sh с актуальными backend/frontend/proxy, без локальной БД, медиа и секретов.

**Architecture:** Зафиксировать проверенные исходники по manifest guided-assistant-20261027; собрать offline Linux/amd64 образы на имеющихся зависимостях; обновить точную политику миграций до0154. Проверить комплект и его обновлятор на отдельной БД из прежней резервной копии. Установку на production здесь не выполнять.

**Tech Stack:** Docker/Compose, Python updater, PostgreSQL16, Bash launcher.

**Spec:** Пользователь просит собрать обновление; ранее согласованы один .sh, сохранение боевой базы/настроек и минимум ручных команд.

## Constraints and decisions

- App source unchanged from accepted2384-file manifest unless new evidence requires a fix and corresponding revalidation.
- Source snapshots and package staging only under outer .build/production-update-20261027; no existing declined path deletion or dev-server startup retried.
- Only application images in delivery. No local .env, dumps, private/media, test data or dependency infrastructure archives.
- Exact ordered migration allowlist; preserve existing rows/columns, user roles, business sequences, uploads, DB container/volume.
- Runtime must include locked cryptography50.0.1 from offline wheelhouse; previous production backend lacks it.
- Both API and worker need persistent model egress. If server uses the reviewed default-internal/ingress-bridge topology, prepare the minimum durable compose transition with backup and recovery handling; preserve other settings and reject ambiguous topologies before downtime. Do not overwrite whole server Compose with template.
- A local release commit may record this reviewed source; no push, production update, credential changes or broad cleanup.

## Work

- [x] Inspect and extend schema-transition allowlist for0149–0154, add focused tests and review additions.
- [x] Inspect/implement minimal persistent API+worker egress transition in updater with rollback and unit coverage; retain current server settings.
- [x] Build digest-bound backend/frontend images offline, validate runtime dependencies and exact app source vs latest accepted manifest.
- [x] Run deployment tests on Linux; review release changes independently.
- [x] Stage application-only manifest, rehearse packaged migrations/backup restore against isolated nonempty legacy and current schema, preserve existing AI settings/tasks and access grants.
- [x] Check real worker queue operation with synthetic provider on the built image; no production LLM or working database mutations.
- [x] Build one .sh with LF header/checksums; verify extraction, Bash entry and all SHA256 in Linux.
- [x] Record final file/hash/instructions, update vault/AGENTS, remove only owned unneeded test containers/volumes/staging duplicates after review.

## Acceptance

Final launcher: outer `Smart-Update-2026-10-27.sh`,428826698 bytes,
SHA256 `74f170129cdf68c02a2e55115c17927cda0d25f9c8353bf80ad25a940380f932`.
189 deployment tests; Linux Bash verify-only/GNU sha256sum; packaged legacy/current
database rehearsal; real Celery/Redis synthetic-provider smoke; independent final
delivery review. Additional production-image browser acceptance:9 guided-dialogue
and11 AI-settings/HTTP scenarios, no skips/flaky/errors, synthetic auth/mocked API.
Temporary owned test resources removed. Production/local installs unchanged;
real model untested. Bindings: `.local-review/production-update-20261027/acceptance.json`
and `browser-acceptance.json` in the same directory.
