# UC-ADM-005. Подать и разобрать обращение обратной связи

| Поле | Значение |
|---|---|
| Модуль | Администрирование и доступ |
| Актор | Автор обращения — держатель `feedback.create` (практически все роли); разбирающий — держатель `feedback.triage` (`FEEDBACK_TRIAGE`, `ADMIN`) |
| Статус | Done |
| Основание | `apps/ops/feedback.py` (`create_feedback`, `submit_feedback`, `list_feedback`, `get_feedback`, `add_comment`, `triage_feedback`, `close_feedback`, `_project`, `_commit_change`), `apps/operations/models_feedback.py` (`OpsFeedbackRegistry`, `OpsFeedbackRequest`, `OpsFeedbackComment`, `OpsFeedbackEvent`), `OpsFeedbackRequestsViewSet` (`/api/ops/feedback-requests/`, `POST {id}/submit|comments|triage|close/`) в `apps/ops/api/views.py`; FRONT `app/security-ops/feedback/page.tsx` (реестр + `FeedbackForm`), `app/security-ops/feedback/[feedbackId]/page.tsx`, `app/feedback/*` (реэкспорты), `hooks/use-ops-feedback.ts`, `features/send-feedback/ui/feedback-dialog.tsx` |
| Дата актуализации | 2026-09-08 |

## Цель
Автор сообщает об ошибке, неверных данных, идее или проблеме доступа; служба поддержки разбирает обращение (ответственный, рабочий приоритет, статус, ответ) и закрывает его терминальным статусом.

## Предусловия
- Актор вошёл; для подачи — `feedback.create`, для реестра/карточки — `feedback.view` (или `feedback.view_all`/`feedback.view_confidential`), для разбора — `feedback.triage`.
- Справочник `OpsFeedbackRegistry` (типы, приоритеты, статусы, модули, карта переходов, терминальные статусы) засеян `seed_operations`; иначе любая операция отвечает `ENTITY_NOT_FOUND` «Справочник обратной связи не засеян».

## Main Flow
1. Автор открывает «Обратная связь» (`/security-ops/feedback` или `/feedback`); система читает реестр `GET /api/ops/feedback-requests/?search&type&status&module&page` — свои обращения всегда, чужие по `feedback.view_all`, чужие черновики — никогда.
2. Автор заполняет форму: тема, описание, тип, приоритет, модуль, ожидаемый результат, шаги воспроизведения, контакт, вложения (только метаданные: имя, размер, тип), флаги «Конфиденциально» и «включить техническую информацию» (маршрут, браузер), и нажимает «Отправить» (или «Сохранить без отправки») → `POST /api/ops/feedback-requests/`.
3. Система проверяет тему/описание/коды по справочнику, создаёт `OpsFeedbackRequest` со статусом `NEW` (или `DRAFT`) и событием `CREATED` (+ `SUBMITTED` при отправке).
4. Автор у черновика нажимает «Отправить в работу» → `POST …/{id}/submit/`; система переводит `DRAFT → NEW`, ставит `submitted_at`, пишет событие `SUBMITTED`.
5. Разбирающий открывает карточку `GET /api/ops/feedback-requests/{id}/` (проекция: содержание конфиденциального обращения вырезано для всех, кроме автора и держателя `feedback.view_confidential`; блок `actions` — доступные действия с причинами недоступности).
6. Разбирающий назначает ответственного, рабочий приоритет и переводит статус по карте переходов → `POST …/{id}/triage/`; система применяет изменения одной операцией и пишет события ленты диффом (`_commit_change`).
7. Разбирающий или автор пишет публичный ответ (`PUBLIC_REPLY`), разбирающий с `feedback.internal_note` — внутреннюю заметку (`INTERNAL_NOTE`) → `POST …/{id}/comments/`.
8. Разбирающий закрывает обращение терминальным статусом с обязательным ответом автору (для `DUPLICATE` — с указанием оригинала) → `POST …/{id}/close/`; система пишет события и блокирует дальнейшие изменения.
9. Автор видит в карточке ленту событий (timeline) и ответы.

