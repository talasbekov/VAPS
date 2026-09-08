# UC-RAT-003. Анализировать состояние службы и мероприятий

| Поле | Значение |
|---|---|
| Модуль | Рейтинг и аналитика |
| Актор | ANALYST, HEAD_DEPARTMENT_LINE (`analytics.view` + `analytics.drilldown` + `analytics.operations`); DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER, AUDITOR, OPS_STAFF (`analytics.view`); EVENT_OFFICER, HEAD_DIRECTORATE_LINE, HEAD_OPS_UNIT (`analytics.operations`); ADMIN |
| Статус | Done |
| Основание | `apps/ops/analytics.py` (resolve_period, list_presets, service_analytics, drilldown, attention, load_analytics, operations_analytics, read_custom_period_limit, read_attention_policy, read_load_policy), `apps/operations/models_analytics.py` (OpsAnalyticsMetricDefinition, OpsAnalyticsPeriodPreset, OpsAttentionDetector), `OpsPolicySetting` секции ANALYTICS/ATTENTION/LOAD_POLICY, вьюсеты `ServiceAnalyticsViewSet` (`GET /api/ops/service-analytics/?preset|from,to`), `ServiceAnalyticsPresetsViewSet` (`GET /service-analytics-presets/`), `ServiceAnalyticsDrilldownViewSet` (`GET /service-analytics-drilldown/?snapshot_id&metric_code&preset|from,to&cursor`), `ServiceAnalyticsAttentionViewSet` (`GET /service-analytics-attention/`), `LoadAnalyticsViewSet` (`GET /load-analytics/`), `OperationsAnalyticsViewSet` (`GET /operations-analytics/?level&object_id&event_id&direction_id&post_id`), `RatingAnalyticsViewSet` (`GET /rating-analytics/`), FRONT `app/security-ops/analytics/page.tsx`, `app/security-ops/analytics/operations/page.tsx`, `app/security-ops/ratings/analytics/page.tsx`, `hooks/use-ops-analytics.ts`, `hooks/use-ops-ratings.ts::useRatingAnalytics`, `entities/service-analytics` |
| Дата актуализации | 2026-09-08 |

## Цель
Аналитик видит посчитанные сервером показатели состояния службы за период, раскрывает показатель до строк, читает блок «требует внимания», нагрузку, аналитику мероприятий по уровням и аналитику рейтинга.

## Предусловия
- Пользователь аутентифицирован; `analytics.view` для аналитики службы и рейтинга, `analytics.drilldown` для разбора по строкам, `analytics.personal_detail` для поимённых строк, `analytics.operations` для аналитики ОМ.
- В базе заведены пресеты периодов `OpsAnalyticsPeriodPreset`, показатели `OpsAnalyticsMetricDefinition`, детекторы `OpsAttentionDetector` и политики в `OpsPolicySetting` (предел произвольного периода, политика внимания, `LOAD_POLICY`); отсутствие политики — отдельное состояние с причиной.

## Main Flow
1. Актор открывает «Аналитика службы» (`/security-ops/analytics`).
2. Система отдаёт пресеты периода и предел произвольного периода (`GET /service-analytics-presets/`).
3. Актор выбирает пресет либо задаёт даты «с»/«по».
4. Система считает период на сервере и отдаёт снимок показателей (`DUTY_ACTIVE`, `DUTY_PLANNED`, `REST_AFTER_DUTY`, `UNFINISHED_PAST_DUTIES`, `CONFLICT_HARD`, `CONFLICT_SOFT`, `UNCONFIRMED_PARTICIPATION`) с `displayValue`, состоянием по порогам, `snapshotId`, версиями расчёта/методики/политики, признаком `drilldownAllowed` и списком недоступных показателей (`GET /service-analytics/`).
5. Актор нажимает разбор показателя; система по тому же `snapshotId` отдаёт страницу строк (25, курсор) — дата, объект, состояние, сотрудник (поимённо только при `analytics.personal_detail`, иначе `personalDetailSuppressed` с причиной) (`GET /service-analytics-drilldown/`).
6. Система отдаёт блок «требует внимания»: детекторы с политикой из «Настроек», severity `CRITICAL/WARNING/INFO`, целевые маршруты (`GET /service-analytics-attention/`), и блок нагрузки: план и факт отдельными полями, окраска только по плану по порогам `LOAD_POLICY` (`GET /load-analytics/`).
7. Актор переходит в «Аналитика ОМ» (`/security-ops/analytics/operations`), проваливается по уровням ALL → OBJECT → EVENT → DIRECTION → POST (breadcrumb); система отдаёт колонки уровня, строки, распределение по этапам жизненного цикла, воронку по журналу переходов ОМ и обеспеченность личным составом (`GET /operations-analytics/`).
8. Актор открывает «Аналитика рейтинга» (`/security-ops/ratings/analytics`); система отдаёт полосы распределения, средние по группам с подавлением малых групп по порогу политики, покрытие и число исправленных (`GET /rating-analytics/`).
9. Актор обновляет снимок кнопкой обновления; экран показывает время обновления.

