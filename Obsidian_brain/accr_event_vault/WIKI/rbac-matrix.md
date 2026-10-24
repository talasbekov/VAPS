# RBAC-матрица: «роль × отношение-узла × действие → ожидаемый ответ»

> **Статус:** исполняемый oracle (FR-19 — права **задокументированы И проверяются**).
> **Источник истины (машинный):** [`eventproject/tests/rbac_matrix.py`](../eventproject/tests/rbac_matrix.py).
> **Харнессы:** [`test_rbac_matrix.py`](../eventproject/tests/test_rbac_matrix.py) ·
> [`test_rbac_bypass_paths.py`](../eventproject/tests/test_rbac_bypass_paths.py).
> Любое изменение ожидаемого поведения правится в **обоих** местах синхронно
> (story hd-7.1). Эта история — ТЕСТ+ДОК: рантайм-authz (резолвер/permissions/модели)
> НЕ меняется; матрица кодирует **текущее ожидаемое** поведение, доказанное негативами.

## Два enforcement-узла (НЕ смешивать — разные коды)

| Узел | Где | Код | Семантика |
|---|---|---|---|
| **read-side** | `get_operator_attendee_queryset` / `get_operator_events` (`serializers/rbac.py`) → `get_queryset()` вьюсетов | **404** | доступ по **id** к чужому = объект вне выборки (НЕ пустой 200 — это info-leak) |
| **write-side** | `AttendeeSerializer.validate` (`serializers/attendee.py:121-142`) → `get_operator_events` | **403** | запись в **чужое событие** (create / reassign через writable `request`) → `PermissionDenied` |

`404` = «не вижу»; `403` = «вижу, но писать в чужое нельзя». Поле `request`
сериализатора writable → write-side закрывает **reassignment-bypass** (своего
участника нельзя перецепить на `Request` чужого события). write-side использует
`get_operator_events` (событие, **без** категории) → см. known-gap «category-асимметрия».

## Роли

`User.role` (`models.py:195-204`): `superuser` (= `is_superuser` ИЛИ `Operator.role`) ·
`superoperator` · `operator` · `user` (залогинен, без `Operator`) · `anonymous`.

## Отношения узла (для оператора, привязанного к листу **A**)

Иерархия `Event.parent` (hd-5.1): контейнер **P** → листья **A**, **B**; чужой
контейнер **Q** → лист **C**. Категории листа A: `cat_own` (= `operator.category`),
`cat_foreign`. Привязка участника к листу — `Attendee → Request → Event` (N:1).

- **own** — лист A, своя категория оператора;
- **own_foreign_cat** — участник в листе A, но `category ≠ operator.category`;
- **own_locked** — лист A, своя кат., статус `ready`/`exported` (edit-lock);
- **sibling** — лист B (тот же контейнер P) — upward-роллапа НЕТ;
- **parent** — контейнер P (прямых участников нет → семантика sibling);
- **foreign_tree** — лист C (чужой контейнер Q).

> Никакого **upward-traversal**: привязка к листу ≠ доступ к siblings/контейнеру.
> Big-event целиком виден только `superuser`/`superoperator`.

## Матрица: роль × отношение × действие

Att = `Attendee` (`/api/v1/attendees/`); Req = `Request` (`/api/v1/requests/`).
Жирным — P0-ячейки (детерминированный перечень ниже).

