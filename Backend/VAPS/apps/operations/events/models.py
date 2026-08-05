"""Story 15.1: `SecurityEvent` (охранное мероприятие, «ОМ») + жизненный цикл.

Первая стори Epic 15 — фундамент, на котором строятся 15.2+ (бюллетень/
рекогносцировка/потребность/брокеридж) и Epic 16-18 (расстановка/проведение/
закрытие). Один `SecurityEvent`-объект живёт через ВСЕ эти эпики — статус-
поле этой стори покрывает полный цикл, не только Epic 15's часть.

Scope Decision (найдено при create-story): донор-спека
(`docs/PersonnelStatus/VAPS_7.8.2.md`) физически недоступна в этом worktree
(известный блайнд-спот — docs/ local-only, разные машины). Research-агент
процитировал `architecture.md:215` как источник детального 21-состояния
`ops_event_statuses` — ПРОВЕРЕНО ЛИЧНО, цитата ложная (та строка — про Vite-
стартер, не про SecurityEvent). Статус-enum ниже вместо этого синтезирован
из `epics.md:58-68`'s FR-21..FR-30 (прочитан лично, не через субагента) —
PROVISIONAL, тот же паттерн, что `seed_operations.py`'s `personnel.*`/
`document.*`-раскладка («тест проверяет механизм, не политику»). Пересверить
с донором, когда файл станет доступен.

Существующий `frontend/src/features/security-events/` (Smart Josparlau
demo-прототип, собственный докстринг признаёт «не реальная схема») — НЕ
источник истины здесь; структурное совпадение фаз (9 донор-предвиденных
этапов) — ожидаемо (тот же домен), не повод копировать буквально.

Scope (15.1): models + migration ONLY — без API/services/RBAC, буквальный
объём Story 14.1 (`Object`/`ObjectPassport`)/14.5 (`DutyPlan`).
`ops_event_levels`-справочник (`Object.importance_level_code`'s будущий
реальный FK, 14.1's Scope Decision) — НЕ эта стори, эта стори её не строит.
"""

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models

from apps.operations.models import TimeStampedModel


class SecurityEvent(TimeStampedModel):
    """Охранное мероприятие (donor `ops_security_events`, DB-OPS-0xx —
    точный номер не верифицирован, донор-спека недоступна в этом
    worktree)."""

    class StatusCode(models.TextChoices):
        DRAFT = "DRAFT", "Черновик"
        BULLETIN = "BULLETIN", "Бюллетень выпущен"
        RECON = "RECON", "Рекогносцировка"
        DEMAND = "DEMAND", "Потребность"
        BROKERAGE = "BROKERAGE", "Брокеридж"
        PLACEMENT = "PLACEMENT", "Расстановка"
        APPROVED = "APPROVED", "Утверждено"
        IN_PROGRESS = "IN_PROGRESS", "Проведение"
        CLOSED = "CLOSED", "Закрыто"
        CANCELLED = "CANCELLED", "Отменено"

    object = models.ForeignKey(
        "ops_facilities.Object",
        on_delete=models.PROTECT,
        related_name="security_events",
    )
    title = models.CharField(max_length=255)
    status_code = models.CharField(
        max_length=20, choices=StatusCode.choices, default=StatusCode.DRAFT
    )
    # ARCH-002/003: flat cross-context reference to core_employees, never an
    # FK — тот же паттерн, что `DutyShift.employee_id`. FR-21: «Старший
    # объекта» назначается на создании ОМ.
    senior_employee_id = models.UUIDField(null=True, blank=True)
    # Story 15.3c: двойной контроль перехода BULLETIN->RECON — минимальное
    # хранилище «первого подтверждения» (kто/когда), очищается на реальном
    # переходе (второе подтверждение ДРУГИМ actor'ом). ARCH-002/003: flat
    # actor-id, тот же паттерн, что `senior_employee_id`.
    recon_first_confirmed_by = models.CharField(max_length=100, blank=True)
    recon_first_confirmed_at = models.DateTimeField(null=True, blank=True)
    # Story 16.3a: prerequisite for FR-25's interval-based conflict checks
    # (double-assignment/rest/duty-overlap) — none of them are computable
    # without knowing WHEN this event happens. Nullable: retrofit onto an
    # already-shipped Epic 15 model, so existing/in-flight rows and any
    # workflow step that hasn't set them yet stay valid. The interval
    # belongs to the EVENT, not each individual PlacementAssignment
    # (confirmed with Bratan directly, not an autonomous PROVISIONAL call —
    # this is a structural gap in a closed epic, not an open numeric/
    # interpretive question). "Every assignment in one ОМ shares the same
    # planned window" is a v1 APPROXIMATION, not a verified fact (review,
    # Acceptance Auditor): a post staffed only for a sub-slot within a
    # longer event would, under this model, be checked for rest/double-
    # assignment conflicts against the FULL event window — conservative
    # (never under-flags) but can false-positive on real sub-event timing.
    # Whichever story builds the rest/double-assignment checks (16.3b+)
    # should treat this as an open question, not inherit it as settled.
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ops_security_events"
        verbose_name = "Охранное мероприятие"
        verbose_name_plural = "Охранные мероприятия"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(
                    status_code__in=[
                        "DRAFT",
                        "BULLETIN",
                        "RECON",
                        "DEMAND",
                        "BROKERAGE",
                        "PLACEMENT",
                        "APPROVED",
                        "IN_PROGRESS",
                        "CLOSED",
                        "CANCELLED",
                    ]
                ),
                name="ck_security_event_status_code_choices",
            ),
        ]

    def __str__(self):
        return f"{self.title} / {self.object.code} ({self.status_code})"

    def clean(self):
        # Nullable fields, unlike DutyShift's NOT-NULL starts_at/ends_at
        # (whose CheckConstraint(starts_at__lt=ends_at) is a real DB guard)
        # — a CHECK against a nullable pair is vacuously true whenever
        # either side is NULL, so this ordering guard can only live at the
        # full_clean() layer, same limited-scope caveat as every other
        # clean()-only guard in this codebase (Post/ChecklistOverride/
        # DutyShift/PlacementAssignment): .objects.create()/bulk_create()
        # bypass it; a future write-path service must call full_clean().
        super().clean()
        if self.starts_at and self.ends_at and self.starts_at >= self.ends_at:
            raise ValidationError({"ends_at": "starts_at должен быть раньше ends_at."})


