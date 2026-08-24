"""Охранное мероприятие (ОМ) — агрегат с 9-стадийным жизненным циклом.

bulletin → recon → demand → forces → placement → approval → acknowledgement →
conduct → closed. Контракт — клиент раздела ОМ
(PersonalRecordFront, entities/security-event/model/types.ts); мок-слой
клиента был его первой реализацией, формы и правила повторяют его дословно.

ОДНА СТРОКА — ОДИН ДОКУМЕНТ. Коллекции этапов (чек-лист, расчёт постов,
потребность, запросы сил, назначения, журнал штаба, итоги направлений) лежат
JSONB-полями, а не своими таблицами, намеренно: контракт правит их ЦЕЛИКОМ
(Update*Request заменяет массив), поперечных запросов по ним нет, а их форма —
форма контракта (camelCase), как у снимка сданного дня. Взаимное исключение
писателей держит select_for_update на строке события — все мутации сервиса
идут под замком агрегата (см. apps/ops/security_events.py).

ПРИВЯЗКА ПАСПОРТА — СНИМОК, не ссылка: публикация новой версии паспорта не
переписывает согласованную расстановку (passport_binding хранит versionId,
номер и effectiveFrom на момент привязки; перепривязка — отдельное решение
человека, в этом срезе не автоматизируется).
"""
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel
from organization_management.apps.operations.models_object import (
    OpsSecurityObject,
)

_STAGES = (
    "BULLETIN",
    "RECON",
    "DEMAND",
    "FORCES",
    "PLACEMENT",
    "APPROVAL",
    "ACKNOWLEDGEMENT",
    "CONDUCT",
    "CLOSED",
)
_APPROVAL_STATUSES = ("PENDING", "APPROVED", "RETURNED")
_KINDS = ("INTERNAL", "FOREIGN")