## Alternative Flow
- **AF1. Нет `feedback.view`** (и нет `view_all`/`view_confidential`): шаг 1 → 403; экран — `OpsAccessDenied what="обращений"`; карточка — `hasPermission("feedback.view")` иначе `OpsAccessDenied what="обращения"`.
- **AF2. Пустая тема / описание, тема > 160, описание > 4000 символов**: шаг 3 → 422/400 `VALIDATION_ERROR` («Тема обращения обязательна.», «Тема длиннее 160 символов.», «Описание обращения обязательно.», «Описание длиннее 4000 символов.»).
- **AF3. Неизвестный тип / приоритет / модуль**: шаг 3 → 422 «Неизвестный тип обращения.» / «Неизвестный приоритет.» / «Неизвестный модуль.».
- **AF4. Отправка чужого черновика или несуществующего обращения**: шаг 4 → `ENTITY_NOT_FOUND` «Обращение не найдено.»; уже отправленного → `FEEDBACK_ALREADY_SUBMITTED` «Обращение уже отправлено.».
- **AF5. Действие над закрытым обращением**: шаги 6–8 → 422 `FEEDBACK_CLOSED` «Обращение закрыто: изменения и комментарии в закрытое обращение не добавляются.»; над черновиком — «Черновик не разбирают и не комментируют: он ещё не отправлен.».
- **AF6. Переход статуса не разрешён справочником**: шаги 6, 8 → `FEEDBACK_TRANSITION_NOT_ALLOWED`; терминальный статус через `triage` → `FEEDBACK_USE_CLOSE` «Закрытие обращения оформляется отдельным действием с ответом автору.».
- **AF7. Закрытие без ответа автору / нетерминальным статусом / дубликат без оригинала / дубликат самого себя / оригинал не виден**: шаг 8 → `VALIDATION_ERROR` с соответствующим сообщением или `ENTITY_NOT_FOUND`.
- **AF8. Пустой комментарий / неизвестный вид**: шаг 7 → 422 «Комментарий пуст.» / «Неизвестный вид комментария.»; `INTERNAL_NOTE` без права → 403 с `INTERNAL_NOTE_REASON`; `PUBLIC_REPLY` не автором и без `feedback.triage` → 403 с `REPLY_REASON`.
- **AF9. Конфиденциальное обращение у стороннего читателя**: шаг 5 → тема/тип/статус/модуль видны, содержание `null`, `restrictedReason` с текстом; поиск по описанию не выполняется.
- **AF10. Реестр пуст по фильтрам**: шаг 1 → «По заданным условиям ничего не нашлось. Доступно обращений: N».

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_feedback_requests` (`OpsFeedbackRequest`) | create / update | создание (`status_code` `NEW`/`DRAFT`, автор `author_user_id`/`author_label`, `technical_info` только при согласии); `submit` → `NEW`, `submitted_at`; `triage` → `assignee_*`, `working_priority_code`, `status_code`; `close` → терминальный статус, `duplicate_of` |
| `ops_feedback_comments` (`OpsFeedbackComment`) | create | `kind` `PUBLIC_REPLY` / `INTERNAL_NOTE`, `body`, автор |
| `ops_feedback_events` (`OpsFeedbackEvent`) | create | append-only лента (timeline + audit одной записью): `CREATED`, `SUBMITTED`, `PUBLIC_REPLY_ADDED`, `INTERNAL_NOTE_ADDED`, события изменения полей по диффу `_commit_change` (`field_code`, `old_value`, `new_value`) |
| `ops_feedback_registry` (`OpsFeedbackRegistry`) | read | справочник и карта переходов |
| Содержимое вложений (blob) | — | Не реализовано в коде (`UNAVAILABLE_CAPABILITIES.ATTACHMENT_CONTENT`): хранятся только `fileName`, `sizeBytes`, `mimeType` |
| Уведомление автора об ответе | — | Не реализовано в коде (`UNAVAILABLE_CAPABILITIES.NOTIFY_AUTHOR`) |
| `ops_audit_logs` (`OpsAuditLog`) | — | Не реализовано в коде: событий обратной связи в `audit_service.ACTIONS` нет; аудит — собственная лента `OpsFeedbackEvent` |

## Бизнес-требования (BR)
- **BR1.** Тема ≤ 160 символов, описание ≤ 4000 (`MAX_SUBJECT`, `MAX_DESCRIPTION`), оба обязательны; тип, приоритет, модуль — из справочника.
- **BR2.** Видимость: свои обращения — всегда; чужие — по `feedback.view_all`; чужой черновик не открывается никаким правом.
- **BR3.** Конфиденциальность закрывает содержание (описание, ожидаемый результат, шаги, контакт, вложения, техинформацию, маршрут), но не тему/тип/статус/модуль; вырезает сервер; поиск идёт только по видимым полям.
- **BR4.** Переходы статусов — по `status_transitions` справочника; терминальные статусы (`terminal_statuses`) ставятся только действием `close` с непустым публичным ответом; `DUPLICATE` требует видимый оригинал, не равный самому обращению.
- **BR5.** Закрытое обращение и черновик не разбирают и не комментируют.
- **BR6.** Разбор (`triage`) — одна операция над ответственным, рабочим приоритетом и статусом; лента пишется диффом в единственной точке `_commit_change`.
- **BR7.** Публичный ответ пишет разбирающий или автор; внутренняя заметка — только держатель `feedback.internal_note`.
- **BR8.** Страница реестра — `FEEDBACK_PAGE_SIZE = 4` записи; превью описания — 120 символов.
- **BR9.** Техническая информация сохраняется только при `includeTechnicalInfo=true`.

## Требования к логированию
- `OpsFeedbackEvent`: собственная append-only лента (актор, момент, поле, старое/новое) — видна в карточке; `OpsAuditLog` не задействован.
- `LogIPMiddleware`: строка на каждый запрос.
- HTTP-аудит `audit.AuditLog`: `ContentType(app_label="ops", …)` не существует → записи нет.
- `logging.getLogger` в `apps/ops/feedback.py`: нет.
- Сроки реакции (SLA) и их нарушение: `Не реализовано в коде` (`UNAVAILABLE_CARD_BLOCKS.SLA`).

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| `ADMIN` | полный | `*` |
| `FEEDBACK_TRIAGE` | полный: реестр всех, содержание конфиденциальных, разбор, закрытие, заметки, подача | `feedback.view`, `feedback.view_all`, `feedback.view_confidential`, `feedback.triage`, `feedback.internal_note`, `feedback.create`; `permission_map`: `list/retrieve/comments` — `feedback.view`, `create/submit` — `feedback.create`, `triage/close` — `feedback.triage`; `permission_bypass_map`: `list` — `view_all`/`view_confidential`, `retrieve` — `view_all`/`view_confidential`/`internal_note`, `comments` — `internal_note` |
| `EMPLOYEE`, `HEAD_DIRECTORATE_LINE`, `HEAD_DEPARTMENT_LINE`, `HEAD_OPS_UNIT`, `EMPLOYEE_OPS_D2`, `FORCES_GATHERING_OFFICER` | подача + реестр/карточка своих обращений, публичный ответ в своём | `feedback.view` + `feedback.create`; экран — `MODULE_PERMISSION["/feedback"] = "feedback.view"` |
| `DIRECTORATE_HEAD`, `DEPARTMENT_EXPENSE_OFFICER`, `DUTY_OFFICER`, `EVENT_OFFICER`, `OPS_STAFF`, `PATROL_LEAD`, `GVO_LEAD`, `EVENT_APPROVER`, `DUTY_PLANNER`, `DUTY_PLAN_APPROVER`, `OBJECT_KEEPER`, `RATING_EVALUATOR`, `ANALYST` | только подача через API (`create`, `submit`); реестр и карточка — нет | `feedback.create` без `feedback.view` — `list/retrieve` 403, экран закрыт `OpsAccessDenied` |
| `REFERENCE_ADMIN`, `SECURITY_ADMIN`, `AUDITOR`, `INTEGRATION_USER`, `OM_CATEGORY_ORG`, `OVERVIEW_DEPARTMENT`, `OPS_STAFF_COMMAND` | нет | прав `feedback.*` в `ROLE_PERMISSIONS` нет |

## Требования к UX/UI
- «Обратная связь» — страница `/security-ops/feedback` (реэкспорт `/feedback`; eyebrow «Обратная связь», описание «Обращения пользователей: ошибки, неверные данные, UX, идеи, доступ и помощь.»): форма нового обращения (`FeedbackForm`: тема, описание, тип, приоритет, модуль, ожидаемый результат, шаги, контакт, вложения-метаданные, чекбоксы «Конфиденциально — содержание видят только автор и обладатель отдельного права» и включения техинформации; кнопки «Отправить» и «Сохранить без отправки»); блок фильтров (`aria-label` «Фильтры реестра»: поиск «Тема или описание», селекты «Все типы» / «Все статусы» / «Все модули»); список карточек (тема, бейдж «Конфиденциально», модуль · автор · момент, превью, вложения, у черновика — кнопка «Отправить в работу»); пагинация «Назад» / «Страница N из M · найдено K» / «Далее»; строка «Всего доступно обращений: N. Справочник …»; состояния ошибки и пустого результата.
- Карточка обращения — `/security-ops/feedback/[feedbackId]`: заголовок — тема, подзаголовок «тип · модуль · автор · момент»; поля содержания или `restrictedReason`; ответственный («не назначен»), рабочий приоритет; комментарии (автор · момент); форма ответа «Отправить ответ»; блок разбора при `actions.TRIAGE.available` (селект ответственного, приоритет, статус — ошибка сервера под блоком); блок закрытия при `actions.CLOSE.available` (терминальный статус, обязательный ответ, оригинал для дубликата; кнопка «Закрыть обращение» `disabled` без статуса/ответа); лента событий; блоки `unavailableBlocks` с причинами («Содержимое вложений», «Срок реакции», «Связанная сущность»).
- `features/send-feedback/ui/feedback-dialog.tsx` — диалог «Обратная связь» (тип, сообщение, «Отправить») с закомментированным вызовом API; в дереве экранов не подключён.

## Открытые вопросы
- Тринадцать ролей имеют `feedback.create`, но не `feedback.view`: подать обращение они могут только через API — экран реестра (и форма в нём) закрыт гейтом `feedback.view`; собственную карточку они тоже не откроют (`retrieve` — `feedback.view`).
- `features/send-feedback` — мёртвый диалог: вызов `apiClient.sendFeedback` закомментирован, показывает «Ваше сообщение успешно отправлено» без запроса; в экраны не подключён.
- Тексты причин отказа называют права как `ops.feedback.*` (`RESTRICTED_REASON`, `INTERNAL_NOTE_REASON`, `TRIAGE_REASON`), коды в справочнике — `feedback.*`.
- Размер страницы реестра — 4 записи (`FEEDBACK_PAGE_SIZE`), из мок-контракта; для рабочего реестра мал.
- Содержимое вложений не хранится, уведомление автора об ответе и SLA — `Не реализовано в коде` (сервер сам объявляет это в `UNAVAILABLE_CAPABILITIES` / `UNAVAILABLE_CARD_BLOCKS`).
- Кандидаты в ответственные (`get_feedback`, `candidates`) собираются из уже назначенных ответственных и авторов комментариев по обращениям — справочник сотрудников службы поддержки не читается; на новой базе список пуст, и назначить первого ответственного через экран нечем (только `assigneeUserId` в теле `triage` через API).