class ReconCheckResult(models.TextChoices):
    """Story 15.3a: результат проверки пункта чек-листа/строки пересчёта
    рекогносцировки — общий для `SecurityEventChecklistItem` и
    `SecurityEventSectorPost` (FR-22)."""

    MATCHES = "MATCHES", "Соответствует"
    NEEDS_CHANGES = "NEEDS_CHANGES", "Требует изменений"


class SecurityEventChecklistItem(TimeStampedModel):
    """Story 15.3a: пункт чек-листа рекогносцировки (FR-22), event-scoped —
    разовый пропуск для КОНКРЕТНОГО `SecurityEvent`, НЕ переиспользует
    14.3's `ChecklistTemplate`/`ChecklistItem` (те — per-Object шаблон-
    каталог с overrides, структурно другая задача). Поля синтезированы из
    soft-сигнала `frontend/src/features/security-events/model/types.ts`'s
    `ReconChecklistItem` (Smart Josparlau прототип — НЕ источник истины,
    донор-спека недоступна в этом worktree)."""

    event = models.ForeignKey(
        SecurityEvent, on_delete=models.CASCADE, related_name="checklist_items"
    )
    label = models.CharField(max_length=255)
    done = models.BooleanField(default=False)
    result = models.CharField(
        max_length=20, choices=ReconCheckResult.choices, null=True, blank=True
    )
    comment = models.TextField(blank=True)

    class Meta:
        db_table = "ops_security_event_checklist_items"
        verbose_name = "Пункт чек-листа рекогносцировки"
        verbose_name_plural = "Пункты чек-листа рекогносцировки"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(result__in=["MATCHES", "NEEDS_CHANGES"])
                | models.Q(result__isnull=True),
                name="ck_security_event_checklist_item_result_choices",
            ),
        ]

    def __str__(self):
        return f"{self.label} ({self.event_id})"


class SecurityEventSectorPost(TimeStampedModel):
    """Story 15.3a: строка пересчёта постов/секторов рекогносцировки
    (FR-22), event-scoped — та же обоснование не-переиспользования 14.3,
    что `SecurityEventChecklistItem` (см. её докстринг). Поля синтезированы
    из `ReconSectorPost` (frontend soft-сигнал, не источник истины)."""

    event = models.ForeignKey(
        SecurityEvent, on_delete=models.CASCADE, related_name="sector_posts"
    )
    sector = models.CharField(max_length=255)
    post = models.CharField(max_length=255)
    task = models.CharField(max_length=255, blank=True)
    need = models.PositiveIntegerField(default=0)
    requirements = models.TextField(blank=True)
    result = models.CharField(
        max_length=20, choices=ReconCheckResult.choices, null=True, blank=True
    )
    comment = models.TextField(blank=True)

    class Meta:
        db_table = "ops_security_event_sector_posts"
        verbose_name = "Строка пересчёта постов/секторов рекогносцировки"
        verbose_name_plural = "Строки пересчёта постов/секторов"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(result__in=["MATCHES", "NEEDS_CHANGES"])
                | models.Q(result__isnull=True),
                name="ck_security_event_sector_post_result_choices",
            ),
        ]

    def __str__(self):
        return f"{self.sector}/{self.post} ({self.event_id})"


