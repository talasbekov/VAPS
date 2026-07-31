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
