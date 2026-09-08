# UC-RAT-002. Просмотреть сводный рейтинг, динамику, аудит оценок и выгрузить рейтинг

| Поле | Значение |
|---|---|
| Модуль | Рейтинг и аналитика |
| Актор | RATING_EVALUATOR, ANALYST (`rating.view_aggregate`), ANALYST (`rating.export`), AUDITOR (`rating.view_audit`), ADMIN |
| Статус | Partial |
| Основание | `apps/ops/ratings.py` (list_operational_ratings, rating_dynamics, rating_employee_detail, rating_audit, rating_notifications, list/create/cancel_rating_export, download_rating_export, _advance_export, read_rating_policy, read_feature_flags, build_summary, UNAVAILABLE_RATING_FACTORS/VIEWS/EXPORT_*), `apps/operations/models_rating.py` (OpsRatingAuditEntry, OpsRatingExportJob, OpsRatingExportArtifact, OpsRatingDynamicsPoint, OpsRatingFeatureFlags, OpsRatingNotification), `apps/operations/models_settings.py` (OpsPolicySetting секция RATING_POLICY), вьюсеты `OperationalRatingsViewSet` (`GET /api/ops/operational-ratings/`), `OperationalRatingDynamicsViewSet` (`GET /operational-rating-dynamics/?employee=`), `OperationalRatingEmployeeViewSet` (`GET /operational-rating-employee/?employee=`), `RatingAuditViewSet` (`GET /rating-audit/?page=`), `RatingNotificationsViewSet`, `RatingExportsViewSet` (`GET/POST /rating-exports/`, `POST …/{id}/cancel/`), `RatingExportArtifactsViewSet` (`POST /rating-export-artifacts/{id}/download/`), FRONT `app/security-ops/ratings/page.tsx`, `ratings/employees/[employeeId]/page.tsx`, `ratings/audit/page.tsx`, `ratings/export/page.tsx`, `features/ops-ratings/rating-dynamics-section.tsx`, `hooks/use-ops-ratings.ts` |
| Дата актуализации | 2026-09-08 |

## Цель
Актор видит агрегированный рейтинг участников без закрытых данных, динамику по сотруднику, журнал оценивания и заказывает выгрузку сводного рейтинга в CSV.

## Предусловия
- Пользователь аутентифицирован; права по экранам: `rating.view_aggregate` (сводка, динамика, карточка), `rating.view_audit` (журнал), `rating.export` (выгрузка).
- Заведены флаги `OpsRatingFeatureFlags` (иначе 422 «Флаги оперативного рейтинга не настроены») и политика `RATING_POLICY` в `OpsPolicySetting` (`RATING.PERIOD.PARAMETER`, `RATING.MIN_EVALUATIONS.PARAMETER`, `RATING.SUPPRESSION_MIN_GROUP.PARAMETER`); без политики агрегаты отдаются в состоянии `POLICY_UNDEFINED`.

## Main Flow
1. Актор открывает «Оперативный рейтинг» (`/security-ops/ratings`).
2. Система считает для каждого участника среднее учтённых оценок периода политики, округлённое до одного знака, и отдаёт строки, отсортированные по подписи, с состоянием данных (`READY` / `INSUFFICIENT_DATA` / `POLICY_UNDEFINED` / `FEATURE_DISABLED`), методикой, периодом, минимумом оценок, шкалой, а также перечни недоступных факторов и представлений (`GET /operational-ratings/`).
3. Актор в секции динамики выбирает сотрудника; система отдаёт ряд точек `OpsRatingDynamicsPoint` с границами политики (`GET /operational-rating-dynamics/?employee=`; без параметра — первый участник).
4. Актор открывает карточку сотрудника (`/security-ops/ratings/employees/{employeeId}`); система отдаёт агрегат, число учтённых оценок, период, версию методики, дату расчёта и агрегированную динамику без отдельных оценок и оценщиков (`GET /operational-rating-employee/?employee=`).
5. Ревизор открывает «Журнал оценивания» (`/security-ops/ratings/audit`); система отдаёт постранично (20) записи «что произошло» — успехи и отказы без значений оценок (`GET /rating-audit/?page=`).
6. Аналитик открывает «Экспорт» (`/security-ops/ratings/export`) и заказывает выгрузку «Сводный рейтинг · CSV» (`POST /rating-exports/` `{scope: AGGREGATE, format: CSV, idempotencyKey}`, 201).
7. Система создаёт задание `QUEUED`, при следующем чтении списка продвигает его `GENERATING` → `READY`, собирая артефакт CSV из сводки (столбцы `AGGREGATE_EXPORT_COLUMNS`, версия политики, число строк), пишет запись журнала оценивания об успехе заказа.
8. Актор видит свои выгрузки (`GET /rating-exports/`), отменяет незавершённую (`POST /rating-exports/{id}/cancel/`) или скачивает готовую (`POST /rating-export-artifacts/{id}/download/`) — файл выдаёт отдельная серверная операция.
9. Оценщик видит собственные уведомления рейтинга (`GET /rating-notifications/`) в рабочем пространстве.