## Alternative Flow
- **AF1. Нет права**: шаги 1, 4, 6, 8 без `analytics.view` и шаг 7 без `analytics.operations` → 403, экран `OpsAccessDenied`; шаг 5 без `analytics.drilldown` → 403 `PERMISSION_DENIED` от сервиса (экран не показывает кнопку: `drilldownAllowed=false` с `drilldownDeniedReason`).
- **AF2. Период не задан**: шаги 4–6 → 400 `VALIDATION_ERROR` (ни `preset`, ни `from/to`).
- **AF3. Некорректный период**: 422 `UNKNOWN_PERIOD_PRESET` «Неизвестный период.»; `INVALID_PERIOD` (неверные даты / «Начало периода позже его конца.»); `PERIOD_LIMIT_UNAVAILABLE` (предел произвольного периода не настроен); `PERIOD_TOO_LONG` (длиннее предела из настроек).
- **AF4. Снимок устарел / неизвестный показатель**: шаг 5 → 422 `SNAPSHOT_OUTDATED` (данные изменились после снимка — выборка не подменяется молча), 422 `UNKNOWN_METRIC` «Неизвестный показатель.»; экран показывает `drilldownQuery.error.message`.
- **AF5. Политика внимания или детекторы отсутствуют**: шаг 6 → `detectionState=UNAVAILABLE` с `detectionUnavailableReason`; политика нагрузки отсутствует → блок нагрузки в состоянии без порогов с причиной.
- **AF6. Воронка недоступна на уровне**: шаг 7 → `funnel=null` с `funnelUnavailableReason`; факт обеспеченности недоступен → `unavailableReason` в строке.
- **AF7. Рейтинг выключен флагом**: шаг 8 → состояние `FEATURE_DISABLED` (экран печатает подпись); порог подавления не задан → группы без подавления с причиной.
- **AF8. Ошибка загрузки**: экран показывает `LoadFailure` / текст ошибки с кнопкой повтора.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| Смены и виды дежурств (`OpsDutyShift`, `OpsDutyType`, `OpsDutyConflictPolicy`), мероприятия и журнал переходов (`OpsSecurityEvent`, `OpsSecurityEventTransition`), реестры аналитики, `OpsPolicySetting`, оценки рейтинга | read | Все ручки только читают и считают снимок на лету; хранимых снимков нет |
| HTTP-аудит `apps/audit` | — | GET-запросы middleware не пишет |

## Бизнес-требования (BR)
- **BR1.** Период задаётся либо кодом пресета, либо парой дат; период считает сервер; произвольный период ограничен пределом из «Настроек» (без предела — отказ, а не умолчание).
- **BR2.** Все числа считаются сервером (§22.3); экран не суммирует строки и не назначает цвет по числу — состояние показателя (`_metric_state`) приходит по порогам `warning_from`/`critical_from` определения показателя; порог NULL — справочный показатель без тревоги.
- **BR3.** Снимок детерминирован входом (`snapshotId` = ревизия данных + период + scope + версия расчёта `service-analytics-2026.07.1`); разбор относится к тому же снимку, иначе `SNAPSHOT_OUTDATED`.
- **BR4.** Разбор по строкам — постранично по 25 с курсором; поимённые строки только при `analytics.personal_detail`, иначе `employeeLabel=null` с причиной.
- **BR5.** Детекторы внимания берут параметры/пороги из политики «Настроек» поверх методики `OpsAttentionDetector`; severity ранжируется CRITICAL → WARNING → INFO; у детектора есть целевой маршрут и право.
- **BR6.** Нагрузка: план и факт — разные поля; окраска только по плану; пороги и период — из `LOAD_POLICY`.
- **BR7.** Аналитика ОМ: уровни `ALL/OBJECT/EVENT/DIRECTION/POST`, воронка строится по журналу переходов (`transitionCount`, `exclusionNote`), распределение по lifecycle — на уровнях ALL/OBJECT; версия расчёта `operations-analytics-2026.07.1`.
- **BR8.** Аналитика рейтинга: группы сортируются по подписи (не по значению), группа меньше порога подавления (`RATING.SUPPRESSION_MIN_GROUP.PARAMETER`) приходит без значения.
- **BR9.** Недоступные показатели, блоки, детекторы и меры (`UNAVAILABLE_METRICS`, `UNAVAILABLE_HEADER_BLOCKS`, `UNAVAILABLE_DETECTORS`, `LOAD_UNAVAILABLE`, `UNAVAILABLE_OPS_MEASURES`) отдаются с причиной вместе с ответом.
- **BR10.** Часовой пояс расчёта — `Asia/Almaty`.