| Actor (роль / отношение) | Att list | Att retrieve (id) | Att update/delete/submit (id) | Att create / reassign → target | Req list / retrieve | Event/Operator API | media `event_{id}/` |
|---|---|---|---|---|---|---|---|
| superuser / superoperator | все (агрегат) | 200 | 200 | 200/201 | все / 200 | 200 | 200 (любой) |
| operator @ own-leaf A, own-cat | свой в выборке | **200** | **200** (draft) | own A → **201/200** | свой / 200 | **403** (IsSuperoperator) | own `event_{A}/` → 200 |
| operator @ own-leaf A, **ready/exported** | в выборке | 200 | **403** (edit-lock) | n/a | — | 403 | own → 200 |
| operator @ sibling-leaf B | B исключён | **404** | **404** | B → **403** (write) | B искл. / **404** | 403 | `event_{B}/` → **404** |
| operator @ parent-aggregate P | искл. (роллапа нет) | **404**¹ | **404**¹ | P → **403** (write) | P искл. / 404 | 403 | `event_{P}/` → **404** |
| operator @ foreign-tree C | C исключён | **404** | **404** | C → **403** (write) | C искл. / **404** | 403 | `event_{C}/` → **404** |
| operator @ own-leaf A, foreign-cat | foreign-cat исключён | **404** | **404** | own A + чужая cat → **201** ⚠gap | n/a | 403 | n/a |
| user (без Operator) | **403** (IsOperator) | 403 | 403 | 403 | 403 | 403 | login-redirect/404 |
| anonymous | **403** | 403 | 403 | 403 | 403 | 403 | login-redirect (302) |
| operator → legacy export `/download_json/…` | — | — | — | — | — | — | **302 → /user_login/** (gap) |

¹ У контейнера P нет прямых участников (крепятся к листу) → реальный parent-негатив =
«нет upward-роллапа»: участник под sibling B не виден оператору A ни через какой
parent-traversal (по сути sibling-кейс). media `event_{P}/` проверяется отдельно (#24).

## P0-перечисление (детерминированный чек-лист — AC-2/AC-3)

Оператор привязан к листу **A**. Все «чужие» участники СУЩЕСТВУЮТ (иначе тест не
доказывает не-leak). Negative-цели — `draft` (иначе edit-lock 403 замаскирует 404).
Источник: `rbac_matrix.P0_OPERATOR_CELLS` (#1–22), `ROLE_GATE` (#26–30), `MEDIA_CELLS` (#23–25).

| # | Endpoint / действие | Цель | Ожидание | Узел |
|---|---|---|---|---|
| 1–3 | `GET /attendees/{id}/` retrieve | B / C / foreign-cat | **404** | read |
| 4–6 | `PUT/PATCH /attendees/{id}/` update by id | B / C / foreign-cat | **404** | read |
| 7–8 | `PATCH /attendees/{own}/` reassign `request`→ чужое | →B / →C | **403** | write |
| 9–11 | `DELETE /attendees/{id}/` | B / C / foreign-cat | **404** | read |
| 12–13 | `POST /attendees/{id}/submit/` | B / C | **404** | read |
| 14–15 | `POST /attendees/` create с чужим `request` | в B / в C | **403** | write |
| 16–18 | `GET /attendees/` list — исключение | B / C / foreign-cat | `assertNotIn` | read |
| 19–20 | `GET /requests/{id}/` retrieve | B / C | **404** | read |
| 21–22 | `GET /requests/` list — исключение | B / C | `assertNotIn` | read |
| 23–25 | `GET /media/event_{id}/…` | B / P / C | **404** | media |
| 26 | `GET /attendees/` — anonymous | — | **403** | role-gate |
| 27 | `GET /attendees/` — user без Operator | — | **403** | role-gate |
| 28 | `… /api/v1/events/` — operator | — | **403** (IsSuperoperator) | role-gate |
| 29 | `… /api/v1/operators/` — operator | — | **403** | role-gate |
| 30 | `/download_json/{event}/` — operator | — | **302** redirect | gap-маркер |

**Позитивные контроли** (анти-over-block, `POSITIVE_CONTROLS`): own-A retrieve→200,
own-A list-include, own-A create→201, own-A submit→200, own Req retrieve→200,
own-A ready/exported update→**403** (edit-lock, НЕ 404).

## Инвентарь защищённых эндпоинтов

| Endpoint | View | Permission | Scoped? |
|---|---|---|---|
| `/api/v1/attendees/` (+ `/{id}/submit/`) | `views/attendee_api.py` | `IsOperator` | **да** (`get_operator_attendee_queryset`, read 404 / write 403) |
| `/api/v1/requests/` (read-only) | `views/request_api.py` | `IsOperator` | **да** (`get_operator_events`) |
| `/api/v1/events/` (+ `/{id}/categories/`) | `views/event.py` | `IsSuperoperator` | оператору — 403 |
| `/api/v1/operators/` | `views/operator_api.py` | `IsSuperoperator` | оператору — 403 |
| `/api/v1/rbac-check/` | `api/urls.py` | `IsAuthenticated` | отдаёт только `role` |
| `/media/<path>` (`protected_media`) | `views/views.py` | `@login_required` + event-regex (по **resolved**-пути) | **да** (bypass-путь; within-root traversal `event_{own}/../event_{чужой}/` → 404) |
| `/export_delta/<ev>/<req>/` | `views/export.py` | `_is_superoperator` (`@require_POST`) | operator → 403, anon → 302 |
| `/dashboard/<ev>/` | `views/dashboard.py` | `_is_superoperator` | operator → 403, anon → 302 |
| `/download_json/<ev>/` | `views/file_download.py` | `@user_passes_test(is_superuser)` | **нет per-event scope** (gap) → 302 |
| `/qr/`, `/qr/success/<pk>/` | `qr_event/views.py` | `@login_required` | слабо (session/superuser, без event-scope) |
| `/delete_request/<id>/`, `/create/<ev>/`, `/add_attendee/<req>/`, `/delete_attendee/` | `views/request.py`, `views/attendee.py` | `@login_required` + ownership (`req.created_by`) | **да** (ownership; при отказе legacy отдаёт 200-текст, не 403/404 — слабый код) |

## Known gaps → defer

Слабые места, **задокументированные и зафиксированные тестом-маркером**; поведение
здесь НЕ исправляется (история hd-7.1 — тест+док). Каждому — история-приёмник.

1. **Legacy-экспорт без per-event scope** — `views/file_download.py`
   (`download_json` и др.): `@user_passes_test(is_superuser)` — прямой `is_superuser`
   в обход permission-классов (anti-pattern `architecture.md:436`), без сужения по
   событию. Оператор получает 302 (redirect на логин). **Defer → hd-1-\*** (Epic
   «Безопасный экспорт») / `hd-5-5` (ExportLog per-leaf). Замена
   `@user_passes_test` на permission-классы — отдельная зачистка.
2. **QR `qr_success_view` без event-scope** — `qr_event/views.py:68`: доступ =
   `(pk in session) OR is_superuser`, без проверки владения событием. Кроме того,
   entrance/scan-валидации (сверка ИИН на входе) **в коде НЕТ** — эндпоинт не
   выдуман, факт зафиксирован маркером. **Defer → новая QR-история.**
3. **Category-асимметрия write/read** — `AttendeeSerializer.validate` →
   `get_operator_events` (write-side) НЕ сужает по категории: оператор создаёт
   участника с **чужой категорией в своём событии** (201), затем НЕ видит его
   (read-side `get_operator_attendee_queryset` сужает по категории → 404).
   **Defer → hd-5-2** (leaf-only / category enforcement). Доказано
   `test_gap_category_write_read_asymmetry`.

## Запуск

```bash
.venv/bin/python manage.py test eventproject.tests.test_rbac_matrix \
    eventproject.tests.test_rbac_bypass_paths --settings=eventproject.settings_test
```
