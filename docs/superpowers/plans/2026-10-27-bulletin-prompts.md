# Multi-object bulletin prompts and account search

> **For agentic workers:** Use focused parallel implementation and independent review. Preserve the accepted dirty worktree; no deployment or publication.

**Goal:** Fix administrator employee search and let authorized bulletin authors describe a multi-object event in one conversation, retain all explicit facts, ask for missing or ambiguous details, and perform allowed actions as the initiating actor.

**Architecture:** Extend the existing durable assistant plan with an optional bounded `briefing`. Keep the single-object contract compatible. Model extraction supplies proposals; deterministic grounding and catalog resolution decide accepted facts. Existing manual DRF actions enforce all mutations, receipts prevent duplicates. No new role grants, schema migration, external model call or installed application change.

**Spec:** User's two messages about «Встреча» on25.10.2026, three/four objects, protected persons800/802/803 and explicit foreign-person creation. Existing autonomous authorization includes routine design decisions; no additional approval gate is introduced.

## Decisions and constraints

- Use one event with multiple visit objects, not separate events or a concatenated object name.
- `briefing.objects`: names, resolved IDs, chiefs, sector/post/subpost structure, separate per-object and per-post need, known/unknown need status, user's checklist declaration and optional explicit results.
- `briefing.protectedPersons`: codes or exact supplied name/country and explicit create-if-missing request; numeric codes are never assumed to be database IDs.
- Unknown demand is not zero. Object totals never allocate people across posts by guesswork.
- Incomplete sectors/posts, contradictory references, unknown chiefs/persons and absent checklist results produce scoped questions. «Все проверены» does not establish that every check is NORMAL.
- Persist partial facts across messages. Preserve completed actions; a later message cannot silently rewrite a created bulletin or sent requests.
- Access to the assistant includes `event.bulletin`; real event creation still requires its existing permission. An LLM cannot select a different actor or elevate privileges.
- Foreign-person creation uses the existing authenticated manual endpoint, same transaction and receipts as the bulletin operation. Recon certification/signatures remain the actual authorized participants' actions.
- Existing denied dev-server launch and .next-build deletion remain denied. Use isolated tests, no workaround. No production mutations.

## Implementation

- [x] Search: reproduce multiword/linked-employee failures, repair scoped account query and employee chooser states; focused API/UI tests.
- [x] Root: add bounded briefing validator, grounded extraction, per-object merging and completeness questions; both full user examples and follow-up regressions.
- [x] Backend execution: resolve permitted references, create/reuse foreign OL, create event/visits/chiefs/recon draft through manual endpoints, explicit pending steps, immutable receipts and permission tests.
- [x] Frontend: compact object summary, unknown demand, protected-person facts, structure details and pending actions; retain existing chat and single-object UI.
- [x] Entry permissions: bulletin-capable users can converse; no implicit permission to perform forbidden domain actions.
- [x] Independent review, focused and full regression checks, source manifest, role guide/handoff; report actual acceptance limitations.

## Review focus

- User says «ещё неизвестно» alongside «пока не нужны»; keep unknown.
- «У третьего поста» does not identify its sector; ask rather than assume third sector.
- Duplicate names/codes, inactive people and other departments cannot be selected arbitrarily.
- An object-level amount cannot become a department request without an explicit recipient.
- Repeated continue, failed later action and changed actor/role cannot duplicate people/events or mutate committed facts.

## Acceptance

Frontend 1058/1058 и production build; PostgreSQL 8053 passed/1 skipped,
проверка миграций прошла, новых миграций нет. 2381 файлов сверены
с финальным снимком; фронт собран в отдельном проверочном каталоге.
Протоколы .local-review/bulletin-prompts-20261027, acceptance.json.
Независимый review закрыт; последние ограничения категории иностранного ОЛ
проверены отдельным тестом автора, чтением reviewer и полным прогоном.

Браузерная приёмка не выполнена: прежний запуск dev-сервера отклонён
автоматической проверкой (`blocked by policy`); повторов/обхода не было.
LLM в API-тестах заменён детерминированными ответами: настоящий боевой ИИ
этим не проверен. Точный сбой установленного поиска без сетевого ответа
не установлен; воспроизведённый дефект исходников исправлен.
Установленные версии и production не менялись, новый .sh не собран.
Файл Smart-Update-HTTP-Fix-2026-10-24.sh прежний и новых функций не содержит.
Старый .next-build после отказа удаления не трогали; проверочная сборка
этого этапа расположена в outer .build/bulletin-prompts-20261027/source-verified.
Удаление её кэша также отклонено автоматически (`blocked by policy`):
704036996 байт сохранены; повторов/обхода после отказа не было.
