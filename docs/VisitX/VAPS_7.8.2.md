# VAPS / ВАПС — Master Product-Ready Specification v7.8 Strict-Audit Fixed Baseline

> This file is based on v7.7 and includes mandatory v7.8 Strict Audit Correction Delta. Sections 44–65 override conflicting v7.7/v7.6/v7.5 content.

> **CODEGEN PRIORITY NOTICE — MUST READ FIRST.**
>
> This document is now patched as **v7.8.2 Development-Ready Fixed**.
> For Google Jules / Claude Code / backend / frontend / QA, sections **44–81** are mandatory override sections.
> If any earlier section v7.5/v7.6/v7.7 conflicts with sections 44–81, the later section wins.
> MVP-core must be implemented by release slices from section 67.
> MVP-2/Future features must not be implemented before MVP-core stabilization unless explicitly moved by product owner decision.
> Real ECP, Face ID, external accreditation, external SMS/email/Telegram/WhatsApp and full logistics are **not MVP-core**.

---

# VAPS / ВАПС — Master Product-Ready Specification v7.7 Full Product Development Baseline

**Статус документа:** единый финальный product-ready master-документ для передачи Google Jules / Claude Code / backend / frontend / QA, дополненный v7.7 product-completion delta.  
**Baseline:** `v7.1 + v7.2 + v7.3 + v7.4 + v7.5 + v7.6-full-coverage-delta + v7.7-product-completion-delta`.  
**Все предыдущие полные перезаписи после v7.1:** не использовать как базу. Любые новые изменения допускаются только как дельта-патчи к этому master-документу.  
**Целевая архитектура MVP:** Django 5.x + Django REST Framework + PostgreSQL + Redis + Celery.  
**Архитектурный стиль:** DDD Modular Monolith.  
**Главный bounded context MVP:** `operations`.

---

## 0. Правило приоритета документа

Этот документ является единственной рабочей спецификацией для кодогенерации Google Jules.

### 0.1. Что считается принятым

Приняты только:

1. v7.1 как основа.
2. v7.2 как корректирующий слой по статусам, ролям, API, отчётам, документам и конфликтам.
3. v7.3 как корректирующий слой по удалению версии расстановки и post deactivation window.
4. v7.4 как корректирующий слой по аккаунт↔сотрудник, исторической штатке и балансу штат/список/вакансии.
5. v7.5 как финальный слой по DB safety-net триггеру брокериджа и прикомандированным силам.
6. v7.6 как full-coverage delta по требованиям `PersonnelStatus.md`, `VisitX.md`, `ПланРасстановка.docx`, `ТЗ VAPS.md`, `brainstorming-session-2026-05-25-2256.md`.

### 0.2. Что не принимается

Не принимаются как целые документы:

- v8.0;
- v9.0;
- v10.0;
- любые дальнейшие полные перезаписи, если они не оформлены как дельта-патч к этому master-документу.

Причина: поздние перезаписи исправляли отдельные пункты, но откатывали уже принятые решения по lookup-таблицам, интервальной истории, `mark_type`, `resolved_by_return`, group assignment, workload rules и `report_column_code`.

---

# 1. Назначение системы

VAPS / ВАПС — система для автоматизации:

- учёта личного состава;
- статусов сотрудников;
- ежедневного расхода личного состава;
- планирования дежурств;
- охранных мероприятий;
- расчёта сил и средств;
- расстановки сотрудников по объектам, секторам и постам;
- контроля конфликтов, недоступности и перегрузки;
- формирования документов;
- аудита действий;
- дальнейшей интеграции с кадровыми системами, ЭЦП, Face ID и аккредитацией.

MVP должен дать рабочий контур: от справочников и сотрудников до ежедневного расхода, дежурств, ОМ, расстановки, конфликтов, отчётов и документов.

---

# 2. Архитектурный каркас

## 2.1. Структура Django-проекта

```text
vaps/
  config/
    settings/
    urls.py
    celery.py

  apps/
    core/
      models.py
      selectors.py
      services.py
      api/
      tests/

    operations/
      models.py
      selectors.py
      validators.py
      services/
      commands/
      api/
      tasks.py
      tests/

    analytics/
      models.py
      selectors.py
      services.py
      tasks.py
      api/
      tests/

    audit/
      models.py
      services.py
      tests/

    documents/
      models.py
      services.py
      tasks.py
      api/
      tests/

    notifications/
      models.py
      services.py
      tasks.py
      api/
      tests/
```

## 2.2. Bounded Contexts

| Context | Назначение | Тип | Владеет данными |
|---|---|---|---|
| `core` | Организации, подразделения, сотрудники, история подразделений, штатные слоты, мост аккаунт↔сотрудник | reference/write | `core_*` |
| `operations` | Статусы, ежедневный расход, объекты, посты, ОМ, требования, дежурства, брокеридж, расстановка, конфликты | main write | `ops_*` |
| `analytics` | Витрины нагрузки, агрегаты, рекомендации | read/projection | `analytics_*` |
| `audit` | Неизменяемый аудит действий | append-only | `audit_logs` |
| `documents` | Шаблоны, очередь генерации, архив документов | async/write | `documents_*` |
| `notifications` | Внутренние уведомления | async/write | `notifications_*` |

## 2.3. Правила изоляции

**ARCH-001.** Физические микросервисы в MVP запрещены.

**ARCH-002.** Прямые `ForeignKey` между разными bounded contexts запрещены.

**ARCH-003.** Межконтекстные ссылки хранятся как плоские `UUIDField` / `VARCHAR`.

**ARCH-004.** Данные чужого context читаются только через selectors/services:

- `CoreEmployeeSelector`;
- `CoreEmployeeLockSelector`;
- `HistoricalEmployeeSelector`;
- `CoreDivisionTreeSelector`;
- `AnalyticsWorkloadSelector`;
- `AuditService`.

**ARCH-005.** В `operations.models` запрещены импорты `core.models`.

**ARCH-006.** AST-test должен падать при прямом ORM-импорте чужого context.

**ARCH-007.** RBAC и аудит работают через `user_id` внешнего Auth/Django, а не через `core_employees.id`.

**ARCH-008.** Связь аккаунта с сотрудником выполняется только через `core_user_employee_bindings`.

---

# 3. Настройка времени

## TIME-001. Основной timezone MVP

```python
TIME_ZONE = "Asia/Qyzylorda"
USE_TZ = True
VAPS_LOCAL_TIMEZONE = "Asia/Qyzylorda"
```

## TIME-002. Правило расчёта `report_date`

`report_date` — локальная календарная дата в `settings.VAPS_LOCAL_TIMEZONE`.

Для отчёта за дату `D`:

```python
local_start = datetime.combine(D, time.min, tzinfo=ZoneInfo(settings.VAPS_LOCAL_TIMEZONE))
local_end = local_start + timedelta(days=1)
utc_start = local_start.astimezone(timezone.utc)
utc_end = local_end.astimezone(timezone.utc)
```

Интервальное пересечение:

```sql
starts_at < :utc_end AND ends_at > :utc_start
```

**TIME-AC-001.** Дежурство `2026-06-05T23:00:00+05:00` — `2026-06-06T07:00:00+05:00` пересекает оба отчёта: 05.06 и 06.06.

---

# 4. Финальная схема базы данных

## 4.1. Core Context

### DB-CORE-001. `core_organizations`

```sql
CREATE TABLE core_organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    parent_id UUID REFERENCES core_organizations(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### DB-CORE-002. `core_division_types`

```sql
CREATE TABLE core_division_types (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL
);
```

Seed:

```text
department
management
division
office
group
```

### DB-CORE-003. `core_divisions`

```sql
CREATE TABLE core_divisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core_organizations(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES core_divisions(id) ON DELETE CASCADE,
    type_code VARCHAR(50) NOT NULL REFERENCES core_division_types(code) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_org_division_code UNIQUE(organization_id, code)
);

CREATE INDEX idx_core_divisions_parent ON core_divisions(parent_id);
CREATE INDEX idx_core_divisions_org_type ON core_divisions(organization_id, type_code);
```

### DB-CORE-004. `core_employees`

```sql
CREATE TABLE core_employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(100) UNIQUE,
    iin VARCHAR(12) UNIQUE NOT NULL CHECK (iin ~ '^[0-9]{12}$'),
    full_name VARCHAR(255) NOT NULL,
    rank_code VARCHAR(50) NOT NULL,
    rank_index INT DEFAULT 0 NOT NULL,
    position_code VARCHAR(50) NOT NULL,
    division_id UUID NOT NULL REFERENCES core_divisions(id) ON DELETE RESTRICT,
    phone VARCHAR(50),
    gender VARCHAR(1) CHECK (gender IN ('M','F')),
    height_cm INT CHECK (height_cm BETWEEN 120 AND 230),
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    is_attached_force BOOLEAN DEFAULT FALSE NOT NULL,
    data_source VARCHAR(50) DEFAULT 'STUB' NOT NULL,
    separated_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_core_employees_division_active ON core_employees(division_id, is_active);
CREATE INDEX idx_core_employees_full_name ON core_employees(full_name);
```

**DB decision:** `is_attached_force=true` используется для прикомандированных сил из чужого ведомства, которые могут участвовать в `ops_assignments`, но не входят в штатный баланс принимающего подразделения.

### DB-CORE-005. `core_employee_division_history`

```sql
CREATE TABLE core_employee_division_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES core_employees(id) ON DELETE CASCADE,
    division_id UUID NOT NULL REFERENCES core_divisions(id) ON DELETE RESTRICT,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    source VARCHAR(50) DEFAULT 'MANUAL' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_emp_div_history_dates CHECK (ends_at IS NULL OR starts_at < ends_at)
);

CREATE INDEX idx_core_emp_div_history_lookup
ON core_employee_division_history(employee_id, starts_at, ends_at);
```

**BR-CORE-HISTORY-001.** У сотрудника не должно быть пересекающихся интервалов подразделения.

**BR-CORE-HISTORY-002.** Текущий `core_employees.division_id` должен соответствовать history-записи с `ends_at IS NULL`.

**BR-CORE-HISTORY-003.** Если history отсутствует, `HistoricalEmployeeSelector` возвращает текущий `core_employees.division_id` и пишет warning в лог.

### DB-CORE-006. `core_user_employee_bindings`

```sql
CREATE TABLE core_user_employee_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) UNIQUE NOT NULL,
    employee_id UUID UNIQUE NOT NULL REFERENCES core_employees(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

**BR-ACCOUNT-001.** `*_user_id` поля всегда содержат ID аккаунта, а не UUID карточки сотрудника.

**BR-ACCOUNT-002.** `core_employees.id` нельзя подставлять в `audit_logs.actor_user_id`, `ops_events.coordinator_user_id`, `ops_assignments.created_by`, `ops_user_roles.user_id`.

### DB-CORE-007. `core_division_historical_slots`

```sql
CREATE TABLE core_division_historical_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES core_divisions(id) ON DELETE CASCADE,
    allocated_slots INT NOT NULL CHECK (allocated_slots >= 0),
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_slots_dates CHECK (valid_to IS NULL OR valid_from < valid_to)
);

CREATE INDEX idx_core_slots_timeline
ON core_division_historical_slots(division_id, valid_from, valid_to);
```

---

## 4.2. Operations Context

### DB-OPS-001. Roles and permissions

```sql
CREATE TABLE ops_roles (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE NOT NULL
);

CREATE TABLE ops_permissions (
    code VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE NOT NULL
);

CREATE TABLE ops_role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_code VARCHAR(50) NOT NULL REFERENCES ops_roles(code) ON DELETE CASCADE,
    permission_code VARCHAR(100) NOT NULL REFERENCES ops_permissions(code) ON DELETE CASCADE,
    CONSTRAINT unique_role_permission UNIQUE(role_code, permission_code)
);

CREATE TABLE ops_user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) NOT NULL,
    role_code VARCHAR(50) NOT NULL REFERENCES ops_roles(code) ON DELETE RESTRICT,
    scope_division_id UUID,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_user_role_scope UNIQUE(user_id, role_code, scope_division_id)
);
```

Seed roles:

```text
ADMIN
ORGD
OMD
SENIOR_COORDINATOR
APPROVER
DIVISION_OPERATOR
VIEWER
INTEGRATION_USER
```

Seed permissions:

```text
admin.roles
status.manage
status.view
assignment.create
assignment.delete
assignment.submit
assignment.return
assignment.approve
brokerage.manage
daily_report.generate
daily_report.mark_update
daily_report.correct
object.manage
event.manage
duty.manage
audit.view
```

Required `ops_role_permissions` seed:

| role_code | permission_code |
|---|---|
| ADMIN | `*` / all permissions |
| OMD | assignment.create, assignment.delete, assignment.submit, daily_report.generate, brokerage.manage |
| SENIOR_COORDINATOR | assignment.create, assignment.delete, assignment.submit |
| APPROVER | assignment.return, assignment.approve |
| DIVISION_OPERATOR | daily_report.mark_update, daily_report.correct, status.view |
| ORGD | audit.view, daily_report.generate |
| VIEWER | GET/read-only permissions |
| INTEGRATION_USER | status.manage for sync/import |

### DB-OPS-002. Lookup tables

```sql
CREATE TABLE ops_status_types (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    priority INT NOT NULL,
    is_hard_block BOOLEAN DEFAULT FALSE NOT NULL,
    is_operational BOOLEAN DEFAULT TRUE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    report_column_code VARCHAR(50),
    is_ku_owned BOOLEAN DEFAULT FALSE NOT NULL,
    counts_in_list BOOLEAN DEFAULT TRUE NOT NULL,
    counts_in_staff BOOLEAN DEFAULT TRUE NOT NULL
);

CREATE TABLE ops_status_states (code VARCHAR(50) PRIMARY KEY, name VARCHAR(255) NOT NULL);
CREATE TABLE ops_status_sources (code VARCHAR(50) PRIMARY KEY, name VARCHAR(255) NOT NULL);
CREATE TABLE ops_post_types (code VARCHAR(50) PRIMARY KEY, name VARCHAR(255) NOT NULL);
CREATE TABLE ops_request_statuses (code VARCHAR(50) PRIMARY KEY, name VARCHAR(255) NOT NULL);
CREATE TABLE ops_allocation_statuses (code VARCHAR(50) PRIMARY KEY, name VARCHAR(255) NOT NULL);
CREATE TABLE ops_duty_plan_statuses (code VARCHAR(50) PRIMARY KEY, name VARCHAR(255) NOT NULL);
CREATE TABLE ops_assignment_roles (code VARCHAR(100) PRIMARY KEY, name VARCHAR(255) NOT NULL, is_active BOOLEAN DEFAULT TRUE NOT NULL);

CREATE TABLE ops_event_statuses (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_terminal BOOLEAN DEFAULT FALSE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL
);

CREATE TABLE ops_event_levels (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL
);

CREATE TABLE ops_assignment_version_statuses (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_locked BOOLEAN DEFAULT FALSE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL
);

CREATE TABLE ops_daily_report_statuses (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    is_final BOOLEAN DEFAULT FALSE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL
);
```

### DB-OPS-003. `ops_status_types` seed

| code | priority | is_hard_block | is_ku_owned | counts_in_list | counts_in_staff | report_column_code |
|---|---:|---:|---:|---:|---:|---|
| SICK_LEAVE | 10 | true | true | true | true | SICK |
| LEAVE_BY_REPORT | 15 | true | true | true | true | VACATION |
| VACATION | 20 | true | true | true | true | VACATION |
| COMMAND | 30 | true | true | true | true | COMMAND |
| STUDY | 32 | false | true | true | true | TRAINING |
| COMPETITION | 34 | false | true | true | true | TRAINING |
| CONFERENCE | 36 | false | true | true | true | TRAINING |
| DETACHED | 40 | false | true | true | true | DETACHED |
| ATTACHED | 50 | false | true | true | false | ATTACHED |
| REST_AFTER_DUTY | 60 | false | false | true | true | AFTER_DUTY |
| BEFORE_DUTY | 65 | false | false | true | true | BEFORE_DUTY |
| DUTY | 70 | false | false | true | true | ON_DUTY |
| GEV | 75 | false | false | true | true | ON_DUTY |
| EVENT_ASSIGNMENT | 80 | false | false | true | true | IN_SERVICE |
| IN_SERVICE | 999 | false | false | true | true | IN_SERVICE |

Дополнительно для прикомандированных сил из v7.5:

```text
ATTACHED_PLUS — report column for employees with core_employees.is_attached_force=true
```

### DB-OPS-004. Other lookup seeds

```text
ops_status_states: PLANNED, ACTIVE, COMPLETED, CANCELLED
ops_status_sources: USER, KU_SYNC, DUTY_AUTO, ASSIGNMENT_AUTO
ops_post_types: FIXED, MOBILE, CHECKPOINT, RESERVE
ops_request_statuses: SENT, ALLOCATED, REJECTED, CANCELLED
ops_allocation_statuses: PROPOSED, CONFIRMED, REJECTED
ops_duty_plan_statuses: DRAFT, APPROVED
ops_assignment_version_statuses: DRAFT(is_locked=false), RETURNED(false), SUBMITTED(true), APPROVED(true)
ops_daily_report_statuses: DRAFT_INCOMPLETE(false), FINAL(true), CORRECTION(true)
ops_assignment_roles: SENIOR_GUARD, SECTOR_SENIOR, POST_GUARD, RESERVE, GROUP_REINFORCEMENT
```

### DB-OPS-005. Objects, sectors, posts

```sql
CREATE TABLE ops_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    latitude NUMERIC(9,6),
    longitude NUMERIC(9,6),
    importance_level_code VARCHAR(50) NOT NULL REFERENCES ops_event_levels(code) ON DELETE RESTRICT,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE ops_object_sectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES ops_objects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_object_sector_name UNIQUE(object_id, name)
);

CREATE TABLE ops_object_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES ops_objects(id) ON DELETE CASCADE,
    sector_id UUID REFERENCES ops_object_sectors(id) ON DELETE SET NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    post_type_code VARCHAR(50) DEFAULT 'FIXED' NOT NULL REFERENCES ops_post_types(code) ON DELETE RESTRICT,
    max_service_minutes INT DEFAULT 480 NOT NULL CHECK (max_service_minutes BETWEEN 30 AND 1440),
    requirements JSONB DEFAULT '{}'::jsonb NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_object_post_code UNIQUE(object_id, code)
);
```

### DB-OPS-006. JSON Schema for `ops_object_posts.requirements`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version"],
  "properties": {
    "schema_version": {"type": "integer", "enum": [1]},
    "min_height_cm": {"type": ["integer", "null"], "minimum": 120, "maximum": 230},
    "gender": {"type": ["string", "null"], "enum": ["M", "F", null]},
    "min_rank_index": {"type": ["integer", "null"], "minimum": 0},
    "max_rank_index": {"type": ["integer", "null"], "minimum": 0},
    "required_position_codes": {
      "type": "array",
      "items": {"type": "string"},
      "uniqueItems": true
    },
    "allow_overqualification": {"type": "boolean"}
  }
}
```

### DB-OPS-007. Employee statuses

```sql
CREATE TABLE ops_employee_statuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    status_type_code VARCHAR(50) NOT NULL REFERENCES ops_status_types(code) ON DELETE RESTRICT,
    state_code VARCHAR(50) DEFAULT 'PLANNED' NOT NULL REFERENCES ops_status_states(code) ON DELETE RESTRICT,
    source_code VARCHAR(50) NOT NULL REFERENCES ops_status_sources(code) ON DELETE RESTRICT,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_status_dates CHECK (starts_at < ends_at)
);

CREATE INDEX idx_ops_statuses_employee_time
ON ops_employee_statuses(employee_id, starts_at, ends_at);
```

### DB-OPS-008. Events and requirements

```sql
CREATE TABLE ops_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    status_code VARCHAR(50) DEFAULT 'DRAFT' NOT NULL REFERENCES ops_event_statuses(code) ON DELETE RESTRICT,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    coordinator_user_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_event_dates CHECK (starts_at < ends_at)
);

CREATE TABLE ops_event_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES ops_events(id) ON DELETE CASCADE,
    object_id UUID NOT NULL REFERENCES ops_objects(id) ON DELETE RESTRICT,
    is_primary BOOLEAN DEFAULT FALSE NOT NULL,
    CONSTRAINT unique_event_object UNIQUE(event_id, object_id)
);

CREATE TABLE ops_event_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES ops_events(id) ON DELETE CASCADE,
    object_id UUID NOT NULL REFERENCES ops_objects(id) ON DELETE RESTRICT,
    sector_id UUID REFERENCES ops_object_sectors(id) ON DELETE RESTRICT,
    post_id UUID REFERENCES ops_object_posts(id) ON DELETE RESTRICT,
    required_count INT NOT NULL CHECK (required_count > 0),
    required_role_code VARCHAR(100) NOT NULL REFERENCES ops_assignment_roles(code) ON DELETE RESTRICT,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_req_dates CHECK (starts_at < ends_at)
);
```

### DB-OPS-009. Groups and brokerage

```sql
CREATE TABLE ops_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_division_group_name UNIQUE(division_id, name)
);

CREATE TABLE ops_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES ops_groups(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_group_member_dates CHECK (ends_at IS NULL OR starts_at < ends_at)
);

CREATE INDEX idx_group_members_active
ON ops_group_members(group_id, employee_id, starts_at, ends_at);

CREATE TABLE ops_resource_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES ops_events(id) ON DELETE CASCADE,
    requirement_id UUID REFERENCES ops_event_requirements(id) ON DELETE SET NULL,
    target_division_id UUID NOT NULL,
    required_count INT NOT NULL CHECK (required_count > 0),
    required_role_code VARCHAR(100) NOT NULL REFERENCES ops_assignment_roles(code) ON DELETE RESTRICT,
    status_code VARCHAR(50) DEFAULT 'SENT' NOT NULL REFERENCES ops_request_statuses(code) ON DELETE RESTRICT,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE ops_resource_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES ops_resource_requests(id) ON DELETE CASCADE,
    allocation_type VARCHAR(50) NOT NULL CHECK (allocation_type IN ('EMPLOYEE','GROUP')),
    employee_id UUID,
    group_id UUID REFERENCES ops_groups(id) ON DELETE SET NULL,
    status_code VARCHAR(50) DEFAULT 'PROPOSED' NOT NULL REFERENCES ops_allocation_statuses(code) ON DELETE RESTRICT,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_alloc_target CHECK (
        (allocation_type='EMPLOYEE' AND employee_id IS NOT NULL AND group_id IS NULL) OR
        (allocation_type='GROUP' AND group_id IS NOT NULL AND employee_id IS NULL)
    )
);
```

### DB-OPS-010. Assignment versions and assignments

```sql
CREATE TABLE ops_assignment_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES ops_events(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    status_code VARCHAR(50) DEFAULT 'DRAFT' NOT NULL REFERENCES ops_assignment_version_statuses(code) ON DELETE RESTRICT,
    has_warnings BOOLEAN DEFAULT FALSE NOT NULL,
    approval_payload_hash VARCHAR(64),
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_event_version UNIQUE(event_id, version_number)
);

CREATE TABLE ops_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id UUID NOT NULL REFERENCES ops_assignment_versions(id) ON DELETE CASCADE,
    source_allocation_id UUID REFERENCES ops_resource_allocations(id) ON DELETE SET NULL,
    employee_id UUID NOT NULL,
    object_id UUID NOT NULL REFERENCES ops_objects(id) ON DELETE RESTRICT,
    sector_id UUID REFERENCES ops_object_sectors(id) ON DELETE RESTRICT,
    post_id UUID REFERENCES ops_object_posts(id) ON DELETE RESTRICT,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    assignment_role_code VARCHAR(100) NOT NULL REFERENCES ops_assignment_roles(code) ON DELETE RESTRICT,
    override_reason TEXT,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_assign_dates CHECK (starts_at < ends_at)
);

CREATE INDEX idx_ops_assignments_version_employee
ON ops_assignments(version_id, employee_id);

CREATE INDEX idx_ops_assignments_employee_time
ON ops_assignments(employee_id, starts_at, ends_at);
```

### DB-OPS-011. Conflicts

```sql
CREATE TABLE ops_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id UUID NOT NULL REFERENCES ops_assignment_versions(id) ON DELETE CASCADE,
    assignment_id UUID REFERENCES ops_assignments(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    conflict_code VARCHAR(100) NOT NULL,
    conflict_type VARCHAR(50) NOT NULL,
    severity VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    is_overridden BOOLEAN DEFAULT FALSE NOT NULL,
    override_reason TEXT,
    resolved_by_return BOOLEAN DEFAULT FALSE NOT NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_ops_conflicts_version
ON ops_conflicts(version_id, severity, is_overridden, resolved_by_return);
```

Allowed `conflict_code`:

```text
DOUBLE_ASSIGNMENT_CONFLICT
UNAVAILABLE_STATUS_CONFLICT
REST_VIOLATION_CONFLICT
WORKLOAD_EXCEEDED_CONFLICT
POST_REQUIREMENT_MISMATCH_CONFLICT
DUTY_OVERLAP_CONFLICT
OVERQUALIFICATION_DETECTED
EMPTY_GROUP
```

### DB-OPS-012. Duty plans

```sql
CREATE TABLE ops_duty_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES ops_objects(id) ON DELETE CASCADE,
    year INT NOT NULL CHECK (year BETWEEN 2026 AND 2100),
    month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
    status_code VARCHAR(50) DEFAULT 'DRAFT' NOT NULL REFERENCES ops_duty_plan_statuses(code) ON DELETE RESTRICT,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_duty_plan_object_month UNIQUE(object_id, year, month)
);

CREATE TABLE ops_duty_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES ops_duty_plans(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    post_id UUID REFERENCES ops_object_posts(id) ON DELETE RESTRICT,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_duty_shift_dates CHECK (starts_at < ends_at)
);

CREATE INDEX idx_ops_duty_employee_time
ON ops_duty_shifts(employee_id, starts_at, ends_at);
```

### DB-OPS-013. Daily personnel reports and marks

```sql
CREATE TABLE ops_daily_personnel_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_date DATE NOT NULL,
    version_number INT DEFAULT 1 NOT NULL,
    status_code VARCHAR(50) NOT NULL REFERENCES ops_daily_report_statuses(code) ON DELETE RESTRICT,
    generated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    generated_by VARCHAR(100),
    previous_report_id UUID REFERENCES ops_daily_personnel_reports(id) ON DELETE SET NULL,
    correction_reason TEXT,
    CONSTRAINT unique_report_date_version UNIQUE(report_date, version_number)
);

CREATE TABLE ops_daily_personnel_report_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL REFERENCES ops_daily_personnel_reports(id) ON DELETE CASCADE,
    division_id UUID NOT NULL,
    report_column_code VARCHAR(50) NOT NULL,
    status_type_code VARCHAR(50) REFERENCES ops_status_types(code) ON DELETE RESTRICT,
    count INT NOT NULL CHECK (count >= 0),
    CONSTRAINT unique_report_division_column UNIQUE(report_id, division_id, report_column_code)
);

CREATE TABLE ops_daily_update_marks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_date DATE NOT NULL,
    division_id UUID NOT NULL,
    mark_type VARCHAR(50) DEFAULT 'INITIAL' NOT NULL CHECK (mark_type IN ('INITIAL','CORRECTION')),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_by VARCHAR(100) NOT NULL,
    CONSTRAINT unique_date_division_mark_type UNIQUE(report_date, division_id, mark_type)
);
```

**BR-DAILY-MARK-001.** Для формирования первого `FINAL` отчёта требуется `INITIAL` отметка от каждого leaf-подразделения активной организации/scope отчёта.

**BR-DAILY-MARK-002.** Для корректировки требуется `CORRECTION` отметка только от корректируемого подразделения.

**BR-DAILY-MARK-003.** Новая версия отчёта не требует повторной `INITIAL` отметки от всех подразделений.

---

## 4.3. Analytics Context

```sql
CREATE TABLE analytics_workload_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    date DATE NOT NULL,
    total_hours NUMERIC(5,2) NOT NULL CHECK (total_hours >= 0),
    night_hours NUMERIC(5,2) DEFAULT 0 NOT NULL CHECK (night_hours >= 0),
    weekend_hours NUMERIC(5,2) DEFAULT 0 NOT NULL CHECK (weekend_hours >= 0),
    calculated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_emp_workload_date UNIQUE(employee_id, date)
);

CREATE INDEX idx_analytics_workload_employee_date
ON analytics_workload_daily(employee_id, date);
```

---

## 4.4. Documents Context

```sql
CREATE TABLE documents_report_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID,
    kind VARCHAR(50) NOT NULL,
    format VARCHAR(10) NOT NULL,
    status VARCHAR(50) DEFAULT 'QUEUED' NOT NULL,
    file_path TEXT,
    requested_by VARCHAR(100) NOT NULL,
    requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at TIMESTAMPTZ
);
```

Allowed values:

```text
kind: DAILY_REPORT, ASSIGNMENT
format: DOCX, XLSX, PDF
status: QUEUED, GENERATING, READY, FAILED, CANCELLED
```

---

## 4.5. Notifications Context

```sql
CREATE TABLE notifications_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id VARCHAR(100) NOT NULL,
    type_code VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    entity_type VARCHAR(100),
    entity_id UUID,
    is_read BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_notifications_recipient_unread
ON notifications_messages(recipient_user_id, is_read, created_at);
```

---

## 4.6. Audit Context

```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    old_value JSONB,
    new_value JSONB,
    reason TEXT,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_audit_entity