class OpsSecurityEvent(TimeStampedModel):
    class Stage(models.TextChoices):
        BULLETIN = "BULLETIN", "Бюллетень"
        RECON = "RECON", "Рекогносцировка"
        DEMAND = "DEMAND", "Потребность"
        FORCES = "FORCES", "Запрос сил"
        PLACEMENT = "PLACEMENT", "Расстановка"
        APPROVAL = "APPROVAL", "Согласование"
        ACKNOWLEDGEMENT = "ACKNOWLEDGEMENT", "Ознакомление"
        CONDUCT = "CONDUCT", "Проведение"
        CLOSED = "CLOSED", "Закрыто"

    class ApprovalStatus(models.TextChoices):
        PENDING = "PENDING", "Ожидает"
        APPROVED = "APPROVED", "Согласовано"
        RETURNED = "RETURNED", "Возвращено"

    class Kind(models.TextChoices):
        INTERNAL = "INTERNAL", "Внутреннее"
        FOREIGN = "FOREIGN", "С участием иностранцев"

    code = models.CharField(max_length=50, unique=True)
    title = models.CharField(max_length=500)
    # SET_NULL, не CASCADE: удаление объекта реестра не вправе стирать историю
    # мероприятий; снимок имени ниже продолжает называть объект и без ссылки.
    security_object = models.ForeignKey(
        OpsSecurityObject,
        on_delete=models.SET_NULL,
        null=True,
        related_name="security_events",
    )
    object_name = models.CharField(max_length=255)
    passport_binding = models.JSONField(null=True)
    business_date = models.DateField()
    # Дата окончания: мероприятие длится днями, и «Продолжительность» с
    # «Убытием» без неё невыводимы. null — заведённые раньше однодневные ОМ:
    # проставлять им business_date задним числом значило бы выдумать факт.
    business_date_end = models.DateField(null=True, blank=True)
    # Тип мероприятия задаёт МАРШРУТ: «с участием иностранцев» уводит запись в
    # реестр ГВО и меняет старшего (ГВО вместо наряда). Обязателен при
    # создании — но null у строк, заведённых до появления поля: назвать их
    # внутренними значило бы выдумать факт (та же логика, что у
    # business_date_end выше).
    kind = models.CharField(
        max_length=20, choices=Kind.choices, null=True, blank=True
    )
    # Время начала — необязательная деталь бюллетеня: дата известна всегда,
    # час — не всегда.
    event_time = models.TimeField(null=True, blank=True)
    # SET_NULL по той же причине, что у объекта: скрытие лица из справочника
    # не вправе стирать историю мероприятий, снимок имени продолжает называть
    # его и без ссылки.
    protected_person = models.ForeignKey(
        "operations.OpsProtectedPerson",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="security_events",
    )
    protected_person_name = models.CharField(max_length=200, blank=True)
    location = models.CharField(max_length=255, blank=True)
    # Плоская ссылка на employees.Employee без FK — идиома раздела ОМ
    # (см. models_status: контексты разделены, каскады старой структуры не
    # утаскивают факты ОМ). Подпись рядом — для экрана, как owner_name.
    chief_employee_id = models.PositiveIntegerField(null=True, blank=True)
    chief_name = models.CharField(max_length=255, blank=True)
    stage = models.CharField(max_length=20, choices=Stage.choices)
    readiness_percent = models.PositiveIntegerField()
    force_need = models.PositiveIntegerField()
    conflicts_count = models.PositiveIntegerField()
    owner_name = models.CharField(max_length=255)
    brief_description = models.TextField(blank=True)
    initial_tasks = models.TextField(blank=True)
    recon_checklist = models.JSONField()
    recon_sector_posts = models.JSONField()
    demand_rows = models.JSONField()
    demand_approved = models.BooleanField()
    force_requests = models.JSONField()
    placement_assignments = models.JSONField()
    approval_status = models.CharField(
        max_length=20, choices=ApprovalStatus.choices
    )
    approval_comment = models.TextField(blank=True)
    # Маршрут согласования из прототипа: список согласующих по порядку со
    # своим решением у каждого. Отдельной таблицей не заводится сознательно —
    # маршрут живёт и меняется ВМЕСТЕ с мероприятием, отдельной жизни у строки
    # согласующего нет, а остальные списки карточки (посты, потребность,
    # журнал) хранятся тем же способом.
    approval_route = models.JSONField(default=list, blank=True)
    journal_entries = models.JSONField()
    closure_direction_summaries = models.JSONField()
    closed_at = models.DateTimeField(null=True)

    class Meta:
        db_table = "ops_security_events"
        verbose_name = "Охранное мероприятие"
        verbose_name_plural = "Охранные мероприятия"
        # Реестр читается свежими сверху (мок сортирует по createdAt убыв.);
        # ключ — тай-брейкер против нестабильной выборки.
        ordering = ["-created_at", "-id"]
        constraints = [
            # Choice-поля без дефолта: пустую строку останавливает база, не
            # форма (мерка chk_ops_security_object_state).
            models.CheckConstraint(
                condition=models.Q(stage__in=_STAGES),
                name="chk_ops_security_event_stage",
            ),
            models.CheckConstraint(
                condition=models.Q(approval_status__in=_APPROVAL_STATUSES),
                name="chk_ops_security_event_approval",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    readiness_percent__gte=0, readiness_percent__lte=100
                ),
                name="chk_ops_security_event_readiness_range",
            ),
            models.CheckConstraint(
                condition=models.Q(code__regex=r"\S"),
                name="chk_ops_security_event_code",
            ),
            models.CheckConstraint(
                condition=models.Q(title__regex=r"\S"),
                name="chk_ops_security_event_title",
            ),
            # NULL разрешён ЯВНО (легаси-строки без типа), пустая строка — нет:
            # без второй ветки `kind__in` пропускал бы "" мимо формы.
            models.CheckConstraint(
                condition=(
                    models.Q(kind__in=_KINDS) | models.Q(kind__isnull=True)
                ),
                name="chk_ops_security_event_kind",
            ),
        ]

    def __str__(self):
        return f"{self.code} — {self.title}"


