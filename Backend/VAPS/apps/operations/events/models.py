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