ON audit_logs(entity_type, entity_id, created_at);
```

---

# 5. Бизнес-правила

## BR-001. Daily report priority matrix

При формировании daily report сотрудник получает ровно один статус за дату `report_date`.

**Единственные источники матрицы:**

- `ops_employee_statuses`;
- `ops_assignments` approved versions.

`ops_duty_shifts` напрямую проектором не читаются. Они проецируются в `ops_employee_statuses` через `DutyShiftStatusProjector`:

- `DUTY` на интервал дежурства;
- `REST_AFTER_DUTY` на последующий период;
- `BEFORE_DUTY` — зарезервировано, в MVP не проецировать до решения заказчика.

Алгоритм:

1. Получить UTC-границы локальной даты `report_date` через TIME-002.
2. Собрать все пересекающиеся интервалы `ops_employee_statuses` со `state_code IN ('ACTIVE','PLANNED')`.
3. Собрать все `ops_assignments` approved versions, пересекающиеся с датой.
4. Победитель — минимальный `ops_status_types.priority`.
5. При равном priority: `status_type_code ASC`, затем `starts_at ASC`.
6. Если интервалов нет — `IN_SERVICE`.

## BR-002. Daily report columns and staffing balance

### 5.2.1. Колонки отчёта

`ops_daily_personnel_report_items.report_column_code` формируется из `ops_status_types.report_column_code`.

Базовые колонки:

```text
STAFF_TOTAL
LIST_TOTAL
VACANCIES
IN_SERVICE
SICK
VACATION
COMMAND
TRAINING
DETACHED
ATTACHED
ATTACHED_PLUS
BEFORE_DUTY
ON_DUTY
AFTER_DUTY
OTHER
```

### 5.2.2. Баланс штат / список / вакансии

Для каждого leaf-подразделения на дату `T`:

1. **STAFF_TOTAL** = `allocated_slots` из `core_division_historical_slots`, где:
   ```sql
   valid_from <= T AND (valid_to IS NULL OR valid_to > T)
   ```
2. **Активные на T** = сотрудники, у которых:
   ```text
   created_at <= T AND (separated_at IS NULL OR separated_at > T)
   ```
   и историческое подразделение на `T` = текущее leaf-подразделение.
3. **VACANCIES** = `STAFF_TOTAL - active_count_on_T`, минимум 0.
4. **LIST_TOTAL** = `STAFF_TOTAL - VACANCIES`.
5. Σ присутственно-отсутствующих колонок, исключая `ATTACHED` и `ATTACHED_PLUS`, должно быть равно `LIST_TOTAL`.
6. `ATTACHED` и `ATTACHED_PLUS` выводятся как `+N`, не входят в штатный числитель принимающего подразделения.

**BR-002.1.** Если нет записи `core_division_historical_slots`, `STAFF_TOTAL=0`, отчёт помечается warning, но не падает, если заказчик не требует строгой штатки.

**BR-002.2.** `is_attached_force=true` → отдельная колонка `ATTACHED_PLUS`, сотрудник исключается из `STAFF_TOTAL`, `VACANCIES`, `LIST_TOTAL` и числителя баланса.

## BR-003. Hard-block and soft-warning

Hard-block определяется данными: `ops_status_types.is_hard_block=true`.

MVP default hard-block:

```text
SICK_LEAVE
LEAVE_BY_REPORT
VACATION
COMMAND
```

Hard-block → HTTP `422 HARD_UNAVAILABLE_STATUS`, override невозможен.

Soft-warning → HTTP `409 SOFT_CONFLICT_DETECTED`, если нет `override_reason`.

Soft-warning codes:

```text
DOUBLE_ASSIGNMENT_CONFLICT
DUTY_OVERLAP_CONFLICT
REST_VIOLATION_CONFLICT
WORKLOAD_EXCEEDED_CONFLICT
POST_REQUIREMENT_MISMATCH_CONFLICT
OVERQUALIFICATION_DETECTED
```

`override_reason` должен быть 10–500 символов.

**OQ-007.** Протокол PR допускает модель “все конфликты soft+override”. Для этого на deployment можно выставить `is_hard_block=false` для всех статусов без изменения кода.

## BR-004. Transaction lock policy

Все команды изменения назначений выполняются в `transaction.atomic()`.

Последовательность блокировки:

1. `ops_assignment_versions` по `version_id` через `SELECT FOR UPDATE`.
2. `core_employees` по `employee_id` через `CoreEmployeeLockSelector.lock_employee`.
3. Пересекающиеся `ops_employee_statuses`:
   ```sql
   SELECT * FROM ops_employee_statuses
   WHERE employee_id = :employee_id
     AND starts_at < :ends_at
     AND ends_at > :starts_at
   FOR UPDATE;
   ```
4. Пересекающиеся `ops_assignments`:
   ```sql
   SELECT * FROM ops_assignments
   WHERE employee_id = :employee_id
     AND starts_at < :ends_at
     AND ends_at > :starts_at
   FOR UPDATE;
   ```
5. Пересекающиеся `ops_duty_shifts`:
   ```sql
   SELECT * FROM ops_duty_shifts
   WHERE employee_id = :employee_id
     AND starts_at < :ends_at
     AND ends_at > :starts_at
   FOR UPDATE;
   ```

При group assignment сотрудники блокируются в порядке `employee_id.hex ASC`.

## BR-005. Group assignment

- Участники: `ops_group_members`, активные на интервал:
  ```sql
  starts_at < :ends_at AND (ends_at IS NULL OR ends_at > :starts_at)
  ```
- Пустая группа → `422 EMPTY_GROUP`.
- Hard-block хотя бы у одного участника → откат всей транзакции, `422`.
- Soft-warning без override → откат всей транзакции, `409`.
- Override → создать индивидуальный `ops_assignments` на каждого участника, один `source_allocation_id` для всей GROUP-аллокации, конфликты записать в `ops_conflicts`.

## BR-006. WORKLOAD_EXCEEDED_CONFLICT

Назначение создаёт `WORKLOAD_EXCEEDED_CONFLICT`, если с учётом нового назначения образуется **3 календарных суток подряд**, в каждом из которых:

```text
analytics_workload_daily.total_hours + hours_of_new_assignment > 8.0
```

Окно проверки: `[starts_at_date - 2 days; ends_at_date]`.

Если витрина пуста, учитывать только новый интервал.

## BR-007. POST_REQUIREMENT_MISMATCH_CONFLICT

Сотрудник конфликтует с `ops_object_posts.requirements`, если нарушено хотя бы одно заданное ограничение:

- `min_height_cm`: `employee.height_cm IS NULL OR employee.height_cm < min_height_cm`;
- `gender`: задан и `employee.gender != gender`;
- `min_rank_index`: `employee.rank_index < min_rank_index`;
- `max_rank_index`: задан и `employee.rank_index > max_rank_index`;
- `required_position_codes`: список непустой и `employee.position_code NOT IN list`;
- `allow_overqualification=false`: при заданном `min_rank_index`, если `employee.rank_index > min_rank_index`, создать `OVERQUALIFICATION_DETECTED`.

Пустой `requirements` (`{}` или только `schema_version`) → конфликта нет.

## BR-008. Delete assignment and brokerage consistency

При удалении `ops_assignments`:

- разрешено только для версий `DRAFT` и `RETURNED`;
- если есть `source_allocation_id`, связанная `ops_resource_allocations.status_code` меняется:
  - `CONFIRMED → PROPOSED`;
  - `PROPOSED` остаётся `PROPOSED`;
  - `REJECTED` не меняется;
- перед сменой статуса заблокировать `ops_resource_allocations` и родительский `ops_resource_requests` через `SELECT FOR UPDATE`;
- действие пишется в `audit_logs`.

## BR-009. Delete assignment version and brokerage reset

При удалении `ops_assignment_versions`:

- разрешено только для `DRAFT` и `RETURNED`;
- `SUBMITTED` / `APPROVED` → `423 ASSIGNMENT_VERSION_LOCKED`;
- команда `DeleteAssignmentVersionCommand` собирает `DISTINCT source_allocation_id` всех дочерних `ops_assignments`;
- блокирует `ops_resource_allocations` и `ops_resource_requests` через `SELECT FOR UPDATE`;
- переводит `CONFIRMED → PROPOSED`;
- удаляет version;
- пишет одну сводную запись в `audit_logs`.

## BR-010. DB safety-net for brokerage reset

Дополнительно к штатной команде используется DB safety-net:

- PostgreSQL `BEFORE DELETE` trigger на `ops_assignment_versions`;
- собирает `source_allocation_id` дочерних assignments;
- переводит связанные `ops_resource_allocations` `CONFIRMED → PROPOSED`;
- покрывает out-of-band удаления: raw SQL, cascade, bulk;
- actor для триггера может быть `SYSTEM`, штатный аудит с реальным actor делает команда.

## BR-011. Assignment version hash

Алгоритм:

1. Выбрать все assignments версии.
2. Отсортировать по:
   - `employee_id.hex ASC`;
   - `starts_at UTC iso ASC`;
   - `id.hex ASC`.
3. Для каждой записи сформировать:

```python
line = (
    f"{UUID(employee_id).hex}:"
    f"{UUID(object_id).hex}:"
    f"{UUID(sector_id).hex if sector_id else 'null'}:"
    f"{UUID(post_id).hex if post_id else 'null'}:"
    f"{starts_at.astimezone(timezone.utc).isoformat()}:"
    f"{ends_at.astimezone(timezone.utc).isoformat()}:"
    f"{assignment_role_code}"
)
```

4. Объединить через `\n`.
5. `sha256(canonical_text.encode("utf-8")).hexdigest()`.

## BR-012. Freeze trigger

Если parent version `status_code IN ('SUBMITTED', 'APPROVED')`, PostgreSQL trigger запрещает:

- INSERT;
- UPDATE;
- DELETE

в `ops_assignments`.

Если version `RETURNED` или `DRAFT`, изменения разрешены.

## BR-013. Return version

`POST /return`:

- разрешён только из `SUBMITTED`;
- переводит в `RETURNED`;
- `approval_payload_hash` сохраняется;
- активные конфликты версии помечаются:
  - `resolved_by_return=true`;
  - `resolved_at=now()`;
- физически конфликты не удаляются;
- audit обязателен.

## BR-014. Approve version

`POST /approve`:

- разрешён только из `SUBMITTED`;
- пересчитывает текущий hash;
- если current hash != `approval_payload_hash` → `409 HASH_MISMATCH`;
- статус меняется на `APPROVED`;
- audit обязателен.

## BR-015. Daily update marks

`POST /daily-update-marks`:

- `mark_type='INITIAL'` — первичная готовность за дату;
- `mark_type='CORRECTION'` — корректировка за дату;
- повторная такая же отметка возвращает `200 OK` и обновляет `updated_at`, не падает UniqueViolation.

## BR-016. Post deactivation window

`ops_object_posts.is_active=false` блокируется (`409 POST_IN_USE`), если на `post_id` есть будущая занятость:

- `ops_assignments` в версиях `DRAFT/SUBMITTED/APPROVED` с `ends_at >= now()`;
- `ops_duty_shifts` с `ends_at >= now()`;
- `ops_event_requirements` с `ends_at >= now()`.

Исторические записи `ends_at < now()` деактивацию не блокируют.

## BR-017. Duty projection

При `POST /duty-plans/{id}/approve` система проецирует `ops_duty_shifts` в `ops_employee_statuses`:

1. `DUTY` на интервал смены;
2. `REST_AFTER_DUTY` с `starts_at = duty_shift.ends_at`, `ends_at = duty_shift.ends_at + 24 hours`;
3. `source_code='DUTY_AUTO'`.

`BEFORE_DUTY` в MVP не проецировать автоматически до решения заказчика.

---

# 6. REST API

Общие правила:

- все мутации выполняются в `transaction.atomic()`;
- все мутации пишутся в `audit_logs`;
- проверка прав только через `PermissionService.has_permission(...)`;
- ошибки: `400 VALIDATION_ERROR`, `403 PERMISSION_DENIED`, `404 *_NOT_FOUND`;
- списки: пагинация `limit/offset`;
- фильтрация по scope роли обязательна.

## API-OPS-001. Создать индивидуальное назначение

**Method:** `POST`  
**URL:** `/api/operations/assignment-versions/{version_id}/assignments`  
**Permission:** `assignment.create`

Request:

```json
{
  "employee_id": "89b52cc8-2f17-4881-8072-a16f21c64af5",
  "object_id": "a4b52cc8-2f17-4881-8072-a16f21c64af1",
  "sector_id": "b4b52cc8-2f17-4881-8072-a16f21c64af2",
  "post_id": "c4b52cc8-2f17-4881-8072-a16f21c64af3",
  "starts_at": "2026-06-05T09:00:00+05:00",
  "ends_at": "2026-06-05T17:00:00+05:00",
  "assignment_role_code": "SENIOR_GUARD",
  "override_reason": null
}
```

Response 201:

```json
{
  "assignment_id": "d4b52cc8-2f17-4881-8072-a16f21c64af4",
  "status": "CREATED",
  "conflicts": []
}
```

Response 409:

```json
{
  "error_code": "SOFT_CONFLICT_DETECTED",
  "message": "Обнаружены конфликты несения службы личным составом.",
  "conflicts": [
    {
      "conflict_code": "REST_VIOLATION_CONFLICT",
      "severity": "WARNING",
      "description": "Сотрудник находится во временном интервале обязательного последежурного отдыха."
    }
  ]
}
```

Errors:

| HTTP | error_code |
|---:|---|
| 400 | VALIDATION_ERROR |
| 403 | PERMISSION_DENIED |
| 404 | VERSION_NOT_FOUND |
| 409 | SOFT_CONFLICT_DETECTED |
| 422 | HARD_UNAVAILABLE_STATUS |
| 423 | ASSIGNMENT_VERSION_LOCKED |

## API-OPS-002. Удалить назначение

**Method:** `DELETE`  
**URL:** `/api/operations/assignment-versions/{version_id}/assignments/{assignment_id}`  
**Permission:** `assignment.delete`

Rules:

- only `DRAFT` / `RETURNED`;
- reset brokerage allocation per BR-008;
- audit required.

Response: `204 No Content`.

## API-OPS-003. Удалить версию расстановки

**Method:** `DELETE`  
**URL:** `/api/operations/assignment-versions/{version_id}`  
**Permission:** `assignment.delete`

Rules:

- only `DRAFT` / `RETURNED`;
- `SUBMITTED` / `APPROVED` → `423 ASSIGNMENT_VERSION_LOCKED`;
- executes BR-009;
- DB trigger BR-010 is safety-net.

Response: `204 No Content`.

## API-OPS-004. Submit approval

**Method:** `POST`  
**URL:** `/api/operations/assignment-versions/{version_id}/submit-approval`  
**Permission:** `assignment.submit`

Rules:

- allowed from `DRAFT`, `RETURNED`;
- calculates hash;
- status becomes `SUBMITTED`;
- audit required.

Response:

```json
{
  "version_id": "e4b52cc8-2f17-4881-8072-a16f21c64af9",
  "status_code": "SUBMITTED",
  "approval_payload_hash": "64-char-sha256"
}
```

## API-OPS-005. Return version

**Method:** `POST`  
**URL:** `/api/operations/assignment-versions/{version_id}/return`  
**Permission:** `assignment.return`

Request:

```json
{
  "comment": "Требуется перерасчет сил по сектору Б."
}
```

Rules:

- only from `SUBMITTED`;
- comment required 10–1000 chars;
- status becomes `RETURNED`;
- conflicts marked resolved, not deleted;
- audit required.

Response:

```json
{
  "version_id": "e4b52cc8-2f17-4881-8072-a16f21c64af9",
  "status_code": "RETURNED",
  "resolved_conflicts_count": 3
}
```

## API-OPS-006. Approve version

**Method:** `POST`  
**URL:** `/api/operations/assignment-versions/{version_id}/approve`  
**Permission:** `assignment.approve`

Rules:

- only from `SUBMITTED`;
- current hash must equal `approval_payload_hash`;
- mismatch → `409 HASH_MISMATCH`;
- status becomes `APPROVED`;
- audit required.

## API-OPS-007. Group assignment

**Method:** `POST`  
**URL:** `/api/operations/assignment-versions/{version_id}/group-assignments`  
**Permission:** `assignment.create`

Request:

```json
{
  "group_id": "49b52cc8-2f17-4881-8072-a16f21c64af5",
  "object_id": "a4b52cc8-2f17-4881-8072-a16f21c64af1",
  "sector_id": "b4b52cc8-2f17-4881-8072-a16f21c64af2",
  "post_id": null,
  "starts_at": "2026-06-05T09:00:00+05:00",
  "ends_at": "2026-06-05T17:00:00+05:00",
  "assignment_role_code": "GROUP_REINFORCEMENT",
  "source_allocation_id": "optional-group-allocation-id",
  "override_reason": null
}
```

## API-OPS-008. Daily update mark

**Method:** `POST`  
**URL:** `/api/operations/daily-update-marks`  
**Permission:** `daily_report.mark_update`

Request:

```json
{
  "report_date": "2026-06-02",
  "division_id": "f4b52cc8-2f17-4881-8072-a16f21c64af0",
  "mark_type": "INITIAL"
}
```

Response:

- first call: `201 Created`;
- repeated same mark: `200 OK`, update `updated_at`.

## API-OPS-009. Employee statuses

- `POST /api/operations/employee-statuses` — `status.manage`; creates manual status `source_code=USER`.
- `GET /api/operations/employee-statuses?employee_id&date_from&date_to` — `status.view`.
- `POST /api/operations/employee-statuses/{id}/terminate` — early termination.
- `POST /api/operations/employee-statuses/{id}/cancel` — cancel only from `PLANNED`.

## API-OPS-010. Objects / sectors / posts

Permission: `object.manage`.

- `POST|GET|PATCH /api/operations/objects`;
- `POST|GET|PATCH /api/operations/objects/{id}/sectors`;
- `POST|GET|PATCH /api/operations/objects/{id}/posts`;
- `POST /api/operations/posts/{id}/deactivate` — executes BR-016.

## API-OPS-011. Events / requirements

Permission: `event.manage`.

- `POST|GET|PATCH /api/operations/events`;
- `POST /api/operations/events/{id}/objects`;
- `POST /api/operations/events/{id}/requirements`;
- `POST /api/operations/events/{id}/transition {to_status_code}`.

## API-OPS-012. Duty plans

Permission: `duty.manage`.

- `POST|GET /api/operations/duty-plans`;
- `POST|GET /api/operations/duty-plans/{id}/shifts`;
- `POST /api/operations/duty-plans/{id}/approve` — projects statuses through BR-017.

## API-OPS-013. Brokerage

Permissions: `assignment.create` / `brokerage.manage`.

- `POST /api/operations/events/{id}/resource-requests`;
- `GET /api/operations/resource-requests?event_id`;
- `POST /api/operations/resource-requests/{id}/allocate`;
- `POST /api/operations/resource-allocations/{id}/confirm`;
- `POST /api/operations/resource-allocations/{id}/reject`.

## API-OPS-014. Daily reports

- `POST /api/operations/daily-reports {report_date, mode: INITIAL|CORRECTION, division_id?}`;
- `GET /api/operations/daily-reports?report_date`;
- `GET /api/operations/daily-reports/{id}/download`.

Rules:

- `INITIAL` requires all `INITIAL` marks from active leaf divisions;
- missing marks → `409 MARKS_INCOMPLETE` with list;
- `CORRECTION` requires correction mark from corrected division only;
- generation is async through Celery;
- download before ready → `409 NOT_READY`.

## API-OPS-015. Read endpoints

- `GET /api/operations/assignment-versions/{id}`;
- `GET /api/operations/assignment-versions/{id}/assignments`;
- `GET /api/operations/assignment-versions/{id}/conflicts?include_resolved=false`.

## API-OPS-016. Roles and permissions

Permission: `admin.roles`.

- `POST|GET|PATCH /api/operations/roles`;
- `POST|GET|PATCH /api/operations/permissions`;
- `POST|DELETE /api/operations/roles/{code}/permissions`;
- `POST|DELETE /api/operations/user-roles`.

## API-CORE-001. Leaf divisions

`GET /api/core/divisions/{division_id}/leaf-descendants`

Rules:

- use `WITH RECURSIVE`;
- return active leaf nodes only;
- one SQL query.

## API-NOTIF-001. Notifications

- `GET /api/notifications?is_read=false`;
- `POST /api/notifications/{id}/read`;
- `POST /api/notifications/read-all`.

---

# 7. TASK Layer for Google Jules

## TASK-001. DDD skeleton and isolation tests

Create apps `core`, `operations`, `analytics`, `audit`, `documents`, `notifications`. Add AST test prohibiting cross-context ORM imports.

**AC:** `operations.models` importing `core.models` fails test.

## TASK-002. Core schema

Implement `core_organizations`, `core_division_types`, `core_divisions`, `core_employees`, `core_employee_division_history`, `core_user_employee_bindings`, `core_division_historical_slots`.

**AC:** employee creation creates initial division history.

## TASK-003. Historical employee selector

Implement `HistoricalEmployeeSelector.get_employee_division_at_date(employee_id, target_date)`.

**AC:** old date returns old division; missing history fallback returns current division.

## TASK-004. Recursive leaf selector

Implement `CoreDivisionTreeSelector.get_descendant_leaf_divisions(division_id)` with raw SQL `WITH RECURSIVE`.

**AC:** 1000-node tree returns leaf nodes in one SQL query.

## TASK-005. Roles and permissions

Implement `ops_roles`, `ops_permissions`, `ops_role_permissions`, `ops_user_roles`, seed data, `PermissionService.has_permission`.

**AC:** OMD has `assignment.create`; DIVISION_OPERATOR has `daily_report.mark_update`; missing permission → 403.

## TASK-006. Lookup tables

Implement all status/source/post/request/allocation/duty/role lookup tables and seed values.

**AC:** `CORRECTION` exists; `SICK_LEAVE.priority < EVENT_ASSIGNMENT.priority`; `SUBMITTED.is_locked=true`.

## TASK-007. Objects, sectors, posts and requirements validator

Implement object/post models and JSON Schema validator.

**AC:** unknown key fails; empty requirements allowed.

## TASK-008. Employee statuses API

Implement create/list/terminate/cancel statuses.

**AC:** cancel only `PLANNED`; terminate updates interval and audit.

## TASK-009. Event and requirement APIs

Implement events, event objects, event requirements, transition.

**AC:** requirement object must belong to event objects.

## TASK-010a. ConflictDetector base rules

Implement double assignment, duty overlap, rest violation.

**AC:** each rule returns correct `conflict_code`.

## TASK-010b. Workload conflict rule

Implement BR-006.

**AC:** 3 days >8h → conflict; 2 days → no conflict.

## TASK-010c. Post requirement rule

Implement BR-007.

**AC:** height/gender/rank/position/overqualification test cases pass.

## TASK-011a. Assignment serializer and permissions

Validate payload, permissions, error codes 400/403/404.

**AC:** invalid payload → 400; no permission → 403.

## TASK-011b. Create assignment orchestration

Lock → conflict detector → create/override/audit.

**AC:** 201/409/422/423 paths pass.

## TASK-012. Delete assignment with brokerage reset

Implement API-OPS-002 and BR-008.

**AC:** allocation `CONFIRMED → PROPOSED`; response 204; audit exists.

## TASK-013a. Group member selector

Implement group active interval predicate and stable lock order.

**AC:** empty group → `EMPTY_GROUP`; correct active members.

## TASK-013b. Group assignment command

Implement group assignment full transaction.

**AC:** hard-block one member creates 0 assignments; soft override creates N assignments with same `source_allocation_id`.

## TASK-014. Hash service

Implement SHA-256 canonical hash.

**AC:** nullable fields as `null`; UUID `.hex`; stable hash.

## TASK-015. Freeze trigger

Implement PostgreSQL trigger blocking changes for `SUBMITTED/APPROVED` versions.

**AC:** raw SQL update is blocked; `RETURNED` allows update.

## TASK-016. Submit, return and approve commands

Implement `submit-approval`, `return`, `approve`.

**AC:** submit locks; return marks conflicts resolved; approve checks hash.

## TASK-017. Assignment version delete command and DB safety-net

Implement `DeleteAssignmentVersionCommand` and `BEFORE DELETE` trigger safety-net.

**AC:** command resets allocations and audits; raw delete resets allocations to PROPOSED with SYSTEM fallback.

## TASK-018a. DutyShiftStatusProjector

Project `duty_shifts` to `ops_employee_statuses`.

**AC:** one shift creates DUTY and REST_AFTER_DUTY.

## TASK-018b. DailyStatusResolver

Implement priority + tie-break + fallback.

**AC:** SICK > EVENT; deterministic equal priority.

## TASK-018c. ReportItemAggregator

Aggregate by leaf divisions, staffing balance, attached +N.

**AC:** ATTACHED/ATTACHED_PLUS not in staff numerator.

## TASK-018d. Daily report Celery generation

Implement marks gating, versions, corrections, document request creation.

**AC:** FINAL without all INITIAL marks rejected; CORRECTION does not require all INITIAL again.

## TASK-019. Documents context

Implement `documents_report_requests`, async generation statuses, daily report and assignment downloads.

**AC:** download before ready → 409 NOT_READY.

## TASK-020. Notifications context

Implement notifications table and read APIs.

**AC:** unread filter works; read-all marks all messages.

---

# 8. Acceptance Criteria

| ID | Модуль | Критерий |
|---|---|---|
| AC-001 | Architecture | Нет cross-context FK между core и operations |
| AC-002 | Architecture | AST-test запрещает прямой импорт чужих ORM models |
| AC-003 | Roles | seed `ops_role_permissions` существует |
| AC-004 | Roles | OMD имеет `assignment.create`; DIVISION_OPERATOR имеет `daily_report.mark_update` |
| AC-005 | Statuses | Матрица содержит STUDY/COMPETITION/CONFERENCE/GEV/BEFORE_DUTY/LEAVE_BY_REPORT |
| AC-006 | Timezone | `report_date` считается через `VAPS_LOCAL_TIMEZONE=Asia/Qyzylorda` |
| AC-007 | Daily Report | Ночная смена 23:00–07:00 попадает в обе даты |
| AC-008 | Daily Report | DUTY не считается дважды |
| AC-009 | Daily Report | Сотрудник получает ровно один итоговый статус |
| AC-010 | Daily Report | ATTACHED выводится `+N`, не входит в штатный числитель |
| AC-011 | Daily Report | ATTACHED_PLUS выводится отдельно и не участвует в штатном балансе |
| AC-012 | Daily Report | INITIAL без всех leaf marks → 409 MARKS_INCOMPLETE |
| AC-013 | Daily Report | CORRECTION не требует всех INITIAL повторно |
| AC-014 | Staffing | STAFF/LIST/VACANCIES считаются по историческим слотам и историческому подразделению |
| AC-015 | Assignment | Hard-block возвращает 422 |
| AC-016 | Assignment | Soft-warning возвращает 409 |
| AC-017 | Assignment | Override создаёт conflict with `is_overridden=true` |
| AC-018 | Assignment | DELETE assignment возвращает 204 |
| AC-019 | Brokerage | DELETE assignment resets allocation to PROPOSED |
| AC-020 | Brokerage | DELETE assignment version resets all allocations to PROPOSED |
| AC-021 | Brokerage | Raw DELETE version trigger resets allocations as safety-net |
| AC-022 | Group | Empty group → 422 EMPTY_GROUP |
| AC-023 | Group | Hard-block одного участника откатывает всю группу |
| AC-024 | Group | Soft override создаёт N assignments с одним source_allocation_id |
| AC-025 | Conflict | WORKLOAD: 3 дня подряд >8ч → conflict; 2 дня → no conflict |
| AC-026 | Conflict | POST_REQUIREMENT covers height/gender/rank/position/overqualification |
| AC-027 | Hash | Hash стабилен на разных ОС |
| AC-028 | Freeze | DB trigger блокирует raw SQL update frozen assignment |
| AC-029 | Return | Return sets `RETURNED` and marks conflicts resolved, not deleted |
| AC-030 | Approve | Approve from non-SUBMITTED fails; hash mismatch → 409 |
| AC-031 | Posts | Past duty does not block post deactivation; future assignment blocks |
| AC-032 | Read API | GET version returns assignments + conflict summary |
| AC-033 | Documents | Download before ready → 409 NOT_READY |
| AC-034 | Audit | Every mutation writes audit log |
| AC-035 | Account bridge | RBAC/audit selectors never compare employee UUID with user_id string |
| AC-036 | Concurrency | Parallel assignment cannot create silent double assignment |
| AC-037 | Brokerage concurrency | Delete version and allocation confirm serialize deterministically |
| AC-038 | Notifications | Unread and read-all endpoints work |

---

# 9. Regression Tests

## TEST-001. Concurrent assignment lock

1. Create employee.
2. Start two parallel transactions assigning same employee to same interval.
3. First transaction commits.
4. Second continues.

Expected:

- no silent double assignment;
- second returns 409 or creates override conflict only if override provided.

## TEST-002. Daily report timezone

1. Create duty shift `2026-06-05T23:00:00+05:00` — `2026-06-06T07:00:00+05:00`.
2. Generate report for 05.06.
3. Generate report for 06.06.

Expected: employee counted in both dates.

## TEST-003. Return does not delete conflicts

1. Create assignment with override conflict.
2. Submit version.
3. Return version.

Expected:

- conflict not deleted;
- `resolved_by_return=true`;
- `resolved_at` set.

## TEST-004. Brokerage reset on delete assignment

1. Create allocation CONFIRMED.
2. Create assignment with `source_allocation_id`.
3. DELETE assignment.

Expected:

- assignment deleted;
- allocation status `PROPOSED`;
- audit log created.

## TEST-005. Brokerage reset on delete version

1. Create DRAFT version with 5 assignments from 5 CONFIRMED allocations.
2. DELETE version.

Expected:

- all 5 allocations become PROPOSED;
- one summary audit log exists;
- SUBMITTED version delete returns 423.

## TEST-006. Raw delete safety-net

1. Create DRAFT version with assignments tied to CONFIRMED allocation.
2. Delete version with raw SQL.

Expected: DB trigger resets allocation to PROPOSED.

## TEST-007. Daily mark correction

1. All leaf divisions send INITIAL.
2. Generate FINAL v1.
3. One division sends CORRECTION.
4. Generate CORRECTION v2.

Expected: no need to repeat all INITIAL marks.

## TEST-008. Staffing balance

1. Division has STAFF_TOTAL=10.
2. 8 active employees historically in division.
3. 1 attached force assigned.

Expected:

- STAFF_TOTAL=10;
- LIST_TOTAL=8;
- VACANCIES=2;
- ATTACHED_PLUS=+1;
- attached force not included in list/staff numerator.

## TEST-009. Account bridge

1. Create user_id `u-1`.
2. Bind to employee UUID.
3. Assign role to user_id.

Expected: PermissionService resolves via user_id, not employee UUID.

---

# 10. JULES.md

```md
# VAPS Master Engineering Rules v7.5 Consolidated

1. Develop VAPS strictly as Django 5.x + DRF Modular Monolith.
2. Physical microservices are forbidden in MVP.
3. Do not create cross-context ForeignKeys between apps.core, apps.operations, apps.analytics, apps.audit.
4. Use flat UUID/VARCHAR fields for cross-context references.
5. Read foreign context data only through selectors/services.
6. Do not import foreign context ORM models inside models.py.
7. Every mutating operation in apps.operations must run inside transaction.atomic().
8. Every assignment mutation must call AssignmentLockService before ConflictDetectorService.
9. Lock assignment version, employee, overlapping statuses, assignments and duty shifts.
10. Group assignment locks employees by employee_id.hex ASC.
11. Hard-block statuses are data-driven through ops_status_types.is_hard_block.
12. Hard-block returns HTTP 422 and is not overridable.
13. Soft-warning returns HTTP 409 unless override_reason is provided.
14. override_reason must be 10–500 characters.
15. Frozen assignment versions are enforced by PostgreSQL trigger.
16. Return endpoint sets status_code=RETURNED and marks conflicts resolved, not deleted.
17. Approve endpoint must verify current hash equals approval_payload_hash.
18. Hash generation must use UUID.hex, UTC isoformat, and null literal for nullable fields.
19. Daily report uses settings.VAPS_LOCAL_TIMEZONE, default Asia/Qyzylorda.
20. Do not read duty_shifts directly in daily projector; project duty to employee statuses first.
21. Use WITH RECURSIVE for division tree traversal.
22. Daily report must use historical employee division.
23. Deleting assignment with source_allocation_id must reset allocation status to PROPOSED.
24. Deleting assignment version must reset all linked allocations to PROPOSED.
25. Add DB trigger as safety-net for out-of-band version deletion.
26. ATTACHED and ATTACHED_PLUS are shown as +N and excluded from staff/list numerator.
27. RBAC/audit operate on user_id string only; never use core_employees.id as user_id.
28. Implement TASK list one by one. Do not merge unrelated tasks.
29. Do not use v8/v9/v10 full rewrites. This document is the only baseline.
```

---

# 11. Open Questions

| ID | Вопрос | Рекомендация MVP |
|---|---|---|
| OQ-001 | Нужна ли ЭЦП в MVP? | Нет, оставить hash-ready architecture |
| OQ-002 | Кто утверждает расстановку: один approver или цепочка? | В MVP один approver |
| OQ-003 | Какие статусы придут из кадровой системы? | В MVP STUB/KU_SYNC-ready lookup |
| OQ-004 | Разрешён ли override REST_AFTER_DUTY? | Да, как soft-warning |
| OQ-005 | Нужен ли Face ID в MVP? | Нет, future scope |
| OQ-006 | Нужна ли аккредитация в MVP? | Нет, future scope |
| OQ-007 | Hard-block оставить или перейти на чистый soft+override? | Подтвердить у заказчика; код конфигурируем через `is_hard_block` |
| OQ-008 | Кто создаёт KU-owned статусы в MVP без КУ? | Через `status.manage` вручную или seed/import stub |
| OQ-009 | Какие leaf-подразделения обязательны для FINAL? | Активные leaf дерева организации/scope отчёта |
| OQ-010 | BEFORE_DUTY проецируется автоматически? | MVP — нет, уточнить |
| OQ-011 | Мост аккаунт↔сотрудник: отдельная таблица или поле? | Использовать отдельную таблицу `core_user_employee_bindings` |

---

# 12. MVP Scope

## 12.1. В MVP входит

- Core organizations/divisions/employees.
- Employee division history.
- Account↔employee binding.
- Historical staffing slots.
- Operations roles/permissions.
- Lookup tables for statuses/states/sources/post types/roles.
- Objects/sectors/posts.
- Event objects and requirements.
- Employee statuses.
- Duty plans and duty status projection.
- Assignment versions.
- Individual assignments.
- Group assignments.
- Brokerage requests/allocations.
- Conflict detector.
- Freeze/return/approve workflow.
- Delete assignment and delete assignment version with brokerage reset.
- DB safety-net trigger for version delete allocation reset.
- Daily update marks.
- Daily personnel reports with corrections.
- Staffing/list/vacancy balance.
- ATTACHED and ATTACHED_PLUS columns.
- Audit logs.
- Basic workload analytics.
- Document generation for daily report and assignment.
- In-app notifications.

## 12.2. Future scope

- ЭЦП.
- Face ID.
- Accreditation.
- Full integration with HR system.
- SMS/email gateway.
- Advanced ratings.
- Talent/OKR.
- BI dashboards.

---

# 13. Final Implementation Order

1. Architecture skeleton and isolation tests.
2. Core schema and selectors.
3. Roles/permissions and lookup seeds.
4. Operations schema.
5. Status APIs.
6. Object/event/duty APIs.
7. Assignment locks and conflict detector.
8. Assignment APIs.
9. Group assignment.
10. Freeze/hash/return/approve.
11. Brokerage reset and delete version.
12. Daily marks and daily report projector.
13. Documents.
14. Notifications.
15. Regression test suite.

---

# 14. Final Decision v7.5

Этот раздел сохранён как историческая фиксация v7.5. После применения delta v7.6 итоговое решение переопределено в разделе 22.

---

# 15. v7.6 Full Coverage Delta Patch

## 15.0. Назначение delta v7.6

Этот раздел дополняет master v7.5 до полного покрытия требований из следующих источников:

- `PersonnelStatus.md` — ежедневный расход личного состава, статусы, штатка, документы, уведомления, календарь, регламентные задачи, импорт/экспорт;
- `VisitX.md` — полный цикл охранного мероприятия, рекогносцировка, инструктаж, штаб, инциденты, паспорт объекта, ОЛ, логистика, документооборот, аккредитация, Face ID, рейтинг;
- `ПланРасстановка.docx` — объект-центричная модель, паспорт/посты/чек-лист, дежурства, 8-шаговый поток ОМ, потребность, soft-conflicts, оценивание, дашборды;
- `ТЗ VAPS.md` — единое консолидированное ТЗ и матрица прослеживаемости;
- `brainstorming-session-2026-05-25-2256.md` — решения по объект-центричности, закрытому контуру, брокериджу, каскадной замене, дежурному как временному полномочию, in-app уведомлениям.

**V76-DECISION-001.** v7.6 не отменяет DDD Modular Monolith и не вводит физические микросервисы.

**V76-DECISION-002.** Все дополнения реализуются как новые модели, сервисы, API, задачи и acceptance criteria внутри существующего modular monolith.

**V76-DECISION-003.** При конфликте v7.5 и v7.6 приоритет имеет v7.6 только по тем пунктам, которые явно указаны в этом delta-разделе.

**V76-DECISION-004.** При конфликте исходных требований приоритет источников:

1. `ПланРасстановка.docx` / PR;
2. зафиксированные решения `brainstorming-session` / BS;
3. `ТЗ VAPS.md` как сводная карта;
4. `PersonnelStatus.md` / PS;
5. `VisitX.md` / VX.

**V76-DECISION-005.** Центр модели — `ops_objects`. Охранные мероприятия, ежедневные дежурства, паспорт, посты, чек-листы, рекогносцировка, нагрузка и история привязываются к объекту.

**V76-DECISION-006.** В full scope VAPS больше не является только системой ежедневного расхода. Это единая система: объект → дежурства → ОМ → потребность → запрос сил → расстановка → ознакомление → проведение → закрытие → архив → аналитика.

---

# 16. Расширение архитектурного каркаса v7.6

## 16.1. Дополненная структура проекта

```text
vaps/
  apps/
    core/
      models.py
      selectors.py
      services.py
      api/
      tests/

    operations/
      objects/
        models.py
        selectors.py
        services.py
        api/
        tests/
      duties/
        models.py
        services.py
        api/
        tests/
      events/
        models.py
        services.py
        commands.py
        api/
        tests/
      assignments/
        models.py
        services.py
        api/
        tests/
      load/
        models.py
        services.py
        tasks.py
        api/
        tests/
      ratings/
        models.py
        services.py
        api/
        tests/
      statuses/
        models.py
        services.py
        tasks.py
        api/
        tests/
      reports/
        services.py
        tasks.py
        exporters/
        tests/

    analytics/
      dashboards.py
      recommendations.py
      projections.py
      api/
      tests/

    audit/
    documents/
    notifications/

    integration_ku/
      models.py
      contracts.py
      tasks.py
      services.py
      api/
      tests/

    integration_auth/
      middleware.py
      services.py
      selectors.py
      tests/

    talent/
      models.py
      services.py
      api/
      tests/