class SecurityEventStaffingDemand(TimeStampedModel):
    """Story 15.5a: строка потребности в силах (FR-23 «StaffingDemand»),
    event-scoped, тот же паттерн, что `SecurityEventSectorPost` — отдельно
    вводимая строка, НЕ производная от `SectorPost.need` (никакой формулы
    «расчёта» нигде не найдено, frontend-прототип трактует оба поля как
    независимые). Поля синтезированы из `StaffingDemandRow` (frontend
    soft-сигнал, не источник истины)."""

    event = models.ForeignKey(
        SecurityEvent, on_delete=models.CASCADE, related_name="staffing_demands"
    )
    sector = models.CharField(max_length=255)
    task = models.CharField(max_length=255, blank=True)
    shift = models.CharField(max_length=100, blank=True)
    need = models.PositiveIntegerField(default=0)
    group = models.CharField(max_length=255, blank=True)
    requirements = models.TextField(blank=True)
    comment = models.TextField(blank=True)

    class Meta:
        db_table = "ops_security_event_staffing_demands"
        verbose_name = "Строка потребности в силах"
        verbose_name_plural = "Строки потребности в силах"

    def __str__(self):
        return f"{self.sector}/{self.group} ({self.event_id})"


class Group(models.Model):
    """Story 15.6: справочник Групп (FR-39), read-only reference table.

    Литеральный образец `apps.operations.statuses.models.status_type
    .StatusType` (простая flat-справочник-модель), минус статус-
    специфичные поля (`is_hard_block` и т.п. — не применимы к Группам).
    Донор-спека не даёт полей за пределами названия «Группы» в FR-39's
    общем списке справочников — PROVISIONAL 3-поля форма.

    `SecurityEventStaffingDemand.group` НЕ переведён на FK сюда в этой
    стори (уже закрытая 15.5a-модель, свободный текст) — открытый вопрос
    для будущей стори, если понадобится реальная связность.
    """

    code = models.CharField(primary_key=True, max_length=50)
    name = models.CharField(max_length=255)
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "ops_groups"
        ordering = ["sort_order", "code"]
        verbose_name = "Группа"
        verbose_name_plural = "Группы"

    def __str__(self):
        return self.code


class GroupForceRequest(TimeStampedModel):
    """Story 15.7a: агрегированный запрос на Группу (FR-24 «запросы
    Группам»), event-scoped. Никакой backend-сущности с этим смыслом не
    существовало (личная проверка research-агента). Поля синтезированы из
    frontend-прототипа's `ForceRequest` (soft-сигнал, не источник истины):
    `types.ts:60-74` — `{group, requestedCount, allocatedCount, status,
    comment}`.

    `group` — FK на 15.6's `Group`-справочник с самого начала (новая
    модель, никакого конфликта с решением НЕ переводить уже-закрытую
    `SecurityEventStaffingDemand.group` на FK). `allocated_count`
    присутствует с дефолтом 0, но НЕ записывается этой стори — запись
    (переход в `PARTIALLY_ALLOCATED`/`ALLOCATED`) — Story 15.8's работа.

    Review (Blind Hunter): `PROTECT` на `group`, а не `SET_NULL`/CASCADE —
    та же «не исчезай молча под ссылками» логика, что `SecurityEvent
    .object`. Раз `Group` уже несёт `is_active` для мягкого вывода из
    оборота (15.6), намеренный путь ретайра referenced-Группы —
    `is_active=False`, НЕ хард-delete (тот навсегда заблокирован, пока
    существует хоть один ссылающийся `GroupForceRequest`)."""

    class Status(models.TextChoices):
        NOT_SENT = "NOT_SENT", "Не отправлен"
        SENT = "SENT", "Отправлен"
        PARTIALLY_ALLOCATED = "PARTIALLY_ALLOCATED", "Частично выделено"
        ALLOCATED = "ALLOCATED", "Выделено"

    event = models.ForeignKey(
        SecurityEvent, on_delete=models.CASCADE, related_name="force_requests"
    )
    group = models.ForeignKey(
        Group, on_delete=models.PROTECT, related_name="force_requests"
    )
    requested_count = models.PositiveIntegerField(default=0)
    allocated_count = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.NOT_SENT
    )
    comment = models.TextField(blank=True)
    # Story 15.10: FR-42 escalation marker — set once, never cleared, so a
    # repeat catch-up run skips an already-escalated row (per-row
    # idempotency, no external watermark needed for this non-daily-batch
    # use case).
    escalated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ops_group_force_requests"
        verbose_name = "Запрос на Группу"
        verbose_name_plural = "Запросы на Группы"
        constraints = [
            models.UniqueConstraint(
                fields=["event", "group"], name="uq_group_force_request_event_group"
            ),
            models.CheckConstraint(
                condition=models.Q(
                    status__in=[
                        "NOT_SENT",
                        "SENT",
                        "PARTIALLY_ALLOCATED",
                        "ALLOCATED",
                    ]
                ),
                name="ck_group_force_request_status_choices",
            ),
        ]

    def __str__(self):
        return f"{self.group_id} ({self.event_id})"


