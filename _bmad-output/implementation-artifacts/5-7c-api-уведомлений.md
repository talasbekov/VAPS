---
baseline_commit: 281d404839d0d0f9ff608edc974e66593bd21175
---
# Story 5.7c: API уведомлений (`GET /api/notifications/?since=`)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **получатель уведомлений (ответственный / любой actor)**,
I want **`GET /api/notifications/?since=` — read-only endpoint, отдающий ТОЛЬКО мои уведомления, новее переданного курсора**,
so that **отстающие-уведомления (FR-13, созданные `notify()` в 5.7a и catch-up-джобой 5.7b2) можно прочитать по паттерну API проекта, а доставка готова к WS (E11)**.

> **Место в сплите 5.7** (реш. Bratan 2026-06-30): 5.7a (модель `Notification` + `notify()`) → 5.7b1 (recipient-config) → 5.7b2 (catch-up-детект) → **5.7c (read-API)**. 5.7c ЗАВИСИТ от 5.7a (читает `Notification`); НЕ зависит от 5.7b (детект — независимый писатель тех же строк). Зеркалит read-API 4.5 (audit) и API-паттерн 5.8.

> **Решения create-story (Bratan, 2026-07-01):**
> - **Q1 = Any-auth + self-scope** (НЕ новый RBAC-код). Любой аутентифицированный actor видит ТОЛЬКО свои строки (`recipient == request.actor_id`); доступ-контроль — ОБЯЗАТЕЛЬНЫЙ фильтр в селекторе, не RBAC-право. Зеркалит `MyPermissionsViewSet` / `ops-my-permissions-list` (`_AnyAuthenticated`). `seed_operations` НЕ трогается.
> - **Q2 = `since` строго больше** — `created_at > since` (курсор «новее уже виденного», для поллинга и задела под WS E11). НЕ inclusive `>=`.

## Acceptance Criteria

1. **Endpoint смонтирован.** **Given** запущенный API, **When** GET `/api/notifications/`, **Then** роут обслуживается (list-only, `http_method_names = ["get","head","options"]`), route-name = `notification-list`, mount `path("api/notifications/", include("apps.notifications.api.urls"))` в `config/urls.py`.

2. **Строгий self-scope (ключевой инвариант).** **Given** уведомления для `recipient="alice"` и `recipient="bob"`, **When** actor `alice` запрашивает список, **Then** возвращаются ТОЛЬКО строки `alice`; строки `bob` невозможны ни при каком query-параметре (фильтр `recipient == actor_id` в селекторе — безусловный, не опциональный).

3. **Гейт = аутентификация (без RBAC-кода).** **Given** запрос без `actor_id` (аноним), **Then** `403` `PERMISSION_DENIED` (через unified handler); **Given** любой аутентифицированный actor (любая роль), **Then** `200` (даже если его список пуст — `count == 0`). Новый permission-код НЕ вводится, `seed_operations` НЕ меняется.

4. **`since`-курсор строго больше.** **Given** свои уведомления с `created_at` = t1<t2<t3, **When** `?since=<t2.isoformat()>`, **Then** вернутся строки СТРОГО новее t2 (только t3; t2 и t1 исключены — `created_at > since`); **Given** `since` опущен, **Then** все свои; **Given** `?since=notadate`, **Then** `400` `VALIDATION_ERROR`.