```

## 16.2. Новые/расширенные bounded contexts

| Context | Назначение | Входит в MVP? | Владеет данными |
|---|---|---:|---|
| `operations.objects` | объект, паспорт объекта, посты, секторы, чек-листы, рекогносцировка | да | `ops_object_*` |
| `operations.events` | полный цикл ОМ, бюллетень, потребность, ознакомление, проведение, штаб, закрытие | да | `ops_event_*` |
| `operations.load` | расчёт нагрузки, фактическое время, перегрузка по посту | да | `ops_load_*`, projections |
| `operations.ratings` | оперативные оценки ОМ, рейтинг, налёт часов | MVP-2/3 | `ops_rating_*` |
| `integration_ku` | контракт синхронизации с кадровой системой / заглушка КУ | да | `integration_ku_*` |
| `integration_auth` | внешний Auth/JWT, VAPS не хранит пароли | да | без пользовательских паролей |
| `talent` | долгосрочные рейтинги, навыки, OKR, резерв | future/optional | `talent_*` |

**ARCH-009.** `integration_auth` не создаёт таблицу пользователей с паролями. Identity приходит из внешнего Auth/JWT.

**ARCH-010.** `integration_ku` в MVP может работать как stub через Django Admin + seed/import, но публичный контракт синхронизации фиксируется сразу.

**ARCH-011.** `talent` не блокирует MVP operations. Оперативные оценки ОМ находятся в `operations.ratings`; долгосрочный кадровый контур — в `talent`.

**ARCH-012.** Закрытый контур MVP: один on-prem server, LAN-only, без внешних email/SMS/cloud integrations.

---

# 17. Дополнение схемы базы данных v7.6

## 17.1. Core: должности, звания, штатные ставки, вакансии

### DB-CORE-008. `core_positions`

```sql
CREATE TABLE core_positions (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    level INT DEFAULT 0 NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### DB-CORE-009. `core_ranks`

```sql
CREATE TABLE core_ranks (
    code VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50),
    rank_index INT DEFAULT 0 NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### DB-CORE-010. `core_staffing_slots`

```sql
CREATE TABLE core_staffing_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_id UUID NOT NULL REFERENCES core_divisions(id) ON DELETE CASCADE,
    position_code VARCHAR(50) NOT NULL REFERENCES core_positions(code) ON DELETE RESTRICT,
    slot_number VARCHAR(50),
    parent_slot_id UUID REFERENCES core_staffing_slots(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_staffing_slot_dates CHECK (valid_to IS NULL OR valid_from < valid_to)
);

CREATE INDEX idx_core_staffing_slots_division
ON core_staffing_slots(division_id, is_active, valid_from, valid_to);
```

### DB-CORE-011. `core_employee_staffing_assignments`

```sql
CREATE TABLE core_employee_staffing_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES core_employees(id) ON DELETE CASCADE,
    staffing_slot_id UUID NOT NULL REFERENCES core_staffing_slots(id) ON DELETE RESTRICT,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    source VARCHAR(50) DEFAULT 'MANUAL' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_emp_staffing_dates CHECK (ends_at IS NULL OR starts_at < ends_at)
);

CREATE INDEX idx_core_emp_staffing_lookup
ON core_employee_staffing_assignments(employee_id, starts_at, ends_at);
```

### DB-CORE-012. `core_vacancies`

```sql
CREATE TABLE core_vacancies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staffing_slot_id UUID NOT NULL REFERENCES core_staffing_slots(id) ON DELETE CASCADE,
    status_code VARCHAR(50) DEFAULT 'OPEN' NOT NULL CHECK (status_code IN ('OPEN','CLOSED','FROZEN')),
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    reason TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_vacancy_dates CHECK (closed_at IS NULL OR opened_at < closed_at)
);
```

**BR-CORE-STAFF-001.** Для каскадной замены система использует `core_staffing_slots.parent_slot_id` и `core_positions.level/sort_order`.

**BR-CORE-STAFF-002.** Вакансия не равна сотруднику. Вакансия считается из свободной штатной ставки на дату.

## 17.2. Documents: вложения и документы-основания

### DB-DOC-002. `documents_attachments`

```sql
CREATE TABLE documents_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    kind VARCHAR(50) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL CHECK (file_size >= 0),
    description TEXT,
    uploaded_by VARCHAR(100) NOT NULL,
    uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE NOT NULL
);

CREATE INDEX idx_documents_attachments_entity
ON documents_attachments(entity_type, entity_id, kind, is_deleted);
```

Allowed `kind`:

```text
STATUS_BASIS
EVENT_BULLETIN
EVENT_EXTERNAL_DOCUMENT
EVENT_APPROVAL_DOCUMENT
EVENT_PRINT_FORM
OBJECT_SCHEMA
OBJECT_PHOTO
OBJECT_EVACUATION_SCHEMA
INCIDENT_PHOTO
INCIDENT_DOCUMENT
ACCREDITATION_FILE
LOGISTICS_DOCUMENT
OTHER
```

**BR-DOC-001.** Статус сотрудника может иметь несколько документов-оснований.

**BR-DOC-002.** Файлы не удаляются физически через обычный UI; используется soft delete + audit.

**BR-DOC-003.** Скачивание чувствительных документов фиксируется в `audit_logs`.

## 17.3. Operations Objects: паспорт объекта

### DB-OPS-014. `ops_object_passports`

```sql
CREATE TABLE ops_object_passports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL UNIQUE REFERENCES ops_objects(id) ON DELETE CASCADE,
    object_type VARCHAR(100),
    responsible_user_id VARCHAR(100),
    responsible_employee_id UUID,
    description TEXT,
    security_notes TEXT,
    vulnerable_places TEXT,
    access_routes JSONB DEFAULT '[]'::jsonb NOT NULL,
    entrances JSONB DEFAULT '[]'::jsonb NOT NULL,
    exits JSONB DEFAULT '[]'::jsonb NOT NULL,
    service_entrances JSONB DEFAULT '[]'::jsonb NOT NULL,
    parking_zones JSONB DEFAULT '[]'::jsonb NOT NULL,
    dropoff_zones JSONB DEFAULT '[]'::jsonb NOT NULL,
    elevators JSONB DEFAULT '[]'::jsonb NOT NULL,
    stairs JSONB DEFAULT '[]'::jsonb NOT NULL,
    roofs JSONB DEFAULT '[]'::jsonb NOT NULL,
    basements JSONB DEFAULT '[]'::jsonb NOT NULL,
    technical_rooms JSONB DEFAULT '[]'::jsonb NOT NULL,
    cameras JSONB DEFAULT '[]'::jsonb NOT NULL,
    power_supply TEXT,
    ventilation TEXT,
    communication TEXT,
    internet TEXT,
    nearby_high_buildings TEXT,
    public_zones TEXT,
    crowd_places TEXT,
    repair_works TEXT,
    completeness_status VARCHAR(50) DEFAULT 'RED' NOT NULL CHECK (completeness_status IN ('RED','YELLOW','GREEN')),
    last_verified_at TIMESTAMPTZ,
    last_verified_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### DB-OPS-015. `ops_object_passport_history`

```sql
CREATE TABLE ops_object_passport_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    passport_id UUID NOT NULL REFERENCES ops_object_passports(id) ON DELETE CASCADE,
    changed_by VARCHAR(100) NOT NULL,
    changed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    old_value JSONB,
    new_value JSONB NOT NULL,
    reason TEXT
);
```

**BR-OBJECT-001.** У каждого активного объекта должен быть паспорт.

**BR-OBJECT-002.** Если обязательные поля паспорта не заполнены, `completeness_status='RED'`.

**BR-OBJECT-003.** ОМ не может перейти в `READY` или `CLOSED`, если паспорт объекта имеет `RED`, кроме override руководителя с причиной.

**BR-OBJECT-004.** Паспорт объекта хранит историю изменений. При закрытии ОМ сохраняется снимок паспорта на момент мероприятия.

## 17.4. Operations Objects: расширение постов и секторов

### DB-OPS-016. Alter `ops_object_posts`

```sql
ALTER TABLE ops_object_posts
ADD COLUMN tasks TEXT,
ADD COLUMN features TEXT,
ADD COLUMN location_description TEXT,
ADD COLUMN is_outdoor BOOLEAN,
ADD COLUMN max_continuous_minutes INT,
ADD COLUMN min_rating NUMERIC(3,1),
ADD COLUMN requires_weapon BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN requires_special_equipment BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN requires_uniform BOOLEAN DEFAULT TRUE NOT NULL;
```

**BR-POST-001.** `max_continuous_minutes` используется для предупреждения о перегрузке по посту.

**BR-POST-002.** Задачи и особенности поста доводятся сотруднику при уведомлении/ознакомлении.

**BR-POST-003.** В печатной расстановке не выводить внутренний рейтинг, чувствительные комментарии, расширенную антропометрию и ограничения.

## 17.5. Object checklist and reconnaissance

### DB-OPS-017. `ops_object_checklist_templates`

```sql
CREATE TABLE ops_object_checklist_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### DB-OPS-018. `ops_object_checklist_items`

```sql
CREATE TABLE ops_object_checklist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES ops_object_checklist_templates(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    category VARCHAR(100),
    is_required BOOLEAN DEFAULT TRUE NOT NULL,
    sort_order INT DEFAULT 0 NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL
);
```

### DB-OPS-019. `ops_event_reconnaissance`

```sql
CREATE TABLE ops_event_reconnaissance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL UNIQUE REFERENCES ops_events(id) ON DELETE CASCADE,
    object_id UUID NOT NULL REFERENCES ops_objects(id) ON DELETE RESTRICT,
    status_code VARCHAR(50) DEFAULT 'DRAFT' NOT NULL CHECK (status_code IN ('DRAFT','IN_PROGRESS','COMPLETED','CONFIRMED','REQUIRES_CHANGES')),
    conducted_by VARCHAR(100) NOT NULL,
    conducted_at TIMESTAMPTZ,
    summary TEXT,
    decision_code VARCHAR(50) CHECK (decision_code IN ('CONFIRM_CURRENT_PLAN','CHANGE_POSTS_SECTORS','REQUIRE_ADDITIONAL_FORCES')),
    decision_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### DB-OPS-020. `ops_event_reconnaissance_items`

```sql
CREATE TABLE ops_event_reconnaissance_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reconnaissance_id UUID NOT NULL REFERENCES ops_event_reconnaissance(id) ON DELETE CASCADE,
    checklist_item_id UUID REFERENCES ops_object_checklist_items(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    answer_code VARCHAR(50) NOT NULL CHECK (answer_code IN ('YES','NO','NA','ISSUE')),
    comment TEXT,
    requires_action BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

**BR-RECON-001.** Рекогносцировка обязательна перед утверждением потребности, если объект не был проверен в пределах настроенного периода актуальности.

**BR-RECON-002.** Итог рекогносцировки: подтвердить текущие посты/секторы, изменить посты/секторы или запросить дополнительные силы.

**BR-RECON-003.** Если в чек-листе есть обязательный пункт `ISSUE`, переход ОМ в `READY` запрещён без решения/override.

## 17.6. Event statuses and lifecycle extension

### DB-OPS-021. Дополнительные seed для `ops_event_statuses`

```text
DRAFT
BULLETIN_CREATED
PREPARATION
SENIOR_ASSIGNED
RECONNAISSANCE
WAITING_CALCULATIONS
CALCULATIONS_PARTIAL
CALCULATIONS_COMPLETED
REQUIREMENTS_APPROVED
REQUESTS_SENT
ALLOCATIONS_IN_PROGRESS
ASSIGNMENT_DRAFT
ON_APPROVAL
RETURNED
APPROVED
READY
IN_PROGRESS
COMPLETED
WAITING_CLOSURE
CLOSED
ARCHIVED
CANCELLED
```

### DB-OPS-022. Alter `ops_events`

```sql
ALTER TABLE ops_events
ADD COLUMN object_id UUID REFERENCES ops_objects(id) ON DELETE RESTRICT,
ADD COLUMN event_type VARCHAR(100),
ADD COLUMN basis TEXT,
ADD COLUMN organizer TEXT,
ADD COLUMN protected_person_id UUID,
ADD COLUMN participation_format VARCHAR(100),
ADD COLUMN program TEXT,
ADD COLUMN importance_level_code VARCHAR(50) REFERENCES ops_event_levels(code) ON DELETE RESTRICT,
ADD COLUMN senior_user_id VARCHAR(100),
ADD COLUMN senior_employee_id UUID,
ADD COLUMN preparation_status TEXT,
ADD COLUMN requires_transport BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN requires_accreditation BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN requires_face_id BOOLEAN DEFAULT FALSE NOT NULL;
```

**BR-EVENT-001.** Каждое ОМ должно быть привязано минимум к одному объекту; для простого сценария используется `ops_events.object_id`, для многообъектного — `ops_event_objects`.

**BR-EVENT-002.** Канонический поток ОМ: объект → бюллетень → рекогносцировка → потребность → запрос сил → распределение → расстановка → ознакомление → проверка конфликтов → утверждение → проведение → закрытие → архив.

**BR-EVENT-003.** Нельзя закрыть ОМ без обязательных блоков закрытия: фактическая расстановка, изменения/замены, инциденты или отметка об отсутствии, документы, выводы, обновление паспорта, оценки/опрос по факту.

## 17.7. Event bulletin

### DB-OPS-023. `ops_event_bulletins`

```sql
CREATE TABLE ops_event_bulletins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL UNIQUE REFERENCES ops_events(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    primary_tasks TEXT,
    deadlines JSONB DEFAULT '[]'::jsonb NOT NULL,
    responsible_units JSONB DEFAULT '[]'::jsonb NOT NULL,
    document_list JSONB DEFAULT '[]'::jsonb NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

**BR-BULLETIN-001.** Создание бюллетеня переводит ОМ из `DRAFT` в `BULLETIN_CREATED`.

**BR-BULLETIN-002.** Бюллетень является стартовым документом подготовки расчётов.

## 17.8. Requirements / Need / distributed calculations

### DB-OPS-024. `ops_event_need_calculations`

```sql
CREATE TABLE ops_event_need_calculations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES ops_events(id) ON DELETE CASCADE,
    object_id UUID NOT NULL REFERENCES ops_objects(id) ON DELETE RESTRICT,
    division_id UUID,
    group_id UUID REFERENCES ops_groups(id) ON DELETE SET NULL,
    calculation_type VARCHAR(50) NOT NULL CHECK (calculation_type IN ('DIVISION','GROUP','PHYSICAL_DETAIL','TECHNICAL','TRANSPORT','OTHER')),
    required_count INT NOT NULL CHECK (required_count >= 0),
    required_male_count INT DEFAULT 0 NOT NULL CHECK (required_male_count >= 0),
    required_female_count INT DEFAULT 0 NOT NULL CHECK (required_female_count >= 0),
    required_equipment JSONB DEFAULT '{}'::jsonb NOT NULL,
    required_weapons JSONB DEFAULT '{}'::jsonb NOT NULL,
    required_special_equipment JSONB DEFAULT '{}'::jsonb NOT NULL,
    justification TEXT,
    risks TEXT,
    status_code VARCHAR(50) DEFAULT 'DRAFT' NOT NULL CHECK (status_code IN ('DRAFT','SUBMITTED','APPROVED','RETURNED')),
    submitted_by VARCHAR(100),
    submitted_at TIMESTAMPTZ,
    approved_by VARCHAR(100),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

**BR-NEED-001.** Утверждённая потребность является основанием для `ops_resource_requests`.

**BR-NEED-002.** Потребность может быть рассчитана по подразделениям, группам, физическому наряду, технике и иным направлениям.

**BR-NEED-003.** После утверждения потребности изменения требуют новой версии или возврата на доработку.

## 17.9. Assignment acquaintance / acknowledgement

### DB-OPS-025. `ops_assignment_acknowledgements`

```sql
CREATE TABLE ops_assignment_acknowledgements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES ops_assignments(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(100),
    status_code VARCHAR(50) DEFAULT 'PENDING' NOT NULL CHECK (status_code IN ('PENDING','ACKNOWLEDGED','DECLINED','NOT_REACHABLE')),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_assignment_ack_employee UNIQUE(assignment_id, employee_id)
);
```

**BR-ACK-001.** После утверждения расстановки каждому участнику создаётся `PENDING` ознакомление.

**BR-ACK-002.** Сотрудник видит: объект, сектор, пост, задачу, особенности, время сбора, время заступления, старшего, примечания.

**BR-ACK-003.** Старший объекта видит список неознакомившихся и может повторно отправить уведомление.

## 17.10. Operational replacements after approval

### DB-OPS-026. `ops_assignment_replacements`

```sql
CREATE TABLE ops_assignment_replacements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id UUID NOT NULL REFERENCES ops_assignment_versions(id) ON DELETE CASCADE,
    old_assignment_id UUID REFERENCES ops_assignments(id) ON DELETE SET NULL,
    old_employee_id UUID NOT NULL,
    new_employee_id UUID NOT NULL,
    object_id UUID NOT NULL REFERENCES ops_objects(id) ON DELETE RESTRICT,
    sector_id UUID REFERENCES ops_object_sectors(id) ON DELETE RESTRICT,
    post_id UUID REFERENCES ops_object_posts(id) ON DELETE RESTRICT,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    basis_document_id UUID,
    initiated_by VARCHAR(100) NOT NULL,
    sanctioned_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_replacement_dates CHECK (starts_at < ends_at)
);
```

**BR-REPLACE-001.** Оперативная замена после утверждения разрешена только через команду `ReplaceApprovedAssignmentCommand`.

**BR-REPLACE-002.** Замена проверяет все конфликты, как обычное назначение.

**BR-REPLACE-003.** Запись замены должна показывать: было/стало, пост, причину, инициатора, санкционирующего, дату, время, комментарий.

**BR-REPLACE-004.** Старая утверждённая версия не теряется. Создаётся новая revision/version или отдельная replacement history, в зависимости от режима deployment.

## 17.11. Cascade replacement

### DB-OPS-027. `ops_replacement_suggestions`

```sql
CREATE TABLE ops_replacement_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES ops_events(id) ON DELETE CASCADE,
    old_employee_id UUID NOT NULL,
    suggested_employee_id UUID NOT NULL,
    suggestion_order INT NOT NULL,
    reason TEXT NOT NULL,
    is_selected BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

**BR-CASCADE-001.** Авто-предложение замены работает внутри управления/leaf scope по штатной должностной цепочке.

**BR-CASCADE-002.** Ручной выбор допустим в пределах подразделения первого уровня под организацией; за пределами — через эскалацию/брокеридж.

**BR-CASCADE-003.** Система предлагает замену, но не назначает без подтверждения ответственного.

**BR-CASCADE-004.** Для предложения учитываются: доступность, конфликты, статус, должностная цепочка, соответствие посту, нагрузка.

## 17.12. Conduct phase / HQ journal

### DB-OPS-028. `ops_event_hq_journal_entries`

```sql
CREATE TABLE ops_event_hq_journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES ops_events(id) ON DELETE CASCADE,
    entry_type VARCHAR(100) NOT NULL,
    happened_at TIMESTAMPTZ NOT NULL,
    object_id UUID REFERENCES ops_objects(id) ON DELETE SET NULL,
    post_id UUID REFERENCES ops_object_posts(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_ops_hq_journal_event_time
ON ops_event_hq_journal_entries(event_id, happened_at);
```

Allowed `entry_type`:

```text
EVENT_STARTED
EVENT_COMPLETED
PROTECTED_PERSON_ARRIVED
PROTECTED_PERSON_DEPARTED
ROUTE_CHANGED
INSTRUCTION_GIVEN
REPORT_RECEIVED
REPLACEMENT
INCIDENT
TECHNICAL_PROBLEM
OBJECT_PROBLEM
OTHER
```

**BR-HQ-001.** В режиме проведения штаб видит активные объекты, посты, старших, состав наряда, журнал, инциденты, изменения, указания, движение ОЛ, логистику и аккредитацию.

**BR-HQ-002.** Каждая запись журнала immutable через обычный UI; исправления делаются новой записью с ссылкой на исправляемую.

## 17.13. Incidents

### DB-OPS-029. `ops_event_incidents`

```sql
CREATE TABLE ops_event_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES ops_events(id) ON DELETE CASCADE,
    object_id UUID REFERENCES ops_objects(id) ON DELETE SET NULL,
    post_id UUID REFERENCES ops_object_posts(id) ON DELETE SET NULL,
    employee_id UUID,
    incident_type_code VARCHAR(100) NOT NULL,
    happened_at TIMESTAMPTZ NOT NULL,
    reported_by VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    measures_taken TEXT,
    reported_to TEXT,
    final_decision TEXT,
    status_code VARCHAR(50) DEFAULT 'OPEN' NOT NULL CHECK (status_code IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED','CANCELLED')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

Allowed `incident_type_code`:

```text
ACCESS_VIOLATION
SUSPICIOUS_PERSON
TECHNICAL_FAILURE
ROUTE_CHANGE
DISCIPLINE_ISSUE
MEDICAL_ISSUE
TRANSPORT_ISSUE
COMMUNICATION_ISSUE
OBJECT_SECURITY_ISSUE
OTHER
```

**BR-INCIDENT-001.** Инцидент сохраняется в истории ОМ.

**BR-INCIDENT-002.** Если инцидент связан с объектом, он отображается в паспорте объекта как исторический риск.

**BR-INCIDENT-003.** Если инцидент связан с сотрудником, он отображается в карточке сотрудника по правам доступа.

**BR-INCIDENT-004.** Закрытие ОМ требует либо зарегистрированные инциденты с итоговым решением, либо отметку `NO_INCIDENTS`.

## 17.14. Event closure and archive

### DB-OPS-030. `ops_event_closure_reports`

```sql
CREATE TABLE ops_event_closure_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL UNIQUE REFERENCES ops_events(id) ON DELETE CASCADE,
    actual_assignment_summary TEXT,
    replacements_summary TEXT,
    incidents_summary TEXT,
    remarks TEXT,
    conclusions TEXT,
    proposals TEXT,
    passport_updated BOOLEAN DEFAULT FALSE NOT NULL,
    no_incidents BOOLEAN DEFAULT FALSE NOT NULL,
    closed_by VARCHAR(100),
    closed_at TIMESTAMPTZ,
    status_code VARCHAR(50) DEFAULT 'DRAFT' NOT NULL CHECK (status_code IN ('DRAFT','SUBMITTED','APPROVED','RETURNED')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### DB-OPS-031. `ops_event_archive_snapshots`

```sql
CREATE TABLE ops_event_archive_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES ops_events(id) ON DELETE CASCADE,
    snapshot_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by VARCHAR(100) NOT NULL
);
```

Allowed `snapshot_type`:

```text
OBJECT_PASSPORT
ASSIGNMENT_APPROVED
ASSIGNMENT_FINAL
INCIDENTS
CLOSURE_REPORT
DOCUMENTS_INDEX
RATINGS_SUMMARY
LOAD_SUMMARY
```

**BR-CLOSURE-001.** ОМ не переходит в `CLOSED`, пока closure report не заполнен по обязательным блокам.

**BR-CLOSURE-002.** При закрытии создаются archive snapshots: паспорт объекта, итоговая расстановка, инциденты, документы, нагрузка и оценки.

**BR-CLOSURE-003.** Архив нельзя изменить напрямую; исправления только через новую запись/дополнение с audit.

## 17.15. Status calendar and status history

### DB-OPS-032. `ops_employee_status_history`

```sql
CREATE TABLE ops_employee_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_id UUID NOT NULL REFERENCES ops_employee_statuses(id) ON DELETE CASCADE,
    action_code VARCHAR(50) NOT NULL CHECK (action_code IN ('CREATED','APPLIED','EXTENDED','TERMINATED','COMPLETED','CANCELLED','MODIFIED')),
    old_value JSONB,
    new_value JSONB,
    actor_user_id VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

**BR-STATUS-HISTORY-001.** Изменения статуса пишутся как отдельная история, кроме общего audit.

**BR-STATUS-CALENDAR-001.** Календарь сотрудника строится из `ops_employee_statuses`, approved assignments, duty projections and replacements.

**BR-STATUS-CALENDAR-002.** Календарь подразделения показывает сотрудников, статусы, конфликты периодов и плановые статусы.

## 17.16. Attached/detached process

### DB-OPS-033. `ops_employee_detachments`

```sql
CREATE TABLE ops_employee_detachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    from_division_id UUID NOT NULL,
    to_division_id UUID NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    status_code VARCHAR(50) DEFAULT 'ACTIVE' NOT NULL CHECK (status_code IN ('PLANNED','ACTIVE','RETURN_REQUESTED','COMPLETED','CANCELLED')),
    reason TEXT,
    basis_document_id UUID,
    initiated_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_detachment_dates CHECK (ends_at IS NULL OR starts_at < ends_at)
);
```

### DB-OPS-034. `ops_employee_return_requests`

```sql
CREATE TABLE ops_employee_return_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    detachment_id UUID NOT NULL REFERENCES ops_employee_detachments(id) ON DELETE CASCADE,
    requested_by VARCHAR(100) NOT NULL,
    requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status_code VARCHAR(50) DEFAULT 'PENDING' NOT NULL CHECK (status_code IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
    decided_by VARCHAR(100),
    decided_at TIMESTAMPTZ,
    decision_comment TEXT,
    expected_return_at TIMESTAMPTZ
);
```

**BR-DETACH-001.** В штатном подразделении сотрудник отображается как `DETACHED`, остаётся в списке, но не считается `IN_SERVICE`.

**BR-DETACH-002.** В принимающем подразделении сотрудник отображается как `ATTACHED +N`, не входит в штатную численность принимающего.

**BR-DETACH-003.** При подтверждении возврата завершаются связанные статусы `DETACHED`/`ATTACHED`, создаётся новый фактический статус по правилу deployment.

**BR-DETACH-004.** Прикомандированный сотрудник не редактирует статусы ни своего, ни принимающего управления, если ему отдельно не назначена роль.

## 17.17. Load facts and post overload

### DB-OPS-035. `ops_assignment_actuals`

```sql
CREATE TABLE ops_assignment_actuals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL UNIQUE REFERENCES ops_assignments(id) ON DELETE CASCADE,
    actual_started_at TIMESTAMPTZ,
    actual_ended_at TIMESTAMPTZ,
    actual_minutes INT CHECK (actual_minutes >= 0),
    night_minutes INT DEFAULT 0 NOT NULL CHECK (night_minutes >= 0),
    exceeded_post_limit BOOLEAN DEFAULT FALSE NOT NULL,
    employee_feedback TEXT,
    confirmed_by VARCHAR(100),
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

**BR-LOAD-001.** Плановая перегрузка считается по assignments/duties.

**BR-LOAD-002.** Фактическая перегрузка по посту считается после закрытия/опроса, если `actual_minutes > ops_object_posts.max_continuous_minutes`.

**BR-LOAD-003.** В dashboard нагрузки выводить: часы за период, ночные часы, дни подряд >8ч, превышения постового лимита, количество ОМ/дежурств.

## 17.18. Ratings / evaluations

### DB-OPS-036. `ops_event_evaluations`

```sql
CREATE TABLE ops_event_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES ops_events(id) ON DELETE CASCADE,
    assignment_id UUID REFERENCES ops_assignments(id) ON DELETE SET NULL,
    evaluator_user_id VARCHAR(100) NOT NULL,
    evaluator_employee_id UUID,
    evaluated_employee_id UUID,
    evaluated_group_id UUID REFERENCES ops_groups(id) ON DELETE SET NULL,
    evaluation_direction VARCHAR(50) NOT NULL CHECK (evaluation_direction IN ('SENIOR_TO_EMPLOYEE','SENIOR_TO_GROUP','EMPLOYEE_TO_SENIOR')),
    score NUMERIC(3,1) DEFAULT 8.0 NOT NULL CHECK (score >= 1 AND score <= 10),
    comment TEXT,
    is_visible_to_evaluated BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_evaluation_target CHECK (
        evaluated_employee_id IS NOT NULL OR evaluated_group_id IS NOT NULL
    )
);
```

### DB-OPS-037. `ops_employee_service_hours`