class SecurityEventDirectAssignment(TimeStampedModel):
    """Story 15.9: физнаряд — ОМД's direct employee->post assignment
    (FR-24 «физнаряд — ОМД напрямую»), bypassing the Group/broker path
    (`GroupForceRequest`, 15.7-15.8) entirely. Genuinely novel — no code
    precedent anywhere (personally verified by the research agent).

    «Система пассивна» (the story's own title) is read literally as "no
    enforcement logic": deliberately NO uniqueness constraint against the
    same `employee_id` being assigned twice — double-booking disputes are
    a human decision outside this system, not something the backend
    blocks or resolves.

    Distinct from the frontend prototype's `PlacementAssignment`
    (types.ts:76-84), which explicitly HAS a hard double-assignment rule
    — that's Epic 16's «Расстановка» (a later PLACEMENT-stage concept),
    a different lifecycle stage, not a contradiction to reconcile here.

    `employee_id` — flat UUID (ARCH-002/003), same pattern as
    `DutyShift.employee_id`/`SecurityEvent.senior_employee_id` — never an
    FK into core.Employee.
    """

    event = models.ForeignKey(
        SecurityEvent, on_delete=models.CASCADE, related_name="direct_assignments"
    )
    sector_post = models.ForeignKey(
        SecurityEventSectorPost,
        on_delete=models.CASCADE,
        related_name="direct_assignments",
    )
    employee_id = models.UUIDField()
    comment = models.TextField(blank=True)

    class Meta:
        db_table = "ops_security_event_direct_assignments"
        verbose_name = "Физнаряд (прямое назначение)"
        verbose_name_plural = "Физнаряды (прямые назначения)"

    def __str__(self):
        return f"{self.employee_id} -> {self.sector_post_id} ({self.event_id})"


