# Smart Josparlau — обзор системы

Актуализировано: 2026-09-08. Бэклог: [Project-Backlog.md](Project-Backlog.md). Реестр разрывов фронт ↔ бэк: [api-gaps.md](api-gaps.md).

## Назначение

Система учёта личного состава и охранных мероприятий (ОМ) службы охраны. Ведёт оргструктуру, штат и статусы сотрудников, ежедневный расход с сдачей дня по цепочке подразделений, полный жизненный цикл охранного мероприятия от бюллетеня до закрытия (сбор сил, расстановка, согласование, ознакомление, проведение), паспорта объектов охраны, оперативный рейтинг участников, аналитику и служебные отчёты.

## Стек и точки входа

| Часть | Стек | Точка входа |
|---|---|---|
| Бэкенд | Django 5.1, DRF 3.17, drf-spectacular, SimpleJWT, django-mptt, Channels 4 + channels-redis, Celery 5 + django-celery-beat/results, PostgreSQL 15, Redis 7 | `Backend/PersonnelStatus/Personnel-Records/manage.py`, `organization_management/config/urls.py`, `config/asgi.py`, `config/celery.py`, настройки `config/settings/{base,production,test,sqlite,local_postgres}.py` |
| Фронтенд | Next.js 15.2 (App Router, standalone), React 19, TypeScript, TanStack Query 5, react-hook-form + zod, NextAuth 4 (Credentials поверх `/api/token/`), Tailwind + shadcn/Radix, MSW 2 (выключен по умолчанию) | `Backend/PersonnelStatus/PersonalRecordFront/app/layout.tsx`, `app/page.tsx` (вход), `middleware.ts`, `next.config.js` (rewrites `/api/*` → бэкенд) |
| API | REST `/api/operations/`, `/api/ops/`, `/api/core/`, `/api/user/`, `/api/staff_unit/`, `/api/statuses/`, `/api/secondments/`, `/api/reports/`, `/api/notifications/`, `/api/audit/`, `/api/dictionaries/`, `/api/divisions/`, `/api/documents/`; WebSocket `/ws/operations/notifications/`; схема `/api/schema/`, `/docs`, `/redoc` | `config/urls.py`, `apps/operations/api/urls.py`, `apps/ops/api/urls.py`, `apps/operations/ws_routing.py` |
| Развёртывание | docker-compose: `db`, `redis`, `web` (gunicorn + uvicorn-worker, ASGI), `celery`, `celery-beat`; фронт отдельным образом node:22-alpine | `Personnel-Records/docker-compose.yml`, `Dockerfile`, `PersonalRecordFront/docker-compose*.yml`, `Dockerfile` |

## Модули

| Код | Модуль | Назначение | Кол-во UC |
|---|---|---|---|
| GEN | Общие | Вход, сессия, свой профиль и пароль, уведомления | 3 |
| ORG | Оргструктура и кадры | Подразделения, штат и вакансии, кадровые справочники, импорт сотрудников | 4 |
| STS | Статусы и дежурства | Статусы личного состава, календарь, прикомандирование, автоматика статусов, дежурства | 5 |
| EXP | Ежедневный расход | Сдача дня, поправки, сводка и светофор, отчёт о расходе, контроль отставания | 5 |
| EVT | Охранные мероприятия | Жизненный цикл ОМ по девяти этапам, сбор сил, визиты иностранных охраняемых лиц | 8 |
| OBJ | Объекты и справочники ОМ | Объекты и паспорта, охраняемые лица, справочники раздела, законы, транспорт | 3 |
| RAT | Рейтинг и аналитика | Оценивание участников, сводный рейтинг и выгрузка, аналитика службы и мероприятий | 3 |
| DOC | Документы и отчёты | Служебные отчёты, документы мероприятия, бюллетени, целостность документов | 2 |
| ADM | Администрирование и доступ | Роли и права, учётные записи, политики раздела, аудит, обратная связь | 5 |

Итого 38 UC.

## Роли

Каталог ролей и прав хранится в БД (модели `Role`, `Permission`, `RolePermission`, `UserRole`, `TemporaryDutyPermission` в `apps/operations/models.py`) и засевается командой `seed_operations` (`apps/operations/management/commands/seed_operations.py`, матрица `ROLE_PERMISSIONS`). Проверка — `permission_map` во вьюсетах через `RequirePermissionMixin` (`apps/operations/api/permissions.py`) и `PermissionService` (`apps/operations/services.py`); глобальный DRF-дефолт `AllowAny` (`config/settings/base.py`). На клиенте гейт по карте «модуль → право» в `entities/portal-access` и хуку `hooks/use-ops-permissions.ts` (источник — `GET /api/operations/my-permissions/`).