```sql
CREATE TABLE ops_employee_service_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    event_id UUID REFERENCES ops_events(id) ON DELETE SET NULL,
    object_id UUID REFERENCES ops_objects(id) ON DELETE SET NULL,
    post_id UUID REFERENCES ops_object_posts(id) ON DELETE SET NULL,
    service_date DATE NOT NULL,
    total_hours NUMERIC(5,2) NOT NULL CHECK (total_hours >= 0),
    night_hours NUMERIC(5,2) DEFAULT 0 NOT NULL CHECK (night_hours >= 0),
    complexity_code VARCHAR(50),
    remarks TEXT,
    score NUMERIC(3,1),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

**BR-RATING-001.** Default score = 8.0. Если замечаний нет, оценку можно не менять.

**BR-RATING-002.** Score < 8.0 требует обязательный comment 10–1000 символов.

**BR-RATING-003.** Оцениваемый не видит персональную оценку; он видит только агрегированный итоговый рейтинг, если роль позволяет.

**BR-RATING-004.** Старший не видит оценки, которые ему поставили подчинённые, если deployment не включает режим раскрытия.

**BR-RATING-005.** Рейтинг не должен автоматически блокировать назначение; он создаёт warning `POST_REQUIREMENT_MISMATCH_CONFLICT` при `post.min_rating`.

## 17.19. Dashboards and recommendations

### DB-ANALYTICS-002. `analytics_event_readiness`

```sql
CREATE TABLE analytics_event_readiness (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL UNIQUE,
    checklist_done BOOLEAN DEFAULT FALSE NOT NULL,
    requirements_approved BOOLEAN DEFAULT FALSE NOT NULL,
    requests_closed BOOLEAN DEFAULT FALSE NOT NULL,
    assignments_approved BOOLEAN DEFAULT FALSE NOT NULL,
    acknowledgements_done BOOLEAN DEFAULT FALSE NOT NULL,
    conflicts_unresolved_count INT DEFAULT 0 NOT NULL,
    readiness_percent NUMERIC(5,2) DEFAULT 0 NOT NULL,
    calculated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### DB-ANALYTICS-003. `analytics_recommendations`

```sql
CREATE TABLE analytics_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    severity VARCHAR(50) DEFAULT 'INFO' NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at TIMESTAMPTZ
);
```

Dashboard types:

```text
EVENT_READINESS
EMPLOYEE_LOAD
DAILY_PERSONNEL_EXPENSE
OBJECT_RISK_HISTORY
ASSIGNMENT_CONFLICTS
UNUPDATED_DIVISIONS
RATING_SUMMARY
```

**BR-DASH-001.** Dashboard готовности ОМ показывает: чек-лист, потребность, закрытие запросов, ознакомление, утверждение, конфликты.

**BR-DASH-002.** Dashboard нагрузки показывает перегрузку сотрудников и подразделений за период.

**BR-DASH-003.** Dashboard общего расхода показывает daily report по всей организации/scope.

**BR-RECO-001.** Рекомендации руководству не принимают решения автоматически. Они показывают риски и варианты: усилить объект, разгрузить сотрудника, запросить людей, обновить паспорт, закрыть ознакомления, устранить конфликты.

## 17.20. Temporary duty permissions / OMD / ORGD

### DB-OPS-038. `ops_temporary_duty_permissions`

```sql
CREATE TABLE ops_temporary_duty_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(100) NOT NULL,
    employee_id UUID,
    duty_role_code VARCHAR(50) NOT NULL CHECK (duty_role_code IN ('OMD','ORGD','HQ_DUTY','OBJECT_SENIOR_DUTY')),
    scope_division_id UUID,
    event_id UUID REFERENCES ops_events(id) ON DELETE CASCADE,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_temp_duty_perm_dates CHECK (starts_at < ends_at)
);
```

**BR-TEMP-PERM-001.** Дежурный — это временное полномочие на личную учётку, а не отдельный общий логин.

**BR-TEMP-PERM-002.** Права включаются только на период `starts_at..ends_at`.

**BR-TEMP-PERM-003.** Все действия дежурного в audit пишутся на его личный `user_id` + активный duty_role_code.

## 17.21. Import/export jobs

### DB-INTEGRATION-001. `integration_jobs`

```sql
CREATE TABLE integration_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type VARCHAR(100) NOT NULL,
    source_code VARCHAR(100) NOT NULL,
    status_code VARCHAR(50) DEFAULT 'QUEUED' NOT NULL CHECK (status_code IN ('QUEUED','RUNNING','SUCCESS','FAILED','CANCELLED')),
    input_file_path TEXT,
    output_file_path TEXT,
    total_rows INT DEFAULT 0 NOT NULL,
    processed_rows INT DEFAULT 0 NOT NULL,
    failed_rows INT DEFAULT 0 NOT NULL,
    error_summary TEXT,
    created_by VARCHAR(100),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

Allowed `job_type`:

```text
KU_SYNC_EMPLOYEES
IMPORT_POSITIONS
IMPORT_RANKS
IMPORT_EMPLOYEES
EXPORT_EMPLOYEES
EXPORT_STATUS_HISTORY
EXPORT_AUDIT_LOGS
EXPORT_ASSIGNMENT
EXPORT_DAILY_REPORT
```

**BR-IMPORT-001.** Import должен быть идемпотентным по external_id/iin/code.

**BR-IMPORT-002.** Ошибки строк не должны ломать весь импорт, если режим `partial_allowed=true`; для strict mode весь импорт откатывается.

**BR-EXPORT-001.** Экспорт чувствительных данных проверяет scope и пишет audit.

## 17.22. Protected persons, logistics, accreditation and Face ID

Эти блоки не должны ломать MVP-core, но требования должны быть зафиксированы, чтобы архитектура не закрыла путь к ним.

### DB-OPS-039. `ops_protected_persons`

```sql
CREATE TABLE ops_protected_persons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(255) NOT NULL,
    position_title VARCHAR(255),
    organization VARCHAR(255),
    category_code VARCHAR(50),
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### DB-OPS-040. `ops_event_protected_persons`

```sql
CREATE TABLE ops_event_protected_persons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES ops_events(id) ON DELETE CASCADE,
    protected_person_id UUID NOT NULL REFERENCES ops_protected_persons(id) ON DELETE RESTRICT,
    visit_program TEXT,
    arrival_at TIMESTAMPTZ,
    departure_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_event_protected_person UNIQUE(event_id, protected_person_id)
);
```

### DB-OPS-041. `ops_event_logistics`

```sql
CREATE TABLE ops_event_logistics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES ops_events(id) ON DELETE CASCADE,
    logistics_type VARCHAR(50) NOT NULL CHECK (logistics_type IN ('TRANSPORT','ACCOMMODATION','ROUTE','PARKING','MEETING_POINT','OTHER')),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    responsible_user_id VARCHAR(100),
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    status_code VARCHAR(50) DEFAULT 'PLANNED' NOT NULL CHECK (status_code IN ('PLANNED','CONFIRMED','CANCELLED','COMPLETED')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

### DB-OPS-042. `ops_accreditation_checks`

```sql
CREATE TABLE ops_accreditation_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES ops_events(id) ON DELETE CASCADE,
    person_full_name VARCHAR(255) NOT NULL,
    iin VARCHAR(12),
    document_number VARCHAR(100),
    check_type VARCHAR(50) NOT NULL CHECK (check_type IN ('ACCREDITATION','FACE_ID','IIN','BLACKLIST','OTHER')),
    status_code VARCHAR(50) DEFAULT 'PENDING' NOT NULL CHECK (status_code IN ('PENDING','PASSED','FAILED','REQUIRES_REVIEW','CANCELLED')),
    result_payload JSONB DEFAULT '{}'::jsonb NOT NULL,
    checked_at TIMESTAMPTZ,
    checked_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

**BR-FUTURE-001.** ОЛ, логистика, аккредитация и Face ID входят в full-product scope, но могут быть реализованы после MVP-core.

**BR-FUTURE-002.** В MVP запрещено создавать реальные внешние проверки Face ID/аккредитации без утверждённого источника данных и политики безопасности.

---

# 18. Дополнительные REST API v7.6

## API-CORE-002. Positions / ranks / staffing / vacancies

- `GET|POST|PATCH /api/core/positions` — справочник должностей.
- `GET|POST|PATCH /api/core/ranks` — справочник званий.
- `GET|POST|PATCH /api/core/staffing-slots` — штатные ставки.
- `POST /api/core/staffing-slots/{id}/assign-employee` — назначить сотрудника на ставку.
- `POST /api/core/staffing-slots/{id}/release` — освободить ставку.
- `GET /api/core/vacancies?division_id&date` — вакансии на дату.

## API-DOC-002. Attachments

- `POST /api/documents/attachments` — загрузить файл к entity.
- `GET /api/documents/attachments?entity_type&entity_id&kind` — список вложений.
- `GET /api/documents/attachments/{id}/download` — скачать файл с audit.
- `DELETE /api/documents/attachments/{id}` — soft delete.

## API-OPS-017. Object passports

- `GET /api/operations/objects/{object_id}/passport`.
- `POST /api/operations/objects/{object_id}/passport`.
- `PATCH /api/operations/objects/{object_id}/passport`.
- `GET /api/operations/objects/{object_id}/passport/history`.
- `POST /api/operations/objects/{object_id}/passport/verify`.

Response example:

```json
{
  "object_id": "uuid",
  "completeness_status": "YELLOW",
  "missing_required_fields": ["access_routes", "cameras"],
  "last_verified_at": "2026-06-02T10:00:00+05:00"
}
```

## API-OPS-018. Checklist / reconnaissance

- `GET|POST|PATCH /api/operations/checklist-templates`.
- `GET|POST|PATCH /api/operations/checklist-templates/{id}/items`.
- `POST /api/operations/events/{event_id}/reconnaissance/start`.
- `PATCH /api/operations/events/{event_id}/reconnaissance/items/{item_id}`.
- `POST /api/operations/events/{event_id}/reconnaissance/complete`.

Errors:

| HTTP | error_code |
|---:|---|
| 409 | RECONNAISSANCE_REQUIRED |
| 409 | CHECKLIST_ISSUES_UNRESOLVED |
| 422 | INVALID_RECONNAISSANCE_DECISION |

## API-OPS-019. Event bulletin and lifecycle

- `POST /api/operations/events/{event_id}/bulletin`.
- `GET /api/operations/events/{event_id}/bulletin`.
- `POST /api/operations/events/{event_id}/transition`.
- `GET /api/operations/events/{event_id}/timeline`.

## API-OPS-020. Need calculations

- `POST /api/operations/events/{event_id}/need-calculations`.
- `GET /api/operations/events/{event_id}/need-calculations`.
- `POST /api/operations/need-calculations/{id}/submit`.
- `POST /api/operations/need-calculations/{id}/approve`.
- `POST /api/operations/need-calculations/{id}/return`.
- `POST /api/operations/events/{event_id}/resource-requests/from-approved-need`.

## API-OPS-021. Acknowledgements

- `GET /api/operations/assignment-versions/{version_id}/acknowledgements`.
- `POST /api/operations/assignments/{assignment_id}/acknowledge`.
- `POST /api/operations/assignments/{assignment_id}/decline-acknowledgement`.
- `POST /api/operations/assignment-versions/{version_id}/notify-unacknowledged`.

## API-OPS-022. Replacement and cascade suggestions

- `GET /api/operations/assignments/{assignment_id}/replacement-suggestions`.
- `POST /api/operations/assignments/{assignment_id}/replace`.
- `POST /api/operations/events/{event_id}/cascade-replacement-suggestions`.

Replacement request:

```json
{
  "new_employee_id": "uuid",
  "reason": "Сотрудник выбыл по состоянию здоровья.",
  "sanctioned_by": "user-id",
  "basis_document_id": "optional-uuid",
  "override_reason": "optional if soft conflicts exist"
}
```

## API-OPS-023. Conduct / HQ journal / incidents

- `GET /api/operations/events/{event_id}/conduct-dashboard`.
- `POST /api/operations/events/{event_id}/hq-journal`.
- `GET /api/operations/events/{event_id}/hq-journal`.
- `POST /api/operations/events/{event_id}/incidents`.
- `GET /api/operations/events/{event_id}/incidents`.
- `PATCH /api/operations/incidents/{id}`.
- `POST /api/operations/incidents/{id}/close`.

## API-OPS-024. Event closure / archive

- `POST /api/operations/events/{event_id}/closure-report`.
- `PATCH /api/operations/events/{event_id}/closure-report`.
- `POST /api/operations/events/{event_id}/closure-report/submit`.
- `POST /api/operations/events/{event_id}/close`.
- `GET /api/operations/events/{event_id}/archive`.

## API-OPS-025. Status calendar

- `GET /api/operations/employees/{employee_id}/status-calendar?date_from&date_to`.
- `GET /api/operations/divisions/{division_id}/status-calendar?date_from&date_to`.
- `GET /api/operations/status-conflicts?employee_id&date_from&date_to`.

## API-OPS-026. Detachment / attachment

- `POST /api/operations/detachments`.
- `GET /api/operations/detachments?employee_id&division_id&status_code`.
- `POST /api/operations/detachments/{id}/request-return`.
- `POST /api/operations/return-requests/{id}/approve`.
- `POST /api/operations/return-requests/{id}/reject`.

## API-OPS-027. Actuals / load / ratings

- `POST /api/operations/assignments/{assignment_id}/actuals`.
- `GET /api/operations/employees/{employee_id}/load?date_from&date_to`.
- `GET /api/operations/divisions/{division_id}/load?date_from&date_to`.
- `POST /api/operations/events/{event_id}/evaluations/bulk-default`.
- `POST /api/operations/events/{event_id}/evaluations`.
- `GET /api/operations/employees/{employee_id}/rating-summary`.

## API-ANALYTICS-001. Dashboards and recommendations

- `GET /api/analytics/events/{event_id}/readiness`.
- `GET /api/analytics/load?division_id&date_from&date_to`.
- `GET /api/analytics/daily-personnel-expense?report_date&division_id`.
- `GET /api/analytics/recommendations?entity_type&entity_id&severity`.
- `POST /api/analytics/recommendations/{id}/resolve`.

## API-OPS-028. Temporary duty permissions

- `POST /api/operations/temporary-duty-permissions`.
- `GET /api/operations/temporary-duty-permissions?user_id&active_at`.
- `POST /api/operations/temporary-duty-permissions/{id}/deactivate`.

## API-INTEGRATION-001. Import/export jobs

- `POST /api/integration/jobs/import-positions`.
- `POST /api/integration/jobs/import-ranks`.
- `POST /api/integration/jobs/import-employees`.
- `POST /api/integration/jobs/export-employees`.
- `POST /api/integration/jobs/export-status-history`.
- `GET /api/integration/jobs/{id}`.
- `GET /api/integration/jobs/{id}/download`.

---

# 19. Дополнительный TASK Layer v7.6 for Google Jules

## TASK-021. Core positions/ranks/staffing/vacancies

Implement `core_positions`, `core_ranks`, `core_staffing_slots`, `core_employee_staffing_assignments`, `core_vacancies`.

**AC:** vacancy count comes from unoccupied active staffing slots on date; employee reassignment preserves history.

## TASK-022. Documents attachments and status basis documents

Implement `documents_attachments` and attach files to employee statuses, events, objects and incidents.

**AC:** status can have multiple basis documents; download writes audit; delete is soft.

## TASK-023. Object passport

Implement `ops_object_passports`, history, completeness status, verify endpoint.

**AC:** object without required passport fields is RED; patch writes history and audit; event readiness sees passport status.

## TASK-024. Post extension and print privacy

Extend `ops_object_posts` with tasks/features/max continuous minutes/min rating/equipment flags.

**AC:** assignment notification includes tasks/features; printed assignment excludes rating/anthropometry/sensitive comments.

## TASK-025. Checklist template and reconnaissance

Implement checklist templates, reconnaissance session, answers and completion decision.

**AC:** required ISSUE blocks READY unless resolved or override; decision `CHANGE_POSTS_SECTORS` can create proposed post/sector changes.

## TASK-026. Event bulletin and full lifecycle

Implement event bulletin and extended status transition guards.

**AC:** DRAFT → BULLETIN_CREATED only after bulletin; READY requires approved assignment and required acknowledgements; CLOSED requires closure report.

## TASK-027. Need calculations and distributed approval

Implement `ops_event_need_calculations` and approve/return workflow.

**AC:** approved need can generate resource requests; returned need cannot generate requests.

## TASK-028. Assignment acknowledgements

Implement participant acknowledgement workflow.

**AC:** approved version creates PENDING acknowledgements; employee ACK updates timestamp; senior sees unacknowledged list.

## TASK-029. Replacement command after approval

Implement sanctioned replacement with conflict check and history.

**AC:** approved assignment can be replaced only with reason and sanctioned_by; old/new visible in event timeline.

## TASK-030. Cascade replacement suggestions

Implement staffing-chain replacement suggestions.

**AC:** suggestions are ordered by staffing chain; unavailable employees show conflict reasons; no auto-commit without human confirmation.

## TASK-031. Conduct dashboard and HQ journal

Implement conduct dashboard and immutable HQ journal.

**AC:** event IN_PROGRESS dashboard shows active posts, seniors, assignments, incidents and journal; journal correction is additive.

## TASK-032. Incidents

Implement incident cards, attachments, status workflow and links to event/object/employee.

**AC:** incident appears in event history; linked object passport risk history includes incident; close requires final decision.

## TASK-033. Event closure and archive snapshots

Implement closure report and archive snapshots.

**AC:** cannot close without required sections or no-incident mark; closing creates snapshots; archive is read-only.

## TASK-034. Status history and calendar

Implement status history and employee/division calendars.

**AC:** extend/terminate/cancel creates status history; calendar includes statuses, duty, assignments and replacements.

## TASK-035. Detachment/attachment workflow

Implement detachment, return request and attached/detached report rules.

**AC:** attached shown as +N; return approval completes detachment statuses; attached employee cannot edit statuses by default.

## TASK-036. Assignment actuals and post overload

Implement actual service time and post limit overload rule.

**AC:** actual > max_continuous_minutes creates overload marker and analytics recommendation.

## TASK-037. Operational ratings and service hours

Implement evaluations, default score, private visibility and service hours.

**AC:** default 8; score <8 without comment rejected; evaluated sees only aggregate rating.

## TASK-038. Dashboards and recommendations

Implement event readiness, load dashboard, daily expense dashboard and recommendations.

**AC:** readiness percent changes when checklist/need/requests/assignments/acks complete; recommendations are advisory only.

## TASK-039. Temporary duty permissions

Implement OMD/ORGD temporary permission assignment.

**AC:** role active only in time window; audit stores personal user_id and active duty role.

## TASK-040. Import/export jobs

Implement import/export job framework and initial CSV/XLSX import/export commands.

**AC:** import is idempotent; strict mode rolls back on row error; export writes audit and downloadable file.

## TASK-041. Protected persons, logistics, accreditation stubs

Implement minimal tables and admin/API stubs for protected persons, logistics and accreditation checks without external integrations.

**AC:** event can reference protected person and logistics item; accreditation check can be manually set PASSED/FAILED; no external calls in MVP.

---

# 20. Дополнительные Acceptance Criteria v7.6

| ID | Модуль | Критерий |
|---|---|---|
| AC-039 | Object | У активного объекта есть паспорт |
| AC-040 | Object | Паспорт RED при незаполненных обязательных полях |
| AC-041 | Object | Изменение паспорта пишет history и audit |
| AC-042 | Object | Пост хранит задачи, особенности, max service time, min rating |
| AC-043 | Checklist | Типовой чек-лист можно применить к ОМ |
| AC-044 | Reconnaissance | ISSUE в обязательном пункте блокирует READY без override |
| AC-045 | Event | ОМ проходит канонический поток: bulletin → recon → need → requests → assignment → ack → approve → conduct → close |
| AC-046 | Bulletin | Создание бюллетеня переводит event в BULLETIN_CREATED |
| AC-047 | Need | Только approved need создаёт resource requests |
| AC-048 | Acknowledgement | Approved assignment version создаёт PENDING acknowledgements |
| AC-049 | Acknowledgement | Senior видит список неознакомившихся |
| AC-050 | Replacement | Замена после утверждения требует reason и sanctioned_by |
| AC-051 | Replacement | Замена после утверждения пишет old/new в timeline |
| AC-052 | Cascade | Система предлагает замены по штатной цепочке, но не назначает сама |
| AC-053 | HQ Journal | Записи штаба immutable через обычный UI |
| AC-054 | Incident | Инцидент связан с event/object/post/employee по необходимости |
| AC-055 | Incident | Закрытие инцидента требует final_decision |
| AC-056 | Closure | ОМ нельзя закрыть без closure report |
| AC-057 | Archive | При закрытии создаются snapshots паспорта, расстановки, инцидентов и документов |
| AC-058 | Status | Extend/terminate/cancel пишут `ops_employee_status_history` |
| AC-059 | Calendar | Календарь сотрудника показывает статусы, duty, assignments, replacements |
| AC-060 | Detachment | ATTACHED выводится +N и не входит в штат принимающего подразделения |
| AC-061 | Detachment | Return request approve завершает detachment |
| AC-062 | Load | Actual time > post limit создаёт overload marker |
| AC-063 | Rating | Default score = 8 |
| AC-064 | Rating | Score <8 без comment возвращает 400 VALIDATION_ERROR |
| AC-065 | Rating | Сотрудник видит только aggregate rating, не персональную оценку |
| AC-066 | Dashboard | Readiness dashboard показывает чек-лист, потребность, запросы, расстановку, ознакомления |
| AC-067 | Recommendations | Рекомендации не выполняют действия автоматически |
| AC-068 | Temp Permission | Дежурный получает права только на интервал назначения |
| AC-069 | Auth | VAPS не хранит user password/hash |
| AC-070 | Import | Import job idempotent по external_id/iin/code |
| AC-071 | Export | Export sensitive data writes audit |
| AC-072 | Protected Person | Event can link protected person |
| AC-073 | Logistics | Event can store transport/route/accommodation logistics items |
| AC-074 | Accreditation | MVP supports manual accreditation check without external Face ID call |
| AC-075 | Print | Printed assignment excludes photos, ratings, anthropometry and sensitive comments |
| AC-076 | Daily Report | DOCX period export creates separate page per date |
| AC-077 | Daily Report | Tomorrow report blocked until required divisions update marks |
| AC-078 | Closed Contour | MVP has only in-app notifications; no SMS/email/cloud dependency |

---

# 21. Дополнительные Regression Tests v7.6

## TEST-010. Object passport completeness

1. Create object.
2. Create passport without required fields.
3. Check readiness.

Expected:

- passport `completeness_status=RED`;
- readiness contains warning;
- READY blocked without override.

## TEST-011. Reconnaissance checklist issue

1. Create event.
2. Start reconnaissance.
3. Mark required checklist item as ISSUE.
4. Try transition to READY.

Expected: `409 CHECKLIST_ISSUES_UNRESOLVED`.

## TEST-012. Approved need creates requests

1. Create need calculation DRAFT.
2. Submit and approve.
3. Generate resource requests.

Expected: requests match approved counts; returned/unapproved need cannot generate requests.

## TEST-013. Acknowledgement flow

1. Approve assignment version with 3 assignments.
2. Read acknowledgements.
3. Employee 1 acknowledges.

Expected: 3 PENDING created; one becomes ACKNOWLEDGED; senior sees 2 unacknowledged.

## TEST-014. Replacement after approval

1. Approve version.
2. Replace employee with reason and sanctioned_by.

Expected: replacement record exists; conflict detector runs; event timeline shows old/new.

## TEST-015. Cascade replacement suggestions

1. Create staffing chain: начальник → заместитель → и.о.
2. Mark начальник unavailable.
3. Request suggestions.

Expected: заместитель first; unavailable candidates show conflict reasons; no assignment created.

## TEST-016. HQ journal immutability

1. Create journal entry.
2. Try to update it directly.

Expected: update rejected or creates correction entry; original remains.

## TEST-017. Incident closure blocks event closure

1. Create event incident OPEN.
2. Try close event.

Expected: event close rejected until incident has final decision or no_incidents is set when no incidents exist.

## TEST-018. Event archive snapshots

1. Close event.

Expected: snapshots created for object passport, final assignment, incidents, closure report and documents index.

## TEST-019. Status calendar

1. Create status, duty shift, approved assignment and replacement.
2. Query employee calendar.

Expected: all intervals appear in chronological order with source types.

## TEST-020. Detachment return

1. Create detachment.
2. Request return.
3. Approve return.

Expected: detachment completed; ATTACHED/DETACHED statuses completed; audit exists.

## TEST-021. Post overload actuals

1. Post max continuous minutes = 120.
2. Assignment actual minutes = 180.

Expected: exceeded_post_limit=true and recommendation created.

## TEST-022. Rating privacy

1. Senior rates employee 6 without comment.
2. Senior rates employee 6 with comment.
3. Employee views rating.

Expected: first fails; second succeeds; employee sees aggregate only.

## TEST-023. Temporary duty permission expiry

1. Create OMD permission 08:00–20:00.
2. Check permission at 10:00 and 21:00.

Expected: allowed at 10:00; denied at 21:00.

## TEST-024. Import idempotency

1. Import same employee file twice.

Expected: no duplicate employees; changed fields update history.

## TEST-025. Export audit

1. Export employee list.

Expected: integration job SUCCESS; file path exists; audit log created.

## TEST-026. Printed assignment privacy

1. Assignment has employee photo, rating, anthropometry, sensitive comments.
2. Generate print form.

Expected: print form includes sector/post/FIO/division/senior/times/tasks; excludes photo/rating/anthropometry/sensitive comments.

---

# 22. Updated MVP Scope v7.6

## 22.1. MVP-core теперь включает

- Core organizations/divisions/employees.
- Positions/ranks/staffing slots/vacancies.
- Employee division and staffing history.
- Account↔employee binding.
- External Auth/JWT consumption without storing passwords.
- KU integration stub and import/export job framework.
- Operations roles/permissions and temporary duty permissions.
- Lookup tables for statuses/states/sources/post types/roles/event statuses.
- Employee statuses, status history and status calendar.
- Documents attachments and status basis documents.
- Objects, object passport, sectors, posts, post requirements.
- Checklist templates and reconnaissance.
- Duty plans, duty types and duty status projection.
- Event bulletin and full event lifecycle guards.
- Need calculations and approved need → resource requests.
- Brokerage requests/allocations.
- Assignment versions, individual assignments and group assignments.
- Conflict detector with soft warning + override; hard-block remains configurable by `is_hard_block`.
- Cascade replacement suggestions.
- Replacement after approval with sanctioned history.
- Assignment acknowledgements / ознакомление.
- HQ journal and conduct dashboard.
- Incidents.
- Event closure and archive snapshots.
- Daily update marks.
- Daily personnel reports with corrections and period DOCX export.
- Staffing/list/vacancy balance.
- Attached/detached +N handling and return request.
- Basic workload analytics + actual post overload marker.
- Event readiness dashboard.
- Daily personnel expense dashboard.
- In-app notifications only for MVP closed contour.
- Audit logs for every mutation and sensitive download/export.
- Document generation for daily report, assignment, event print forms.
- Regression test suite v7.5 + v7.6.

## 22.2. MVP-2 / next stage

- Operational ratings and service hours if timeline permits.
- Advanced load dashboard.
- Recommendations to leadership.
- Manual protected person and logistics modules.
- Manual accreditation check records without external Face ID.
- Offline tablet reader mode is not MVP-core.

## 22.3. Future scope remains

- Real ECP integration.
- Real Face ID integration.
- Full accreditation center integration.
- Full HR/KU realtime integration.
- SMS/email gateway outside closed contour.
- External government exchange bus.
- Full BI dashboards.
- Talent/OKR/skills/reserve as separate `talent` context.
- Offline tablet sync.

---

# 23. Updated JULES.md v7.6

```md
# VAPS Master Engineering Rules v7.6 Full Coverage

1. Develop VAPS strictly as Django 5.x + DRF Modular Monolith.
2. Physical microservices are forbidden in MVP.
3. Object is the central aggregate for duties and events.
4. Do not create cross-context ForeignKeys between core, operations, analytics, audit, documents, notifications, integration_* and talent contexts.
5. Use flat UUID/VARCHAR fields for cross-context references.
6. Read foreign context data only through selectors/services.
7. Do not import foreign context ORM models inside models.py.
8. VAPS must not store user passwords or password hashes. Identity comes from external Auth/JWT.
9. Every mutating operation in apps.operations must run inside transaction.atomic().
10. Every assignment mutation must call AssignmentLockService before ConflictDetectorService.
11. Lock assignment version, employee, overlapping statuses, assignments and duty shifts.
12. Group assignment locks employees by employee_id.hex ASC.
13. Conflicts are soft warning + override by default where PR requires it.
14. Hard-block statuses remain data-driven through ops_status_types.is_hard_block for deployment configuration.
15. override_reason must be 10-500 characters.
16. Frozen assignment versions are enforced by PostgreSQL trigger.
17. Return endpoint sets status_code=RETURNED and marks conflicts resolved, not deleted.
18. Approve endpoint must verify current hash equals approval_payload_hash.
19. Hash generation must use UUID.hex, UTC isoformat, and null literal for nullable fields.
20. Daily report uses settings.VAPS_LOCAL_TIMEZONE, default Asia/Qyzylorda.
21. Do not read duty_shifts directly in daily projector; project duty to employee statuses first.
22. Use WITH RECURSIVE for division tree traversal.
23. Daily report must use historical employee division and historical staffing slots.
24. Deleting assignment with source_allocation_id must reset allocation status to PROPOSED.
25. Deleting assignment version must reset all linked allocations to PROPOSED.
26. Add DB trigger as safety-net for out-of-band version deletion.
27. ATTACHED and ATTACHED_PLUS are shown as +N and excluded from staff/list numerator.
28. RBAC/audit operate on user_id string only; never use core_employees.id as user_id.
29. Every active object must have a passport.
30. Object passport completeness must affect event readiness.
31. Checklist and reconnaissance are required before event readiness unless overridden by authorized user.
32. Approved need calculation is the only basis for generated resource requests.
33. Assignment acknowledgements must be created after approval.
34. Operational replacement after approval requires reason and sanctioned_by.
35. Cascade replacement suggests candidates; it never auto-assigns without human confirmation.
36. HQ journal entries are immutable through normal UI.
37. Event cannot close without closure report and required blocks.
38. Closing event creates archive snapshots.
39. Status changes write status history plus audit.
40. Documents and sensitive downloads write audit.
41. Ratings are private; evaluated employee sees aggregate only.
42. Score below 8 requires comment.
43. Temporary duty permissions are bound to personal user_id and time window.
44. In MVP closed contour use in-app notifications only; no email/SMS/cloud dependency.
45. Implement TASK list one by one. Do not merge unrelated tasks.
46. Do not use v8/v9/v10 full rewrites. This v7.6 document is the only baseline.
```

---

# 24. Updated Open Questions v7.6

| ID | Вопрос | Рекомендация |
|---|---|---|
| OQ-012 | Оставлять ли ОМД/ОРГД как отдельные роли? | Да, как temporary duty permissions на личную учётку, но не как общий логин |
| OQ-013 | ЭЦП обязательна в MVP? | Нет, оставить hash-ready architecture; ЭЦП future |
| OQ-014 | Face ID/аккредитация входит в MVP-core? | Нет, только ручной stub/status; реальные интеграции future |
| OQ-015 | Email/SMS нужны в закрытом контуре? | Нет, MVP только in-app |
| OQ-016 | Рейтинг входит в MVP-core? | Минимальный operational rating можно MVP-2; full talent future |
| OQ-017 | Предельное время поста зависит от погоды/сезона? | MVP: ручное поле max_continuous_minutes; коэффициенты future |
| OQ-018 | Прикомандирование ведёт VAPS или КУ? | MVP: VAPS process + source_code, чтобы не блокировать; при КУ sync внешний источник может переопределить |
| OQ-019 | Опрос по итогам ОМ обязателен? | MVP: actuals + ratings after closure; можно сделать optional deployment flag |
| OQ-020 | Логистика и ОЛ входят в первую поставку? | Минимальные таблицы/stub; полноценные процессы next stage |

---

# 25. Updated Final Implementation Order v7.6

1. Architecture skeleton, isolation tests, integration_auth stub.
2. Core schema: divisions, employees, positions, ranks, staffing slots, vacancies, histories.
3. Roles/permissions, temporary duty permissions, external JWT permission service.
4. Lookup tables and seed data.
5. Documents attachments and audit for downloads.
6. Statuses, status history, status calendar, daily marks.
7. Objects, passports, sectors, posts, post requirements.
8. Checklist templates and reconnaissance.
9. Duty types/plans/shifts and duty projection.
10. Event bulletin and extended lifecycle.
11. Need calculations and approved need → requests.
12. Brokerage requests/allocations.
13. Assignment locks and conflict detector.
14. Assignment APIs, group assignment.
15. Hash/freeze/submit/return/approve.
16. Assignment acknowledgements.
17. Cascade replacement suggestions and sanctioned replacement.
18. Brokerage reset and delete version safety-net.
19. Daily report projector and DOCX/XLSX/PDF generation.
20. Load analytics and assignment actuals.
21. Conduct dashboard and HQ journal.
22. Incidents.
23. Event closure and archive snapshots.
24. Dashboards and recommendations.
25. Ratings/service hours if approved for MVP-2.
26. Protected persons/logistics/accreditation stubs.
27. Import/export jobs.
28. Full regression tests v7.5 + v7.6.
29. Hardening: audit, permission boundaries, closed-contour deployment.
30. Documentation and JULES handoff.

---

# 26. Final Decision v7.6

Этот документ является итоговой рабочей спецификацией VAPS v7.6 Full Coverage для Google Jules.

Google Jules должен использовать только этот файл как baseline. Старые документы (`PersonnelStatus.md`, `VisitX.md`, `ПланРасстановка.docx`, `ТЗ VAPS.md`, brainstorming) не должны использоваться как отдельные конкурирующие требования, но их требования уже перенесены в этот master через delta v7.6.

Если при реализации обнаруживается конфликт между v7.5 и v7.6, применяется правило:

- для базового DDD/DB safety/assignment/daily report ядра — v7.5 сохраняется;
- для паспорта объекта, чек-листа, рекогносцировки, проведения ОМ, инцидентов, закрытия, календаря, документов-оснований, дашбордов, рейтингов, временных полномочий и import/export — v7.6 дополняет и переопределяет scope.

Финальная формула системы:

```text
VAPS = Объекты + Паспорт + Дежурства + Статусы + Ежедневный расход + ОМ + Потребность + Брокеридж + Расстановка + Конфликты + Ознакомление + Проведение + Инциденты + Закрытие + Архив + Нагрузка + Аналитика + Аудит.
```

---

# 27. v7.7 Product-Ready Completion Delta

## 27.0. Назначение v7.7

Этот раздел закрывает пробелы v7.6, выявленные при strict audit review, и переводит master-документ из backend-heavy specification в полноценную product-development specification.

v7.7 не отменяет v7.6. v7.7 является обязательным product-layer delta patch поверх v7.6 и добавляет:

- точный MVP / MVP-2 / Future scope;
- frontend specification;
- UI routes, pages, states and role-based actions;
- bulk status update workflow;
- scheduled jobs / Celery Beat регламент;
- notification matrix;
- document templates specification;
- import/export file contracts;
- external Auth/JWT contract;
- frontend acceptance criteria;
- end-to-end test scenarios;
- implementation order for product delivery.

**V77-DECISION-001.** После v7.7 документ считается product-ready baseline для backend, frontend, QA, Google Jules, Claude Code и ручной разработки.

**V77-DECISION-002.** Если v7.6 и v7.7 противоречат по MVP scope, приоритет имеет v7.7.

**V77-DECISION-003.** Любая функция без UI-screen, API, permission rule, audit rule and test не считается готовой для MVP, даже если модель БД уже описана.

**V77-DECISION-004.** Product delivery делится на:

1. MVP-core — обязательная первая поставка.
2. MVP-2 — расширение после стабилизации MVP-core.
3. Future — архитектурно подготовлено, но не реализуется в первой поставке.

---

# 28. Final Product Scope v7.7

## 28.1. MVP-core: обязательно реализовать в первой поставке

MVP-core включает только то, что необходимо для рабочего закрытого контура VAPS:

1. External Auth/JWT consumption without storing passwords.
2. Core organizations/divisions/employees.
3. Positions, ranks, staffing slots, vacancies.
4. Employee division history and staffing history.
5. Roles, permissions, temporary duty permissions.
6. Employee statuses, status history, basis documents.
7. Bulk status update for division operators.
8. Status calendar for employee and division.
9. Daily update marks.
10. Daily personnel report for one date and period.
11. DOCX/XLSX/PDF generation for daily reports.
12. Objects, sectors, posts.
13. Object passport with completeness status.
14. Checklist templates and reconnaissance.
15. Duty plans, duty shifts, duty projection.
16. Event bulletin.
17. Event lifecycle from DRAFT to CLOSED.
18. Need calculations.
19. Resource requests and allocations.
20. Assignment versions.
21. Individual assignments.
22. Group assignments.
23. Conflict detector.
24. Submit/return/approve workflow.
25. Assignment acknowledgements.
26. Approved assignment replacement.
27. Cascade replacement suggestions.
28. Conduct dashboard.
29. HQ journal.
30. Incidents.
31. Event closure report.
32. Archive snapshots.
33. In-app notifications.
34. Audit logs.
35. Import/export job framework.
36. Import employees, positions, ranks, staffing slots.
37. Export employees, status history, daily report, assignment.
38. Readiness dashboard.
39. Load dashboard basic.
40. Frontend UI for all MVP-core modules.

## 28.2. MVP-2: реализовать после первой рабочей поставки

1. Operational ratings and service hours.
2. Advanced recommendations to leadership.
3. Manual protected persons module.
4. Manual logistics module.
5. Manual accreditation check records.
6. Advanced BI dashboard.
7. Full workload analytics.
8. Printable event archive package.
9. Offline-friendly read-only mode.

## 28.3. Future scope: не реализовать в MVP-core

1. Real ECP / ЭЦП integration.
2. Real Face ID integration.
3. Full accreditation center integration.
4. Full realtime KU/HR integration.
5. SMS/email gateway.
6. External government exchange bus.
7. Talent/OKR/skills/reserve context.
8. Offline tablet synchronization.
9. Mobile app.

## 28.4. MVP exclusion rule

Если функция отмечена как MVP-2/Future, она может иметь DB stub or admin stub, но не должна блокировать MVP-core delivery.

---

# 29. External Auth / JWT Contract

## 29.1. Auth principle

VAPS не хранит passwords, password hashes, password reset tokens or local user credentials.

Identity comes from external authentication service through JWT.

## 29.2. Required JWT claims

JWT payload must contain:

```json
{
  "sub": "external-user-id",
  "iin": "optional-12-digit-iin",
  "full_name": "Иванов Иван Иванович",
  "email": "optional@example.com",
  "phone": "+77000000000",
  "is_active": true,
  "auth_source": "EXTERNAL_AUTH",
  "issued_at": 1780000000,
  "expires_at": 1780003600
}
```

Required claims:

| Claim | Required | Type | Meaning |
|---|---:|---|---|
| `sub` | yes | string | External user ID. Used as `user_id` everywhere. |
| `full_name` | yes | string | Display name. |
| `is_active` | yes | boolean | If false, request denied. |
| `expires_at` | yes | unix timestamp | Token expiry. |

Optional claims:

| Claim | Type | Meaning |
|---|---|---|
| `iin` | string | Link to employee by IIN if binding absent. |
| `email` | string | For display only. |
| `phone` | string | For display only. |
| `auth_source` | string | Source system marker. |

## 29.3. Request headers

All protected API requests must include:

```http
Authorization: Bearer <jwt>
X-Request-ID: <uuid-or-client-generated-id>
```

Optional:

```http
X-Forwarded-For: <client-ip>
User-Agent: <browser-agent>
```

## 29.4. Middleware behavior

`integration_auth.middleware.ExternalJWTAuthenticationMiddleware` must:

1. Validate token signature.
2. Validate expiry.
3. Validate `is_active=true`.
4. Extract `sub` as `request.user_id`.
5. Extract display fields into `request.identity`.
6. Resolve employee binding through `core_user_employee_bindings`.
7. Never create local password credentials.
8. Return `401 AUTH_REQUIRED` if token missing.
9. Return `401 TOKEN_INVALID` if token invalid.
10. Return `403 USER_INACTIVE` if `is_active=false`.

## 29.5. Employee binding fallback

If `core_user_employee_bindings` has no row and JWT contains `iin`, system may suggest binding but must not silently bind without permission unless deployment flag `AUTO_BIND_BY_IIN=true`.

Default MVP setting:

```text
AUTO_BIND_BY_IIN=false
```

## 29.6. Auth acceptance criteria

| ID | Criterion |
|---|---|
| AUTH-AC-001 | API request without token returns 401 AUTH_REQUIRED. |
| AUTH-AC-002 | Expired token returns 401 TOKEN_INVALID. |
| AUTH-AC-003 | Inactive user returns 403 USER_INACTIVE. |
| AUTH-AC-004 | `sub` is used as `actor_user_id` in audit. |
| AUTH-AC-005 | VAPS DB has no password/hash columns. |
| AUTH-AC-006 | Employee UUID is never used as `user_id`. |

---

# 30. Frontend Product Specification

## 30.1. Frontend stack

Recommended MVP frontend:

```text
React + TypeScript + Vite + TanStack Query + React Router + Ant Design or shadcn/ui
```

Alternative allowed:

```text
Django templates + HTMX + Alpine.js
```

**V77-FE-DECISION-001.** If product speed is priority, React + TypeScript is preferred because VAPS has many dashboards, calendars, tables and role-based screens.

## 30.2. Frontend app structure

```text
frontend/
  src/
    app/
      router.tsx
      providers.tsx
      queryClient.ts
      auth.ts
    shared/
      api/
        httpClient.ts
        errors.ts
      ui/
      hooks/
      utils/
      types/
    entities/
      employee/
      division/
      status/
      object/
      event/
      assignment/
      notification/
      document/
    features/
      auth/
      employee-status-update/
      bulk-status-update/
      daily-report-generation/
      object-passport-edit/
      reconnaissance-flow/
      need-calculation-approval/
      assignment-create/
      assignment-approval/
      assignment-acknowledgement/
      replacement-flow/
      incident-management/
      event-closure/
      import-export/
    pages/
      DashboardPage.tsx
      DailyExpensePage.tsx
      EmployeesPage.tsx
      EmployeeCardPage.tsx
      DivisionsPage.tsx
      ObjectsPage.tsx
      ObjectCardPage.tsx
      EventsPage.tsx
      EventCardPage.tsx
      AssignmentVersionPage.tsx
      ConductDashboardPage.tsx
      ReportsPage.tsx
      AdminPage.tsx
      AuditPage.tsx
      NotificationsPage.tsx
```

## 30.3. Main routes

| Route | Page | MVP | Permissions |
|---|---|---:|---|
| `/login` | External login redirect / token handler | yes | public |
| `/` | Dashboard | yes | authenticated |
| `/daily-expense` | Daily personnel expense | yes | `daily_report.generate` or `status.view` |
| `/daily-expense/:date` | Daily report detail | yes | `daily_report.generate` or `status.view` |
| `/employees` | Employee list | yes | `status.view` |
| `/employees/:id` | Employee card | yes | `status.view` |
| `/divisions` | Division tree | yes | `status.view` |
| `/objects` | Object list | yes | `object.manage` or read-only |
| `/objects/:id` | Object card | yes | object read |
| `/objects/:id/passport` | Object passport | yes | `object.manage` |
| `/events` | Event list | yes | `event.manage` or assignment read |
| `/events/:id` | Event card | yes | event read |
| `/events/:id/reconnaissance` | Reconnaissance | yes | `event.manage` |
| `/events/:id/need` | Need calculations | yes | `event.manage` |
| `/events/:id/requests` | Resource requests | yes | `brokerage.manage` |
| `/assignment-versions/:id` | Assignment version | yes | assignment read/create |
| `/events/:id/conduct` | Conduct dashboard | yes | HQ/OMD/ORGD |
| `/events/:id/closure` | Closure report | yes | `event.manage` |
| `/reports` | Documents and generated reports | yes | report/document read |
| `/notifications` | Notifications | yes | authenticated |
| `/admin/roles` | Roles and permissions | yes | `admin.roles` |
| `/admin/import-export` | Import/export jobs | yes | admin/integration role |
| `/audit` | Audit log | yes | `audit.view` |

## 30.4. Global UI states

Every page must implement:

1. Loading state.
2. Empty state.
3. Error state.
4. Permission denied state.
5. Validation errors display.
6. Unsaved changes warning for forms.
7. Audit-sensitive confirmation modal for destructive actions.
8. Server conflict modal for `409 SOFT_CONFLICT_DETECTED`.
9. Hard-block modal for `422 HARD_UNAVAILABLE_STATUS`.
10. Locked version banner for `423 ASSIGNMENT_VERSION_LOCKED`.

## 30.5. Main dashboard

Dashboard shows:

- today date in `Asia/Qyzylorda`;
- unupdated divisions count;
- active events count;
- events requiring readiness action;
- pending acknowledgements;
- unresolved conflicts;
- open incidents;
- pending documents;
- latest notifications.

Required widgets:

| Widget | Source API | Action |
|---|---|---|
| Daily update status | `/api/analytics/daily-personnel-expense` | Open daily expense |
| Event readiness | `/api/analytics/events/{id}/readiness` | Open event |
| Open incidents | `/api/operations/events/{id}/incidents` | Open incidents |
| Pending acknowledgements | `/api/operations/assignment-versions/{id}/acknowledgements` | Notify / open |
| Recommendations | `/api/analytics/recommendations` | Resolve / open entity |

## 30.6. Employees page

Columns:

| Column | Required | Notes |
|---|---:|---|
| Full name | yes | clickable |
| IIN | yes | masked unless permission allows full view |
| Rank | yes | from `core_ranks` |
| Position | yes | from `core_positions` |
| Division | yes | current division |
| Current status | yes | calculated for today |
| Status period | yes | starts/ends |
| Phone | optional | role-based visibility |
| Attached/detached marker | yes | `ATTACHED`, `DETACHED`, `ATTACHED_PLUS` |
| Actions | yes | depends on role |

Filters:

- division;
- status;
- rank;
- position;
- active/inactive;
- attached/detached;
- text search by name/IIN.

Actions:

- open employee card;
- create status;
- bulk select;
- export selected;
- view calendar.

## 30.7. Employee card

Tabs:

1. Overview.
2. Status history.
3. Calendar.
4. Assignments.
5. Duties.
6. Documents.
7. Load.
8. Audit.

Overview fields:

- FIO;
- IIN masked by default;
- rank;
- position;
- division;
- staffing slot;
- current status;
- phone;
- active flag;
- attached/detached state.

Role-based sensitive fields:

- full IIN;
- phone;
- documents;
- incident history;
- rating aggregate.

## 30.8. Daily expense page

Main screen for division operators.

Required layout:

1. Date picker.
2. Division tree filter.
3. Update marks panel.
4. Employee status table.
5. Bulk status toolbar.
6. Report generation panel.
7. Missing marks list.
8. Export buttons: DOCX/XLSX/PDF.

Employee status table columns:

| Column | Notes |
|---|---|
| № | row number |
| Employee | FIO + rank |
| Position | current position |
| Current status | resolved status |
| Planned status | if future/planned exists |
| Period | starts_at - ends_at |
| Basis documents | count + link |
| Last updated by | user display |
| Actions | create/terminate/cancel status |

Bulk toolbar actions:

- set status;
- set period;
- attach basis documents;
- preview affected employees;
- apply;
- mark division as updated.

## 30.9. Objects page

Columns:

- object name;
- address;
- importance level;
- passport completeness;
- active posts count;
- last verified date;
- active events count;
- actions.

Object card tabs:

1. Passport.
2. Sectors and posts.
3. Checklist templates.
4. Reconnaissance history.
5. Events.
6. Incidents/risk history.
7. Documents.
8. Audit.

## 30.10. Event card

Tabs:

1. Overview.
2. Bulletin.
3. Reconnaissance.
4. Need calculations.
5. Resource requests.
6. Assignment versions.
7. Acknowledgements.
8. Conduct dashboard.
9. Incidents.
10. Closure.
11. Archive.
12. Documents.
13. Timeline.

Event header must show:

- title;
- status;
- date/time;
- object(s);
- senior;
- readiness percent;
- unresolved conflicts;
- pending acknowledgements;
- open incidents.

Allowed status transitions must be shown as buttons only if current user has permission and transition guard allows it.

## 30.11. Assignment version page

Required panels:

1. Version status banner.
2. Assignment table grouped by object/sector/post.
3. Conflict panel.
4. Resource allocation panel.
5. Add individual assignment form.
6. Add group assignment form.
7. Submit/return/approve actions.
8. Print/export actions.

Assignment table columns:

| Column | Notes |
|---|---|
| Object | object name |
| Sector | sector name |
| Post | post name |
| Employee | rank + FIO |
| Division | historical/current division |
| Role | assignment role |
| Start | local datetime |
| End | local datetime |
| Conflicts | badges |
| Acknowledgement | PENDING/ACK/DECLINED |
| Actions | edit/delete/replace where allowed |

## 30.12. Conduct dashboard page

For active event execution.

Must show:

- active objects;
- active posts;
- seniors;
- current assignments;
- replacements;
- protected person timeline if available;
- incidents;
- HQ journal;
- logistics stubs if enabled;
- accreditation stubs if enabled.

Allowed actions:

- add journal entry;
- create incident;
- register replacement;
- mark event started/completed;
- open closure report.

## 30.13. Admin import/export page

Tabs:

1. Import employees.
2. Import positions.
3. Import ranks.
4. Import staffing slots.
5. Export data.
6. Job history.

Each import must show:

- file upload;
- strict/partial mode switch;
- preview rows;
- validation result;
- start import;
- job progress;
- downloadable error report.

---

# 31. Bulk Status Update Workflow

## 31.1. Business purpose

Division operator must update statuses for many employees quickly during daily personnel expense preparation.

## 31.2. API endpoint

**Method:** `POST`  
**URL:** `/api/operations/employee-statuses/bulk-update`  
**Permission:** `status.manage` or `daily_report.mark_update` depending deployment policy.

Request:

```json
{
  "division_id": "uuid",
  "employee_ids": ["uuid-1", "uuid-2"],
  "status_type_code": "VACATION",
  "state_code": "ACTIVE",
  "starts_at": "2026-06-02T00:00:00+05:00",
  "ends_at": "2026-06-10T23:59:59+05:00",
  "reason": "Ежегодный отпуск согласно рапорту.",
  "basis_document_ids": ["uuid-doc-1"],
  "mode": "STRICT"
}
```

Allowed `mode`:

```text
STRICT — any employee error rolls back entire operation.
PARTIAL — valid rows are applied, invalid rows returned in errors.
PREVIEW — no DB write, only validation.
```

Response 200 for PREVIEW:

```json
{
  "mode": "PREVIEW",
  "total": 10,
  "valid": 9,
  "invalid": 1,
  "items": [
    {
      "employee_id": "uuid",
      "employee_name": "Иванов И.И.",
      "can_apply": false,
      "errors": [
        {
          "error_code": "OVERLAPPING_HARD_STATUS",
          "message": "На выбранный период уже есть отпуск."
        }
      ]
    }
  ]
}
```

Response 201 for STRICT success:

```json
{
  "created_count": 10,
  "updated_count": 0,
  "skipped_count": 0,
  "audit_id": "uuid"
}
```

Response 207 for PARTIAL:

```json
{
  "created_count": 8,
  "failed_count": 2,
  "errors": [
    {
      "employee_id": "uuid",
      "error_code": "VALIDATION_ERROR",
      "message": "Некорректный период статуса."
    }
  ]
}
```

## 31.3. Rules

**BR-BULK-STATUS-001.** Bulk update runs in `transaction.atomic()` for STRICT.

**BR-BULK-STATUS-002.** PARTIAL mode writes one audit summary plus per-status history.

**BR-BULK-STATUS-003.** PREVIEW must run same validation as actual write.

**BR-BULK-STATUS-004.** Employee scope must be checked against user's division permissions.

**BR-BULK-STATUS-005.** Basis documents are optional for non-KU statuses and required for deployment-configured status types.

**BR-BULK-STATUS-006.** Duplicate employee_ids in request are rejected with `400 DUPLICATE_EMPLOYEE_ID`.

## 31.4. Acceptance criteria

| ID | Criterion |
|---|---|
| BULK-AC-001 | PREVIEW validates without DB writes. |
| BULK-AC-002 | STRICT rolls back all on one invalid employee. |
| BULK-AC-003 | PARTIAL applies valid rows and returns invalid rows. |
| BULK-AC-004 | Operation writes audit and status history. |
| BULK-AC-005 | User cannot update employees outside permitted division scope. |

---

# 32. Scheduled Jobs / Celery Beat Regламент

## 32.1. General rules

All scheduled jobs must be:

- idempotent;
- logged;
- retriable;
- safe for double execution;
- auditable when they mutate business data;
- timezone-aware using `VAPS_LOCAL_TIMEZONE=Asia/Qyzylorda`.

## 32.2. Celery Beat schedule

| Job name | Schedule | Purpose | Mutates data | Retry |
|---|---|---|---:|---|
| `activate_planned_statuses` | every 5 min | Move due PLANNED statuses to ACTIVE | yes | 3 |
| `complete_expired_statuses` | every 5 min | Move expired ACTIVE statuses to COMPLETED | yes | 3 |
| `project_approved_duties` | every 10 min | Ensure approved duty shifts projected to statuses | yes | 3 |
| `recalculate_today_daily_readiness` | every 15 min | Update missing marks/readiness projections | yes | 2 |
| `send_daily_update_reminders` | daily 09:00 local | Notify divisions without INITIAL mark | no/notifications | 2 |
| `send_daily_update_escalation` | daily 11:00 local | Escalate unupdated divisions to supervisors | no/notifications | 2 |
| `block_tomorrow_report_if_unupdated` | daily 18:00 local | Create warning recommendation if tomorrow not ready | yes | 2 |
| `refresh_event_readiness` | every 10 min | Recalculate event readiness dashboard | yes | 2 |
| `refresh_workload_analytics` | hourly | Recalculate workload projection | yes | 2 |
| `expire_temporary_permissions` | every 5 min | Deactivate expired temporary duty permissions | yes | 3 |
| `cleanup_expired_document_requests` | daily 03:00 local | Mark expired generated files | yes | 1 |
| `archive_old_notifications` | daily 03:30 local | Archive old read notifications | yes | 1 |
| `integration_job_dispatcher` | every 1 min | Start queued import/export jobs | yes | 3 |

## 32.3. Job models

Add table:

```sql
CREATE TABLE system_scheduled_job_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name VARCHAR(100) NOT NULL,
    status_code VARCHAR(50) NOT NULL CHECK (status_code IN ('RUNNING','SUCCESS','FAILED','SKIPPED')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ,
    duration_ms INT,
    affected_count INT DEFAULT 0 NOT NULL,
    error_message TEXT,
    payload JSONB DEFAULT '{}'::jsonb NOT NULL
);

CREATE INDEX idx_system_job_runs_name_started
ON system_scheduled_job_runs(job_name, started_at DESC);
```

## 32.4. Status activation job

`activate_planned_statuses`:

```sql
UPDATE ops_employee_statuses
SET state_code='ACTIVE', updated_at=now()
WHERE state_code='PLANNED'
  AND starts_at <= now()
  AND ends_at > now();
```

For each changed status create `ops_employee_status_history` with `action_code='APPLIED'` and `actor_user_id='SYSTEM'`.

## 32.5. Status completion job

`complete_expired_statuses`:

```sql
UPDATE ops_employee_statuses
SET state_code='COMPLETED', updated_at=now()
WHERE state_code='ACTIVE'
  AND ends_at <= now();
```

For each changed status create status history with `action_code='COMPLETED'` and `actor_user_id='SYSTEM'`.

## 32.6. Daily update reminder job

At 09:00 local time:

1. Find active leaf divisions without `INITIAL` mark for today.
2. Notify division operators.
3. Create dashboard recommendation `UNUPDATED_DIVISIONS`.

At 11:00 local time:

1. Find still missing divisions.
2. Notify OMD/ORGD/supervisors.
3. Mark notification as escalation.

## 32.7. Acceptance criteria

| ID | Criterion |
|---|---|
| JOB-AC-001 | All scheduled jobs write `system_scheduled_job_runs`. |
| JOB-AC-002 | Running same activation job twice does not duplicate histories. |
| JOB-AC-003 | Expired temp permissions stop granting access after `ends_at`. |
| JOB-AC-004 | Missing INITIAL marks create reminders at 09:00 local time. |
| JOB-AC-005 | Failed job stores error and does not hide failure. |

---

# 33. Notification Matrix

## 33.1. Notification channels

MVP-core allowed channel:

```text
IN_APP only
```

Forbidden in MVP-core:

```text
SMS, email, WhatsApp, Telegram, external push, cloud notification service
```

## 33.2. Notification event matrix

| Event code | Trigger | Recipients | Priority | Repeat | Action link |
|---|---|---|---|---|---|
| `DAILY_MARK_MISSING` | 09:00 no INITIAL mark | division operators | WARNING | daily until mark | `/daily-expense` |
| `DAILY_MARK_ESCALATION` | 11:00 no INITIAL mark | OMD/ORGD/supervisor | CRITICAL | daily until mark | `/daily-expense` |
| `REPORT_READY` | document generated | requester | INFO | no | `/reports/{id}` |
| `REPORT_FAILED` | document failed | requester/admin | WARNING | no | `/reports/{id}` |
| `EVENT_BULLETIN_CREATED` | bulletin created | event participants/senior | INFO | no | `/events/{id}` |
| `RECON_REQUIRED` | event needs reconnaissance | responsible user | WARNING | no | `/events/{id}/reconnaissance` |
| `NEED_RETURNED` | need returned | need author | WARNING | no | `/events/{id}/need` |
| `RESOURCE_REQUEST_SENT` | request created | target division operator | INFO | no | `/events/{id}/requests` |
| `ALLOCATION_CONFIRMED` | allocation confirmed | event senior/OMD | INFO | no | `/events/{id}/requests` |
| `ASSIGNMENT_SUBMITTED` | version submitted | approver | WARNING | no | `/assignment-versions/{id}` |
| `ASSIGNMENT_RETURNED` | version returned | creator/senior | WARNING | no | `/assignment-versions/{id}` |
| `ASSIGNMENT_APPROVED` | version approved | assigned employees/senior | INFO | no | `/assignment-versions/{id}` |
| `ACK_REQUIRED` | acknowledgement created | assigned employee | WARNING | every 2h until ack during event prep | `/assignments/{id}` |
| `ACK_MISSING_ESCALATION` | near event start and pending ack | senior | CRITICAL | once | `/assignment-versions/{id}/acknowledgements` |
| `SOFT_CONFLICT_DETECTED` | conflict created | creator/senior | WARNING | no | `/assignment-versions/{id}` |
| `HARD_BLOCK_ATTEMPT` | hard-block assignment attempted | actor/admin optional | WARNING | no | `/assignment-versions/{id}` |
| `REPLACEMENT_CREATED` | replacement after approval | senior/affected users | WARNING | no | `/events/{id}` |
| `INCIDENT_CREATED` | incident opened | HQ/senior/OMD | CRITICAL | no | `/events/{id}/incidents` |
| `INCIDENT_CLOSED` | incident closed | HQ/senior | INFO | no | `/events/{id}/incidents` |
| `EVENT_READY_BLOCKED` | readiness blocker | event senior | WARNING | every 4h until resolved | `/events/{id}` |
| `TEMP_PERMISSION_ACTIVE` | temp permission starts | duty user | INFO | no | `/` |
| `TEMP_PERMISSION_EXPIRED` | temp permission expires | duty user | INFO | no | `/` |
| `IMPORT_COMPLETED` | import job success | requester | INFO | no | `/admin/import-export` |
| `IMPORT_FAILED` | import job failed | requester/admin | WARNING | no | `/admin/import-export` |

## 33.3. Notification payload

```json
{
  "type_code": "ASSIGNMENT_APPROVED",
  "title": "Расстановка утверждена",
  "body": "Вы назначены на пост №1, объект Конгресс-центр.",
  "entity_type": "assignment_version",
  "entity_id": "uuid",
  "action_url": "/assignment-versions/uuid",
  "priority": "INFO",
  "expires_at": "2026-06-05T09:00:00+05:00"
}
```

## 33.4. Acceptance criteria

| ID | Criterion |
|---|---|
| NOTIF-AC-001 | Approved assignment creates ACK_REQUIRED notifications. |
| NOTIF-AC-002 | Daily missing marks create reminders and escalation. |
| NOTIF-AC-003 | Notifications are filtered by recipient_user_id. |
| NOTIF-AC-004 | Read-all affects only current user. |
| NOTIF-AC-005 | No external notification channel is used in MVP-core. |

---

# 34. Document Templates Specification

## 34.1. General document rules

All generated documents must:

1. Be generated asynchronously via `documents_report_requests`.
2. Store file path and status.
3. Write audit on generation and download.
4. Use local date/time `Asia/Qyzylorda`.
5. Use stable filenames.
6. Exclude sensitive fields unless template explicitly allows them.

Filename pattern:

```text
{kind}_{entity_id_or_date}_{yyyyMMdd_HHmmss}.{ext}
```

## 34.2. Daily personnel report DOCX — one date

Kind:

```text
DAILY_REPORT
```

Format:

```text
DOCX
```

Page setup:

| Setting | Value |
|---|---|
| Page size | A4 |
| Orientation | landscape |
| Margins | 1.0 cm all sides |
| Font | Times New Roman or deployment default |
| Font size | 10 body, 12 header |

Header:

```text
ЕЖЕДНЕВНЫЙ РАСХОД ЛИЧНОГО СОСТАВА
по состоянию на {report_date} года
```

Required table columns:

| № | Column code | Title |
|---:|---|---|
| 1 | DIVISION | Подразделение |
| 2 | STAFF_TOTAL | Штат |
| 3 | LIST_TOTAL | Список |
| 4 | VACANCIES | Вакансии |
| 5 | IN_SERVICE | В строю |
| 6 | SICK | Болен |
| 7 | VACATION | Отпуск |
| 8 | COMMAND | Командировка |
| 9 | TRAINING | Учёба/сборы |
| 10 | DETACHED | Откомандирован |
| 11 | ATTACHED | Прикомандирован |
| 12 | ATTACHED_PLUS | Приданные силы |
| 13 | BEFORE_DUTY | Перед дежурством |
| 14 | ON_DUTY | На дежурстве |
| 15 | AFTER_DUTY | После дежурства |
| 16 | OTHER | Прочие |
| 17 | UPDATED_AT | Обновлено |
| 18 | UPDATED_BY | Ответственный |

Footer:

```text
Сформировано: {generated_at}
Сформировал: {generated_by}
Версия отчёта: {version_number}
```

## 34.3. Daily personnel report DOCX — period

Request:

```json
{
  "kind": "DAILY_REPORT",
  "format": "DOCX",
  "date_from": "2026-06-01",
  "date_to": "2026-06-07"
}
```

Rules:

**DOC-DAILY-PERIOD-001.** Each date must start from a separate page.

**DOC-DAILY-PERIOD-002.** Table structure must be same as one-date report.

**DOC-DAILY-PERIOD-003.** If date has no FINAL/CORRECTION report, document generation returns `409 REPORT_NOT_READY_FOR_DATE` with missing dates.

## 34.4. Daily report XLSX

Sheets:

| Sheet | Content |
|---|---|
| `Summary` | organization totals by date |
| `ByDivision` | rows by division/date |
| `MissingMarks` | missing marks if any |
| `Metadata` | generation info, filters, version |

## 34.5. Assignment print form DOCX/PDF

Kind:

```text
ASSIGNMENT
```

Header:

```text
РАССТАНОВКА СИЛ И СРЕДСТВ
на охранное мероприятие: {event_title}
```

Must include:

- event title;
- event date/time;
- object;
- sector;
- post;
- assigned employee rank + FIO;
- employee division;
- assignment role;
- start/end time;
- senior;
- post tasks;
- post features;
- gathering time if configured;
- notes allowed for print.

Must exclude:

- employee photo;
- full IIN;
- phone unless deployment allows;
- rating;
- anthropometry;
- internal conflict comments;
- sensitive passport notes;
- private evaluation comments.

## 34.6. Event closure archive package

Kind:

```text
EVENT_ARCHIVE
```

MVP-core may generate DOCX or ZIP.

Package contents:

1. Event summary.
2. Bulletin.
3. Reconnaissance summary.
4. Approved need summary.
5. Final assignment.
6. Replacements list.
7. Incidents list.
8. Closure report.
9. Documents index.
10. Object passport snapshot.

## 34.7. Document generation errors

| HTTP | Error code | Meaning |
|---:|---|---|
| 409 | `NOT_READY` | File generation not completed. |
| 409 | `REPORT_NOT_READY_FOR_DATE` | Required report date has no ready report. |
| 422 | `TEMPLATE_DATA_MISSING` | Required fields missing. |
| 500 | `DOCUMENT_GENERATION_FAILED` | Unexpected generation error. |

## 34.8. Acceptance criteria

| ID | Criterion |
|---|---|
| DOC-AC-001 | Daily DOCX includes all required columns. |
| DOC-AC-002 | Period DOCX creates separate page per date. |
| DOC-AC-003 | Assignment print excludes sensitive fields. |
| DOC-AC-004 | Download writes audit. |
| DOC-AC-005 | Report unavailable before generation returns 409 NOT_READY. |

---

# 35. Import / Export File Contracts

## 35.1. General import rules

Supported formats:

```text
CSV UTF-8, XLSX
```

Import modes:

```text
STRICT, PARTIAL, PREVIEW
```

All imports must:

1. Create `integration_jobs` row.
2. Validate file before write.
3. Be idempotent by natural key.
4. Produce downloadable error report.
5. Write audit summary.

## 35.2. Import positions

Job type:

```text
IMPORT_POSITIONS
```

Columns:

| Column | Required | Type | Example |
|---|---:|---|---|
| `code` | yes | string | `SENIOR_INSPECTOR` |
| `name` | yes | string | `Старший инспектор` |
| `level` | no | integer | `5` |
| `sort_order` | no | integer | `10` |
| `is_active` | no | boolean | `true` |

Natural key:

```text
code
```

## 35.3. Import ranks

Columns:

| Column | Required | Type | Example |
|---|---:|---|---|
| `code` | yes | string | `MAJOR` |
| `name` | yes | string | `Майор` |
| `category` | no | string | `OFFICER` |
| `rank_index` | yes | integer | `50` |
| `is_active` | no | boolean | `true` |

Natural key:

```text
code
```

## 35.4. Import divisions

Columns:

| Column | Required | Type | Example |
|---|---:|---|---|
| `organization_code` | yes | string | `SGO` |
| `code` | yes | string | `DEP_1` |
| `name` | yes | string | `1 департамент` |
| `type_code` | yes | string | `department` |
| `parent_code` | no | string | `SGO_ROOT` |
| `is_active` | no | boolean | `true` |

Natural key:

```text
organization_code + code
```

## 35.5. Import employees

Columns:

| Column | Required | Type | Example |
|---|---:|---|---|
| `external_id` | no | string | `KU-10001` |
| `iin` | yes | string(12) | `960118300000` |
| `full_name` | yes | string | `Иванов Иван Иванович` |
| `rank_code` | yes | string | `MAJOR` |
| `position_code` | yes | string | `SENIOR_INSPECTOR` |
| `division_code` | yes | string | `DEP_1_DIV_2` |
| `phone` | no | string | `+77000000000` |
| `gender` | no | enum M/F | `M` |
| `height_cm` | no | integer | `180` |
| `is_active` | no | boolean | `true` |
| `is_attached_force` | no | boolean | `false` |

Natural key priority:

1. `external_id` if present.
2. `iin` if external_id absent.

Rules:

**IMPORT-EMP-001.** If employee exists, update changed fields and create history if division/rank/position changed.

**IMPORT-EMP-002.** Invalid IIN format rejects row.

**IMPORT-EMP-003.** Unknown rank/position/division rejects row unless `auto_create_references=true` deployment flag is enabled.

Default:

```text
auto_create_references=false
```

## 35.6. Import staffing slots

Columns:

| Column | Required | Type | Example |
|---|---:|---|---|
| `division_code` | yes | string | `DEP_1_DIV_2` |
| `position_code` | yes | string | `SENIOR_INSPECTOR` |
| `slot_number` | no | string | `12` |
| `parent_slot_number` | no | string | `1` |
| `valid_from` | yes | date/datetime | `2026-01-01` |
| `valid_to` | no | date/datetime | empty |
| `is_active` | no | boolean | `true` |

Natural key:

```text
division_code + position_code + slot_number + valid_from
```

## 35.7. Export employees

Columns:

| Column | Notes |
|---|---|
| `iin` | masked unless permission allows full export |
| `full_name` | required |
| `rank` | display name |
| `position` | display name |
| `division` | path |
| `status` | current resolved status |
| `phone` | permission-based |
| `is_active` | yes |

## 35.8. Export daily report

Formats:

```text
DOCX, XLSX, PDF
```

Parameters:

```json
{
  "date_from": "2026-06-01",
  "date_to": "2026-06-07",
  "division_id": "optional-uuid",
  "format": "XLSX"
}
```

## 35.9. Import/export acceptance criteria

| ID | Criterion |
|---|---|
| IMP-AC-001 | PREVIEW import writes no business data. |
| IMP-AC-002 | Same employee file imported twice creates no duplicates. |
| IMP-AC-003 | Changed division creates division history. |
| IMP-AC-004 | Error report contains row number, field, error_code, message. |
| EXP-AC-001 | Sensitive export writes audit. |
| EXP-AC-002 | XLSX export contains Metadata sheet. |

---

# 36. Standard API Error Format

All API errors must follow one shape:

```json
{
  "error_code": "VALIDATION_ERROR",
  "message": "Описание ошибки для пользователя.",
  "details": {},
  "request_id": "uuid",
  "timestamp": "2026-06-02T10:00:00+05:00"
}
```

Validation error example:

```json
{
  "error_code": "VALIDATION_ERROR",
  "message": "Проверьте заполнение формы.",
  "details": {
    "starts_at": ["Дата начала должна быть раньше даты окончания."],
    "employee_ids": ["Список сотрудников не должен быть пустым."]
  },
  "request_id": "uuid",
  "timestamp": "2026-06-02T10:00:00+05:00"
}
```

Conflict error example:

```json
{
  "error_code": "SOFT_CONFLICT_DETECTED",
  "message": "Обнаружены конфликты. Укажите основание для override или измените назначение.",
  "details": {
    "conflicts": [
      {
        "conflict_code": "REST_VIOLATION_CONFLICT",
        "severity": "WARNING",
        "description": "Сотрудник находится на последежурном отдыхе."
      }
    ]
  },
  "request_id": "uuid",
  "timestamp": "2026-06-02T10:00:00+05:00"
}
```

Common errors:

| HTTP | error_code | Meaning |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | Invalid payload. |
| 401 | `AUTH_REQUIRED` | Missing auth. |
| 401 | `TOKEN_INVALID` | Invalid token. |
| 403 | `PERMISSION_DENIED` | No permission. |
| 403 | `USER_INACTIVE` | External auth says inactive. |
| 404 | `ENTITY_NOT_FOUND` | Resource missing. |
| 409 | `SOFT_CONFLICT_DETECTED` | Override needed. |
| 409 | `MARKS_INCOMPLETE` | Daily marks missing. |
| 409 | `CHECKLIST_ISSUES_UNRESOLVED` | Recon issue blocks readiness. |
| 409 | `HASH_MISMATCH` | Approval hash mismatch. |
| 422 | `HARD_UNAVAILABLE_STATUS` | Hard status blocks assignment. |
| 422 | `TEMPLATE_DATA_MISSING` | Cannot generate document. |
| 423 | `ASSIGNMENT_VERSION_LOCKED` | Version frozen. |
| 500 | `INTERNAL_ERROR` | Unexpected error. |

---

# 37. Permission Matrix v7.7

## 37.1. UI and API permission matrix

| Module | View permission | Mutate permission | Admin permission |
|---|---|---|---|
| Employees | `status.view` | `status.manage` | `admin.roles` |
| Daily expense | `daily_report.generate` or `status.view` | `daily_report.mark_update`, `daily_report.correct` | `admin.roles` |
| Objects | read-only role or `object.manage` | `object.manage` | `admin.roles` |
| Object passport | object read | `object.manage` | `admin.roles` |
| Events | event read | `event.manage` | `admin.roles` |
| Reconnaissance | event read | `event.manage` | `admin.roles` |
| Need calculations | event read | `event.manage` | `admin.roles` |
| Resource requests | event read | `brokerage.manage` | `admin.roles` |
| Assignments | assignment read | `assignment.create/delete/submit` | `admin.roles` |
| Approval | assignment read | `assignment.return`, `assignment.approve` | `admin.roles` |
| Incidents | event read | `event.manage` or HQ duty | `admin.roles` |
| Reports | report read | `daily_report.generate` | `admin.roles` |
| Documents | document read | document owner permissions | `admin.roles` |
| Import/export | integration read | integration/import/export role | `admin.roles` |
| Audit | `audit.view` | none | `admin.roles` |
| Roles | none | none | `admin.roles` |

## 37.2. Scope rules

**PERM-SCOPE-001.** Division operator sees only own division subtree.

**PERM-SCOPE-002.** OMD can see operational events and assignments in assigned scope.

**PERM-SCOPE-003.** ORGD can view daily reports and audit in assigned scope.

**PERM-SCOPE-004.** Temporary duty permission adds permissions only inside time window.

**PERM-SCOPE-005.** Admin sees all scopes.

---

# 38. Frontend Acceptance Criteria

| ID | Area | Criterion |
|---|---|---|
| FE-AC-001 | Auth | Unauthorized user is redirected to login/token handler. |
| FE-AC-002 | Auth | Permission denied page shown for 403. |
| FE-AC-003 | Layout | Sidebar shows only modules available by role. |
| FE-AC-004 | Daily expense | Division operator can bulk update selected employees. |
| FE-AC-005 | Daily expense | Missing marks are visible before report generation. |
| FE-AC-006 | Daily expense | Generate report button disabled if marks incomplete. |
| FE-AC-007 | Employee card | Calendar shows statuses, duties, assignments, replacements. |
| FE-AC-008 | Objects | Passport RED/YELLOW/GREEN is visible on object list. |
| FE-AC-009 | Event | Event header shows readiness and blockers. |
| FE-AC-010 | Recon | Required ISSUE blocks READY transition in UI. |
| FE-AC-011 | Assignment | Soft conflict opens override modal. |
| FE-AC-012 | Assignment | Hard-block shows non-overridable message. |
| FE-AC-013 | Assignment | Locked version disables edit/delete actions. |
| FE-AC-014 | Acknowledgement | Senior sees unacknowledged employees. |
| FE-AC-015 | Conduct | HQ dashboard shows active posts and incidents. |
| FE-AC-016 | Incidents | Incident cannot close without final decision. |
| FE-AC-017 | Documents | Download before ready shows NOT_READY. |
| FE-AC-018 | Import | Import preview shows row-level validation errors. |
| FE-AC-019 | Notifications | User can mark one notification read and all read. |
| FE-AC-020 | Audit | Audit page is hidden without `audit.view`. |

---

# 39. End-to-End MVP Scenarios

## E2E-001. Daily personnel expense full cycle

1. Division operator opens `/daily-expense`.
2. Selects today's date.
3. Bulk updates statuses for several employees.
4. Attaches basis document to vacation status.
5. Marks division as updated.
6. OMD sees all required divisions updated.
7. Generates daily report.
8. Downloads DOCX.
9. Audit records all mutations and download.

Expected:

- report generation allowed only after marks complete;
- DOCX has required columns;
- status history exists;
- audit exists.

## E2E-002. Event preparation full cycle

1. Create object and passport.
2. Create event.
3. Create bulletin.
4. Complete reconnaissance.
5. Create and approve need calculation.
6. Generate resource requests.
7. Confirm allocations.
8. Create assignment version.
9. Add individual and group assignments.
10. Resolve/override soft conflicts.
11. Submit version.
12. Approver approves.
13. System creates acknowledgements and notifications.
14. Employees acknowledge.
15. Event moves READY.

Expected:

- every transition guard works;
- assignment hash stable;
- acknowledgements created;
- readiness reaches 100% when all blockers resolved.

## E2E-003. Event conduct and closure

1. Event starts.
2. HQ adds journal entry.
3. Incident is created.
4. Replacement is created after approval.
5. Incident is closed with final decision.
6. Closure report is filled.
7. Event is closed.
8. Archive snapshots are created.

Expected:

- original journal immutable;
- replacement old/new visible;
- event cannot close while incident open;
- archive read-only.

## E2E-004. Import employees idempotency

1. Admin uploads employee XLSX in PREVIEW.
2. Fixes errors.
3. Runs STRICT import.
4. Runs same import again.
5. Changes employee division and imports again.

Expected:

- no duplicate employees;
- division history created;
- integration job SUCCESS;
- audit exists.

## E2E-005. Temporary duty permission

1. Admin grants OMD temporary permission 08:00–20:00.
2. User opens event at 10:00 and can act.
3. User tries same action at 21:00.

Expected:

- allowed inside window;
- denied after window;
- audit stores personal user_id and duty role.

---

# 40. Additional TASK Layer v7.7

## TASK-042. External Auth/JWT implementation

Implement JWT middleware, claim validation, request identity, employee binding selector and auth error responses.

**AC:** AUTH-AC-001..AUTH-AC-006 pass.

## TASK-043. Frontend application shell

Create frontend app with router, auth provider, API client, sidebar, layout, error handling and permission-based navigation.

**AC:** FE-AC-001..FE-AC-003 pass.

## TASK-044. Daily expense frontend and bulk status API

Implement daily expense page, employee status table, bulk update workflow, preview, strict/partial modes and daily mark action.

**AC:** BULK-AC-001..BULK-AC-005 and FE-AC-004..FE-AC-006 pass.

## TASK-045. Scheduled jobs framework

Implement `system_scheduled_job_runs`, Celery Beat jobs, idempotency protections and job monitoring admin page.

**AC:** JOB-AC-001..JOB-AC-005 pass.

## TASK-046. Notification engine

Implement notification event dispatcher, matrix handlers and in-app notification UI.

**AC:** NOTIF-AC-001..NOTIF-AC-005 pass.

## TASK-047. Document templates

Implement DOCX/XLSX/PDF templates for daily report, period report, assignment print and event archive package.

**AC:** DOC-AC-001..DOC-AC-005 pass.

## TASK-048. Import/export contracts

Implement CSV/XLSX import/export according to v7.7 contracts, including preview, strict, partial, error reports and audit.

**AC:** IMP-AC-001..IMP-AC-004 and EXP-AC-001..EXP-AC-002 pass.

## TASK-049. Object and event frontend

Implement object list/card/passport, event list/card, bulletin, reconnaissance, need, requests and readiness blockers.

**AC:** FE-AC-008..FE-AC-010 pass.

## TASK-050. Assignment frontend

Implement assignment version page, assignment forms, conflict modals, override workflow, submit/return/approve and print actions.

**AC:** FE-AC-011..FE-AC-014 pass.

## TASK-051. Conduct, incidents and closure frontend

Implement conduct dashboard, HQ journal, incidents, replacement flow, closure report and archive view.

**AC:** FE-AC-015..FE-AC-016 and E2E-003 pass.

## TASK-052. Product E2E regression suite

Implement E2E tests for daily expense, event preparation, conduct/closure, import idempotency and temporary duty permissions.

**AC:** E2E-001..E2E-005 pass.

---

# 41. Final Product Implementation Order v7.7

The final delivery order replaces v7.6 order for product development:

1. Backend architecture skeleton and isolation tests.
2. External Auth/JWT middleware.
3. Core schema: organizations, divisions, employees, positions, ranks, staffing slots, histories.
4. Roles, permissions, temporary duty permissions.
5. Lookup tables and seeds.
6. Frontend shell: auth, router, layout, permissions, API client.
7. Documents attachments and audit for downloads.
8. Employee statuses, status history, bulk update API.
9. Daily expense frontend and daily marks.
10. Scheduled jobs for statuses and daily reminders.
11. Daily report projector and document templates.
12. Objects, sectors, posts, object passport.
13. Object frontend.
14. Checklist templates and reconnaissance.
15. Event bulletin and lifecycle.
16. Event frontend.
17. Duty plans and duty projection.
18. Need calculations and resource requests.
19. Brokerage allocations.
20. Assignment locks and conflict detector.
21. Assignment APIs and assignment frontend.
22. Group assignment.
23. Hash/freeze/submit/return/approve.
24. Acknowledgements and notifications.
25. Replacement and cascade suggestions.
26. Conduct dashboard and HQ journal.
27. Incidents.
28. Event closure and archive snapshots.
29. Import/export jobs and UI.
30. Analytics dashboards: readiness, daily expense, basic load.
31. E2E tests.
32. Hardening: audit, permissions, concurrency, closed-contour deployment.
33. Documentation handoff for developers and operators.

---

# 42. Definition of Done

A feature is done only if all items are true:

1. DB schema/migration implemented.
2. Business rules implemented.
3. API implemented.
4. Permission checks implemented.
5. Audit implemented for mutations/sensitive reads.
6. Frontend page/form/table implemented where user-facing.
7. Loading/empty/error states implemented.
8. Tests implemented.
9. E2E scenario updated if feature is part of product flow.
10. Documented in developer handoff.
11. No cross-context ORM violation.
12. No direct password storage.
13. No external notification channel in MVP-core.
14. No silent data loss on delete.
15. No sensitive fields in print/export unless explicitly allowed.

---

# 43. Final Decision v7.7

VAPS v7.7 is the final product-ready baseline for development.

Use this document as the single source of truth for:

- backend development;
- frontend development;
- database migrations;
- API implementation;
- QA test planning;
- document generation;
- import/export;
- closed-contour deployment;
- AI code generation through Google Jules / Claude Code.

Old v7.6 remains the architectural and backend foundation. v7.7 completes the missing product layer.

Final product formula:

```text
VAPS = Auth + Core + Staff + Statuses + Daily Expense + Objects + Passport + Duties + Events + Need + Brokerage + Assignment + Conflicts + Acknowledgement + Conduct + Incidents + Closure + Archive + Documents + Notifications + Analytics + Import/Export + Audit + Frontend.
```
---

# 44. v7.8 Strict Audit Correction Delta — Required Fixes Before Development

## 44.0. Назначение v7.8

Этот раздел является обязательным corrective delta patch поверх v7.7. Он закрывает пробелы, выявленные при strict audit review v7.7 against source requirements and current Personnel Records implementation baseline.

v7.8 не отменяет v7.7 целиком. v7.8 уточняет и переопределяет только спорные, неполные или противоречивые места.

**V78-DECISION-001.** После применения v7.8 рабочий baseline называется:

```text
VAPS v7.8 Strict-Audit Fixed Product Baseline
```

**V78-DECISION-002.** Если v7.7 и v7.8 противоречат, приоритет имеет v7.8.

**V78-DECISION-003.** Если v7.5/v7.6/v7.7 содержат старый MVP scope, а v7.8 содержит corrected scope, использовать corrected scope из v7.8.

**V78-DECISION-004.** Любая функция, которая в источниках требуется для MVP-core, не может быть перенесена в Future без явного `SCOPE-DECISION` с причиной.

**V78-DECISION-005.** Текущая реализация Personnel Records учитывается как implementation baseline для кадрового блока, но VAPS не обязан копировать её 1:1. Там, где текущая реализация богаче master-документа, v7.8 добавляет совместимость или миграционный контракт.

## 44.1. Updated source priority

При конфликте требований использовать следующий порядок:

1. `v7.8 Strict Audit Correction Delta`.
2. `ПланРасстановка.docx` / PR — объектная модель, расстановка, дежурства, паспорт, чек-листы.
3. `ТЗ VAPS.md` — сводное техническое задание.
4. `brainstorming-session-2026-05-25-2256.md` — зафиксированные продуктовые решения.
5. `PersonnelStatus.md` — ежедневный расход, статусы, штатка, документы, уведомления.
6. `VisitX.md` — охранное мероприятие, рекогносцировка, штаб, инциденты, аккредитация, Face ID.
7. `PROJECT_DOCUMENTATION.md` — текущая реализация Personnel Records и миграционные ограничения.
8. v7.7 product layer.
9. v7.6/v7.5 backend foundation.

## 44.2. Canonical scope resolution table

| Блок | MVP-core | MVP-2 | Future | Решение v7.8 |
|---|---:|---:|---:|---|
| Core employees/divisions/staffing | yes | no | no | Обязательно в первой поставке. |
| Rich employee profile from Personnel Records | yes | no | no | Добавить поля совместимости. |
| External Auth/JWT | yes | no | no | Основной режим VAPS. |
| Legacy local JWT from Personnel Records | migration only | no | no | Только адаптер совместимости; не расширять как новый auth. |
| Statuses/status history/bulk update | yes | no | no | Обязательно. |
| Department-specific status types | yes | no | no | Добавить scoped status types. |
| Composite status display | yes | no | no | Добавить display/composition rules. |
| Daily personnel expense | yes | no | no | Обязательно. |
| Detailed DOCX cells with count + FIO + reason + period | yes | no | no | Исправление Critical. |
| Duty plans/shifts | yes | no | no | Обязательно. |
| Object duty types | yes | no | no | Исправление Critical. |
| REST_AFTER_DUTY hard policy | yes | no | no | Default hard-block unless deployment overrides. |
| Objects/passport/posts/sectors | yes | no | no | Обязательно. |
| Object-specific checklist overrides | yes | no | no | Исправление High. |
| Reconnaissance structured payload | yes | no | no | Исправление High. |
| Event lifecycle | yes | no | no | Обязательно. |
| Need calculations with detail items | yes | no | no | Исправление High. |
| Resource brokerage | yes | no | no | Обязательно. |
| Manual assignment | yes | no | no | Обязательно. |
| Auto draft assignment generator | no | yes | no | Не блокирует MVP-core, но архитектурный stub обязателен. |
| Assignment approval hash | yes | no | no | MVP approval mechanism. |
| Real ECP/ЭЦП | no | no | yes | Future only. |
| Assignment acknowledgements | yes | no | no | Обязательно. |
| Approved assignment replacements | yes | no | no | Обязательно. |
| Conduct/HQ journal/incidents/closure/archive | yes | no | no | Обязательно. |
| Operational ratings | no | yes | no | MVP-2. Remove hard dependency from MVP-core. |
| Post min_rating | no | yes | no | Disabled in MVP-core conflict detector. |
| Basic load dashboard | yes | no | no | Обязательно. |
| Advanced load/rating recommendations | no | yes | no | MVP-2. |
| Protected persons/manual logistics | no | yes | no | MVP-2 stubs allowed. |
| Manual accreditation checks | no | yes | no | MVP-2 stub. |
| Real accreditation integration | no | no | yes | Future. |
| Face ID | no | no | yes | Future. |
| In-app notifications | yes | no | no | Обязательно. |
| SMS/email/Telegram/WhatsApp notifications | no | no | yes | Excluded by closed-contour MVP. |

**SCOPE-AC-001.** Codegen must implement only MVP-core tasks first.

**SCOPE-AC-002.** MVP-2/Future tables may exist as nullable/admin-only stubs only if they do not block MVP-core flows.

---

# 45. Critical Fix 1 — Rich Employee Profile and Personnel Records Compatibility

## 45.1. Problem

v7.7 `core_employees` is too thin compared to Personnel Records implementation. Personnel Records already models personnel number, separate name parts, birth date, photo, hire/dismissal dates, work/personal contacts, notes and employment status.

## 45.2. Alter `core_employees`

```sql
ALTER TABLE core_employees
ADD COLUMN personnel_number VARCHAR(50) UNIQUE,
ADD COLUMN last_name VARCHAR(150),
ADD COLUMN first_name VARCHAR(150),
ADD COLUMN middle_name VARCHAR(150),
ADD COLUMN birth_date DATE,
ADD COLUMN photo_file_path TEXT,
ADD COLUMN hire_date DATE,
ADD COLUMN dismissal_date DATE,
ADD COLUMN work_phone VARCHAR(50),
ADD COLUMN work_email VARCHAR(255),
ADD COLUMN personal_phone VARCHAR(50),
ADD COLUMN personal_email VARCHAR(255),
ADD COLUMN notes TEXT,
ADD COLUMN employment_status VARCHAR(50) DEFAULT 'WORKING' NOT NULL CHECK (employment_status IN ('WORKING','FIRED','ARCHIVED'));
```

## 45.3. Name synchronization rule

**BR-EMP-001.** If `last_name`, `first_name`, `middle_name` are provided, `full_name` is generated as:

```text
{last_name} {first_name} {middle_name}
```

**BR-EMP-002.** If only `full_name` is imported, parsed name parts may remain null.

**BR-EMP-003.** Search must support both `full_name` and separate name parts.

## 45.4. Personnel number rule

**BR-EMP-004.** `personnel_number` is unique when present.

**BR-EMP-005.** Deployment may enable automatic personnel number generation:

```text
AUTO_GENERATE_PERSONNEL_NUMBER=true|false
```

Default MVP:

```text
AUTO_GENERATE_PERSONNEL_NUMBER=false
```

## 45.5. Sensitive fields masking policy

### DB-CORE-013. `core_sensitive_field_policies`

```sql
CREATE TABLE core_sensitive_field_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_code VARCHAR(100) NOT NULL,
    permission_code VARCHAR(100) NOT NULL,
    mask_strategy VARCHAR(50) NOT NULL CHECK (mask_strategy IN ('FULL_HIDE','PARTIAL_MASK','ALLOW')),
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    CONSTRAINT unique_sensitive_policy UNIQUE(field_code, permission_code)
);
```

Default sensitive fields:

```text
iin
photo_file_path
work_phone
personal_phone
work_email
personal_email
birth_date
notes
documents
incident_history
rating_aggregate
```

**BR-PRIVACY-001.** IIN is masked by default in list pages and exports.

**BR-PRIVACY-002.** Full IIN requires explicit permission `employee.sensitive.view`.

**BR-PRIVACY-003.** Photo is not included in printable assignment forms.

**BR-PRIVACY-004.** Sensitive export must write audit.

## 45.6. API additions

- `GET /api/core/employees?search&division_id&status&rank_code&position_code`.
- `GET /api/core/employees/{id}`.
- `PATCH /api/core/employees/{id}`.
- `POST /api/core/employees/{id}/archive`.
- `POST /api/core/employees/{id}/restore`.
- `GET /api/core/employees/{id}/sensitive-fields` — returns fields visible for current user.

## 45.7. Frontend additions

Employee list columns must support:

| Column | MVP | Masking |
|---|---:|---|
| FIO | yes | no |
| Personnel number | yes | no |
| IIN | yes | masked by default |
| Photo/avatar | yes | permission-based |
| Rank | yes | no |
| Position | yes | no |
| Division | yes | no |
| Current status | yes | no |
| Hire date | yes | permission-based |
| Work phone | optional | permission-based |
| Work email | optional | permission-based |
| Attached/detached marker | yes | no |

## 45.8. Acceptance criteria

| ID | Criterion |
|---|---|
| EMP-AC-001 | Employee can be created with separate name parts and generated `full_name`. |
| EMP-AC-002 | Search by full_name, last_name, first_name and IIN works. |
| EMP-AC-003 | IIN is masked without `employee.sensitive.view`. |
| EMP-AC-004 | Sensitive export writes audit. |
| EMP-AC-005 | Personnel number uniqueness is enforced. |

---

# 46. Critical Fix 2 — Department-Specific and Composite Statuses

## 46.1. Scoped status types

### DB-OPS-043. `ops_status_type_scopes`

```sql
CREATE TABLE ops_status_type_scopes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status_type_code VARCHAR(50) NOT NULL REFERENCES ops_status_types(code) ON DELETE CASCADE,
    division_id UUID,
    organization_id UUID,
    is_allowed BOOLEAN DEFAULT TRUE NOT NULL,
    is_required_basis_document BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_status_scope_target CHECK (division_id IS NOT NULL OR organization_id IS NOT NULL)
);

CREATE INDEX idx_ops_status_type_scopes_division
ON ops_status_type_scopes(status_type_code, division_id, organization_id);
```

**BR-STATUS-SCOPE-001.** If a status has no scope rows, it is globally available.

**BR-STATUS-SCOPE-002.** If a status has scope rows, it is available only inside matching organization/division subtree.

**BR-STATUS-SCOPE-003.** `is_required_basis_document=true` requires at least one `STATUS_BASIS` attachment when creating this status.

## 46.2. Composite status display

### DB-OPS-044. `ops_status_display_rules`

```sql
CREATE TABLE ops_status_display_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    primary_status_type_code VARCHAR(50) NOT NULL REFERENCES ops_status_types(code) ON DELETE CASCADE,
    secondary_status_type_code VARCHAR(50) NOT NULL REFERENCES ops_status_types(code) ON DELETE CASCADE,
    display_code VARCHAR(100) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    report_column_code VARCHAR(50),
    priority INT DEFAULT 0 NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    CONSTRAINT unique_status_display_pair UNIQUE(primary_status_type_code, secondary_status_type_code)
);
```

Examples:

```text
DUTY + STUDY -> DUTY_STUDY_DISPLAY
REST_AFTER_DUTY + STUDY -> REST_STUDY_DISPLAY
EVENT_ASSIGNMENT + TRAINING -> EVENT_TRAINING_DISPLAY
```

**BR-STATUS-COMPOSITE-001.** Daily report still counts exactly one final status by priority matrix.

**BR-STATUS-COMPOSITE-002.** UI calendar may show composite status if multiple intervals overlap.

**BR-STATUS-COMPOSITE-003.** Composite display must not break staffing balance.

## 46.3. Status conflict policy

**BR-STATUS-CONFLICT-001.** Creating a manual status must check overlap with existing statuses for same employee.

**BR-STATUS-CONFLICT-002.** If overlapping status is hard-block, return `422 OVERLAPPING_HARD_STATUS`.

**BR-STATUS-CONFLICT-003.** If overlapping status is soft, return `409 STATUS_OVERLAP_WARNING` unless override reason is provided.

**BR-STATUS-CONFLICT-004.** Deployment may allow automatic completion of lower-priority status only if `AUTO_COMPLETE_LOWER_PRIORITY_STATUS=true`.

Default MVP:

```text
AUTO_COMPLETE_LOWER_PRIORITY_STATUS=false
```

## 46.4. API additions

- `GET|POST|PATCH /api/operations/status-type-scopes`.
- `GET|POST|PATCH /api/operations/status-display-rules`.
- `POST /api/operations/employee-statuses/validate-overlap`.

## 46.5. Acceptance criteria

| ID | Criterion |
|---|---|
| STATUS-AC-001 | Division-scoped status is visible only inside allowed subtree. |
| STATUS-AC-002 | Basis document is required when scope rule requires it. |
| STATUS-AC-003 | Composite status appears in calendar when two statuses overlap. |
| STATUS-AC-004 | Daily report still counts employee once. |
| STATUS-AC-005 | Overlap with hard status returns 422. |

---

# 47. Critical Fix 3 — Daily Personnel Report Cell Content

## 47.1. Problem

v7.7 described required columns but did not define cell-level content. For operational usage, each report status cell must contain count plus human-readable employee details.

## 47.2. Daily report item details

### DB-OPS-045. `ops_daily_personnel_report_item_details`

```sql
CREATE TABLE ops_daily_personnel_report_item_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_item_id UUID NOT NULL REFERENCES ops_daily_personnel_report_items(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    employee_display_name VARCHAR(255) NOT NULL,
    rank_name VARCHAR(255),
    position_name VARCHAR(255),
    status_type_code VARCHAR(50),
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    reason TEXT,
    basis_documents_count INT DEFAULT 0 NOT NULL,
    display_order INT DEFAULT 0 NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb NOT NULL
);

CREATE INDEX idx_daily_item_details_item
ON ops_daily_personnel_report_item_details(report_item_id, display_order);
```

## 47.3. Cell rendering rule

**DOC-DAILY-CELL-001.** Each status cell must render:

```text
{count}
1) {rank_short} {FIO_short} — {period}, {reason/comment if present}
2) ...
```

**DOC-DAILY-CELL-002.** If `basis_documents_count > 0`, append marker:

```text
[осн. док.: N]
```

**DOC-DAILY-CELL-003.** For `ATTACHED` and `ATTACHED_PLUS`, render count as `+N`.

**DOC-DAILY-CELL-004.** If the list is longer than deployment limit, render first N names and append:

```text
... ещё {remaining_count}
```

Default:

```text
DAILY_REPORT_CELL_MAX_NAMES=20
```

**DOC-DAILY-CELL-005.** XLSX export must include separate detailed sheet `Details` with one row per employee/status detail.

## 47.4. DOCX daily report updated columns

The existing columns remain, but cells for status columns must use `ops_daily_personnel_report_item_details`.

Affected columns:

```text
IN_SERVICE
SICK
VACATION
COMMAND
TRAINING
DETACHED
ATTACHED
ATTACHED_PLUS
BEFORE_DUTY
ON_DUTY
AFTER_DUTY
OTHER
```

## 47.5. API additions

- `GET /api/operations/daily-reports/{id}/details`.
- `GET /api/operations/daily-reports/{id}/items/{item_id}/details`.

## 47.6. Acceptance criteria

| ID | Criterion |
|---|---|
| DAILY-DOC-AC-001 | DOCX status cell contains count and employee short names. |
| DAILY-DOC-AC-002 | DOCX status cell includes period and reason when available. |
| DAILY-DOC-AC-003 | ATTACHED/ATTACHED_PLUS render as +N. |
| DAILY-DOC-AC-004 | XLSX has `Details` sheet. |
| DAILY-DOC-AC-005 | Period DOCX preserves detailed cell content per date. |

---

# 48. Critical Fix 4 — Object Duty Types

## 48.1. Duty type model

### DB-OPS-046. `ops_object_duty_types`

```sql
CREATE TABLE ops_object_duty_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES ops_objects(id) ON DELETE CASCADE,
    code VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    default_post_type_code VARCHAR(50) REFERENCES ops_post_types(code) ON DELETE SET NULL,
    default_duration_minutes INT CHECK (default_duration_minutes > 0),
    rest_after_minutes INT DEFAULT 1440 NOT NULL CHECK (rest_after_minutes >= 0),
    before_duty_minutes INT DEFAULT 0 NOT NULL CHECK (before_duty_minutes >= 0),
    requires_reconnaissance BOOLEAN DEFAULT FALSE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_object_duty_type_code UNIQUE(object_id, code)
);
```

### DB-OPS-047. Alter `ops_duty_shifts`

```sql
ALTER TABLE ops_duty_shifts
ADD COLUMN duty_type_id UUID REFERENCES ops_object_duty_types(id) ON DELETE RESTRICT,
ADD COLUMN duty_role_code VARCHAR(100),
ADD COLUMN notes TEXT;
```

## 48.2. Duty type rules

**BR-DUTY-TYPE-001.** Each duty shift for object-based duty should reference `duty_type_id`.

**BR-DUTY-TYPE-002.** `rest_after_minutes` defines auto-projected `REST_AFTER_DUTY` interval.

**BR-DUTY-TYPE-003.** `before_duty_minutes > 0` creates `BEFORE_DUTY` projection.

**BR-DUTY-TYPE-004.** If `requires_reconnaissance=true`, approving duty plan requires object passport not RED and latest reconnaissance within configured validity period.

## 48.3. REST_AFTER_DUTY policy

Default MVP:

```text
REST_AFTER_DUTY_POLICY=HARD_BLOCK
```

Allowed values:

```text
HARD_BLOCK
SOFT_OVERRIDE
```

**BR-DUTY-REST-001.** If policy is `HARD_BLOCK`, assigning an employee during `REST_AFTER_DUTY` returns `422 REST_AFTER_DUTY_BLOCK`.

**BR-DUTY-REST-002.** If policy is `SOFT_OVERRIDE`, assigning during `REST_AFTER_DUTY` returns `409 REST_VIOLATION_CONFLICT` unless override reason is provided.

**BR-DUTY-REST-003.** Policy must be shown in admin settings and deployment documentation.

## 48.4. Conflict checks for duty shifts

**BR-DUTY-CONFLICT-001.** Creating or approving a duty shift must run the same availability checks as assignment:

- hard employee statuses;
- existing assignments;
- existing duty shifts;
- rest violations;
- workload limits;
- post requirements when post is defined.

**BR-DUTY-CONFLICT-002.** Duty shift conflicts must be written into `ops_conflicts` with entity reference to duty shift or into `ops_duty_conflicts` if separated.

### Optional table if separate duty conflicts are preferred

```sql
CREATE TABLE ops_duty_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    duty_shift_id UUID NOT NULL REFERENCES ops_duty_shifts(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    conflict_code VARCHAR(100) NOT NULL,
    severity VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    is_overridden BOOLEAN DEFAULT FALSE NOT NULL,
    override_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

## 48.5. API additions

- `GET|POST|PATCH /api/operations/objects/{object_id}/duty-types`.
- `POST /api/operations/duty-plans/{id}/validate`.
- `GET /api/operations/duty-plans/{id}/conflicts`.

## 48.6. Frontend additions

Duty plan screen must include:

- duty type selector;
- object selector;
- post selector;
- rest-after preview;
- conflict panel;
- approve guard.

## 48.7. Acceptance criteria

| ID | Criterion |
|---|---|
| DUTY-AC-001 | Object can have multiple duty types. |
| DUTY-AC-002 | Duty shift references duty type. |
| DUTY-AC-003 | Approving duty projects DUTY and REST_AFTER_DUTY using duty type rest rule. |
| DUTY-AC-004 | `REST_AFTER_DUTY_POLICY=HARD_BLOCK` returns 422 for assignment during rest. |
| DUTY-AC-005 | Duty approval detects overlap with existing assignments. |

---

# 49. High Fix — Group Profile and Specialized Groups

## 49.1. Alter `ops_groups`

```sql
ALTER TABLE ops_groups
ADD COLUMN group_type VARCHAR(100),
ADD COLUMN specialization_code VARCHAR(100),
ADD COLUMN description TEXT,
ADD COLUMN tasks TEXT,
ADD COLUMN default_equipment JSONB DEFAULT '{}'::jsonb NOT NULL,
ADD COLUMN default_weapons JSONB DEFAULT '{}'::jsonb NOT NULL,
ADD COLUMN default_special_equipment JSONB DEFAULT '{}'::jsonb NOT NULL,
ADD COLUMN min_members INT DEFAULT 0 NOT NULL CHECK (min_members >= 0),
ADD COLUMN max_members INT CHECK (max_members IS NULL OR max_members >= 0);
```

## 49.2. Group rules

**BR-GROUP-001.** Group profile must be visible when creating group assignment.

**BR-GROUP-002.** If group has `min_members > 0`, group assignment must validate active member count.

**BR-GROUP-003.** If need calculation requests `specialization_code`, only matching groups are suggested by default.

**BR-GROUP-004.** Group membership history must remain interval-based.

## 49.3. API additions

- `GET|POST|PATCH /api/operations/groups`.
- `GET|POST|PATCH /api/operations/groups/{id}/members`.
- `GET /api/operations/groups?specialization_code&division_id&active_at`.

## 49.4. Acceptance criteria

| ID | Criterion |
|---|---|
| GROUP-AC-001 | Group stores specialization and tasks. |
| GROUP-AC-002 | Group assignment displays group profile before submit. |
| GROUP-AC-003 | Empty or under-minimum group returns validation error. |
| GROUP-AC-004 | Need calculation can suggest groups by specialization. |

---

# 50. High Fix — Object-Specific Checklist Overrides

## 50.1. Object checklist binding

### DB-OPS-048. `ops_object_checklist_bindings`

```sql
CREATE TABLE ops_object_checklist_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES ops_objects(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES ops_object_checklist_templates(id) ON DELETE RESTRICT,
    name VARCHAR(255),
    is_default BOOLEAN DEFAULT FALSE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_object_template_binding UNIQUE(object_id, template_id)
);
```

### DB-OPS-049. `ops_object_checklist_overrides`

```sql
CREATE TABLE ops_object_checklist_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    binding_id UUID NOT NULL REFERENCES ops_object_checklist_bindings(id) ON DELETE CASCADE,
    source_item_id UUID REFERENCES ops_object_checklist_items(id) ON DELETE SET NULL,
    override_type VARCHAR(50) NOT NULL CHECK (override_type IN ('ADD','MODIFY','DISABLE')),
    text TEXT,
    category VARCHAR(100),
    is_required BOOLEAN,
    sort_order INT,
    reason TEXT,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

## 50.2. Checklist rules

**BR-CHECKLIST-001.** Object may use a standard template without overrides.

**BR-CHECKLIST-002.** Object may add, modify or disable checklist items through override table.

**BR-CHECKLIST-003.** Reconnaissance uses resolved checklist:

```text
template items + object overrides
```

**BR-CHECKLIST-004.** Disabling required standard item requires permission `object.checklist.override_required`.

## 50.3. API additions

- `POST /api/operations/objects/{object_id}/checklist-bindings`.
- `GET /api/operations/objects/{object_id}/resolved-checklist`.
- `POST /api/operations/object-checklist-bindings/{id}/overrides`.
- `DELETE /api/operations/object-checklist-overrides/{id}`.

## 50.4. Acceptance criteria

| ID | Criterion |
|---|---|
| CHECKLIST-AC-001 | Object can bind standard checklist template. |
| CHECKLIST-AC-002 | Object can add custom checklist item. |
| CHECKLIST-AC-003 | Object can modify checklist item text. |
| CHECKLIST-AC-004 | Resolved checklist is used in reconnaissance. |
| CHECKLIST-AC-005 | Disabling required item requires special permission. |

---

# 51. High Fix — Structured Reconnaissance Result

## 51.1. Alter `ops_event_reconnaissance`

```sql
ALTER TABLE ops_event_reconnaissance
ADD COLUMN preliminary_posts JSONB DEFAULT '[]'::jsonb NOT NULL,
ADD COLUMN preliminary_sectors JSONB DEFAULT '[]'::jsonb NOT NULL,
ADD COLUMN proposed_routes JSONB DEFAULT '[]'::jsonb NOT NULL,
ADD COLUMN risk_points JSONB DEFAULT '[]'::jsonb NOT NULL,
ADD COLUMN required_force_profile JSONB DEFAULT '{}'::jsonb NOT NULL,
ADD COLUMN required_equipment JSONB DEFAULT '{}'::jsonb NOT NULL,
ADD COLUMN required_transport JSONB DEFAULT '{}'::jsonb NOT NULL,
ADD COLUMN required_weapons JSONB DEFAULT '{}'::jsonb NOT NULL,
ADD COLUMN required_special_equipment JSONB DEFAULT '{}'::jsonb NOT NULL,
ADD COLUMN notes_for_assignment TEXT;
```

## 51.2. Reconnaissance payload schema

`required_force_profile` schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "total_required": {"type": "integer", "minimum": 0},
    "male_required": {"type": "integer", "minimum": 0},
    "female_required": {"type": "integer", "minimum": 0},
    "bvs_required": {"type": "integer", "minimum": 0},
    "pdta_required": {"type": "integer", "minimum": 0},
    "mergen_required": {"type": "integer", "minimum": 0},
    "combat_groups_required": {"type": "integer", "minimum": 0},
    "physical_detail_required": {"type": "integer", "minimum": 0},
    "senior_required": {"type": "boolean"}
  }
}
```

`preliminary_posts` item schema:

```json
{
  "post_code": "P-1",
  "post_name": "Главный вход",
  "sector_name": "Сектор А",
  "post_type_code": "FIXED",
  "location_description": "у центрального входа",
  "tasks": "контроль доступа",
  "features": "высокий поток людей",
  "required_count": 2,
  "start_time": "2026-06-05T09:00:00+05:00",
  "end_time": "2026-06-05T18:00:00+05:00"
}
```

## 51.3. Reconnaissance to need conversion

**BR-RECON-004.** Completed reconnaissance may generate draft need calculations.

**BR-RECON-005.** Generated need must remain DRAFT until submitted/approved by responsible user.

**BR-RECON-006.** Proposed posts/sectors from reconnaissance do not modify object passport automatically; they create proposed changes requiring approval.

## 51.4. API additions

- `POST /api/operations/events/{event_id}/reconnaissance/generate-need-draft`.
- `POST /api/operations/events/{event_id}/reconnaissance/propose-object-changes`.

## 51.5. Acceptance criteria

| ID | Criterion |
|---|---|
| RECON-AC-001 | Reconnaissance stores preliminary posts and sectors. |
| RECON-AC-002 | Reconnaissance stores required force profile. |
| RECON-AC-003 | Completed reconnaissance can generate draft need. |
| RECON-AC-004 | Recon proposed object changes do not directly alter passport/posts. |

---

# 52. High Fix — Detailed Need Calculation Items

## 52.1. Need calculation items

### DB-OPS-050. `ops_event_need_calculation_items`

```sql
CREATE TABLE ops_event_need_calculation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calculation_id UUID NOT NULL REFERENCES ops_event_need_calculations(id) ON DELETE CASCADE,
    object_id UUID NOT NULL REFERENCES ops_objects(id) ON DELETE RESTRICT,
    sector_id UUID REFERENCES ops_object_sectors(id) ON DELETE SET NULL,
    post_id UUID REFERENCES ops_object_posts(id) ON DELETE SET NULL,
    direction_name VARCHAR(255),
    senior_required BOOLEAN DEFAULT FALSE NOT NULL,
    required_role_code VARCHAR(100) REFERENCES ops_assignment_roles(code) ON DELETE SET NULL,
    required_count INT NOT NULL CHECK (required_count >= 0),
    required_male_count INT DEFAULT 0 NOT NULL CHECK (required_male_count >= 0),
    required_female_count INT DEFAULT 0 NOT NULL CHECK (required_female_count >= 0),
    required_group_specialization_code VARCHAR(100),
    gathering_place TEXT,
    gathering_at TIMESTAMPTZ,
    duty_starts_at TIMESTAMPTZ,
    duty_ends_at TIMESTAMPTZ,
    uniform_requirements TEXT,
    weapon_requirements JSONB DEFAULT '{}'::jsonb NOT NULL,
    special_equipment_requirements JSONB DEFAULT '{}'::jsonb NOT NULL,
    transport_requirements JSONB DEFAULT '{}'::jsonb NOT NULL,
    notes TEXT,
    sort_order INT DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