5. **Детерминированный порядок + LimitOffset-пагинация.** **Then** сортировка `(-created_at, id)` (новейшие первыми; `id` — ОБЯЗАТЕЛЬНЫЙ тай-брейкер); ответ — конверт `{count, next, previous, results}` (канон architecture.md#L427), `default_limit=50`, `max_limit=200` (5000 → капается до 200).

6. **Форма ответа (snake_case, flat).** **Then** каждый элемент = ровно `{id, recipient, kind, business_date, payload, read_at, created_at}` (без `updated_at`/`created_by`); flat, snake_case.

7. **Read-only.** **Given** POST/PUT/PATCH/DELETE на `/api/notifications/`, **Then** `405` (write-глаголы вне `http_method_names`).

8. **RBAC-матрица зелёная.** **Then** в `test_rbac_matrix.py` `MATRIX["notification-list"] = _AnyAuthenticated()`; `test_matrix_covers_every_registered_route` зелёный (роут покрыт, нет протухших строк); поведенчески — аноним `403`, любая роль `≠403`.

9. **Отложенные обязательства 5.7a закрыты.** **Then** (B9) индекс под scoped-recency-запрос добавлен на `Notification` (миграция `0002`) — `makemigrations --check` пуст; (F6) арх-гвард `notifications ↛ apps.core.models` добавлен и зелёный.

10. **Гейт.** **Then** `make gate` зелёный: `ruff` чист (E,F), `makemigrations --check` пуст, все тесты проходят (+новые), никаких hardcoded-секретов.

## Tasks / Subtasks

- [x] **Task 1 — Селектор с безусловным self-scope** (AC: 2, 4, 5)
  - [x] Создать `apps/notifications/selectors.py` → `class NotificationSelector` со `@staticmethod list(actor_id, *, since=None)`.
  - [x] `qs = Notification.objects.filter(recipient=actor_id)` — self-scope ПЕРВЫМ и БЕЗУСЛОВНО (не за `if`). Это единственный контроль доступа к чужим строкам.
  - [x] `if since is not None: qs = qs.filter(created_at__gt=since)` — строго больше (Q2).
  - [x] `return qs.order_by("-created_at", "id")` — тай-брейкер `id` обязателен (LimitOffset без него теряет/дублирует строки при равном `created_at`).
  - [x] Docstring: почему self-scope безусловный (в отличие от `AuditLogSelector`, где `audit.view` = плоский журнал целиком); зеркало layer-contract (селектор — единственный read-канал, вьюха тонкая).

- [x] **Task 2 — Сериализаторы (проекция + фильтр-форма)** (AC: 4, 6)
  - [x] Создать `apps/notifications/api/__init__.py` (пустой) и `apps/notifications/api/serializers.py`.
  - [x] `NotificationSerializer(serializers.ModelSerializer)`: `Meta.model = Notification`, `fields = ["id","recipient","kind","business_date","payload","read_at","created_at"]`, `read_only_fields = fields`.
  - [x] `NotificationFilterSerializer(serializers.Serializer)`: `since = serializers.DateTimeField(required=False)`. Плохой `since` → DRF `ValidationError` → `400 VALIDATION_ERROR` (unified handler, без ручного `Response`).

- [x] **Task 3 — ViewSet (list-only, self-scope-гейт, пагинация)** (AC: 1, 2, 3, 5, 7)
  - [x] Создать `apps/notifications/api/views.py`.
  - [x] `NotificationPagination(LimitOffsetPagination)`: `default_limit = 50`, `max_limit = 200` (зеркало `AuditLogPagination`).
  - [x] `NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet)` — ТОЛЬКО list (не `ReadOnlyModelViewSet`, чтобы не заводить `retrieve`/`notification-detail`; retrieve вне скоупа 5.7c). `serializer_class = NotificationSerializer`, `pagination_class = NotificationPagination`, `http_method_names = ["get","head","options"]` (write → 405).
  - [x] Гейт БЕЗ `RequirePermissionMixin` (нет RBAC-кода). Мини-гейт как в `MyPermissionsViewSet`: в `initial()` (после `super().initial()`) — `if not getattr(request, "actor_id", None): raise PermissionDenied("PERMISSION_DENIED")`. НЕ гейтить `OPTIONS`/`metadata` (как в `RequirePermissionMixin`) — вернуть до проверки, чтобы preflight не падал в 403.
  - [x] `get_queryset`: провалидировать `NotificationFilterSerializer(data=self.request.query_params)` → `is_valid(raise_exception=True)` → `NotificationSelector.list(self.request.actor_id, since=data.get("since"))`.

- [x] **Task 4 — Роутинг + монтаж** (AC: 1)
  - [x] Создать `apps/notifications/api/urls.py`: `DefaultRouter()`, `router.register("", NotificationViewSet, basename="notification")`, `urlpatterns = router.urls` → `notification-list`, URL `/api/notifications/`.
  - [x] Модифицировать `config/urls.py`: добавить `path("api/notifications/", include("apps.notifications.api.urls"))`.

- [x] **Task 5 — Индекс под scoped-recency (закрытие defer B9)** (AC: 9)
  - [x] Модифицировать `apps/notifications/models.py`: `Meta.indexes = [models.Index(fields=["recipient", "-created_at", "id"], name="ix_notification_recipient_recency")]`. Покрывает `recipient=? AND created_at>? ORDER BY -created_at, id` (leftmost-prefix уникального ключа `(recipient,kind,business_date)` НЕ помогает сортировке по `created_at`).
  - [x] `python manage.py makemigrations notifications` → миграция `0002_*`; `makemigrations --check` пуст.

- [x] **Task 6 — Арх-гвард notifications↛core.models (закрытие defer F6)** (AC: 9)
  - [x] Создать `apps/notifications/tests/test_isolation.py` (зеркало `apps/operations/tests/test_isolation.py`): AST-скан `.py` в `apps/notifications` (исключая `tests`) → ни один не импортит `apps.core.models`/`apps.core.models.*`. Сегодня легально (файлы 5.7c импортят только `apps.notifications.models`) — гвард форвардный.

- [x] **Task 7 — RBAC-матрица** (AC: 8)
  - [x] Модифицировать `apps/operations/tests/test_rbac_matrix.py`: `MATRIX["notification-list"] = _AnyAuthenticated()` (с комментарием: личный feed, self-scope в селекторе, зеркало `ops-my-permissions-list`).

- [x] **Task 8 — Тесты read-API** (AC: 1–7)
  - [x] Создать `apps/notifications/tests/test_notifications_read_api.py` (зеркало `test_audit_read_api.py`, Postgres, `HTTP_X_USER_ID` для actor).
  - [x] Хелпер посадки строки с контролем `created_at` (см. ⚠️ Dev Notes — `auto_now_add` игнорирует `created_at=` в `create()`; сначала `create()`, потом `Notification.objects.filter(pk=...).update(created_at=T)`).
  - [x] Кейсы: self-scope (alice не видит bob) · аноним→403 PERMISSION_DENIED · authed→200 · `since>` строго-больше (t2 исключён) · `since=notadate`→400 · ordering newest-first · LimitOffset envelope + тай-брейкер на равном `created_at` + cap 5000→200 + default 50 · write-глаголы→405 · форма из 7 полей.

- [x] **Task 9 — Гейт** (AC: 10)
  - [x] `ruff format` по КАЖДОМУ новому/тронутому файлу (не по app-папке — иначе трогает out-of-scope; урок feedback_vaps_ruff_format_scoping), затем `ruff check` (E,F).
  - [x] `make gate` зелёный; зафиксировать число прошедших тестов и время.

## Dev Notes

### Эталон — read-API 4.5 (audit). КОПИРУЙ структуру, но не семантику доступа
5.7c — почти дословный близнец `apps/audit/api/` + `apps/audit/selectors.py`. Единственное принципиальное отличие: **audit-журнал плоский** (`audit.view` → видишь всё), **notifications — личные** (`_AnyAuthenticated` + `recipient == actor_id` → видишь только своё). Не переноси `RequirePermissionMixin`/RBAC-код из audit — здесь гейт другой.

- **View — гейт:** `apps/operations/api/views.py:122` `MyPermissionsViewSet` — точный образец `_AnyAuthenticated`: читает `getattr(request, "actor_id", None)`, нет → `PermissionDenied("PERMISSION_DENIED")`, дальше скоупит по этому id. Наш `initial()` делает то же до `get_queryset`.
- **View/Selector/Serializer/Pagination:** `apps/audit/api/views.py`, `apps/audit/selectors.py`, `apps/audit/api/serializers.py`, `apps/audit/api/urls.py` — структура 1:1.
- **Тонкая вьюха:** фильтрация + порядок живут в селекторе (layer-contract, architecture.md#L451); вьюха только гейт → валидация фильтра → селектор → пагинация → сериализация. `get_queryset` НЕ трогает модель напрямую.

### ⚠️ ЛОВУШКА: `created_at = auto_now_add=True` (иначе `since`-тесты не написать)
`Notification` наследует `apps/operations/models.py:TimeStampedModel.created_at = DateTimeField(auto_now_add=True)`. Это ОТЛИЧАЕТСЯ от `AuditLog.created_at` (обычное settable-поле — `test_audit_read_api._log` сажает `created_at=_T` прямо в `create()`). `auto_now_add` **перезаписывает** любое переданное значение на `now()` при INSERT. Чтобы посадить контролируемый `created_at` для теста `since`/ordering:
```python
n = Notification.objects.create(recipient="alice", kind="SUBMISSION_LAGGING", business_date=d)
Notification.objects.filter(pk=n.pk).update(created_at=T)  # .update() обходит auto_now_add
```
`QuerySet.update()` пишет напрямую, минуя `pre_save`/`auto_now_add`. Без этого все строки получат один `now()` и `since`/ordering-тесты будут зелёными вхолостую.

### Модель Notification (что читаем; НЕ меняем поля — только добавляем индекс)
`apps/notifications/models.py` (5.7a): `recipient` (CharField100, flat actor-id ARCH-007 — то же пространство, что `request.actor_id` и `DivisionNotifyRecipient.recipient`, поэтому self-scope корректен), `kind` (TextChoices, пока `SUBMISSION_LAGGING`), `business_date` (DateField), `payload` (JSONField default=dict), `read_at` (DateTimeField null=True — read/unread для UI/E11), `created_at`/`updated_at`/`created_by` (из `TimeStampedModel`). Инварианты 5.7a — не ломать: `UniqueConstraint(recipient,kind,business_date)` (одно-на-день), `CheckConstraint chk_notification_kind` (словарь видов). Модель — бизнес-запись, НЕ в Admin.
- **Сериализуем 7 полей** (AC-6): `id, recipient, kind, business_date, payload, read_at, created_at`. `updated_at`/`created_by` — служебные, наружу не отдаём.
- **`read_at` / mark-read / unread-фильтр — ВНЕ скоупа 5.7c.** 5.7c отдаёт `read_at` в проекции (forward-useful для E11), но НЕ вводит `?unread=`, `PATCH .../read` и т.п. — это E11 (центр уведомлений). Не расширяй поверхность.

### `since` — строго больше (Q2)
`created_at > since` (не `>=`). Обоснование безопасности от tie-skip: `notify()` идемпотентен «одно-на-день» на `(recipient, kind, business_date)` — один recipient практически не получает две строки в одну микросекунду, поэтому строгий `>` не рискует пропустить строку с граничным `created_at` (в отличие от bulk-audit, где 4.4 пишет N строк одним `Clock.now()` и потому берёт `>=`+`id`-тай-брейкер). Порядок и `since` ортогональны: фильтр `>` + сортировка `-created_at, id`.

### Гейт, обработчик ошибок, аутентификация
- `REST_FRAMEWORK.DEFAULT_PERMISSION_CLASSES = []` (settings.py:176) — глобального гейта нет, каждая вьюха гейтит себя. Поэтому self-scope-гейт в `initial()` обязателен.
- Auth-цепочка (settings.py:161–168): `JWTAuthentication` [+ `XUserIdAuthentication` если `VAPS_JWT` off] + `EffectivePermissionsResolver`. Ставит `request.actor_id` (flat sub, ARCH-007) и `request.effective_permissions`. Нам нужен только `actor_id`.
- `EXCEPTION_HANDLER = domain_exception_handler` (settings.py:180): `PermissionDenied → 403 {error_code:"PERMISSION_DENIED"}`, DRF `ValidationError → 400 {error_code:"VALIDATION_ERROR"}`. Тесты ассертят `resp.data["error_code"]` — НЕ формируй `Response` руками, дай исключениям всплыть.
- Тесты гоняют через `HTTP_X_USER_ID=<id>` (как `test_audit_read_api`/`test_rbac_matrix`) — это и есть `actor_id` в тестовом контуре.

### RBAC-матрица (AR-9, story 2.9) — completeness-гейт покраснеет без строки
`apps/operations/tests/test_rbac_matrix.py::test_matrix_covers_every_registered_route` интроспектит ВСЕ роуты резолвера; новый `notification-list` без строки в `MATRIX` → красный. Добавить `MATRIX["notification-list"] = _AnyAuthenticated()` (класс уже есть, строки 100–104). `_AnyAuthenticated.expected`: аноним `DENY`, любой actor `ALLOW` — ровно наша семантика (self-scope сужает СОДЕРЖИМОЕ, не ДОСТУП). Поведенческий тест: authed actor → `≠403` (200 с пустым списком проходит ALLOW), аноним → `403`. `_AnyAuthenticated` НЕ требует seed-права → `seed_operations` не трогаем (AC-3).

### Отложенные обязательства 5.7a, закрываемые здесь (deferred-work.md L495–496)
- **B9 (индекс):** «read-API 5.7c фильтрует/сортирует вне leftmost-prefix уникального ключа» → добавить `Index(recipient, -created_at, id)`. Реальный запрос 5.7c — `recipient=? AND created_at>? ORDER BY -created_at,id`, поэтому индекс на `(recipient, created_at)` (с `id`), НЕ на `read_at` (unread-фильтра в 5.7c нет).
- **F6 (isolation-гвард):** «`test_isolation` не сканирует `notifications`» → добавить `apps/notifications/tests/test_isolation.py` (notifications↛`apps.core.models`). Сегодня нарушения нет — форвардная защита теперь, когда app обзавёлся API-слоем.

### Границы (что 5.7c НЕ делает)
НЕ пишет уведомления (`notify()` — 5.7a; детект — 5.7b2) · НЕ вводит RBAC-код/не трогает `seed_operations` · НЕ `retrieve`-by-id (list-only) · НЕ unread-фильтр / mark-read / `read_at`-мутации (E11) · НЕ WebSocket-доставку (E11) · НЕ Admin-регистрацию `Notification` (бизнес-запись) · НЕ меняет поля модели (только `Meta.indexes`).

### Project Structure Notes
- Целевой код — `Backend/VAPS/apps/notifications` (донор `Backend/PersonnelStatus/.../apps/notifications` — визуальный/референс-эталон, НЕ трогать; project_vaps_ux_spines / project_vaps_architecture).
- Новая папка `apps/notifications/api/` (нужен `__init__.py`) — зеркало `apps/audit/api/`. `selectors.py` — на уровне app (как `apps/audit/selectors.py`), не внутри `api/`.
- App-label `notifications` (`apps/notifications/apps.py`), уже в `INSTALLED_APPS` (5.7a).
- Счёт файлов: 6 create (`selectors.py`, `api/__init__.py`, `api/serializers.py`, `api/views.py`, `api/urls.py`, миграция `0002`) + 2 test-create (`test_notifications_read_api.py`, `test_isolation.py`) + 3 modify (`config/urls.py`, `models.py`, `test_rbac_matrix.py`). Выше эвристики «≤5 файлов», но это ЕДИНАЯ ответственность (read-API-слой) + 2 приклеенных к 5.7c defer-обязательства (индекс/гвард — 5.7a явно сказал «добавить вместе с 5.7c»); дробить 1-строчный индекс/гвард в отдельные стори — оверинжиниринг. Зеркалит объём read-API 4.5.

### References
- [Source: epics.md#L767] — «5.7c — `GET /notifications/?since=` read-API: endpoint + serializer + permission + since-фильтр (доставка готова к WS E11). API-слой (паттерн 5.8). Зависит от 5.7a.»
- [Source: epics.md#L757] — AC 5.7: «GET /notifications/?since= возвращает новые.»
- [Source: apps/audit/api/views.py, selectors.py, serializers.py, urls.py] — эталон read-API (тонкая вьюха, селектор-read-канал, LimitOffset, GET-only 405).
- [Source: apps/operations/api/views.py:122 MyPermissionsViewSet] — образец `_AnyAuthenticated`-гейта (actor_id → иначе 403).
- [Source: apps/notifications/models.py] — модель `Notification` (5.7a); поля, инварианты, `read_at`.
- [Source: apps/operations/models.py:12] — `TimeStampedModel.created_at = auto_now_add` (ловушка тестов `since`).
- [Source: apps/operations/tests/test_rbac_matrix.py:100,131] — `_AnyAuthenticated` + прецедент `ops-my-permissions-list`; completeness-гейт AR-9.
- [Source: apps/operations/tests/test_isolation.py] — образец AST-гварда изоляции app.
- [Source: config/settings.py:161–180] — auth-цепочка, `DEFAULT_PERMISSION_CLASSES=[]`, `EXCEPTION_HANDLER`.
- [Source: deferred-work.md#L495-496] — defer 5.7a B9 (индекс) + F6 (isolation-гвард) → закрыть в 5.7c.
- [Source: apps/audit/tests/test_audit_read_api.py] — структура тестов read-API (gate/filter/ordering/pagination/405/shape).
- [Source: memory feedback_vaps_ruff_format_scoping] — `ruff format` по файлу, не по app-папке.
- [Source: memory feedback_vaps_arch_guards] — тестируемые инварианты (operations↛core.models, audit-coverage, Admin=справочники).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — `claude-opus-4-8[1m]`

### Debug Log References

- `make gate` (Backend/VAPS): **1655 passed, 25 deselected, ruff чист, makemigrations --check пуст, 26s** (< 300s NFR-8).
- `apps/notifications/` изолированно: 28 passed (12 5.7a + 15 read-API + 1 isolation).
- `test_rbac_matrix.py`: 385 passed (incl. поведенческие `notification-list`: аноним→403, каждая роль→ALLOW).

### Implementation Plan / Decisions

- **TDD red→green:** тесты read-API написаны первыми (RED: `ModuleNotFoundError apps.notifications.api`), затем реализация (GREEN: 15/15). RBAC-матрица: подтверждён RED (`notification-list` missing) → добавлена строка → 385 green.
- **Роутинг — уточнение задачи 4:** вместо `router.register("", …)` (у `DefaultRouter` пустой префикс конфликтует `api-root` с list на `^$`) — явный `path("", NotificationViewSet.as_view({"get": "list"}), name="notification-list")`. Даёт ровно `/api/notifications/`, list-only, и сохраняет `.cls`/`.actions` на callback для интроспекции AR-9.
- **Гейт = аутентификация:** `initial()` (после `super().initial()`) — нет `actor_id` → `PermissionDenied("PERMISSION_DENIED")`; OPTIONS/metadata пропускаются. Без `RequirePermissionMixin`/RBAC-кода; `seed_operations` не тронут (реш. Q1).
- **Self-scope безусловный:** `NotificationSelector.list` — `filter(recipient=actor)` первым и всегда; `since` → `created_at__gt` (реш. Q2, строго больше). Порядок `(-created_at, id)`.
- **Индекс имени ≤30:** первый вариант `ix_notification_recipient_recency` (33) отклонён `models.E034` → `ix_notif_recipient_recency` (26).
- **ruff в миграции:** авто-строка `AddIndex` дала E501 (в отличие от 0005, где overflow — неразрывный токен) → `ruff format` по файлу (per-file, не по app-папке).

### Completion Notes List

- ✅ AC1 endpoint `GET /api/notifications/` (route `notification-list`, list-only, GET/HEAD/OPTIONS).
- ✅ AC2 строгий self-scope (alice не видит bob; `?recipient=bob` не расширяет).
- ✅ AC3 аноним→403 PERMISSION_DENIED; любой actor→200 (даже пусто), без RBAC-кода.
- ✅ AC4 `since` строго `>`; опущен→все свои; `notadate`→400 VALIDATION_ERROR.
- ✅ AC5 порядок `(-created_at, id)` newest-first; LimitOffset конверт, default 50 / cap 200.
- ✅ AC6 форма из 7 snake_case полей.
- ✅ AC7 write-глаголы→405.
- ✅ AC8 `MATRIX["notification-list"] = _AnyAuthenticated()`; completeness+поведенческие зелёные.
- ✅ AC9 defer 5.7a закрыты: индекс `(recipient,-created_at,id)` (миграция 0002) + гвард `notifications↛apps.core.models`.
- ✅ AC10 `make gate` зелёный.
- Границы соблюдены: не тронуты `notify()`/детект/seed/Admin/поля модели; retrieve/unread/mark-read/WS — вне 5.7c.

### File List

**Created:**
- `Backend/VAPS/apps/notifications/selectors.py`
- `Backend/VAPS/apps/notifications/api/__init__.py`
- `Backend/VAPS/apps/notifications/api/serializers.py`
- `Backend/VAPS/apps/notifications/api/views.py`
- `Backend/VAPS/apps/notifications/api/urls.py`
- `Backend/VAPS/apps/notifications/migrations/0002_notification_ix_notif_recipient_recency.py`
- `Backend/VAPS/apps/notifications/tests/test_notifications_read_api.py`
- `Backend/VAPS/apps/notifications/tests/test_isolation.py`

**Modified:**
- `Backend/VAPS/config/urls.py` (монтаж `api/notifications/`)
- `Backend/VAPS/apps/notifications/models.py` (`Meta.indexes` — recency-индекс)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (строка `notification-list`)

## Change Log

| Дата | Версия | Изменение | Автор |
|------|--------|-----------|-------|
| 2026-07-01 | 0.1 | Создана стори (bmad-create-story) | Bratan |
| 2026-07-01 | 1.0 | Реализован read-API `GET /api/notifications/?since=` (TDD): selector self-scope + serializers + list-only ViewSet + routing + recency-индекс (миграция 0002) + isolation-гвард + строка RBAC-матрицы. Закрыты defer 5.7a B9/F6. `make gate` зелёный (1655 passed). Status → review | Amelia (dev-story) |