| Роль | Как определяется в коде | Краткое описание |
|---|---|---|
| ADMIN | `ROLE_PERMISSIONS["ADMIN"] = ["*"]` | Полный доступ, wildcard `*` |
| EMPLOYEE | `ROLE_PERMISSIONS["EMPLOYEE"]` | Сотрудник: свой профиль, назначения, подтверждение заступления |
| HEAD_DIRECTORATE_LINE, HEAD_DEPARTMENT_LINE, DIRECTORATE_HEAD | `ROLE_PERMISSIONS` | Руководители управления/департамента: статусы и расход своей области, выделение сил |
| DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER | `ROLE_PERMISSIONS` | Ответственный за расход департамента; оперативный дежурный (сводка, обход блокировки) |
| EMPLOYEE_OPS_D2, EVENT_OFFICER, OPS_STAFF, OPS_STAFF_COMMAND, HEAD_OPS_UNIT | `ROLE_PERMISSIONS` | Сотрудник и штаб второго департамента: создание ОМ, бюллетень, переопределение этапа, команда сбором сил |
| FORCES_GATHERING_OFFICER, PATROL_LEAD, GVO_LEAD | `ROLE_PERMISSIONS` | Сбор сил, старший наряда, старший ГВО (расстановка, визиты) |
| EVENT_APPROVER, DUTY_PLANNER, DUTY_PLAN_APPROVER, OBJECT_KEEPER | `ROLE_PERMISSIONS` | Согласующий расстановку; планировщик и утверждающий дежурств; хранитель объектов и паспортов |
| RATING_EVALUATOR, ANALYST | `ROLE_PERMISSIONS` | Оценивание участников; аналитика и рейтинг |
| FEEDBACK_TRIAGE, REFERENCE_ADMIN, SECURITY_ADMIN, AUDITOR, INTEGRATION_USER | `ROLE_PERMISSIONS` | Разбор обращений; справочники; настройки и доступ; чтение аудита; техническая учётка |
| OM_CATEGORY_ORG, OVERVIEW_DEPARTMENT | `ROLE_PERMISSIONS` | Роли-добавки: категория ОМ по организации; обзор департамента |

Полный список кодов прав (55 штук: `status.*`, `daily_report.*`, `object.*`, `event.*`, `forces.*`, `placement.*`, `duty.*`, `rating.*`, `analytics.*`, `report.*`, `feedback.*`, `dictionary.*`, `settings.*`, `audit.view`, `admin.roles` и другие) — в `seed_operations.py`. Область действия роли (подразделение) — `UserRole.division` и `PermissionService.visible_division_ids`.

## Ключевые сущности