## 52.2. Need rules

**BR-NEED-004.** Header `ops_event_need_calculations.required_count` must equal sum of item `required_count`, unless calculation type is summary-only.

**BR-NEED-005.** Approved need items are the source for resource requests and assignment requirements.

**BR-NEED-006.** If item references `post_id`, post must belong to event object.

**BR-NEED-007.** Need item can request group specialization without specifying exact group.

## 52.3. Resource request generation from need items

**BR-REQ-FROM-NEED-001.** One approved need item may generate one or more resource requests.

**BR-REQ-FROM-NEED-002.** Generated request must reference source need item:

```sql
ALTER TABLE ops_resource_requests
ADD COLUMN source_need_item_id UUID REFERENCES ops_event_need_calculation_items(id) ON DELETE SET NULL;
```

**BR-REQ-FROM-NEED-003.** Generated assignment requirement must reference source need item:

```sql
ALTER TABLE ops_event_requirements
ADD COLUMN source_need_item_id UUID REFERENCES ops_event_need_calculation_items(id) ON DELETE SET NULL;
```

## 52.4. API additions

- `POST /api/operations/need-calculations/{id}/items`.
- `PATCH /api/operations/need-calculation-items/{id}`.
- `DELETE /api/operations/need-calculation-items/{id}`.
- `POST /api/operations/need-calculations/{id}/generate-requests`.

