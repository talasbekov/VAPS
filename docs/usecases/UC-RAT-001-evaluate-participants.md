# UC-RAT-001. Оценить участников мероприятия и исправить оценку

| Поле | Значение |
|---|---|
| Модуль | Рейтинг и аналитика |
| Актор | RATING_EVALUATOR (`rating.evaluate`, `rating.correct`), AUDITOR (`rating.view_correction_chain` — цепочка исправлений), ADMIN |
| Статус | Done |
| Основание | `apps/ops/ratings.py` (evaluation_workspace, submit_evaluation, correct_evaluation, submitted_evaluation_detail, open_evaluation_for_event, _validate_submission, EVALUATION_BASES), `apps/operations/models_rating.py` (OpsRatingGroup, OpsRatedParticipant, OpsEvaluationEvent, OpsEventEvaluation, OpsEvaluationWorkItem, OpsEvaluationCorrection, OpsRatingIdempotencyRecord, OpsRatingNotification, OpsRatingAuditEntry, OpsRatingFeatureFlags), `EvaluationWorkspaceViewSet` (`GET /api/ops/evaluation-workspace/?event=`), `EvaluationWorkItemViewSet` (`POST /evaluation-work-items/{id}/submit/`, `POST …/correct/`, `GET …/detail/`), `EvaluationRegistryViewSet` (`GET /evaluation-registry/`), `RatingNotificationsViewSet` (`GET /rating-notifications/`), `apps/ops/security_events.py` (вызовы `open_evaluation_for_event` при входе в CONDUCT и закрытии), FRONT `app/security-ops/ratings/workspace/page.tsx`, `app/security-ops/ratings/evaluations/page.tsx`, `features/ops-ratings/*`, `hooks/use-ops-ratings.ts`, `entities/operational-rating` |
| Дата актуализации | 2026-09-08 |

## Цель
Оценщик выставляет оценки участникам мероприятия по своим заданиям и при необходимости исправляет собственную оценку с указанием причины, сохраняя цепочку исправлений.

## Предусловия
- Пользователь аутентифицирован; для очереди и отправки — `rating.evaluate`, для исправления — `rating.correct`.
- Флаги рейтинга `OpsRatingFeatureFlags` (singleton_key=1) заведены (сид `seed_operations`: `operational_ratings=True`, `rating_conflicts=True`); без строки — 422 «Флаги оперативного рейтинга не настроены».
- Мероприятие ОМ вошло в этап «Проведение» (CONDUCT) или закрыто: в этот момент система заводит `OpsEvaluationEvent` и задания `OpsEvaluationWorkItem` по назначениям расстановки (`open_evaluation_for_event`, идемпотентно), оценщик задания — актор перевода этапа.

## Main Flow
1. Оценщик открывает «Рабочее пространство оценивания» (`/security-ops/ratings/workspace`).
2. Система отдаёт только его задания (`evaluator_user_id = актор`), список мероприятий с его заданиями, выбранное мероприятие, очередь (всего / отправлено / осталось), прогресс мероприятия, перечень оснований и начальную оценку каждого задания (`GET /evaluation-workspace/?event=`).
3. Оценщик выбирает мероприятие и задание из очереди; видит участника, подразделение, пост, направление оценки, начальную оценку (8).
4. Оценщик выбирает оценку по шкале 1–10, основание из перечня, при основании «Другое» — пояснение, при оценке ниже 8 — комментарий с причиной; отправляет.
5. Система проверяет право, флаг, архив, статус задания, участие, ревизию; создаёт `OpsEventEvaluation` (method `MANUAL`), переводит задание в `SUBMITTED`, увеличивает `revision`, пишет уведомление `EVALUATION_SUBMITTED` оценщику и запись журнала оценивания `EVALUATION_SUBMITTED` (и `EVALUATION_SCORE_CHANGED_FROM_INITIAL`, если оценка отличается от начальной), фиксирует ключ идемпотентности (`POST /evaluation-work-items/{id}/submit/`, 201).
6. Оценщик открывает отправленную оценку (`GET /evaluation-work-items/{id}/detail/`) — видит текущее значение, основание, комментарий, актуальную ревизию и признак `canCorrect`.
7. При необходимости оценщик правит значение/основание/комментарий, указывает причину исправления и отправляет.
8. Система создаёт замещающую `OpsEventEvaluation`, помечает прежнюю `superseded_by_code`, создаёт `OpsEvaluationCorrection` (причина, кто, когда, ревизия), увеличивает `revision`, пишет уведомление `EVALUATION_CORRECTED` и запись журнала `EVALUATION_CORRECTED` (`POST …/correct/`, 201).
9. Ревизор с `rating.view_correction_chain` видит в карточке задания цепочку исправлений; оценщик и сводные экраны видят актуальную оценку в реестре «Итоговые оценки участников» (`/security-ops/ratings/evaluations`).