| Сущность | Таблица/модель | Назначение |
|---|---|---|
| Подразделение | `divisions.Division` (MPTT) | Дерево оргструктуры |
| Сотрудник | `employees.Employee`, `EmployeeTransferHistory` | Кадровая запись и история переводов |
| Штатная единица, вакансия | `staff_unit.StaffUnit` (MPTT), `Vacancy` | Штатное расписание |
| Справочники | `dictionaries.Position`, `Rank`, `StatusType`, `DismissalReason`, `TransferReason`, `VacancyReason`, `EducationType`, `DocumentType`, `SystemSetting` | Кадровые справочники |
| Статус сотрудника | `operations.OpsEmployeeStatus`, `OpsStatusParticipation`, `StatusOverride`, `Secondment`; `statuses.EmployeeStatus`, `StatusChangeHistory` | Статусы личного состава, участие в ОМ, прикомандирование |
| Сдача дня | `operations.OpsDailySubmission`, `OpsSubmissionControlSettings`, `OpsDivisionNotifyRecipient`, `OpsTomorrowBlockOverride` | Ежедневный расход, версии сдачи, блокировка на завтра |
| Охранное мероприятие | `operations.OpsSecurityEvent`, `OpsSecurityEventTransition`, `OpsSecurityEventVisitObject`, `OpsVisitObjectDeputy`, `OpsPlacementDocumentVersion`, `OpsSecurityEventPerson` | Мероприятие со стейт-машиной `Stage` из девяти этапов, объекты визита, расстановка |
| Сбор сил | `operations.OpsForceRequest`, `OpsDepartmentRequest`, `OpsUnitRequest`, `OpsForceRequestMember` | Запросы сил по департаментам и управлениям (append-only) |
| Объект охраны | `operations.OpsSecurityObject`, `OpsObjectSector`, `OpsSecurityPost`, `OpsPassportVersion`, `OpsPassportFreshnessPolicy` | Объекты, секторы, посты, версии паспорта |
| Дежурства | `operations.OpsDutyType`, `OpsDutyShift`, `OpsDutyMonthlyPlan`, `OpsDutyConflictPolicy`, `OpsCombatDutyType`, `OpsCombatRoute`, `OpsCombatDutyShift` | Планы и смены суточных и боевых дежурств |
| Документы | `operations.OpsAttachment`, `OpsDocumentSequence`, `OpsIssuedDocument`, `OpsBulletinIssue`, `OpsWatermark`, `OpsLegalDocument` | Вложения, выпущенные документы, бюллетени, законы |
| ГВО | `operations.OpsProtectedPerson`, `OpsGvoSummaryPatch`, `OpsForeignVisit`, `OpsCountry`, `OpsCity` | Охраняемые лица, визиты иностранных ОЛ, география |
| Рейтинг | `operations.OpsRatingGroup`, `OpsRatedParticipant`, `OpsEvaluationEvent`, `OpsEventEvaluation`, `OpsEvaluationWorkItem`, `OpsEvaluationCorrection`, `OpsRatingExportJob`, `OpsRatingExportArtifact`, `OpsRatingFeatureFlags` и другие (13 моделей в `models_rating.py`) | Оценивание, исправления, выгрузки, флаги функции |
| Аналитика, отчёты | `operations.OpsAnalyticsMetricDefinition`, `OpsAnalyticsPeriodPreset`, `OpsAttentionDetector`, `OpsServiceReportType`, `OpsServiceReportJob`, `OpsServiceReportArtifact`; `reports.Report` | Метрики, пресеты, задания служебных отчётов |
| Настройки, справочники раздела | `operations.OpsPolicySetting`, `OpsPolicySectionVersion`, `OpsSettingChangeEvent`, `OpsDictionaryEntry`, `OpsApprovalRouteStep` | Политики раздела с версиями, маршрут согласования |
| Доступ | `operations.Role`, `Permission`, `RolePermission`, `UserRole`, `TemporaryDutyPermission` | RBAC |
| Обратная связь, транспорт, уведомления | `operations.OpsFeedbackRequest`, `OpsFeedbackComment`, `OpsFeedbackEvent`, `OpsVehicle`, `OpsEventVehicle`, `OpsNotification` | Обращения, транспорт ГОН, внутренние уведомления |
| Аудит | `operations.OpsAuditLog` (`ops_audit_logs`), `audit.AuditLog` | Доменный и HTTP-аудит |

## Логирование

- **Библиотека**: стандартный `logging`. Конфигурация `LOGGING` в `config/settings/base.py`: единственный handler `console` (`StreamHandler`, без formatter), логгеры `django` (INFO), `django.server` (INFO), `django.request` (DEBUG), `root` (DEBUG). Файловых handler'ов и ротации нет. Логгеры `logging.getLogger(__name__)` используются точечно в сервисах `apps/operations` (`locks`, `notify_service`, `lagging_check`, `clock`, `document_service`, `catch_up`), `apps/ops` (`forces_send`, `security_events`), `apps/statuses/tasks.py` и обработчике ошибок `apps/operations/api/exception_handler.py`. IP запросов пишет `LogIPMiddleware` (`apps/common/management/ip_logging_middleware.py`).
- **Аудит**: два независимых журнала. `audit.AuditLog` (`apps/audit/domain/models.py`) наполняется `AuditMiddleware` на каждый успешный изменяющий запрос к `/api/` (пользователь, тип действия, объект, дифф, ip, user-agent); API `/api/audit/logs/`. `operations.OpsAuditLog` (`apps/operations/models_audit.py`) — доменные события со словарём около 70 действий в `apps/operations/audit_service.py`, append-only на уровне БД (триггер в миграции 0006); API `/api/operations/audit-logs/`, `/api/ops/audit-logs/`. Специализированные журналы: `OpsRatingAuditEntry`, `OpsSettingChangeEvent`, `OpsSecurityEventTransition`, `StatusChangeHistory`, `EmployeeTransferHistory`.
- **Фронтенд**: собственной телеметрии нет; `@sentry/nextjs` в зависимостях без инициализации; только `console.error` в `lib/auth-config.ts`, `lib/api.ts`, `lib/auth.tsx`.
- **Внешние интеграции**: отсутствуют (нет почты, SMS, LDAP, внешних HTTP-вызовов). Уведомления только внутренние: таблица `OpsNotification` и WebSocket.