## 52.5. Acceptance criteria

| ID | Criterion |
|---|---|
| NEED-AC-001 | Need calculation can contain multiple detailed items. |
| NEED-AC-002 | Need item can specify gathering place/time and uniform. |
| NEED-AC-003 | Approved need item generates resource request with source reference. |
| NEED-AC-004 | Returned/unapproved need cannot generate requests. |
| NEED-AC-005 | Need item post must belong to event object. |

---

# 53. High Fix — ECP / ЭЦП Decision

## 53.1. MVP decision

**ECP-DECISION-001.** Real ECP/ЭЦП integration is not part of MVP-core.

**ECP-DECISION-002.** MVP-core approval is implemented through:

- submit/return/approve workflow;
- immutable audit;
- assignment payload hash;
- approver identity from JWT;
- timestamp and request ID;
- generated approval document if needed.

**ECP-DECISION-003.** This internal approval must not be called legal ECP signature.

**ECP-DECISION-004.** Future ECP integration must attach signature metadata to approval event without changing approved assignment hash semantics.

## 53.2. ECP-ready table

### DB-DOC-003. `documents_signature_placeholders`

```sql
CREATE TABLE documents_signature_placeholders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    signature_provider VARCHAR(100),
    signature_status VARCHAR(50) DEFAULT 'NOT_REQUIRED' NOT NULL CHECK (signature_status IN ('NOT_REQUIRED','PENDING','SIGNED','FAILED','CANCELLED')),
    signed_by VARCHAR(100),
    signed_at TIMESTAMPTZ,
    signature_payload JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

**ECP-AC-001.** MVP approval works without external ECP.

**ECP-AC-002.** UI labels must say “Утвердить” not “Подписать ЭЦП” in MVP.

**ECP-AC-003.** Future ECP can be added without changing assignment version approval hash.

---

# 54. High Fix — Notification Channel Decision

## 54.1. Closed contour rule

**NOTIF-DECISION-001.** MVP-core uses only in-app notifications.

**NOTIF-DECISION-002.** WebSocket real-time in LAN is allowed.

**NOTIF-DECISION-003.** SMS, email, WhatsApp, Telegram, cloud push are excluded from MVP-core.

**NOTIF-DECISION-004.** If PersonnelStatus mentions email/SMS, that requirement is reclassified to Future because closed-contour deployment has higher priority.

## 54.2. Optional WebSocket support

v7.7 in-app notification API remains canonical. If real-time UX is required, implement WebSocket as optional LAN-only channel.

### DB-NOTIF-002. Alter `notifications_messages`

```sql
ALTER TABLE notifications_messages
ADD COLUMN action_url TEXT,
ADD COLUMN priority VARCHAR(50) DEFAULT 'INFO' NOT NULL CHECK (priority IN ('INFO','WARNING','CRITICAL')),
ADD COLUMN expires_at TIMESTAMPTZ,
ADD COLUMN delivered_ws_at TIMESTAMPTZ;
```

**NOTIF-WS-001.** WebSocket must not be the only delivery mechanism. Notification must always be stored in DB.

**NOTIF-WS-002.** If WebSocket fails, user still sees notification in `/notifications`.

---

# 55. High Fix — Auto Draft Assignment Scope

## 55.1. MVP-2 decision

**AUTO-ASSIGN-DECISION-001.** Fully automatic draft assignment generator is not required in MVP-core.

**AUTO-ASSIGN-DECISION-002.** MVP-core must provide architecture stub and manual assignment tools.

**AUTO-ASSIGN-DECISION-003.** MVP-2 may implement auto draft assignment based on approved need, availability, post requirements, workload and staffing chain.

## 55.2. Stub service contract

```python
class DraftAssignmentGeneratorService:
    def generate_draft(self, event_id: UUID, strategy_code: str, created_by: str) -> UUID:
        """Generate draft assignment version from approved need.
        MVP-core: raise NOT_IMPLEMENTED_FOR_MVP unless deployment flag enables experimental mode.
        """