## Alternative Flow
- **AF1. Нет права `rating.evaluate` / `rating.correct`**: шаги 1, 5, 8 → 403 `PERMISSION_DENIED`; отказ записывается в журнал оценивания (`EVALUATION_ACCESS_DENIED`, reason `PERMISSION_DENIED`) своей транзакцией; экран без права — `OpsAccessDenied`.
- **AF2. Рейтинг выключен флагом**: шаг 2 → очередь пустая с `unavailableReason=FEATURE_DISABLED` (экран показывает блок причины); шаги 5, 8 → 422 `RATING_DISABLED`.
- **AF3. Ошибки значения** (порядок проверок закреплён): шаг 5 → 422 `SCORE_NOT_INTEGER` «Оценка выставляется целым значением шкалы.» → `SCORE_OUT_OF_SCALE` «Оценка вне шкалы 1–10.» → `BASIS_REQUIRED` «Укажите основание оценки.» → `BASIS_UNKNOWN` → `BASIS_NOTE_REQUIRED` «Основание «Другое» требует пояснения.» → `COMMENT_REQUIRED` «Оценка ниже 8 требует комментария с конкретной причиной.»; те же проверки продублированы на клиенте (`entities/operational-rating`). Отказ по `COMMENT_REQUIRED` пишется в журнал как `EVALUATION_LOW_SCORE_WITHOUT_COMMENT`.
- **AF4. Задание уже отправлено / не подтверждено участие / групповое задание**: шаг 5 → 422 `EVALUATION_ALREADY_SUBMITTED`, `PARTICIPATION_NOT_CONFIRMED`, `GROUP_EVALUATION_UNSUPPORTED`.
- **AF5. Мероприятие закрыто и архив сформирован**: шаг 5 → 422 `EVALUATION_ARCHIVE_LOCKED`.
- **AF6. Ревизия задания устарела**: шаги 5, 8 → 409 `EVALUATION_REVISION_MISMATCH` с `detail` (текущие значения vs вводимые); экран показывает `EvaluationConflictNotice` («вы вводите …»), введённый текст не стирается.
- **AF7. Чужое задание**: шаги 6, 8 → 404 `ENTITY_NOT_FOUND` (детали чужой записи не раскрываются), отказ в журнал `FOREIGN_EVALUATION`.
- **AF8. Исправлять нечего / уже исправлено / нет причины**: шаг 8 → 422 `EVALUATION_NOT_SUBMITTED`; 409 `EVALUATION_ALREADY_CORRECTED`; 422 `CORRECTION_REASON_REQUIRED` «Укажите причину исправления оценки.». Отказ пишется в журнал `EVALUATION_CORRECTION_REJECTED`.
- **AF9. Повтор запроса с тем же `idempotencyKey`**: шаги 5, 8 → система возвращает результат первой операции без второй записи (`OpsRatingIdempotencyRecord`, операции `submit`/`correct`).

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_evaluation_events`, `ops_rated_participants`, `ops_rating_groups`, `ops_evaluation_work_items` | create / update | При входе ОМ в CONDUCT или закрытии: мероприятие оценивания, участники по назначениям расстановки, задания (`status=PENDING`, `participated=True`, `initial_score=8`, `evaluator_user_id`=актор перевода) |
| `ops_event_evaluations` (OpsEventEvaluation) | create | score, comment, basis_code, basis_note, evaluation_direction, method=MANUAL, evaluated_at, evaluator_user_id |
| `ops_event_evaluations.superseded_by_code` | update | Исходная оценка помечается вытесненной при исправлении |
| `ops_evaluation_work_items` | update | status PENDING→SUBMITTED, revision+1, submitted_evaluation_code, submitted_at |
| `ops_evaluation_corrections` | create | original/replacement коды, reason, corrected_by, corrected_at, revision |
| `ops_rating_idempotency` | create | key + operation (submit/correct) → work item, evaluation |
| `ops_rating_notifications` | create | `EVALUATION_SUBMITTED`, `EVALUATION_CORRECTED` адресату (оценщику), deep_link |
| `ops_rating_audit_entries` | create | Успехи `EVALUATION_SUBMITTED`, `EVALUATION_SCORE_CHANGED_FROM_INITIAL`, `EVALUATION_CORRECTED`; отказы `EVALUATION_ACCESS_DENIED`, `EVALUATION_LOW_SCORE_WITHOUT_COMMENT`, `EVALUATION_CORRECTION_REJECTED`, `FOREIGN_EVALUATION` (отдельной транзакцией) |
| HTTP-аудит `apps/audit` | create | AuditMiddleware на POST submit/correct |
| Очередь, карточка, реестр, уведомления | read | `GET /evaluation-workspace/`, `/…/detail/`, `/evaluation-registry/`, `/rating-notifications/` |

## Бизнес-требования (BR)
- **BR1.** Шкала оценки — целые 1–10; начальная оценка задания — 8.
- **BR2.** Основание обязательно и выбирается из серверного перечня (`EVALUATION_BASES`: исполнение обязанностей, своевременное прибытие, дисциплина, знание задач поста, исполнение указаний, взаимодействие, действия в нестандартной ситуации, другое); «Другое» требует пояснения.
- **BR3.** Оценка ниже 8 требует комментария с причиной; основание комментарий не заменяет.
- **BR4.** Оценивать можно только своё задание (`evaluator_user_id = актор`) в статусе `PENDING` с подтверждённым участием; групповые задания (`target_group_code`) не поддерживаются.
- **BR5.** Отправка и исправление защищены ревизией (`revision` в теле = ревизия задания) и ключом идемпотентности (`idempotencyKey`).
- **BR6.** Исправлять может только оценщик исходной записи (`rating.correct`); причина обязательна; исправлять можно только действующую (не вытесненную) оценку; каждая исправленная оценка остаётся в цепочке (`superseded_by_code` → замещающая).
- **BR7.** При закрытом ОМ со сформированным архивом оценки не принимаются (`EVALUATION_ARCHIVE_LOCKED`).
- **BR8.** Закрытые данные (score, оценщик, комментарий чужой записи) наружу не сериализуются; очередь отбирается по актору на сервере; уведомления отдаются только адресату.
- **BR9.** Каждая попытка, включая отклонённые и запрещённые, фиксируется в журнале оценивания (§19.27) отдельной транзакцией.
- **BR10.** Задания заводятся входом объекта ОМ в этап CONDUCT и закрытием ОМ, вызов идемпотентен; оценки этапа «Проведение» (`conduct_evaluations.py`) пишутся в ту же `OpsEventEvaluation` и учитываются в среднем.

## Требования к логированию
- Журнал оценивания `OpsRatingAuditEntry` (`_audit_entry_row`, `record_rejection`): occurred_at, actor_user_id, event_code, outcome (SUCCESS/REJECTED), reason_code, security_event_code, event_run_code, assignment_code, evaluation_code, correction_code, request_id (=idempotencyKey), revision. Отказы пишутся своей транзакцией (не откатываются с отклонённой операцией).
- HTTP-аудит успешных POST — AuditMiddleware `apps/audit`.
- `logging.getLogger` в `ratings.py`, `views.py` не используется.
- Уведомления — только строки `OpsRatingNotification` (внутренние); внешней доставки (почта, SMS) — `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный | `*` |
| RATING_EVALUATOR | очередь, отправка, исправление, карточка своего задания, реестр итоговых оценок | `rating.evaluate` (`EvaluationWorkspaceViewSet.permission_map`; в `EvaluationWorkItemViewSet` право проверяет сервис первым действием — `has_perm` в `submit_evaluation`, `submitted_evaluation_detail`), `rating.correct` (`correct_evaluation`), `rating.view_aggregate` (реестр) |
| AUDITOR | цепочка исправлений в карточке задания (без права оценивать) | `rating.view_correction_chain` — `permission_bypass_map["detail_view"]`, обход гейта `rating.evaluate` в `submitted_evaluation_detail` |
| Остальные роли | нет | 403 `PERMISSION_DENIED` от сервиса (с записью в журнал) или `RequirePermissionMixin` |