class AssignmentVersion(TimeStampedModel):
    """Story 16.1 (FR-26): версия Расстановки (Placement) — черновик →
    согласование с возвратом → утверждение. Versioning follows
    `DailySubmission`'s pattern (ARCH-DATA-021/025) literally, NOT
    `duties.DutyPlan`'s mutable single-status shape: Placement is a
    submit→return→resubmit cycle over ONE event, keeping every prior
    version immutable, not a recurring monthly plan mutated in place.

    Model+migration only (this story) — the draft auto-formation (16.2),
    conflict detector (16.3), approval workflow (16.4), status projection
    (16.5), notifications (16.6), print form (16.7), and API/audit/e2e
    (16.8) are all later stories; nothing here writes to this table yet.
    """

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Черновик"
        SUBMITTED = "SUBMITTED", "Подано на согласование"
        RETURNED = "RETURNED", "Возвращено на доработку"
        APPROVED = "APPROVED", "Утверждено"

    event = models.ForeignKey(
        SecurityEvent, on_delete=models.CASCADE, related_name="assignment_versions"
    )
    status = models.CharField(max_length=20, choices=Status.choices)
    version = models.PositiveIntegerField(default=1)
    # First version is current by nature; the partial-unique below
    # guarantees at most one current per event — same "ровно одна
    # текущая" contract as DailySubmission's is_current.
    is_current = models.BooleanField(default=True)
    # Story 16.4 (FR-26): "hash-ready заглушка ЭЦП" — architecture.md
    # itself defers REAL digital signing to MVP-2 ("Честно отложены: ЭЦП
    # (OQ-1, hash-заглушка)"). No cryptographic/PKI precedent exists
    # anywhere in this codebase — this is a plain hashlib.sha256() digest
    # of the version's PlacementAssignment rows, computed once on
    # approval, an honest stub rather than a fake integration. Blank
    # until approved.
    signature_hash = models.CharField(max_length=64, blank=True)
    # Story 16.6d (FR-27): `created_by` is NOT declared here — it's already
    # inherited from `TimeStampedModel` (apps/operations/models.py,
    # ARCH-007/BR-ACCOUNT-002 flat actor-id) but had never been POPULATED
    # by any service until this story (`form_draft_placement()` below). The
    # new DRAFT `return_assignment_version()` (16.4) creates on a return is
    # system-generated — "creator" is meaningless for it, stays blank
    # ("no data = skip" at notify time, `_notify_assignment_returned()`'s
    # own docstring).
    # Story 17.3 (FR-28): версии, созданные `amend_assignment_version()`
    # (пост-утверждённое оперативное изменение) несут `is_amendment=True`
    # + обязательные `reason`/`sanction` — буквальный образец
    # `DailySubmission`'s `AMENDED`-паттерна. Версии обычного 16.x-цикла
    # (DRAFT→SUBMITTED→APPROVED) остаются `is_amendment=False`, оба поля
    # пустые — симметричный CheckConstraint ниже.
    is_amendment = models.BooleanField(default=False)
    reason = models.TextField(blank=True, default="")
    sanction = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        db_table = "ops_assignment_versions"
        verbose_name = "Версия расстановки"
        verbose_name_plural = "Версии расстановки"
        constraints = [
            # Ровно одна текущая версия на событие (DailySubmission pattern).
            models.UniqueConstraint(
                fields=["event"],
                condition=models.Q(is_current=True),
                name="unique_assignment_version_current",
            ),
            # Версии одного события различны.
            models.UniqueConstraint(
                fields=["event", "version"],
                name="unique_assignment_version_number",
            ),
            models.CheckConstraint(
                condition=models.Q(version__gte=1),
                name="ck_assignment_version_min",
            ),
            # status без дефолта → .objects.create() без него запишет "";
            # CharField.choices не валидируется на пути create() — тот же
            # урок, что chk_daily_submission_event.
            models.CheckConstraint(
                condition=models.Q(
                    status__in=["DRAFT", "SUBMITTED", "RETURNED", "APPROVED"]
                ),
                name="ck_assignment_version_status_choices",
            ),
            # Story 17.3 — симметричный образец
            # chk_daily_submission_amended_requires_reason_sanction: обе
            # стороны проверены (не только «amendment требует reason/
            # sanction», но и «не-amendment обязан быть пустым»).
            models.CheckConstraint(
                condition=(
                    models.Q(
                        is_amendment=True,
                        reason__regex=r"\S",
                        sanction__regex=r"\S",
                    )
                    | models.Q(is_amendment=False, reason="", sanction="")
                ),
                name="ck_assignment_version_amendment_requires_reason_sanction",
            ),
        ]

    def __str__(self):
        return f"{self.event_id} v{self.version} ({self.status})"