## Alternative Flow
- **AF1. Нет права**: шаги 1–5 → 403 `RequirePermissionMixin`, экран `OpsAccessDenied`; шаги 6–8 → 403 `PERMISSION_DENIED` от сервиса с записью отказа в журнал оценивания.
- **AF2. Рейтинг выключен флагом `operational_ratings`**: шаги 2–4 → строки в состоянии `FEATURE_DISABLED` (экран печатает подпись состояния); флаг `rating_conflicts` в `capabilities.ratingConflicts`.
- **AF3. Политика не задана**: шаг 2 → `dataState=POLICY_UNDEFINED`, экран: «Методика расчёта не определена»; порог подавления не задан → `read_suppression_min_group() = None`.
- **AF4. Оценок меньше минимума политики**: шаги 2, 4 → `INSUFFICIENT_DATA` с причиной; карточка показывает пояснение.
- **AF5. Параметр `employee` не указан / неизвестен**: шаг 4 → 400 `VALIDATION_ERROR` «Проверьте заполнение формы.» / 404 `ENTITY_NOT_FOUND`.
- **AF6. Заказ индивидуальной выгрузки**: шаг 6 → 422 `SENSITIVE_EXPORT_UNAVAILABLE` (закрытые данные требуют scope и срока полномочия); отказ в журнал.
- **AF7. Неподдерживаемый формат**: шаг 6 → 422 `EXPORT_FORMAT_UNAVAILABLE` «Формат не собирается в этой сборке: доступен CSV.»; неизвестный scope → 400 `VALIDATION_ERROR`.
- **AF8. Повтор заказа с тем же `idempotencyKey`**: шаг 6 → возвращается существующее задание (`idempotency_key unique`).
- **AF9. Отмена завершённого / скачивание неготового**: шаг 8 → 422 `EXPORT_NOT_CANCELLABLE` «Работа уже завершена: отменять нечего.» / 422 `EXPORT_NOT_READY` «Файл не выдан: работа не в состоянии «Готов».»; сбой сборки → задание `FAILED` с `failure_code` и безопасным сообщением.
- **AF10. Некорректный `page`**: шаг 5 → страница 1.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_rating_export_jobs` (OpsRatingExportJob) | create | scope=AGGREGATE, format=CSV, state=QUEUED, requested_at/by, idempotency_key |
| `ops_rating_export_jobs.state` | update | QUEUED→GENERATING→READY (артефакт) / FAILED (failure_code, safe_failure_message) / CANCELLED, finished_at |
| `ops_rating_export_artifacts` (OpsRatingExportArtifact) | create | file_name, generated_at, policy_version, row_count, content (CSV текстом в БД) |
| `ops_rating_audit_entries` | create | Успех заказа выгрузки; отказы `PERMISSION_DENIED`, `SENSITIVE_EXPORT_UNAVAILABLE`, `EXPORT_FORMAT_UNAVAILABLE` (request_id = idempotencyKey) |
| HTTP-аудит `apps/audit` | create | AuditMiddleware на POST create/cancel/download |
| Сводка, динамика, карточка, журнал, уведомления, список выгрузок | read | `GET /operational-ratings/`, `/operational-rating-dynamics/`, `/operational-rating-employee/`, `/rating-audit/`, `/rating-notifications/`, `/rating-exports/` |

## Бизнес-требования (BR)
- **BR1.** Агрегат — среднее учтённых оценок участника за период политики (`RATING.PERIOD.PARAMETER` дней, включая бизнес-дату), округление половинки вверх до одного знака, считается только сервером.
- **BR2.** Учтённые оценки — в периоде, не вытесненные исправлением (`superseded_by_code is null`) и не снятые (`withdrawn_at is null`); все оценки равнозначны (весов оценщиков нет).
- **BR3.** Агрегат выдаётся только при числе оценок ≥ `RATING.MIN_EVALUATIONS.PARAMETER`, иначе `INSUFFICIENT_DATA`; отсутствие политики — `POLICY_UNDEFINED`, а не ноль.
- **BR4.** Строки сводки сортируются по подписи, не по значению (таблица лидеров запрещена §22.16); закрытые поля (score отдельных оценок, оценщик, комментарии) в сводке, карточке, журнале и выгрузке не выдаются.
- **BR5.** Журнал оценивания постраничный (20 записей), содержит исходы и коды причин без значений оценок.
- **BR6.** Уведомления отдаются только адресату (`recipient_user_id = актор`) — отбор и есть право.
- **BR7.** Выгрузка — только `scope=AGGREGATE`, `format=CSV`; индивидуальная выгрузка запрещена; ключ идемпотентности уникален; артефакт собирается один раз на переходе в `READY` и не пересобирается; отменить можно только `QUEUED`/`GENERATING`; скачать — только `READY` с артефактом.
- **BR8.** Пользователь видит только свои выгрузки (`requested_by = актор`).
- **BR9.** Точки динамики уникальны по участнику и периоду (`OpsRatingDynamicsPoint` UniqueConstraint) и несут версию политики и состояние данных.

## Требования к логированию
- Журнал оценивания `OpsRatingAuditEntry`: заказ/отказ выгрузки с `request_id=idempotencyKey`, отказы по правам (`record_rejection`, отдельная транзакция).
- HTTP-аудит write-запросов — AuditMiddleware `apps/audit`.
- `logging.getLogger` не используется.
- Просмотр сводки, карточки сотрудника, журнала и скачивание артефакта в журнал оценивания не пишутся — `Не реализовано в коде` (у download — только отказ по праву).

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный | `*` |
| RATING_EVALUATOR | сводка, динамика, карточка, реестр | `rating.view_aggregate` — `permission_map` OperationalRatings/Dynamics/Employee/Registry |
| ANALYST | сводка, динамика, карточка, реестр + выгрузка | `rating.view_aggregate`, `rating.export` (проверка `has_perm` в `list/create/cancel/download_rating_export`) |
| AUDITOR | журнал оценивания + цепочка исправлений | `rating.view_audit` — `RatingAuditViewSet.permission_map`; `rating.view_correction_chain` |
| Любой аутентифицированный | свои уведомления | `RatingNotificationsViewSet` без права — отбор по адресату |
| Остальные роли | нет | 403 |

## Требования к UX/UI
- **«Оперативный рейтинг»** — страница `/security-ops/ratings`: блок методики («Методика», «Период расчёта», «Минимум оценок», «Шкала»; при `POLICY_UNDEFINED` — «Методика расчёта не определена»), таблица участников с подписью состояния (`DATA_STATE_LABEL`), секция динамики `RatingDynamicsSection` (выбор сотрудника, ряд точек, состояние «сотрудник ещё не выбран»), блоки «Что не учитывается» (`unavailableFactors`) и «Что не показывается» (`unavailableViews`); состояния: «Загрузка рейтинга…», ошибка.
- **Карточка сотрудника** — `/security-ops/ratings/employees/{employeeId}`: ссылка «назад» на сохранённый запрос реестра (`back`), описание агрегата (состояние, учтено, период, методика, дата расчёта), пояснения для `INSUFFICIENT_DATA` и `POLICY_UNDEFINED`, агрегированная динамика, «Что не показывается».
- **«Журнал оценивания»** — `/security-ops/ratings/audit`: таблица записей (время, актор, событие, исход, причина, коды связей), пагинация; «Что не показывается».
- **«Экспорт»** — `/security-ops/ratings/export`: блок «Заказать выгрузку» с одной кнопкой «Сводный рейтинг · CSV»; таблица «Мои выгрузки рейтинга» (состояние, время, файл); у `READY` — кнопка «Скачать», у `QUEUED`/`GENERATING` — «Отменить»; ошибки `download.error`/`cancel.error` текстом; блок «Что не выгружается» (`unavailableScopes` + `unavailableFormats`). Состояния: «Загрузка выгрузок…», ошибка.
- Нет права — `OpsAccessDenied`.

## Открытые вопросы
- Сервер объявляет нереализованными и отдаёт с причиной: веса оценщиков (`EVALUATOR_WEIGHTS`), распределение групповой оценки (`GROUP_EVALUATION`), учёт суточных дежурств (`DUTY_SHIFTS`), часы службы (`SERVICE_HOURS`) — `UNAVAILABLE_RATING_FACTORS` (`ratings.py` ~87–127); основание статуса Partial.
- Флаги `operational_ratings` / `rating_conflicts` — хранимый синглтон; при выключенном флаге все агрегаты уходят в `FEATURE_DISABLED`; отдельного UI для переключения флагов нет (только сид/Admin) — `Не определено в коде`.
- Выгрузка продвигается по состояниям синхронно при чтении списка (`_advance_export` в `list_rating_exports`), фоновой очереди нет; CELERY_BEAT_SCHEDULE отсутствует.
- Доступен единственный формат CSV и единственный режим AGGREGATE; XLSX/PDF и индивидуальная выгрузка — в `UNAVAILABLE_EXPORT_FORMATS/SCOPES`.
- Точки динамики `OpsRatingDynamicsPoint` — хранимые строки; пишет их только сид `seed_operations` (`update_or_create`); в рабочем коде `ratings.py` их никто не создаёт — динамика на живых данных `Не реализовано в коде`.
- Скачивание артефакта — `POST …/download/` с содержимым в теле ответа (CSV хранится в поле `content` БД), а не файловая ссылка.