## Требования к UX/UI
- **«Рабочее пространство оценивания»** — страница `/security-ops/ratings/workspace` (навигация `ratings-nav`): выбор мероприятия; сводка мероприятия (объект, состояние, фактическое начало/завершение, «Моих заданий», «Отправлено мной», «Осталось мне», методика, синхронизация); очередь заданий (участник, подразделение, пост, направление, начальная оценка, кнопка «Оценить: {участник}»); форма оценки: селект оценки 1–10, селект основания («— выберите основание —»), поле пояснения при основании с `requiresNote`, textarea комментария; ошибки полей по коду сервера (`errorFor(score|basisCode|basisNote|comment)`), `EvaluationConflictNotice` при 409, общая ошибка текстом; список отправленных оценок с кнопкой «Открыть отправленную оценку»; секция уведомлений `RatingNotificationsSection`; блок «Что не показывается» (`unavailableViews` сервера); при `FEATURE_DISABLED` — блок причины. Состояния: «Загрузка заданий…», ошибка, пусто.
- **Карточка отправленной оценки** (`SubmittedEvaluationCard`): текущие значения, кнопка исправления только при `canCorrect`; режим правки: селект оценки, селект основания, пояснение, textarea комментария, textarea причины исправления; кнопка отправки отключена без изменений (`diff.length === 0`) и во время запроса; цепочка исправлений при праве `rating.view_correction_chain`.
- **«Итоговые оценки участников»** — страница `/security-ops/ratings/evaluations`: фильтры в URL («Период с», «Период по», «Мероприятие», «Подразделение», «Сотрудник», «Направление», «Метод», «Поиск» с подсказкой «Участник, мероприятие, объект», чекбокс «только исправленные»), таблица (участник, подразделение, мероприятие, объект, пост, признак исправления, агрегат), пагинация по 10 строк на сервере, ссылка на карточку сотрудника с сохранением запроса (`?back=`); блок «Что не показывается».
- Нет права — `OpsAccessDenied`.

## Открытые вопросы
- Групповое оценивание (§19.13) не реализовано: задания с `target_group_code` отбиваются `GROUP_EVALUATION_UNSUPPORTED`; сервер объявляет это в `UNAVAILABLE_RATING_FACTORS`.
- Оценщиком всех заданий мероприятия становится актор, переведший объект в CONDUCT/закрывший ОМ (`open_evaluation_for_event`), а не старший объекта по данным — назначение оценщика по роли в данных `Не реализовано в коде`.
- `EvaluationWorkItemViewSet` и `RatingExportsViewSet` намеренно без `RequirePermissionMixin` (право проверяет сервис ради записи отказов); карта `permission_service_map` служит каталогу прав, а не гейту.
- Экран очереди показывает только собственные задания; просмотр чужих оценок ни одной ролью не предусмотрен (`UNAVAILABLE_WORKSPACE_VIEWS`).
- Оценки этапа «Проведение» (`conduct_evaluations.py`) не требуют основания и комментария, тогда как модуль рейтинга требует — два набора правил на одну таблицу `OpsEventEvaluation`.