class PlacementAssignment(TimeStampedModel):
    """Story 16.1 (FR-25/26/27): построчное назначение сотрудника на пост
    внутри одной `AssignmentVersion`.

    `employee_id` — плоский UUID (ARCH-002/003), тот же паттерн, что
    `DutyShift.employee_id`/`SecurityEvent.senior_employee_id` — никогда
    FK в core.Employee. `post` — FK на `ops_facilities.Post`, PROTECT
    (тот же выбор, что `DutyShift.post`): живая версия не должна молча
    потерять свой Пост.

    `acknowledged_at`/`conflict_severity` — ПОЛЯ-ЗАГЛУШКИ, найденные через
    уже зарезервированные типы `docs/registries/ws-message-types.yaml`
    (`ACK_REQUIRED`/`ACK_MISSING_ESCALATION`, `SOFT_CONFLICT_DETECTED` vs
    `HARD_BLOCK_ATTEMPT`) — структура нужна СЕЙЧАС, чтобы 16.3/16.6 не
    добавляли миграцию за миграцией; РЕАЛЬНАЯ детекция конфликтов (16.3)
    и уведомление-об-ознакомлении (16.6) — не эта стори.

    Известный, задокументированный (15.9's ревью), НЕ решаемый здесь
    коллизионный риск: `SecurityEventDirectAssignment` (физнаряд) сегодня
    БЕЗ гарда против двойного назначения («система пассивна» —
    намеренно), а `PlacementAssignment` — концепт СТАДИИ PLACEMENT,
    структурно другой уровень цикла ОМ; hard-block (если появится) —
    предмет Story 16.3, не изобретается здесь.

    `clean()` (найдено ревью, Blind Hunter/Edge Case Hunter — тот же
    класс разрыва, что `Post.clean()`(14.2)/`ChecklistOverride.clean()`
    (14.3)/`DutyShift.clean()`(14.5): `post` и `version.event.object` —
    ДВА независимых пути к `Object`, ничто без гарда не мешает Посту из
    ОДНОГО объекта попасть в расстановку СОВСЕМ ДРУГОГО ОМ). Проверено
    живым пробником: без гарда назначение с чужим Постом создавалось
    молча. Как и у `DutyShift.clean()` — только `full_clean()`-путь, не
    `.objects.create()`/`bulk_create()`; будущий сервис (16.2+) обязан
    вызывать `full_clean()` на пути записи.
    """

    class ConflictSeverity(models.TextChoices):
        SOFT = "SOFT", "Мягкий конфликт"
        HARD = "HARD", "Жёсткий конфликт"

    version = models.ForeignKey(
        AssignmentVersion, on_delete=models.CASCADE, related_name="assignments"
    )
    employee_id = models.UUIDField()
    post = models.ForeignKey(
        "ops_facilities.Post", on_delete=models.PROTECT, related_name="placements"
    )
    # FR-27: заполняется Story 16.6's уведомление-об-ознакомлении сервисом;
    # nullable — «ещё не ознакомлен» по умолчанию.
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    # Story 16.6c (FR-27): watermark для батч-эскалации
    # (escalate_missing_acknowledgements()) — тот же приём, что
    # GroupForceRequest.escalated_at (15.10): once set, a row is never
    # re-escalated by a later batch run, even if still unacknowledged.
    ack_escalated_at = models.DateTimeField(null=True, blank=True)
    # FR-25: заполняется Story 16.3's конфликт-детектором; blank — ещё не
    # прогнан детектор ИЛИ конфликтов нет.
    conflict_severity = models.CharField(
        max_length=10, choices=ConflictSeverity.choices, blank=True
    )
    # Story 16.3b: `conflict_severity` несёт только worst-case severity, не
    # КАКОЙ конфликт сработал — `conflict_codes` (список из
    # docs/registries/error-codes.yaml's `conflict_codes`-ключей, напр.
    # `DOUBLE_ASSIGNMENT_CONFLICT`/`REST_VIOLATION_CONFLICT`) несёт детали.
    # Общее хранилище для ВСЕХ детекторов (16.3b/16.3c/16.3d) — каждый
    # добавляет свои коды в ОДИН и тот же список при полном пересчёте, не
    # создаёт параллельное поле.
    conflict_codes = models.JSONField(default=list, blank=True)
    # Story 17.4 (FR-28): допнаряд — флаг + источник снятия. Заполняются
    # ТОЛЬКО через `amend_assignment_version()` (17.3); плановые
    # назначения (form_draft_placement, 16.2) оставляют все три поля
    # дефолтными. Источник — «подразделение ИЛИ наряд» (FR-28's «/»),
    # ОБА плоские ссылки (ARCH-003): `source_division_id` на
    # `core.Division` (никогда FK — operations не импортирует core.models),
    # `source_duty_shift_id` на `duties.DutyShift` (реальная модель,
    # сиблинг-поддомен — референциальная целостность не проверяется, тот
    # же компромисс, что `photo_attachment_id`, 17.2).
    is_unplanned = models.BooleanField(default=False)
    source_division_id = models.UUIDField(null=True, blank=True)
    source_duty_shift_id = models.BigIntegerField(null=True, blank=True)

    class Meta:
        db_table = "ops_placement_assignments"
        verbose_name = "Назначение в расстановке"
        verbose_name_plural = "Назначения в расстановке"
        constraints = [
            # blank допустим (детектор ещё не прогнан) — CHECK держит
            # словарь ТОЛЬКО непустых значений (та же asymmetric-CHECK
            # форма, что chk_daily_submission_amended_requires_reason_
            # sanction — пустая строка сознательно вне словаря choices).
            models.CheckConstraint(
                condition=(
                    models.Q(conflict_severity="")
                    | models.Q(conflict_severity__in=["SOFT", "HARD"])
                ),
                name="ck_placement_assignment_conflict_severity_choices",
            ),
            # Story 17.4 — ИЛИ-форма (не И, в отличие от 17.1-17.3's
            # образцов): is_unplanned=True требует ХОТЯ БЫ ОДИН источник
            # (подразделение ИЛИ наряд, FR-28's «/»), не оба сразу.
            # is_unplanned=False требует ОБА источника пустыми.
            models.CheckConstraint(
                condition=(
                    models.Q(
                        is_unplanned=True,
                    )
                    & (
                        models.Q(source_division_id__isnull=False)
                        | models.Q(source_duty_shift_id__isnull=False)
                    )
                    | models.Q(
                        is_unplanned=False,
                        source_division_id__isnull=True,
                        source_duty_shift_id__isnull=True,
                    )
                ),
                name="ck_placement_assignment_unplanned_requires_source",
            ),
        ]

    def __str__(self):
        return f"{self.employee_id} -> {self.post_id} (v{self.version_id})"

    def clean(self):
        super().clean()
        if (
            self.post_id
            and self.version_id
            and self.post.object_id != self.version.event.object_id
        ):
            raise ValidationError(
                {
                    "post": (
                        "Пост должен принадлежать тому же объекту, что и "
                        "событие версии расстановки."
                    )
                }
            )