## Требования к логированию
- Ручки аналитики только читают: в журнал раздела `audit_service` и в HTTP-аудит (только write-запросы) ничего не пишется.
- `logging.getLogger` в `analytics.py`, `views.py` не используется.
- Отказы по `analytics.drilldown` / `analytics.personal_detail` и факт просмотра поимённых строк не журналируются — `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный | `*` |
| ANALYST | аналитика службы + разбор + аналитика ОМ + аналитика рейтинга | `analytics.view` (`permission_map` ServiceAnalytics/Presets/Drilldown/Attention/Load/RatingAnalytics), `analytics.drilldown` (`has_perm` в `service_analytics`, `drilldown`), `analytics.operations` (`OperationsAnalyticsViewSet`) |
| HEAD_DEPARTMENT_LINE | то же, что ANALYST | `analytics.view`, `analytics.drilldown`, `analytics.operations` |
| DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER, AUDITOR | аналитика службы (без разбора) + аналитика рейтинга | `analytics.view` |
| OPS_STAFF | аналитика службы (без разбора) + аналитика ОМ | `analytics.view`, `analytics.operations` |
| EVENT_OFFICER, HEAD_DIRECTORATE_LINE, HEAD_OPS_UNIT | только аналитика ОМ | `analytics.operations`; экран `MODULE_PERMISSION["/security-ops/analytics/operations"]` |
| Поимённые строки разбора | только ADMIN | `analytics.personal_detail` не выдано ни одной роли в `ROLE_PERMISSIONS` |
| Остальные роли | нет | 403 |

## Требования к UX/UI
- **«Аналитика службы»** — страница `/security-ops/analytics`: ссылки на «Аналитика ОМ» и «Аналитика рейтинга»; выбор пресета и два поля `type="date"` («с», «по»); кнопка обновления с временем последнего обновления; плитки показателей с состоянием и кнопкой разбора (недоступна с причиной `drilldownDeniedReason`); панель разбора: таблица «Дата / Объект / Состояние / Сотрудник», «Всего строк», кнопка следующей страницы (отключена при `nextCursor=null`), строка `personalDetailReason`; секция нагрузки (`LoadSection`); блок «требует внимания» с severity-окраской и ссылками; блок численности (`status.view`); состояния: загрузка, ошибка с текстом, `UNAVAILABLE` с причиной.
- **«Аналитика ОМ»** — `/security-ops/analytics/operations`: breadcrumb уровней с переходами, кнопка возврата на «ALL», карточка воронки (`FunnelCard`: выбор меры, таблица «Этап / Конверсия / меры», `transitionCount`, `exclusionNote`, причина недоступности), карточка «Структура мероприятий» (ALL/OBJECT), карточка «Обеспеченность личным составом» (план/факт, `unavailableReason`), таблица строк уровня с проваливанием; состояния: загрузка, `LoadFailure`.
- **«Аналитика рейтинга»** — `/security-ops/ratings/analytics`: полосы распределения, средние по группам (подавленная группа без значения), покрытие, число исправленных, подпись `FEATURE_DISABLED`, «Что не показывается».
- Нет права — `OpsAccessDenied`.

## Открытые вопросы
- `analytics.personal_detail` не выдано ни одной роли в `seed_operations.py` — поимённый разбор доступен только ADMIN.
- Перечни недоступного объявляются сервером с причиной: `UNAVAILABLE_METRICS`, `UNAVAILABLE_HEADER_BLOCKS`, `UNAVAILABLE_DETECTORS`, `LOAD_UNAVAILABLE`, `UNAVAILABLE_OPS_MEASURES` (`analytics.py` ~115–270) — состав показателей меньше прототипа.
- Хранимых снимков и фоновых пересчётов нет: каждый запрос считает заново по живым данным; CELERY_BEAT_SCHEDULE отсутствует.
- Аналитика рейтинга зависит от флага `operational_ratings` и порога подавления из `RATING_POLICY`; без порога подавление не применяется (`read_suppression_min_group() = None`).
- Экран аналитики службы дополнительно читает численность по `status.view` (другой модуль) — гейт раздельный.