```

Default:

```text
ENABLE_AUTO_DRAFT_ASSIGNMENT=false
```

## 55.3. API stub

- `POST /api/operations/events/{event_id}/assignment-versions/generate-draft`.

MVP-core response when disabled:

```json
{
  "error_code": "NOT_IMPLEMENTED_FOR_MVP",
  "message": "Автоматическая черновая расстановка запланирована для MVP-2. Используйте ручное создание версии расстановки."
}
```

## 55.4. Acceptance criteria

| ID | Criterion |
|---|---|
| AUTO-ASSIGN-AC-001 | Disabled auto-draft endpoint returns explicit `NOT_IMPLEMENTED_FOR_MVP`. |
| AUTO-ASSIGN-AC-002 | Manual assignment flow works without auto generator. |
| AUTO-ASSIGN-AC-003 | Architecture has service contract for future implementation. |

---

# 56. High Fix — Rating / min_rating Dependency Resolution

## 56.1. Corrected MVP rule

**RATING-DECISION-001.** Operational ratings are MVP-2.

**RATING-DECISION-002.** `ops_object_posts.min_rating` must not be enforced in MVP-core unless minimal rating aggregate module is enabled.

Default:

```text
ENABLE_RATING_CONFLICTS=false
```

## 56.2. Conflict detector rule

**BR-RATING-CONFLICT-001.** If `ENABLE_RATING_CONFLICTS=false`, `min_rating` is ignored by conflict detector.

**BR-RATING-CONFLICT-002.** If `ENABLE_RATING_CONFLICTS=true`, missing rating data creates soft warning `RATING_DATA_MISSING`, not hard block.

**BR-RATING-CONFLICT-003.** Rating must never automatically block assignment in MVP-core.

## 56.3. Acceptance criteria

| ID | Criterion |
|---|---|
| RATING-AC-001 | MVP-core assignment does not fail because rating module is absent. |
| RATING-AC-002 | `min_rating` is ignored when `ENABLE_RATING_CONFLICTS=false`. |
| RATING-AC-003 | Missing rating creates warning only when rating conflicts are enabled. |

---

# 57. Medium Fix — Division Calendar UI

## 57.1. Division calendar layout

Division calendar must support two views:

1. Table view:

```text
rows = employees
columns = days
cell = status badges / duty / assignment / replacement
```

2. Summary view:

```text
rows = status columns
columns = days
cell = count + drilldown
```

## 57.2. API additions

- `GET /api/operations/divisions/{division_id}/status-calendar-grid?date_from&date_to`.
- `GET /api/operations/divisions/{division_id}/status-calendar-summary?date_from&date_to`.

## 57.3. Acceptance criteria

| ID | Criterion |
|---|---|
| CAL-AC-001 | Division calendar shows employees by rows and days by columns. |
| CAL-AC-002 | Cell can show multiple badges if composite display applies. |
| CAL-AC-003 | Summary view aggregates by status per day. |

---

# 58. Medium Fix — Analytics for Absence Comparison

## 58.1. Absence analytics endpoints

- `GET /api/analytics/absence-comparison?division_id&date_from&date_to&group_by=division|date|status`.
- `GET /api/analytics/absence-trend?division_id&date_from&date_to`.
- `GET /api/analytics/unupdated-divisions?report_date`.

## 58.2. Acceptance criteria

| ID | Criterion |
|---|---|
| ANALYTICS-AC-001 | User can compare absence counts by division. |
| ANALYTICS-AC-002 | User can compare absence counts by date. |
| ANALYTICS-AC-003 | Scope permissions are applied to analytics. |

---

# 59. Import / Export Additions

## 59.1. Additional import contracts

v7.7 import contracts are extended with:

| Job type | MVP | Natural key |
|---|---:|---|
| `IMPORT_DIVISIONS` | yes | organization_code + code |
| `IMPORT_STATUS_TYPES` | yes | code |
| `IMPORT_OBJECTS` | yes | code |
| `IMPORT_OBJECT_POSTS` | yes | object_code + post_code |
| `IMPORT_OBJECT_CHECKLISTS` | yes | object_code + checklist_code |
| `IMPORT_DUTY_TYPES` | yes | object_code + code |

## 59.2. Export additions

| Export | MVP | Notes |
|---|---:|---|
| `EXPORT_DIVISION_CALENDAR` | yes | XLSX/PDF |
| `EXPORT_OBJECT_PASSPORT` | yes | DOCX/PDF |
| `EXPORT_EVENT_ARCHIVE` | yes | DOCX/ZIP |
| `EXPORT_AUDIT_LOGS` | yes | scope-filtered |

## 59.3. Acceptance criteria

| ID | Criterion |
|---|---|
| IMP2-AC-001 | Object import is idempotent by code. |
| IMP2-AC-002 | Post import validates object exists. |
| IMP2-AC-003 | Duty type import validates object exists. |
| EXP2-AC-001 | Object passport export excludes sensitive security notes unless permission allows. |

---

# 60. Updated Standard API Errors v7.8

Add common errors:

| HTTP | error_code | Meaning |
|---:|---|---|
| 400 | `DUPLICATE_EMPLOYEE_ID` | Duplicate employee id in bulk request. |
| 400 | `INVALID_SCOPE_STATUS` | Status not allowed in user's division scope. |
| 400 | `OBJECT_CHECKLIST_REQUIRED` | Object has no resolved checklist. |
| 409 | `STATUS_OVERLAP_WARNING` | Status overlaps with another soft status. |
| 409 | `RECONNAISSANCE_REQUIRED` | Recon required before readiness. |
| 409 | `DUTY_CONFLICT_DETECTED` | Duty shift has conflicts. |
| 409 | `NOT_IMPLEMENTED_FOR_MVP` | Feature explicitly moved to MVP-2/Future. |
| 422 | `OVERLAPPING_HARD_STATUS` | Status overlaps with hard status. |
| 422 | `REST_AFTER_DUTY_BLOCK` | REST_AFTER_DUTY hard policy blocks assignment. |
| 422 | `UNDER_MINIMUM_GROUP_MEMBERS` | Group has fewer active members than required. |

---

# 61. Additional TASK Layer v7.8

## TASK-053. Employee profile compatibility and masking

Implement rich employee fields, personnel number, name synchronization, masking policy and sensitive export audit.

**AC:** EMP-AC-001..EMP-AC-005 pass.

## TASK-054. Scoped and composite statuses

Implement status type scopes, basis requirements, display composition and overlap validation.

**AC:** STATUS-AC-001..STATUS-AC-005 pass.

## TASK-055. Detailed daily report cells

Implement report item details, DOCX cell renderer and XLSX Details sheet.

**AC:** DAILY-DOC-AC-001..DAILY-DOC-AC-005 pass.

## TASK-056. Object duty types and duty conflict validation

Implement object duty types, duty type selector, rest policy and conflict validation for duty shifts.

**AC:** DUTY-AC-001..DUTY-AC-005 pass.

## TASK-057. Group profile expansion

Implement group specialization, tasks, equipment profile and group filters.

**AC:** GROUP-AC-001..GROUP-AC-004 pass.

## TASK-058. Object-specific checklist overrides

Implement checklist bindings, overrides and resolved checklist API.

**AC:** CHECKLIST-AC-001..CHECKLIST-AC-005 pass.

## TASK-059. Structured reconnaissance result

Implement extended reconnaissance fields, schema validation and draft need generation from reconnaissance.

**AC:** RECON-AC-001..RECON-AC-004 pass.

## TASK-060. Need calculation detail items

Implement need calculation items and generation of resource requests from approved items.

**AC:** NEED-AC-001..NEED-AC-005 pass.

## TASK-061. ECP placeholder and approval wording

Implement ECP-ready placeholder table and ensure MVP UI says approval, not ECP signing.

**AC:** ECP-AC-001..ECP-AC-003 pass.

## TASK-062. Notification closed-contour hardening

Implement optional WebSocket delivery while preserving DB notification as source of truth.

**AC:** NOTIF-WS-001..NOTIF-WS-002 pass.

## TASK-063. Auto draft assignment stub

Implement disabled-by-default auto draft endpoint and service contract.

**AC:** AUTO-ASSIGN-AC-001..AUTO-ASSIGN-AC-003 pass.

## TASK-064. Rating dependency guard

Disable rating-based conflicts in MVP-core unless explicitly enabled.

**AC:** RATING-AC-001..RATING-AC-003 pass.

## TASK-065. Division calendar and absence analytics

Implement division calendar grid/summary and absence comparison endpoints.

**AC:** CAL-AC-001..CAL-AC-003 and ANALYTICS-AC-001..ANALYTICS-AC-003 pass.

## TASK-066. Import/export extensions

Implement import/export additions for objects, posts, duty types, checklists and object passport.

**AC:** IMP2-AC-001..IMP2-AC-003 and EXP2-AC-001 pass.

---

# 62. Additional Regression Tests v7.8

## TEST-027. Employee masking

1. Create employee with IIN, photo and phone.
2. Login as viewer without sensitive permission.
3. Open employee list and export employees.

Expected:

- IIN is masked;
- phone hidden/masked;
- export audit exists.

## TEST-028. Scoped status

1. Create status type allowed only for division A.
2. User from division B tries to create it.

Expected: `400 INVALID_SCOPE_STATUS`.

## TEST-029. Composite status calendar

1. Create DUTY and STUDY overlapping same day.
2. Open employee calendar.
3. Generate daily report.

Expected:

- calendar shows composite display;
- daily report counts employee once.

## TEST-030. Detailed DOCX report cell

1. Create three employees on vacation with reasons and periods.
2. Generate daily DOCX.

Expected:

- VACATION cell contains count 3;
- employee short names are listed;
- period/reason shown;
- basis marker shown if documents exist.

## TEST-031. Object duty type rest policy

1. Create object duty type with `rest_after_minutes=1440`.
2. Approve duty shift.
3. Try assignment during rest.

Expected: `422 REST_AFTER_DUTY_BLOCK` with default policy.

## TEST-032. Duty conflict validation

1. Employee has approved assignment 10:00–12:00.
2. Create duty shift 11:00–13:00.

Expected: duty validation returns conflict.

## TEST-033. Group specialization

1. Create group with specialization `BVS`.
2. Create need item requiring `BVS`.
3. Generate suggestions.

Expected: matching group appears first.

## TEST-034. Object checklist override

1. Bind standard checklist to object.
2. Add custom required item.
3. Start reconnaissance.

Expected: reconnaissance contains standard + custom item.

## TEST-035. Recon to need draft

1. Complete reconnaissance with required force profile.
2. Generate draft need.

Expected: need calculation items match reconnaissance payload.

## TEST-036. Need item to resource request

1. Approve need with two items.
2. Generate resource requests.

Expected: requests reference source need item.

## TEST-037. ECP wording

1. Open approval page in MVP.

Expected: UI says `Утвердить`, not `Подписать ЭЦП`.

## TEST-038. Rating disabled

1. Post has `min_rating=9`.
2. `ENABLE_RATING_CONFLICTS=false`.
3. Assign employee without rating.

Expected: assignment does not fail because of rating.

## TEST-039. Auto draft disabled

1. Call auto draft endpoint with default config.

Expected: `409 NOT_IMPLEMENTED_FOR_MVP`.

---

# 63. Updated JULES.md v7.8

```md
# VAPS Master Engineering Rules v7.8 Strict-Audit Fixed

1. Use v7.8 as final override over v7.7/v7.6/v7.5.
2. Implement MVP-core first. Do not implement MVP-2/Future before MVP-core is stable.
3. Preserve Django 5.x + DRF + PostgreSQL + Redis + Celery modular monolith.
4. Do not create physical microservices in MVP-core.
5. Do not create cross-context ForeignKeys between bounded contexts.
6. Use selectors/services for cross-context reads.
7. VAPS must not expand local password auth; use external JWT as canonical identity.
8. Personnel Records local JWT is migration compatibility only.
9. Enrich core_employees with Personnel Records-compatible fields.
10. Mask sensitive employee fields by default.
11. Every sensitive export/download writes audit.
12. Implement scoped status types and composite status display.
13. Daily report counts each employee exactly once even when calendar shows composite status.
14. Daily DOCX cells must include count + FIO + period + reason/comment where available.
15. ATTACHED and ATTACHED_PLUS render as +N and do not affect receiving staff/list numerator.
16. Implement object duty types before duty planning UI is considered complete.
17. Default REST_AFTER_DUTY_POLICY is HARD_BLOCK.
18. Duty shifts must run conflict validation before approval.
19. Expand groups with specialization, tasks and equipment profile.
20. Implement object-specific checklist overrides.
21. Reconnaissance must store structured proposed posts/sectors/force/equipment/risk payload.
22. Approved reconnaissance may generate draft need, but must not auto-change object passport/posts.
23. Need calculations must have detailed items.
24. Approved need items are source for resource requests.
25. Real ECP is Future; MVP uses internal approval + hash + audit.
26. MVP UI must say approval, not ECP signing.
27. MVP notification channel is IN_APP only; LAN WebSocket is optional but DB notification is source of truth.
28. SMS/email/Telegram/WhatsApp notifications are Future.
29. Fully automatic draft assignment is MVP-2; provide disabled stub endpoint in MVP-core.
30. Rating conflicts are disabled by default in MVP-core.
31. `min_rating` must not block assignment unless ENABLE_RATING_CONFLICTS=true.
32. Add division calendar grid and absence comparison analytics.
33. Add import/export contracts for objects, posts, duty types and checklists.
34. Every new v7.8 requirement must have DB/API/UI/AC/tests where user-facing.
35. Do not merge unrelated tasks. Implement TASK-053..TASK-066 after v7.7 mandatory tasks that they correct.
```

---

# 64. Updated Product Implementation Order v7.8

This replaces v7.7 order where conflicts exist.

1. Backend architecture skeleton and isolation tests.
2. External Auth/JWT middleware and legacy Personnel Records auth compatibility decision.
3. Core schema enriched with Personnel Records fields.
4. Sensitive field masking and audit policy.
5. Core organizations/divisions/employees/positions/ranks/staffing slots/histories.
6. Roles, permissions, scope rules, temporary duty permissions.
7. Lookup tables and seeds.
8. Scoped status types and composite display rules.
9. Frontend shell: auth, router, layout, permission navigation.
10. Documents attachments and audit for downloads.
11. Employee statuses, status history, overlap validation, bulk update API.
12. Daily expense frontend and daily marks.
13. Scheduled jobs for status activation/completion and daily reminders.
14. Daily report projector with item details.
15. Daily DOCX/XLSX/PDF templates with detailed cell content.
16. Objects, sectors, posts, object passport.
17. Object duty types.
18. Duty plans/shifts, duty conflict validation and duty projection.
19. Object-specific checklist templates/overrides.
20. Reconnaissance with structured payload.
21. Event bulletin and lifecycle.
22. Need calculations with detail items.
23. Resource requests generated from approved need items.
24. Brokerage allocations.
25. Assignment locks and conflict detector.
26. Assignment APIs and assignment frontend.
27. Group profile expansion and group assignment.
28. Hash/freeze/submit/return/approve.
29. Acknowledgements and notifications.
30. Replacement and cascade suggestions.
31. Conduct dashboard and HQ journal.
32. Incidents.
33. Event closure and archive snapshots.
34. Import/export jobs and UI.
35. Division calendar and absence analytics.
36. Readiness, daily expense and basic load dashboards.
37. E2E tests v7.7 + regression tests v7.8.
38. Hardening: audit, permissions, concurrency, closed-contour deployment.
39. Documentation handoff for developers and operators.
40. MVP-2 planning: ratings, auto draft assignment, advanced recommendations, protected persons/logistics/accreditation stubs.

---

# 65. Final Decision v7.8

VAPS v7.8 is the corrected product-ready baseline after strict audit.

The corrected product formula is:

```text
VAPS = External Auth + Core Personnel + Staff + Scoped Statuses + Composite Calendar + Daily Expense with Detailed Cells + Object Duty Types + Objects + Passport + Object Checklists + Reconnaissance + Duties + Events + Need Items + Brokerage + Assignment + Conflicts + Approval Hash + Acknowledgement + Replacement + Conduct + Incidents + Closure + Archive + Documents + In-App Notifications + Analytics + Import/Export + Audit + Frontend.
```

Development can start only if the team accepts these v7.8 corrections as mandatory.

**Final verdict:** можно отдавать в разработку после применения v7.8 patch. Without v7.8 corrections, v7.7 remains incomplete for MVP-core.

---

# 66. v7.8.1 Development-Readiness Patch

## 66.0. Purpose

This section applies the final strict-audit corrections required before handing the master specification to Google Jules / Claude Code / backend / frontend / QA.

The patch closes the remaining delivery risks found after v7.8 review:

1. codegen priority ambiguity between older v7.5/v7.6/v7.7 content and v7.8 corrections;
2. oversized MVP-core without release slicing;
3. missing legacy Personnel Records authentication migration contract;
4. insufficiently precise DOCX daily personnel report template rules;
5. ambiguous scheduled job execution times;
6. missing legacy data migration mapping;
7. missing Definition of Done checks for notifications, rating-disabled mode and template rendering.

**V781-DECISION-001.** Sections 44–73 are the highest-priority implementation source inside this document.

**V781-DECISION-002.** Development must start from MVP-0 / MVP-1 slices in section 67, not from the full functional list at once.

**V781-DECISION-003.** Any feature listed as MVP-2 or Future must not block MVP-core release.

**V781-DECISION-004.** Every user-facing function must have at least: API, UI route or UI scenario, permission rule, audit rule if mutating/sensitive, acceptance criteria and test.

---

# 67. MVP-core Release Slicing

## 67.1. Why slicing is mandatory

The full MVP-core list is too large for one safe implementation pass. Therefore, MVP-core is divided into delivery slices. Each slice must be independently testable and deployable inside the closed contour.

## 67.2. MVP-0 — Foundation and migration shell

Goal: create the technical foundation without business workflow complexity.

Scope:

1. Django 5.x + DRF + PostgreSQL + Redis + Celery project skeleton.
2. Modular monolith apps and isolation tests.
3. External Auth/JWT middleware.
4. Legacy Personnel Records auth compatibility layer.
5. Core organizations/divisions/employees enriched with Personnel Records-compatible fields.
6. Positions, ranks, staffing slots, vacancies.
7. Roles, permissions, scope rules.
8. Audit service.
9. Documents attachment base.
10. Frontend shell: auth handler, router, layout, permission-based navigation.

Exit criteria:

- API without token returns `401 AUTH_REQUIRED`.
- Expired/invalid token returns `401 TOKEN_INVALID`.
- Inactive user returns `403 USER_INACTIVE`.
- VAPS stores no password or password hash.
- Employee UUID is never used as `user_id`.
- Cross-context ORM import isolation test passes.
- Basic employee/division/staffing CRUD works under permissions.

## 67.3. MVP-1 — Personnel status and daily expense

Goal: deliver the first operational value: daily personnel accounting.

Scope:

1. Employee statuses with scoped types.
2. Status history.
3. Status basis documents.
4. Bulk status update.
5. Composite employee/division calendar.
6. Daily update marks.
7. Daily personnel report for one date.
8. Daily personnel report for period.
9. DOCX/XLSX/PDF report generation.
10. Scheduled jobs for status activation/completion/reminders.
11. In-app notifications for status/report workflows.
12. Frontend pages: employees, employee card, division calendar, status update, bulk update, daily expense, reports.

Exit criteria:

- Employee has exactly one daily report counted status.
- Composite calendar may show multiple statuses, but report counts once by priority.
- Tomorrow report is blocked until required leaf divisions submit marks.
- Daily DOCX cell includes count, short FIO, period and reason/comment where available.
- ATTACHED/ATTACHED_PLUS renders as `+N` and does not affect receiving staff/list numerator.
- Repeated mark update is idempotent.

## 67.4. MVP-2 — Objects, duties and event preparation

Goal: prepare object-based operations and duty planning.

Scope:

1. Objects, sectors, posts.
2. Object passport with completeness.
3. Object duty types.
4. Duty plans and shifts.
5. Duty conflict validation.
6. Duty projection to employee statuses.
7. Checklist templates and object-specific overrides.
8. Reconnaissance with structured payload.
9. Event bulletin.
10. Need calculations with detailed items.
11. Resource requests generated from approved need.
12. Frontend pages: objects, object card, passport, duty plan, event card, bulletin, reconnaissance, need.

Exit criteria:

- Active object has passport.
- RED passport blocks READY unless authorized override exists.
- Duty approval creates DUTY and REST_AFTER_DUTY statuses.
- Duty conflicts are validated before approval.
- Reconnaissance ISSUE blocks READY unless resolved/overridden.
- Approved reconnaissance can create draft need, but does not automatically modify passport/posts.

## 67.5. MVP-3 — Assignment, approval and acknowledgement

Goal: deliver full assignment workflow.

Scope:

1. Assignment versions.
2. Individual assignments.
3. Group assignments.
4. Group profile expansion.
5. Conflict detector.
6. Assignment locks.
7. Hash/freeze/submit/return/approve.
8. Brokerage allocations.
9. Assignment acknowledgements.
10. In-app notifications for assignment workflow.
11. Replacement and cascade suggestions.
12. Frontend pages: assignment version, assignment table/grid, conflicts, approval, acknowledgements, replacement.

Exit criteria:

- Parallel assignment cannot silently create double assignment.
- Hard-block returns 422 when enabled by data.
- Soft-warning returns 409 unless valid override reason is provided.
- SUBMITTED/APPROVED assignment version is frozen by DB trigger.
- Approval verifies hash.
- Approved version creates PENDING acknowledgements.
- Replacement after approval requires reason and sanctioned_by.

## 67.6. MVP-4 — Conduct, incidents, closure, archive and analytics

Goal: close the event lifecycle.

Scope:

1. Conduct dashboard.
2. HQ journal.
3. Incidents.
4. Assignment actuals.
5. Event closure report.
6. Archive snapshots.
7. Readiness dashboard.
8. Daily expense dashboard.
9. Basic load dashboard.
10. Import/export jobs and UI.
11. Frontend pages: conduct dashboard, incidents, closure, archive, analytics, import/export.

Exit criteria:

- HQ journal entries are immutable through normal UI.
- Open incident blocks event closure unless final decision exists.
- Closing event creates snapshots for passport, final assignment, incidents, closure report and documents index.
- Export of sensitive data writes audit.
- WebSocket, if enabled, is only delivery acceleration; DB notification remains source of truth.

## 67.7. MVP-5 / MVP-2 backlog after stabilization

May be implemented only after MVP-0..MVP-4 are stable:

1. Operational ratings and service hours.
2. Advanced recommendations.
3. Protected persons module.
4. Logistics module.
5. Manual accreditation checks.
6. Printable event archive package.
7. Advanced BI dashboards.
8. Offline-friendly read-only mode.

---

# 68. Legacy Personnel Records Auth Migration Contract

## 68.1. Problem

Legacy Personnel Records may use local JWT / NextAuth / simplejwt flows, while VAPS canonical design requires External Auth/JWT and must not store local passwords or password hashes.

## 68.2. Canonical target

VAPS canonical identity is JWT claim `sub`.

All audit, RBAC, temporary duty permissions and created_by/updated_by fields must use `sub` as `user_id`.

## 68.3. Compatibility period

During migration, VAPS may accept legacy Personnel Records JWT only through `integration_auth.LegacyPersonnelRecordsJWTAdapter`.

Rules:

1. Legacy token is accepted only when `ENABLE_LEGACY_PERSONNEL_RECORDS_AUTH=true`.
2. Adapter validates legacy token signature using legacy public/secret key configured in environment.
3. Adapter maps legacy user identifier to canonical `sub`.
4. Adapter must not create local passwords, password hashes or reset tokens.
5. Adapter must write audit action `AUTH_LEGACY_TOKEN_ACCEPTED` for successful legacy-token authentication.
6. Adapter must write audit action `AUTH_LEGACY_TOKEN_REJECTED` for invalid legacy-token attempts when actor is identifiable.
7. Compatibility mode must be removable without changing business modules.

## 68.4. Token mapping

| Legacy source | VAPS canonical field | Rule |
|---|---|---|
| legacy user id | `sub` | convert to stable string `legacy:<id>` unless external id exists |
| username/email | `identity.email` / display only | must not be used as primary actor id |
| full name | `identity.full_name` | display only |
| iin | `identity.iin` | optional employee-binding hint |
| active flag | `is_active` | inactive returns `403 USER_INACTIVE` |

## 68.5. Employee binding during migration

Default:

```text
AUTO_BIND_BY_IIN=false
```

If binding is absent and JWT contains `iin`, UI may show “Связать учётную запись с сотрудником” only to authorized admin/HR role.

No silent binding is allowed unless deployment explicitly sets:

```text
AUTO_BIND_BY_IIN=true
```

## 68.6. Migration acceptance criteria

| ID | Criterion |
|---|---|
| AUTH-MIG-AC-001 | Legacy token accepted only when compatibility flag is enabled. |
| AUTH-MIG-AC-002 | Legacy token disabled flag causes `401 TOKEN_INVALID`. |
| AUTH-MIG-AC-003 | Legacy user id is converted to stable `sub`. |
| AUTH-MIG-AC-004 | Audit actor uses canonical `sub`, not employee UUID. |
| AUTH-MIG-AC-005 | No password/password hash/reset token columns are created. |
| AUTH-MIG-AC-006 | Compatibility adapter can be removed without touching operations/core business services. |

---

# 69. Daily Personnel Report Template Appendix

## 69.1. Purpose

This section is mandatory for DOCX/XLSX/PDF rendering of the daily personnel expense report.

The report must be understandable to leadership without opening employee cards.

## 69.2. DOCX page setup

Default layout:

```text
Page size: A4
Orientation: landscape
Margins: top 10 mm, bottom 10 mm, left 8 mm, right 8 mm
Header font: Times New Roman 12 bold
Table font: Times New Roman 8
Main title font: Times New Roman 14 bold
Line spacing: single
Table borders: visible
Cell vertical alignment: center
```

If the deployment uses an official government template, the template file overrides visual layout but not data requirements.

## 69.3. DOCX title block

Must include:

1. organization name;
2. report title;
3. report date or period;
4. generated_at local datetime;
5. generated_by display name;
6. version number;
7. correction reason if report is correction.

Example title text:

```text
Ежедневный расход личного состава
за 02.06.2026
Версия: 1
Сформировано: 02.06.2026 09:30 Asia/Qyzylorda
```

## 69.4. DOCX table columns

Minimum mandatory columns:

```text
№
Подразделение
Штат
Список
Вакансии
В строю
Больничный
Отпуск
Командировка
Учёба/подготовка
Откомандирован
Прикомандирован +N
Перед дежурством
На дежурстве
После дежурства
ОМ/служба
Прочее
Не обновлено/примечание
```

Exact column names may be localized, but `report_column_code` must remain stable.

## 69.5. Detailed cell content rule

Each status cell must contain:

```text
<count>
<short FIO 1> — <period or interval> — <reason/comment if exists>
<short FIO 2> — <period or interval> — <reason/comment if exists>
...
```

Example:

```text
2
Иванов И.И. — 01.06–10.06 — ежегодный отпуск
Петров П.П. — 02.06 — больничный
```

If count is zero:

```text
0
```

If employee list is too long for one cell:

1. DOCX cell shows count and first N short names.
2. Cell ends with `ещё +M`.
3. Full list must be present in appendix section of the same DOCX.

## 69.6. ATTACHED / ATTACHED_PLUS rendering

For receiving division:

```text
+N
<short FIO> — from <source division> — <period>
```

ATTACHED and ATTACHED_PLUS must not increase receiving `STAFF_TOTAL`, `LIST_TOTAL` or numerator of staffing balance.

## 69.7. Period DOCX export

For period export:

1. each date starts from a new page;
2. each date uses the same table layout;
3. summary page is placed at the beginning;
4. correction versions must be marked per date.

## 69.8. XLSX export requirements

Workbook sheets:

```text
Summary
Details
ByDivision
AuditInfo
```

`Details` sheet mandatory columns:

```text
report_date
division_code
division_name
employee_id
employee_short_name
employee_full_name
report_column_code
status_type_code
period_start
period_end
reason
comment
source
is_attached_plus
source_division_name
```

## 69.9. PDF export requirements

PDF may be generated from DOCX or directly from report data.

PDF must preserve:

1. title block;
2. table columns;
3. detailed cell content or appendix;
4. version/correction markers.

## 69.10. Template acceptance criteria

| ID | Criterion |
|---|---|
| TEMPLATE-AC-001 | DOCX generated for one date contains title, version, generated_at and generated_by. |
| TEMPLATE-AC-002 | DOCX status cell contains count + FIO + period + reason/comment where data exists. |
| TEMPLATE-AC-003 | Long cells use `ещё +M` and appendix contains full list. |
| TEMPLATE-AC-004 | ATTACHED/ATTACHED_PLUS displayed as `+N` and excluded from receiving staffing numerator. |
| TEMPLATE-AC-005 | Period DOCX creates separate page per date. |
| TEMPLATE-AC-006 | XLSX contains `Summary`, `Details`, `ByDivision`, `AuditInfo`. |
| TEMPLATE-AC-007 | Downloading generated report writes audit. |

---

# 70. Scheduled Jobs Policy

## 70.1. Canonical timezone

All business schedules are evaluated in:

```text
VAPS_LOCAL_TIMEZONE=Asia/Qyzylorda
```

Celery Beat may store UTC schedule internally, but business date calculation must use local timezone.

## 70.2. Default job schedule

Default MVP schedule:

| Job | Local time | Purpose |
|---|---:|---|
| `apply_planned_statuses` | 00:01 | Activate planned statuses for local date. |
| `complete_expired_statuses` | 00:15 | Complete expired active statuses. |
| `send_upcoming_status_notifications` | 09:00 | Notify about upcoming statuses. |
| `send_ending_status_notifications` | 09:05 | Notify about ending statuses. |
| `daily_report_missing_marks_reminder` | 09:30 | Notify leaf divisions without INITIAL mark. |
| `documents_report_queue_cleanup` | 23:30 | Expire old report download links if configured. |

## 70.3. Deployment override

All job times must be configurable through environment or DB settings.

Example:

```text
VAPS_JOB_APPLY_PLANNED_STATUSES_LOCAL_TIME=00:01
VAPS_JOB_COMPLETE_EXPIRED_STATUSES_LOCAL_TIME=00:15
VAPS_JOB_UPCOMING_STATUS_NOTIFICATIONS_LOCAL_TIME=09:00
VAPS_JOB_ENDING_STATUS_NOTIFICATIONS_LOCAL_TIME=09:05
```

## 70.4. Idempotency rule

Every scheduled job must be idempotent.

Running the same job twice for the same local date must not create duplicate statuses, duplicate notifications or duplicate report marks.

## 70.5. Schedule acceptance criteria

| ID | Criterion |
|---|---|
| SCHEDULE-AC-001 | Jobs use `VAPS_LOCAL_TIMEZONE` for business date. |
| SCHEDULE-AC-002 | Job times can be overridden without code changes. |
| SCHEDULE-AC-003 | Running `apply_planned_statuses` twice creates no duplicate active status. |
| SCHEDULE-AC-004 | Running notification jobs twice creates no duplicate unread notification for same event and recipient. |
| SCHEDULE-AC-005 | Missed job can be safely rerun manually by admin. |

---

# 71. Legacy Data Migration Mapping

## 71.1. Purpose

This mapping is mandatory when migrating data from existing Personnel Records implementation into VAPS.

## 71.2. Employee mapping

| Legacy Personnel Records field | VAPS field | Rule |
|---|---|---|
| `Employee.id` | migration map only | do not reuse as UUID; store in `external_id` if needed |
| `personnel_number` | `core_employees.personnel_number` | unique, immutable by default |
| `last_name` | `core_employees.last_name` | required |
| `first_name` | `core_employees.first_name` | required |
| `middle_name` | `core_employees.middle_name` | optional |
| combined FIO | `core_employees.full_name` | generated from parts unless explicitly imported |
| `iin` | `core_employees.iin` | must match 12 digits |
| `photo` | `documents_attachments` or employee photo path | sensitive download audit applies |
| `rank` | `rank_code` / `core_ranks` | create rank if missing in import mode |
| `birth_date` | `core_employees.birth_date` | sensitive field |
| `work_phone` | `core_employees.work_phone` | mask by default |
| `personal_phone` | `core_employees.personal_phone` | mask by default |
| `work_email` | `core_employees.work_email` | display by permission |
| `personal_email` | `core_employees.personal_email` | mask by default |
| `hire_date` | `core_employees.hire_date` | used in validation |
| `dismissal_date` | `core_employees.separated_at` | convert date to local end-of-day timestamp |
| `employment_status=fired` | `is_active=false` | preserve separated_at |

## 71.3. Division mapping

| Legacy field | VAPS field | Rule |
|---|---|---|
| `Division.id` | migration map only | do not expose as VAPS id |
| `name` | `core_divisions.name` | required |
| `code` | `core_divisions.code` | unique per organization |
| `division_type` | `core_divisions.type_code` | map organization/department/directorate/division to configured type codes |
| `parent` | `core_divisions.parent_id` | resolve through migration map |
| `is_active` | `core_divisions.is_active` | preserve |
| `order` | sort metadata | optional |

## 71.4. Status mapping

| Legacy status | VAPS status_type_code | Rule |
|---|---|---|
| `in_service` / `В строю` | `IN_SERVICE` | fallback if no other interval wins |
| `vacation` / отпуск | `VACATION` or subtype | use subtype when available |
| `sick_leave` | `SICK_LEAVE` | hard-block default |
| `business_trip` | `COMMAND` | preserve location/comment |
| `training` / учеба | `STUDY` | if competition/conference unknown, map to STUDY |
| `seconded_to` | `ATTACHED` | receiving side +N |
| `seconded_from` | `DETACHED` | source side |

## 71.5. Staff unit mapping

| Legacy field | VAPS field | Rule |
|---|---|---|
| `StaffUnit.division` | `core_staffing_slots.division_id` | resolve through division map |
| `StaffUnit.position` | `core_staffing_slots.position_code` | create position if missing |
| `StaffUnit.employee` | `core_employee_staffing_assignments` | create interval assignment |
| `StaffUnit.vacancy` | `core_vacancies` | create OPEN/CLOSED vacancy based on occupancy |
| `StaffUnit.parent_id` | `core_staffing_slots.parent_slot_id` | preserve hierarchy |

## 71.6. Report migration

Historical generated files may be imported into `documents_report_requests` or `documents_attachments` as archived documents.

They must not be treated as authoritative recalculated reports unless regenerated by VAPS daily report projector.

## 71.7. Migration acceptance criteria

| ID | Criterion |
|---|---|
| MIG-AC-001 | Importing same employee file twice creates no duplicate employee. |
| MIG-AC-002 | Legacy employee id is not used as VAPS primary key. |
| MIG-AC-003 | Employee full name is synchronized from name parts. |
| MIG-AC-004 | Fired employee becomes inactive with separated_at. |
| MIG-AC-005 | Legacy staff unit occupancy creates staffing assignment history. |
| MIG-AC-006 | Legacy secondment creates ATTACHED/DETACHED compatible records. |
| MIG-AC-007 | Migration writes integration job summary with processed/failed row counts. |

---

# 72. Additional Definition of Done and Regression Tests

## 72.1. Global Definition of Done

A feature is not done unless all applicable items are true:

1. database migration exists;
2. API exists and is documented in OpenAPI;
3. permission check exists;
4. scope filter exists where data is division/user scoped;
5. audit exists for mutation/sensitive read/export/download;
6. frontend route or UI scenario exists if user-facing;
7. loading/empty/error/permission-denied states exist in UI;
8. acceptance criteria are covered by automated tests;
9. regression test exists for the main failure path;
10. feature is not silently dependent on MVP-2/Future module.

## 72.2. Notification DoD

1. Every notification must be persisted in `notifications_messages` first.
2. WebSocket may only publish an already persisted notification id/payload.
3. If WebSocket is unavailable, UI must still show unread notifications after refresh.
4. Duplicate prevention key must exist for scheduled notifications.

## 72.3. Rating-disabled DoD

Default MVP-core setting:

```text
ENABLE_RATING_CONFLICTS=false
```

Rules:

1. `ops_object_posts.min_rating` may be stored.
2. `min_rating` must not block assignment when `ENABLE_RATING_CONFLICTS=false`.
3. Rating pages may be hidden in MVP-core navigation.
4. Rating APIs may return `409 NOT_IMPLEMENTED_FOR_MVP` unless enabled.

## 72.4. Additional regression tests

### TEST-040. Notification DB source of truth

1. Disable WebSocket worker.
2. Trigger assignment approval notification.
3. Refresh frontend notifications page.

Expected:

- notification exists in DB;
- unread count is correct;
- no WebSocket dependency for data correctness.

### TEST-041. Legacy auth compatibility disabled

1. Set `ENABLE_LEGACY_PERSONNEL_RECORDS_AUTH=false`.
2. Send legacy JWT.

Expected: `401 TOKEN_INVALID`.

### TEST-042. Legacy auth compatibility enabled

1. Set `ENABLE_LEGACY_PERSONNEL_RECORDS_AUTH=true`.
2. Send valid legacy JWT.

Expected:

- request authenticated;
- `request.user_id` is canonical `sub`;
- audit uses canonical `sub`.

### TEST-043. DOCX detailed cell rendering

1. Create two vacation statuses with comments.
2. Generate daily DOCX.

Expected:

- vacation cell contains count `2`;
- both short names appear;
- periods appear;
- comments/reasons appear.

### TEST-044. DOCX long cell appendix

1. Create more employees in same report column than configured cell display limit.
2. Generate DOCX.

Expected:

- cell shows `ещё +M`;
- appendix contains full employee list.

### TEST-045. Scheduled job idempotency

1. Create planned status for today.
2. Run `apply_planned_statuses` twice.

Expected:

- exactly one active status exists;
- no duplicate notification exists.

### TEST-046. Legacy migration idempotency

1. Import same Personnel Records employee/staffing file twice.

Expected:

- no duplicate employee;
- no duplicate staffing assignment interval;
- second import updates changed fields and writes job summary.

### TEST-047. MVP-2 module hidden in MVP-core

1. Set deployment stage `MVP_CORE`.
2. Open frontend navigation.

Expected:

- ratings/protected persons/full logistics/accreditation pages are hidden or disabled;
- direct API call returns `409 NOT_IMPLEMENTED_FOR_MVP` or `403 PERMISSION_DENIED` depending on configuration.

---

# 73. Final Development Verdict v7.8.1 — Superseded by v7.8.2

After this patch, the document is development-ready for staged implementation.

**Final verdict:** можно отдавать в разработку с обязательным условием, что Google Jules / Claude Code / разработчики используют sections 44–81 as the highest-priority source and follow release slicing from section 67.

Development must start with MVP-0 and MVP-1. Full event assignment and closure modules must not be implemented before the foundation, personnel status and daily expense workflows pass acceptance tests.

The remaining real integrations are explicitly outside MVP-core:

```text
Real ECP
Real Face ID
Full accreditation integration
External SMS/email/Telegram/WhatsApp
Full protected-person logistics
Advanced ratings and recommendations
```

These features may be implemented only after MVP-core stabilization or after explicit product owner scope change.



---

# 74. v7.8.2 Audit-Fix Delta — Mandatory Development Corrections

## 74.0. Purpose

This section fixes the remaining development-readiness risks found after strict audit of v7.8.1.

v7.8.2 does **not** rewrite the product scope. It adds mandatory implementation contracts so Google Jules / Claude Code / backend / frontend / QA do not make assumptions in the following areas:

1. final frontend stack decision;
2. concrete import/export file contracts;
3. exact DOCX daily personnel report visual contract;
4. legacy MPTT migration validation;
5. story-level backlog decomposition;
6. closed-contour deployment profile;
7. MVP feature flags and future-module blocking.

**V782-DECISION-001.** Sections 74–79 override any earlier ambiguous or optional wording about frontend stack, migration contracts, report templates and MVP feature visibility.

**V782-DECISION-002.** No developer or codegen agent may implement MVP-2/Future modules in MVP-core unless a product owner explicitly changes the scope.

**V782-DECISION-003.** A module is not development-ready if it lacks DB/API/business rules/permissions/audit/frontend state/acceptance tests/import-export impact where applicable.

---

# 75. Final Frontend Stack Decision and Compatibility Rule

## 75.1. Final MVP frontend stack

The final MVP frontend stack is:

```text
React + TypeScript + Vite + TanStack Query + React Router + Ant Design or shadcn/ui
```

**FE-STACK-001.** This stack is the default for new VAPS MVP-core development.

**FE-STACK-002.** Next.js 15 from legacy Personnel Records is allowed only as a migration/reference source, not as the default new VAPS UI stack, unless product owner explicitly decides to keep it.

**FE-STACK-003.** If legacy Next.js screens are reused, they must be adapted to the same API contracts, permission rules and UI states defined in this master document.

## 75.2. Required frontend architecture rules

```text
frontend/src/
  app/
  shared/
  entities/
  features/
  pages/