class JournalEntry(TimeStampedModel):
    """Story 17.1 (FR-29): журнал штаба — инструктаж/указания/инциденты в
    режиме проведения ОМ (`SecurityEvent.status_code == IN_PROGRESS`).
    Append-only (тот же принцип, что `AuditLog`) — нет UPDATE/DELETE-пути,
    только `create()` через сервис `create_journal_entry()`.

    Story 17.2 расширила `EntryType` до `INCIDENT` + добавила `post`/
    `participant_ids`/`photo_attachment_id` — РАСШИРЕНИЕ этой же таблицы
    («история ОМ» уже и есть `JournalEntry»), не новая. У `BRIEFING`/
    `DIRECTIVE` эти три поля остаются `null`/`[]`. `post` обязателен
    ТОЛЬКО для `INCIDENT` (`ck_journal_entry_incident_requires_post`);
    `participant_ids`/`photo_attachment_id` не обязательны даже для
    `INCIDENT` (не каждый инцидент называет участников поимённо/имеет
    снимок на момент подачи).
    """

    class EntryType(models.TextChoices):
        BRIEFING = "BRIEFING", "Инструктаж"
        DIRECTIVE = "DIRECTIVE", "Указание"
        INCIDENT = "INCIDENT", "Инцидент"

    event = models.ForeignKey(
        SecurityEvent, on_delete=models.CASCADE, related_name="journal_entries"
    )
    entry_type = models.CharField(max_length=20, choices=EntryType.choices)
    text = models.TextField()
    # Story 17.2 (FR-29, INCIDENT-only) — `post` обязателен только для
    # INCIDENT (CheckConstraint ниже); PROTECT — тот же выбор, что
    # PlacementAssignment.post (16.1), Пост не удаляется, пока на него
    # ссылается история.
    post = models.ForeignKey(
        "ops_facilities.Post",
        on_delete=models.PROTECT,
        related_name="incident_journal_entries",
        null=True,
        blank=True,
    )
    # Буквальный образец `PlacementAssignment.conflict_codes` (16.3) — та
    # же форма "список значений на одной строке"; НЕТ established
    # M2M/child-table паттерна для "N сотрудников на одной записи" нигде в
    # кодовой базе (research 17.2).
    participant_ids = models.JSONField(default=list, blank=True)
    # ARCH-003: плоская ссылка на `apps.documents.Attachment`, НЕ FK через
    # границу приложений (буквальный образец существующих owner-полей).
    # Референциальная целостность НЕ проверяется — тот же компромисс, что
    # у всех остальных плоских attachment_id-полей.
    photo_attachment_id = models.UUIDField(null=True, blank=True)

    class Meta:
        db_table = "ops_journal_entries"
        verbose_name = "Запись журнала штаба"
        verbose_name_plural = "Записи журнала штаба"
        ordering = ["created_at"]
        constraints = [
            # entry_type без дефолта → .objects.create() без него запишет
            # "" — тот же урок, что ck_assignment_version_status_choices.
            models.CheckConstraint(
                condition=models.Q(
                    entry_type__in=["BRIEFING", "DIRECTIVE", "INCIDENT"]
                ),
                name="ck_journal_entry_type_choices",
            ),
            # Асимметричный CHECK (образец
            # chk_daily_submission_amended_requires_reason_sanction) — post
            # обязателен ТОЛЬКО когда entry_type=INCIDENT, у BRIEFING/
            # DIRECTIVE post обязан оставаться null.
            models.CheckConstraint(
                condition=(
                    models.Q(entry_type="INCIDENT", post__isnull=False)
                    | (~models.Q(entry_type="INCIDENT") & models.Q(post__isnull=True))
                ),
                name="ck_journal_entry_incident_requires_post",
            ),
        ]

    def __str__(self):
        return f"{self.event_id} {self.entry_type} @ {self.created_at}"