class OpsSecurityEventTransition(TimeStampedModel):
    """Журнал переходов стадий ОМ — append-only (§22.14).

    Воронка аналитики строится ТОЛЬКО по этим событиям, а не по текущему
    массиву карточек: карточка знает лишь «где ОМ сейчас», журнал — «как оно
    туда шло». `from_stage` NULL — заведение мероприятия (вход в BULLETIN).
    `kind` RETURN — движение назад (возврат с согласования): различие нужно
    воронке, чтобы возвраты не выглядели прогрессом.
    """

    event = models.ForeignKey(
        OpsSecurityEvent,
        on_delete=models.CASCADE,
        related_name="transitions",
    )
    from_stage = models.CharField(max_length=20, null=True)
    to_stage = models.CharField(max_length=20)
    kind = models.CharField(max_length=10)
    occurred_at = models.DateTimeField()

    class Meta:
        db_table = "ops_security_event_transitions"
        verbose_name = "Переход стадии ОМ"
        verbose_name_plural = "Переходы стадий ОМ"
        ordering = ["occurred_at", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(to_stage__in=_STAGES),
                name="chk_ops_event_transition_to_stage",
            ),
            models.CheckConstraint(
                condition=models.Q(kind__in=("FORWARD", "RETURN")),
                name="chk_ops_event_transition_kind",
            ),
        ]

    def __str__(self):
        return f"{self.event_id}: {self.from_stage} → {self.to_stage}"


class OpsSecurityEventVisitObject(TimeStampedModel):
    """Объект посещения в рамках одного ОМ.

    Мероприятие — это бюллетень, у которого может быть НЕСКОЛЬКО объектов
    посещения: заказчик ведёт реестр так, что строка списка = бюллетень, а
    раскрытие строки = объекты, на которые едет охраняемое лицо. До появления
    этой таблицы объект был единственным полем ОМ (`security_object`), и
    второй объект было негде хранить.

    Отдельной таблицей, а не JSONB рядом с коллекциями этапов: у объекта
    посещения ЕСТЬ своя жизнь — он добавляется и убирается позже создания
    бюллетеня, по нему идёт рекогносцировка и расстановка, на него ссылаются
    строки расчёта постов. Это ровно тот случай, который оговорка в докстринге
    модуля («контракт правит коллекцию целиком») выносит за скобки.

    `security_object` — SET_NULL по той же причине, что у ОМ: удаление объекта
    реестра не вправе стирать историю посещений, снимок имени продолжает
    называть его и без ссылки. Привязка паспорта — снимок на дату ОМ, как у
    мероприятия.
    """

    event = models.ForeignKey(
        OpsSecurityEvent,
        on_delete=models.CASCADE,
        related_name="visit_objects",
    )
    security_object = models.ForeignKey(
        OpsSecurityObject,
        on_delete=models.SET_NULL,
        null=True,
        related_name="event_visits",
    )
    object_name = models.CharField(max_length=255)
    passport_binding = models.JSONField(null=True)
    # Охраняемое лицо у объекта СВОЁ: в одном бюллетене лицо может посещать
    # разные объекты, и на длинных мероприятиях объекты разных лиц идут одним
    # ОМ. Пусто — лицо не названо (у ОМ оно тоже необязательно).
    protected_person = models.ForeignKey(
        "operations.OpsProtectedPerson",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="event_visits",
    )
    protected_person_name = models.CharField(max_length=200, blank=True)
    # Порядок в раскрытии строки реестра: объекты идут так, как их завёл
    # человек, а не по алфавиту и не по времени вставки в базу.
    position = models.PositiveIntegerField()

    class Meta:
        db_table = "ops_security_event_visit_objects"
        verbose_name = "Объект посещения ОМ"
        verbose_name_plural = "Объекты посещения ОМ"
        ordering = ["position", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(object_name__regex=r"\S"),
                name="chk_ops_event_visit_object_name",
            ),
            # Один объект реестра не заводится в одно ОМ дважды: две одинаковые
            # строки в раскрытии — это не два посещения, а ошибка ввода.
            # NULL-ссылка (объект удалён из реестра) под ограничение не
            # попадает — такие строки уже история, а не ввод.
            models.UniqueConstraint(
                fields=["event", "security_object"],
                condition=models.Q(security_object__isnull=False),
                name="uniq_ops_event_visit_object",
            ),
        ]

    def __str__(self):
        return f"{self.event_id}: {self.object_name}"