```

**FE-ARCH-001.** API clients must be generated or typed from OpenAPI where possible.

**FE-ARCH-002.** Every mutation must handle:

- 400 VALIDATION_ERROR;
- 401 AUTH_REQUIRED / TOKEN_INVALID;
- 403 PERMISSION_DENIED / USER_INACTIVE;
- 409 SOFT_CONFLICT_DETECTED / MARKS_INCOMPLETE / NOT_READY;
- 422 HARD_UNAVAILABLE_STATUS;
- 423 ASSIGNMENT_VERSION_LOCKED.

**FE-ARCH-003.** All destructive actions require confirmation modal and show audit-sensitive warning text.

**FE-ARCH-004.** Feature flags must hide MVP-2/Future navigation items in MVP-core.

## 75.3. Frontend route readiness checklist

Each MVP page must include:

1. loading state;
2. empty state;
3. error state;
4. permission denied state;
5. validation error rendering;
6. optimistic update only where rollback is safe;
7. server-driven pagination/filtering;
8. audit confirmation for destructive actions;
9. conflict resolution modal if operation can create soft conflicts;
10. readonly mode if user has view permission but no mutation permission.

---

# 76. Concrete Import / Export File Contracts

## 76.0. General rules

**IMPORT-CORE-001.** Import files may be CSV or XLSX.

**IMPORT-CORE-002.** CSV encoding must be UTF-8 with BOM accepted and UTF-8 without BOM preferred.

**IMPORT-CORE-003.** Date format must be `YYYY-MM-DD`.

**IMPORT-CORE-004.** Datetime format must be ISO-8601 with timezone, for example `2026-06-02T09:00:00+05:00`.

**IMPORT-CORE-005.** Empty cells are treated as `null`; whitespace-only cells are normalized to `null`.

**IMPORT-CORE-006.** Strict mode: any row error rolls back the whole import.

**IMPORT-CORE-007.** Partial mode: valid rows are imported, invalid rows are written to error report.

**IMPORT-CORE-008.** Every import creates `integration_jobs` record and downloadable row-level result file.

**IMPORT-CORE-009.** Every sensitive import/export writes audit.

## 76.1. `divisions.csv/xlsx`

| Column | Required | Type | Rule |
|---|---:|---|---|
| `external_id` | no | string | Legacy identifier if exists. |
| `organization_code` | yes | string | Must exist or be created by deployment seed. |
| `code` | yes | string | Unique inside organization. |
| `name` | yes | string | Non-empty. |
| `type_code` | yes | enum | `department`, `management`, `division`, `office`, `group`. |
| `parent_code` | no | string | Must reference existing/imported division code. |
| `is_active` | no | boolean | Default true. |
| `sort_order` | no | integer | Default 0. |

Idempotency key:

```text
organization_code + code
```

Acceptance criteria:

- duplicate rows with same key update existing division;
- missing parent fails row;
- cycle in parent tree fails import;
- inactive legacy divisions are imported as `is_active=false`.

## 76.2. `positions.csv/xlsx`

| Column | Required | Type | Rule |
|---|---:|---|---|
| `code` | yes | string | Primary key. |
| `name` | yes | string | Non-empty. |
| `level` | no | integer | Lower value means higher position. |
| `sort_order` | no | integer | Default 0. |
| `is_active` | no | boolean | Default true. |

Idempotency key: `code`.

## 76.3. `ranks.csv/xlsx`

| Column | Required | Type | Rule |
|---|---:|---|---|
| `code` | yes | string | Primary key. |
| `name` | yes | string | Non-empty. |
| `category` | no | string | Optional. |
| `rank_index` | no | integer | Default 0. |
| `is_active` | no | boolean | Default true. |

Idempotency key: `code`.

## 76.4. `employees.csv/xlsx`

| Column | Required | Type | Rule |
|---|---:|---|---|
| `external_id` | no | string | Legacy ID/personnel number. |
| `iin` | yes | string | 12 digits, unique. |
| `last_name` | yes | string | Non-empty. |
| `first_name` | yes | string | Non-empty. |
| `middle_name` | no | string | Optional. |
| `full_name` | no | string | If empty, build from name parts. |
| `birth_date` | no | date | `YYYY-MM-DD`. |
| `gender` | no | enum | `M`, `F`. |
| `rank_code` | yes | string | Must exist in `core_ranks`. |
| `position_code` | yes | string | Must exist in `core_positions`. |
| `division_code` | yes | string | Current division. |
| `phone` | no | string | Optional. |
| `email` | no | string | Optional. |
| `height_cm` | no | integer | 120–230. |
| `hire_date` | no | date | Optional. |
| `separated_at` | no | datetime | Optional. |
| `is_active` | no | boolean | Default true. |
| `is_attached_force` | no | boolean | Default false. |
| `data_source` | no | string | Default `LEGACY_IMPORT`. |

Idempotency priority:

1. `external_id` if present;
2. `iin`.

Business rules:

- if employee exists and `division_code` changed, create/close `core_employee_division_history` interval;
- if rank or position changed, update employee and write import summary;
- do not silently delete employees missing from file;
- whitespace-only name fields are validation errors.

## 76.5. `staffing_slots.csv/xlsx`

| Column | Required | Type | Rule |
|---|---:|---|---|
| `slot_external_id` | no | string | Legacy slot ID. |
| `division_code` | yes | string | Must exist. |
| `position_code` | yes | string | Must exist. |
| `slot_number` | no | string | Optional. |
| `parent_slot_external_id` | no | string | For staffing chain. |
| `employee_iin` | no | string | Occupant if filled. |
| `valid_from` | yes | datetime | ISO-8601. |
| `valid_to` | no | datetime | Optional. |
| `is_active` | no | boolean | Default true. |

Idempotency key:

```text
slot_external_id if present, else division_code + position_code + slot_number + valid_from
```

Acceptance criteria:

- occupied slot creates `core_employee_staffing_assignments`;
- empty active slot is counted as vacancy;
- duplicate import does not create duplicate intervals;
- parent slot reference may resolve from same file.

## 76.6. `employee_statuses.csv/xlsx`

| Column | Required | Type | Rule |
|---|---:|---|---|
| `status_external_id` | no | string | Legacy ID. |
| `employee_iin` | yes | string | Must exist. |
| `status_type_code` | yes | string | Must exist in `ops_status_types`. |
| `state_code` | yes | enum | `PLANNED`, `ACTIVE`, `COMPLETED`, `CANCELLED`. |
| `source_code` | no | string | Default `USER` or `LEGACY_IMPORT`. |
| `starts_at` | yes | datetime | ISO-8601. |
| `ends_at` | yes | datetime | Must be greater than starts_at. |
| `reason` | no | text | Optional. |
| `basis_document_path` | no | string | Optional migration reference. |
| `scope_division_code` | no | string | Required only for scoped status. |
| `report_column_code` | no | string | Override only when approved by mapping. |

Idempotency key:

```text
status_external_id if present, else employee_iin + status_type_code + starts_at + ends_at
```

Validation:

- hard status overlap is imported only if legacy mode allows historical overlap;
- active/future overlap must be reported as row warning or error based on strict mode;
- imported status must write `ops_employee_status_history` action `CREATED`.

## 76.7. `secondments.csv/xlsx`

| Column | Required | Type | Rule |
|---|---:|---|---|
| `external_id` | no | string | Legacy request ID. |
| `employee_iin` | yes | string | Must exist. |
| `from_division_code` | yes | string | Must exist. |
| `to_division_code` | yes | string | Must exist and differ from from_division. |
| `starts_at` | yes | datetime | ISO-8601. |
| `ends_at` | no | datetime | Optional. |
| `status_code` | yes | enum | `PLANNED`, `ACTIVE`, `RETURN_REQUESTED`, `COMPLETED`, `CANCELLED`. |
| `reason` | no | text | Optional. |
| `basis_document_path` | no | string | Optional. |

Idempotency key: `external_id` if present, else employee_iin + starts_at + to_division_code.

## 76.8. Export contracts

### 76.8.1. Employee export

Required columns:

```text
№, external_id, iin, full_name, rank, position, division_path, phone, is_active, separated_at
```

### 76.8.2. Status history export

Required columns:

```text
№, employee_iin, full_name, status_type, state, starts_at, ends_at, action, actor_user_id, created_at, comment
```

### 76.8.3. Daily report export

Required formats:

```text
DOCX, XLSX, PDF
```

Required metadata:

```text
report_date, generated_at, generated_by, version_number, correction_reason, organization/scope
```

### 76.8.4. Assignment export

Required columns:

```text
№, object, sector, post, employee_full_name, rank, division, assignment_role, starts_at, ends_at, senior, tasks, features, acknowledgement_status
```

Privacy exclusions:

```text
photo, rating, height_cm, private comments, medical details, sensitive incident notes
```

---

# 77. Daily Personnel DOCX Visual Template Contract

## 77.1. Page setup

**DOCX-TEMPLATE-001.** Daily personnel report DOCX must use:

```text
page size: A4
orientation: landscape
margins: 10 mm top, 10 mm bottom, 10 mm left, 10 mm right
font: Times New Roman or deployment-approved official font
base font size: 9 pt
header font size: 11–12 pt
table font size: 8–9 pt
```

## 77.2. Required header

The report page must include:

1. organization/scope name;
2. report title;
3. report date in local timezone `Asia/Qyzylorda`;
4. version number;
5. generated timestamp;
6. generated by;
7. correction reason if version is correction.

## 77.3. Required table columns

Minimum required columns:

```text
№
Подразделение
Штат
Список
Вакансии
В строю
Больничный
Отпуск
Командировка
Учёба/мероприятия
Откомандирован
Прикомандирован +N
Прикомандированные силы +N
Перед дежурством
На дежурстве
После дежурства
Иное
Примечание
```

**DOCX-TEMPLATE-002.** Column labels may be deployment-localized, but the internal `report_column_code` mapping must remain stable.

## 77.4. Cell content rules

Each non-total status cell must contain:

```text
count
short employee list
period/date fragment when applicable
short reason/comment when applicable
```

Example:

```text
2
Иванов И.И. 01.06–05.06 отпуск
Петров П.П. 02.06 больн.
```

If the employee list exceeds cell limit:

```text
3
Иванов И.И.; Петров П.П.; ещё +1
```

Full details must be placed in appendix.

## 77.5. Appendix rules

Appendix must be generated when any cell is truncated.

Appendix columns:

```text
№, Подразделение, Колонка отчёта, Сотрудник, ИИН masked, Звание, Должность, Период, Причина/комментарий
```

IIN masking:

```text
****** + last 4 digits
```

## 77.6. Period export rules

For period DOCX export:

- each date must start on a new page;
- page header must include exact date;
- period summary table may be added at the end;
- failed date generation must not silently skip the date.

## 77.7. DOCX acceptance tests

### DOCX-AC-001. Landscape page

Generated DOCX section orientation is landscape.

### DOCX-AC-002. Required columns

All required report columns exist and map to `report_column_code`.

### DOCX-AC-003. Cell details

A cell with two employees contains count, names, period and reason.

### DOCX-AC-004. Appendix truncation

A truncated cell shows `ещё +N`, and appendix contains full list.

### DOCX-AC-005. Privacy

DOCX does not expose full IIN, photo, rating, health diagnosis or sensitive comments.

### DOCX-AC-006. Period export

A 3-day period export produces 3 report pages plus optional summary/appendix pages.

---

# 78. Legacy MPTT Migration Validation Contract

## 78.1. Legacy source model

Legacy Personnel Records may store divisions through MPTT fields:

```text
tree_id
level
lft
rght
parent_id
```

VAPS target model stores adjacency list with recursive SQL traversal:

```text
core_divisions.parent_id
core_divisions.type_code
```

## 78.2. Migration mapping

| Legacy field | Target handling |
|---|---|
| `id` | `external_id` or migration reference. |
| `name` | `core_divisions.name`. |
| `code` | `core_divisions.code`. |
| `division_type` | mapped to `type_code`. |
| `parent_id` | mapped to `parent_id`. |
| `tree_id` | validation only, not required in target. |
| `level` | validation only, can be derived. |
| `lft/rght` | validation only, not stored. |
| `is_active` | `core_divisions.is_active`. |
| `archived_at` | if present, `is_active=false` and audit/migration summary. |

## 78.3. Validation rules

**MPTT-MIG-001.** Import must reject parent cycles.

**MPTT-MIG-002.** Import must verify every non-root division has parent.

**MPTT-MIG-003.** Import must verify legacy level equals derived level where legacy level is present.

**MPTT-MIG-004.** Import must preserve sibling order using `sort_order` if available; otherwise sort by name/code.

**MPTT-MIG-005.** Recursive leaf selector must return the same active leaf set as legacy MPTT descendants for sample data.

## 78.4. Migration acceptance tests

### MPTT-AC-001. Leaf equivalence

Given a legacy MPTT tree with 1000 nodes, migrated VAPS recursive selector returns the same active leaves.

### MPTT-AC-002. Cycle rejection

A file where A parent is B and B parent is A fails import.

### MPTT-AC-003. Missing parent rejection

A non-root row with unknown parent fails row or whole import depending on strict mode.

### MPTT-AC-004. Archived division

Archived legacy division is imported as inactive and excluded from active leaf report marks.

---

# 79. MVP Story Backlog for Codegen Agents

## 79.0. Story decomposition rule

**STORY-000.** Google Jules / Claude Code must implement by stories, not by large sections.

Each story must include:

1. scope;
2. files/modules to touch;
3. DB migration if needed;
4. API contract;
5. permission rule;
6. audit rule;
7. frontend route/state if applicable;
8. unit tests;
9. integration tests;
10. regression acceptance criteria.

## 79.1. MVP-0 Foundation stories

### STORY-001. Project skeleton and bounded context isolation

Implement Django project skeleton, apps, settings, AST isolation tests.

Acceptance:

- all apps exist;
- `operations.models` cannot import `core.models`;
- pytest passes isolation test.

### STORY-002. External JWT middleware

Implement external JWT validation and request identity extraction.

Acceptance:

- missing token → `401 AUTH_REQUIRED`;
- expired token → `401 TOKEN_INVALID`;
- inactive user → `403 USER_INACTIVE`;
- `request.user_id` equals JWT `sub`.

### STORY-003. RBAC seed and PermissionService

Implement roles, permissions, user roles and permission checks.

Acceptance:

- ADMIN has all permissions;
- OMD has assignment permissions;
- DIVISION_OPERATOR can update daily marks;
- unauthorized mutation returns 403.

## 79.2. MVP-1 Personnel and Daily Expense stories

### STORY-010. Core divisions and recursive leaf selector

Implement organization/division schema and leaf descendants API.

Acceptance:

- one SQL recursive query returns active leaves;
- inactive divisions excluded.

### STORY-011. Employees, positions, ranks and histories

Implement employee, rank, position, division history.

Acceptance:

- employee creation creates current division history;
- division change closes old interval and opens new interval.

### STORY-012. Staffing slots and vacancies

Implement staffing slots, employee staffing assignment and vacancy calculation.

Acceptance:

- empty active slot counts as vacancy;
- occupied slot counts as filled;
- historical date returns historical staffing state.

### STORY-013. Employee statuses and history

Implement status create/list/terminate/cancel with status history.

Acceptance:

- planned status can be cancelled;
- active status can be terminated;
- every change writes status history and audit.

### STORY-014. Bulk status update UI/API

Implement division operator bulk status update.

Acceptance:

- operator can update scoped employees;
- invalid rows show row-level validation;
- successful bulk operation writes audit summary.

### STORY-015. Daily update marks

Implement daily marks for leaf divisions.

Acceptance:

- first mark returns 201;
- repeated mark returns 200 and updates timestamp;
- mark outside scope returns 403.

### STORY-016. Daily report generator

Implement daily status resolver, staffing balance and report item aggregation.

Acceptance:

- one employee receives one final status;
- attached +N excluded from staff/list numerator;
- missing marks block FINAL.

### STORY-017. Daily DOCX/XLSX/PDF generation

Implement report document generation according to section 77.

Acceptance:

- DOCX landscape;
- required columns exist;
- appendix generated for truncated cells;
- download before ready returns 409.

## 79.3. MVP-2 Object, Duty and Event Preparation stories

### STORY-020. Objects, sectors and posts

Implement object/post CRUD and post requirement validation.

Acceptance:

- invalid requirement key fails;
- post deactivation blocked by future assignment/duty/requirement.

### STORY-021. Object passport

Implement passport CRUD, completeness and history.

Acceptance:

- missing required fields → RED;
- patch writes history and audit;
- readiness sees passport status.

### STORY-022. Checklist and reconnaissance

Implement templates, object overrides, reconnaissance flow.

Acceptance:

- required ISSUE blocks READY;
- completion decision is validated;
- checklist result appears in event readiness.

### STORY-023. Duty plans and projection

Implement duty plans, shifts and status projection.

Acceptance:

- approved shift creates DUTY and REST_AFTER_DUTY;
- duplicate approval is idempotent.

### STORY-024. Event bulletin and lifecycle guards

Implement event creation, bulletin and guarded transitions.

Acceptance:

- DRAFT → BULLETIN_CREATED only after bulletin;
- invalid transition returns 409.

### STORY-025. Need calculations

Implement need calculations and approval.

Acceptance:

- only approved need can generate resource requests;
- returned need cannot generate requests.

## 79.4. MVP-3 Assignment and Brokerage stories

### STORY-030. Resource requests and allocations

Implement brokerage requests/allocations.

Acceptance:

- request can be allocated by employee or group;
- confirm/reject writes audit;
- allocation status transitions are validated.

### STORY-031. Assignment lock service and conflict detector

Implement lock order and conflict detection.

Acceptance:

- double assignment conflict detected;
- hard unavailable returns 422;
- soft conflict returns 409 unless override reason is valid.

### STORY-032. Individual assignment

Implement create/delete assignment.

Acceptance:

- create returns 201/409/422/423 correctly;
- delete resets allocation to PROPOSED;
- audit exists.

### STORY-033. Group assignment

Implement group assignment transaction.

Acceptance:

- empty group → 422;
- hard-block one member rolls back all;
- override creates N individual assignments.

### STORY-034. Submit/return/approve workflow

Implement hash, freeze trigger, submit, return, approve.

Acceptance:

- submitted version is frozen;
- return marks conflicts resolved, not deleted;
- approve checks hash.

### STORY-035. Assignment acknowledgements

Implement acknowledgement creation and employee acknowledge/decline.

Acceptance:

- approved version creates pending acknowledgements;
- senior sees unacknowledged list.

### STORY-036. Replacement and cascade suggestions

Implement replacement after approval and suggestions.

Acceptance:

- replacement requires reason and sanctioned_by;
- suggestions never auto-assign.

## 79.5. MVP-4 Conduct, Closure and Archive stories

### STORY-040. Conduct dashboard

Implement active event dashboard.

Acceptance:

- dashboard shows active objects/posts/seniors/assignments/incidents/journal.

### STORY-041. HQ journal

Implement immutable journal.

Acceptance:

- direct update is rejected or creates correction entry;
- original remains unchanged.

### STORY-042. Incidents

Implement incident workflow.

Acceptance:

- incident can link event/object/post/employee;
- close requires final decision;
- open incident blocks event closure.

### STORY-043. Event closure report

Implement closure report and guards.

Acceptance:

- cannot close without closure report;
- no incidents requires explicit `no_incidents=true`.

### STORY-044. Archive snapshots

Implement archive snapshots on close.

Acceptance:

- object passport, final assignment, incidents, closure report and documents index snapshots exist;
- archive is read-only.

## 79.6. MVP-5 Import/Export, Notifications and Hardening stories

### STORY-050. Import framework

Implement `integration_jobs`, strict/partial modes and row-level result files.

Acceptance:

- repeated import is idempotent;
- strict mode rolls back on error;
- partial mode imports valid rows.

### STORY-051. Concrete legacy importers

Implement divisions, positions, ranks, employees, staffing slots, statuses and secondments importers.

Acceptance:

- contracts from section 76 pass;
- MPTT validation from section 78 passes.

### STORY-052. Export framework

Implement employee/status/daily report/assignment exports.

Acceptance:

- sensitive export writes audit;
- export file can be downloaded;
- privacy exclusions apply.

### STORY-053. In-app notifications

Implement notification creation/read/read-all and optional WebSocket delivery.

Acceptance:

- DB notification is source of truth;
- repeated scheduled job does not duplicate notifications;
- read-all marks all visible notifications read.

### STORY-054. Feature flags and MVP-2 blocking

Implement deployment-stage feature flags.

Acceptance:

- ratings/protected persons/full logistics/accreditation hidden in MVP-core;
- direct API returns `409 NOT_IMPLEMENTED_FOR_MVP` or 403;
- tests prove future modules cannot block MVP-core.

---

# 80. Closed-Contour Deployment Profile

## 80.1. MVP environment flags

Default MVP-core deployment must use:

```env
DEPLOYMENT_STAGE=MVP_CORE
VAPS_LOCAL_TIMEZONE=Asia/Qyzylorda
AUTO_BIND_BY_IIN=false
ENABLE_WEBSOCKET_NOTIFICATIONS=false
ENABLE_RATING_CONFLICTS=false
ENABLE_REAL_ECP=false
ENABLE_REAL_FACE_ID=false
ENABLE_REAL_ACCREDITATION=false
ENABLE_EXTERNAL_EMAIL=false
ENABLE_EXTERNAL_SMS=false
ENABLE_EXTERNAL_TELEGRAM=false
ENABLE_EXTERNAL_WHATSAPP=false
ENABLE_FULL_LOGISTICS=false
```

## 80.2. Closed-contour rules

**CLOSED-001.** MVP-core must work without internet access after deployment inside LAN.

**CLOSED-002.** No external notification gateway may be required for MVP-core acceptance.

**CLOSED-003.** All external integrations must have disabled-by-default feature flags.

**CLOSED-004.** If a future integration is disabled, UI must show it as unavailable, not broken.

**CLOSED-005.** Background jobs must not call external services unless corresponding feature flag is enabled.

---

# 81. Final Development Verdict v7.8.2

After applying v7.8.2, the master document is ready for staged implementation.

**Final verdict:** можно отдавать в разработку с обязательными условиями:

1. Codegen and developers must use sections **44–81** as highest-priority source.
2. Work must start from MVP-0 and MVP-1 stories in section 79.
3. MVP-2/Future modules must remain hidden/disabled in MVP-core.
4. Daily personnel report generation must follow the visual DOCX contract from section 77.
5. Legacy migration must follow import/export contracts from section 76 and MPTT validation from section 78.
6. Closed-contour deployment must use the environment flags from section 80.

This v7.8.2 patch resolves the remaining audit risks from v7.8.1 without changing the approved product direction.