class SecurityEventClosureSummary(TimeStampedModel):
    """Story 18.1 (FR-30): итог по одному направлению при закрытии ОМ.
    Направление = `SecurityEventSectorPost.sector` (свободный текст, не
    FK/enum — тот же тип, что там) — `close_security_event()` проверяет
    покрытие ВСЕХ дистинкт-секторов на сервисном уровне, не через DB-FK
    (секторы — CharField-строки, введённые вручную на 15.3a, нет
    справочника для FK-ссылки на них).

    `unique_together (event, sector)` — повторная запись по тому же
    направлению это upsert (повторное закрытие того же сектора
    переписывает итог), не дубликат-строка."""

    event = models.ForeignKey(
        SecurityEvent, on_delete=models.CASCADE, related_name="closure_summaries"
    )
    sector = models.CharField(max_length=255)
    summary = models.TextField()

    class Meta:
        db_table = "ops_security_event_closure_summaries"
        verbose_name = "Итог направления при закрытии"
        verbose_name_plural = "Итоги направлений при закрытии"
        constraints = [
            models.UniqueConstraint(
                fields=["event", "sector"],
                name="uq_security_event_closure_summary_event_sector",
            ),
        ]

    def __str__(self):
        return f"{self.sector} ({self.event_id})"


class PlacementAssignmentActual(TimeStampedModel):
    """Story 18.3 (FR-43): «опрос по итогам» — фактическое время ОДНОГО
    назначения на посту, записанное ПОСЛЕ закрытия события. Design-
    решение (нет donor-спеки/UX-макета для «опроса»): одна фактическая
    запись на `PlacementAssignment` (`OneToOne`), не анкета/список
    вопросов — «опрос» здесь означает «сбор факта времени», основа для
    Налёта часов (18.4), не построена этой стори.

    `recorded_by` — плоская actor-строка (ARCH-002/003), тот же паттерн,
    что `AssignmentVersion.created_by`."""

    assignment = models.OneToOneField(
        PlacementAssignment, on_delete=models.CASCADE, related_name="actual_time"
    )
    actual_start_at = models.DateTimeField()
    actual_end_at = models.DateTimeField()
    recorded_by = models.CharField(max_length=100, blank=True)

    class Meta:
        db_table = "ops_placement_assignment_actuals"
        verbose_name = "Факт времени на посту"
        verbose_name_plural = "Факты времени на постах"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(actual_start_at__lt=models.F("actual_end_at")),
                name="ck_placement_assignment_actual_start_before_end",
            ),
        ]

    def __str__(self):
        return f"{self.assignment_id}: {self.actual_start_at} — {self.actual_end_at}"


class ServiceHours(TimeStampedModel):
    """Story 18.4 (FR-32): Налёт часов день/ночь, вычисленный из
    `PlacementAssignmentActual` (18.3). `OneToOne` — тот же паттерн, что
    18.3's собственный `OneToOne` на `PlacementAssignment`.

    PROVISIONAL (нет donor-справочника коэффициентов — тот принадлежит
    Epic 19): ночь = 22:00–06:00 местного времени
    (`settings.VAPS_LOCAL_TIMEZONE`), стандартная трудовая норма.
    Подтвердить с Bratan, если Epic 19's справочник определит другую
    границу.

    `is_overloaded`/`overload_minutes` (Story 18.5, FR-32's «превышение
    лимита Поста» half): per-instance сравнение `(day_hours+night_hours)*60`
    с `Post.max_service_minutes` (14.2) через `actual.assignment.post`.
    Отдельная явная функция (`flag_post_overload()`), НЕ вычисляется
    автоматически внутри `compute_service_hours()` — тот же принцип
    разделения, что 18.1/18.2 (закрытие ≠ архив). Агрегатный >3-дневный
    перегрузка-детектор (FR-32's другая половина) — Story 19.2, не это
    поле."""

    actual = models.OneToOneField(
        PlacementAssignmentActual,
        on_delete=models.CASCADE,
        related_name="service_hours",
    )
    day_hours = models.DecimalField(max_digits=6, decimal_places=2)
    night_hours = models.DecimalField(max_digits=6, decimal_places=2)
    computed_at = models.DateTimeField()
    is_overloaded = models.BooleanField(default=False)
    overload_minutes = models.DecimalField(
        max_digits=7, decimal_places=2, default=Decimal("0.00")
    )

    class Meta:
        db_table = "ops_service_hours"
        verbose_name = "Налёт часов"
        verbose_name_plural = "Налёт часов"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(day_hours__gte=0) & models.Q(night_hours__gte=0),
                name="ck_service_hours_non_negative",
            ),
            models.CheckConstraint(
                condition=models.Q(overload_minutes__gte=0),
                name="ck_service_hours_overload_minutes_non_negative",
            ),
        ]

    def __str__(self):
        return f"{self.actual_id}: day={self.day_hours} night={self.night_hours}"
