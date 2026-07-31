---
baseline_commit: d2c7b23
---

# Story 15.3b: `PUT /security-events/{id}/checklist` + `/sector-posts` — захват данных рекогносцировки (FR-22)

Status: review

## Story

As a **оператор, проводящий рекогносцировку**,
I want **записать/перезаписать чек-лист и строки пересчёта постов/секторов для конкретного ОМ**,
so that **15.3c может проверить их наличие перед двойным контролем и переходом в `RECON`**.

## Scope Decision (найдено при create-story)

- **Средняя часть разбитого `15-3`** (15.3a — модели, done; эта стори — захват данных; 15.3c — двойной контроль+переход+паспорт).
- **`PUT`-семантика «replace all»**, не `POST`-инкремент. Донор-спека недоступна, но чек-лист/пересчёт — форма с фиксированным (на момент отправки) набором строк, редактируемая оператором целиком за один просмотр (тот же UX-паттерн, что `frontend/src/features/security-events`'s soft-сигнал предполагает — форма, не построчный CRUD). `PUT` со списком целиком проще и безопаснее построчного `POST`/`PATCH`/`DELETE` API (нет риска забытых orphan-строк от прошлой попытки).
- **Два симметричных эндпоинта на одном `SecurityEventViewSet`** (`checklist`, `sector-posts`) — та же структура операции (replace-all-rows-for-parent), применённая к двум родственным моделям, не разные бизнес-действия — та же логика бандлинга, что 15.2a's create+list на одном ViewSet.
- **`service.py`-функция `replace_checklist_items()`/`replace_sector_posts()`** — `transaction.atomic()`: `event.checklist_items.all().delete()` + `bulk_create()` новых строк (тот же "replace" паттерн, что нигде явно не прецедентен в этом кодбейзе для `bulk_create`, но `.delete()+bulk_create()` внутри одной транзакции — стандартный Django-идиом для «replace all»).
- **Без аудита на этой стори.** Чек-лист/пересчёт — рабочие черновики рекогносцировки, не финализированное бизнес-событие (в отличие от `SECURITY_EVENT_BULLETIN_ISSUED` — реальный статус-переход). Аудируется факт ЗАВЕРШЕНИЯ рекогносцировки (переход в `RECON` через двойной контроль, 15.3c), не каждая промежуточная правка черновика — тот же принцип, что `_NOTIF`/`_BUGREPORTS`'s deferred-audit обоснование в `test_audit_coverage.py` (не каждая мутация несёт compliance-след). Роуты попадут в `AUDIT_MATRIX` как `_DeferredAudit` с этим обоснованием, не `_Audited`.
- **Без гейта по статусу ОМ.** Донор-спека не уточняет, можно ли редактировать чек-лист только в определённом статусе — консервативно НЕ гейтуем (проще снять ограничение позже, чем сломать легитимный воркфлоу неверным допущением). Открытый вопрос — не блокирует эту стори.
- **Permission — `event.manage`** (тот же код).

## Acceptance Criteria

1. **AC-1 (replace чек-листа).** `PUT /security-events/{id}/checklist` с массивом `{label, done, result?, comment?}` — удаляет ВСЕ прежние строки этого ОМ, создаёт новые, возвращает 200 + список.
2. **AC-2 (replace пересчёта).** `PUT /security-events/{id}/sector-posts` с массивом `{sector, post, task?, need, requirements?, result?, comment?}` — та же replace-семантика.
3. **AC-3 (пустой массив допустим).** `PUT` с `[]` очищает все строки (легитимный «сбросить чек-лист» сценарий).
4. **AC-4 (permission).** Оба роута требуют `event.manage` — без него 403.
5. **AC-5 (несуществующий ОМ — 404).** Нечисловой/несуществующий `{id}` — 404, не 500 (тот же isdigit-гвард, что 15.2b's ревью-фикс).
6. **AC-6 (регресс нулевой).** `make gate` зелёный, обе route — классифицированы в `AUDIT_MATRIX` (`_DeferredAudit`) и RBAC `MATRIX` (`_Gate("event.manage")`).

## Out of Scope

- Аудит записи чек-листа/пересчёта — намеренно deferred (см. Scope Decision).
- Двойной контроль, переход в `RECON`, обновление Паспорта — Story 15.3c.
- Валидация «чек-лист заполнен полностью» перед переходом — 15.3c's забота (может читать эти же таблицы).

## Tasks / Subtasks

- [x] Task 1 — Сериализаторы (AC: 1, 2)
  - [x] `ChecklistItemSerializer` (read+write), `SectorPostSerializer` (read+write)
- [x] Task 2 — `services.py`: `replace_checklist_items()`/`replace_sector_posts()` (AC: 1-3)
  - [x] `transaction.atomic()`: `.all().delete()` + `bulk_create()`
- [x] Task 3 — ViewSet `@action`-ы (AC: 1-5)
  - [x] `PUT .../checklist`, `PUT .../sector-posts` — `require_permission` + `isdigit()`-гвард (общий `_get_event_or_404()`-хелпер) + вызов сервиса
- [x] Task 4 — Живые реестры (AC: 6)
  - [x] `AUDIT_MATRIX` — `_DeferredAudit` с обоснованием (обе route)
  - [x] RBAC `MATRIX` — `_Gate("event.manage")` (обе route)
- [x] Task 5 — Тесты (AC: 1-6)
  - [x] Replace-семантика (старые строки удалены), пустой массив, 403, 404 нечисловой id
- [x] Task 6 — Гейт + схема (AC: 6)

## Dev Notes

- Читать `apps/operations/events/api/views.py` (15.2a/15.2b) — буквальный образец `require_permission`+`isdigit`-гвард+`@action`-паттерна.
- `apps/operations/events/models.py` (15.3a) — `checklist_items`/`sector_posts`-`related_name` уже существуют.
- `bulk_create()` не вызывает `save()`/сигналы по умолчанию — не проблема здесь (нет сигналов на этих моделях).

### References

- [Source: Backend/VAPS/apps/operations/events/api/views.py] — паттерн require_permission/isdigit-гвард (15.2a/15.2b).
- [Source: Backend/VAPS/apps/operations/events/models.py] — модели 15.3a.
- [Source: Backend/VAPS/apps/audit/tests/test_audit_coverage.py] — `_DeferredAudit`-обоснование прецедент (`_NOTIF`/`_BUGREPORTS`).

## Dev Agent Record

### Context Reference

_(заполняется dev-story)_

### Completion Notes

Реализовано по AC 1-6. `ChecklistItemSerializer`/`SectorPostSerializer` (`ModelSerializer`, `id`-read-only). `replace_checklist_items()`/`replace_sector_posts()` — `services.py`, `transaction.atomic()`-блок `.all().delete()` + `bulk_create()`. `PUT .../checklist`/`PUT .../sector-posts` — новый общий `_get_event_or_404()`-хелпер (извлечён из `bulletin()`'s ревью-фикса 15.2b, теперь переиспользован трижды). Оба роута — `_DeferredAudit` в `AUDIT_MATRIX` (черновик-данные, не финализированное событие — тот же принцип, что `_NOTIF`/`_BUGREPORTS`), `_Gate("event.manage")` в RBAC-матрице. 7 новых тестов (create/replace-old-rows/empty-array-reset ×оба эндпоинта где применимо, 403, 404×2). `make gate` — 3453 passed (было 3426, +27 — включая параметризованные RBAC-кейсы на 2 новых роута), 0 regressions, schema регенерирована.

### File List

- `Backend/VAPS/apps/operations/events/api/serializers.py` (modified — `ChecklistItemSerializer`/`SectorPostSerializer`)
- `Backend/VAPS/apps/operations/events/services.py` (modified — `replace_checklist_items()`/`replace_sector_posts()`)
- `Backend/VAPS/apps/operations/events/api/views.py` (modified — `checklist`/`sector_posts`-actions, `_get_event_or_404()`-хелпер, `bulletin()` рефакторен на хелпер)
- `Backend/VAPS/apps/operations/events/tests/test_recon_capture_api.py` (new)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (modified — 2 `_DeferredAudit`-записи)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — 2 `_Gate`-записи)
- `Backend/VAPS/schema.yaml` (regenerated)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story) — средняя часть разбитого `15-3`. PUT-replace-семантика выбрана вместо построчного CRUD; аудит намеренно deferred (черновик, не финализированное событие). |
| 2026-07-31 | Dev-story: 2 PUT-replace-эндпоинта, общий `_get_event_or_404()`-хелпер (рефакторинг `bulletin()`), оба живых реестра обновлены (`_DeferredAudit`+`_Gate`), 7 новых тестов, схема регенерирована. `make gate` — 3453 passed. Status → review. |
