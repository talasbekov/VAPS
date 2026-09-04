"""Заявка на сбор сил таблицами (`[МД-06]`, Plane №425, Ш-9 плана P2).

Иерархия: заявка (мероприятие/объект) → запрос департаменту → запрос
управлению → сотрудник. ВСЕ строки append-only: довыделение, новый срок,
новый ответ департамента — НОВАЯ строка с большим `sequence`, старые не
меняются. Единственное изменяемое поле — `removed_at` у строки состава:
исключение из состава — факт с датой, а не стирание факта включения.

🔴 ЧЕМ ДЕРЖИТСЯ ИЕРАРХИЯ — КЛЮЧОМ, А НЕ ВНЕШНИМ КЛЮЧОМ (Plane №672). Строка
запроса департаменту живёт СЕРИЯМИ (`sequence`), а состав и разбивка по
управлениям к серии не относятся: департамент ответил «выделяем 6» — появилась
новая строка запроса, но люди в составе те же самые. Поэтому:

* `allocation_key` (у состава) и `directorate_key` (у запроса управлению) —
  НАСТОЯЩИЙ адрес строки: по ним читается живое состояние;
* `department_request` — ПРОВЕНАНС: под какой серией запроса строка была
  записана. У текущей серии он пуст, если с её появления состав не менялся, и
  это верно, а не потеряно: задваивать людей на каждую серию значило бы
  соврать историей («приняли дважды»), и от этого стережёт пин
  `test_more_people_is_a_new_row_not_an_edit` («состав не задвоился»).

Читателю живого состояния предназначены `live_members` и
`live_unit_requests` у `OpsDepartmentRequest`: они отвечают на вопрос «кто в
составе СЕЙЧАС» с любой серии, и владелец этого правила — один.

JSON `force_requests`/`force_allocation` мероприятия ОСТАЁТСЯ источником для
экранов, пока их читают (снимается отдельным шагом после Ш-10, №426); эти
таблицы — его проекция (`ops/forces_ledger.py`) и история, которой у JSON
нет. Расширяем, не подменяем.
"""
from django.db import models

from organization_management.apps.operations.models import TimeStampedModel


class AppendOnlyError(RuntimeError):
    """Попытка изменить уже записанную строку реестра заявки."""


class _AppendOnly(TimeStampedModel):
    #: Поля, которые можно менять у существующей строки (остальное — новая строка).
    MUTABLE = frozenset()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self._state.adding:
            allowed = set(self.MUTABLE) | {"updated_at"}
            fields = kwargs.get("update_fields")
            if fields is None or not set(fields) <= allowed:
                raise AppendOnlyError(
                    f"{type(self).__name__}#{self.pk}: строка реестра заявки "
                    "не правится — довыделение или новый срок пишутся новой строкой."
                )
        return super().save(*args, **kwargs)


class OpsForceRequest(_AppendOnly):
    """Заявка мероприятия: сколько людей просит старший по расчёту."""

    event = models.ForeignKey(
        "operations.OpsSecurityEvent", on_delete=models.CASCADE,
        related_name="force_request_rows",
    )
    visit_object = models.ForeignKey(
        "operations.OpsSecurityEventVisitObject", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="force_request_rows",
    )
    #: Ключ строки JSON (`force-request-1`), чтобы проекция была идемпотентной.
    source_key = models.CharField(max_length=100)
    requested_count = models.PositiveIntegerField()
    sequence = models.PositiveIntegerField()

    class Meta:
        db_table = "ops_force_requests"
        verbose_name = "Заявка на сбор сил"
        verbose_name_plural = "Заявки на сбор сил"
        unique_together = [("event", "source_key", "sequence")]
        ordering = ["event_id", "source_key", "sequence"]


class OpsDepartmentRequest(_AppendOnly):
    """Запрос департаменту: штаб просит `requested_count` к сроку, департамент
    отвечает `allocating_count` (`[СБС-21]`). Каждое изменение — новая строка."""

    event = models.ForeignKey(
        "operations.OpsSecurityEvent", on_delete=models.CASCADE,
        related_name="department_request_rows",
    )
    force_request = models.ForeignKey(
        OpsForceRequest, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="department_requests",
    )
    department = models.ForeignKey(
        "divisions.Division", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
    )
    #: Ключ департамента из JSON — всегда; FK выше — если подразделение есть в базе.
    department_key = models.CharField(max_length=40, blank=True, default="")
    allocation_key = models.CharField(max_length=160)
    requested_count = models.PositiveIntegerField()
    allocating_count = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=30)
    due_at = models.DateTimeField(null=True, blank=True)
    sequence = models.PositiveIntegerField()

    @property
    def live_members(self):
        """Состав заявки СЕЙЧАС — с любой серии запроса (Plane №672).

        Адрес состава — `(event, allocation_key)`, а не серия: люди не
        переписываются заново оттого, что департамент назвал другое число.
        `related_name="members"` отвечает на ДРУГОЙ вопрос — «что записано под
        этой серией», и у текущей серии он законно пуст.
        """
        return OpsForceRequestMember.objects.filter(
            event_id=self.event_id,
            allocation_key=self.allocation_key,
            removed_at__isnull=True,
        )

    @property
    def live_unit_requests(self):
        """Разбивка по управлениям СЕЙЧАС: последняя серия каждого управления.

        Запрос управлению тоже живёт сериями и меняется независимо от
        департаментской строки, поэтому «последняя по департаменту» и
        «последняя по управлению» — разные вещи.
        """
        # Отбор идёт по ПРОВЕНАНСУ (`department_request__allocation_key`), а не
        # по форме ключа управления: `directorate_key` берётся из JSON как есть
        # (`id` строки управления), и совпадение с префиксом заявки —
        # случайность фикстуры, а не правило. Запасной ключ проекции строится
        # через двоеточие, а не через дефис, — совпадения по префиксу хватило
        # бы ровно до первой такой строки.
        rows = OpsUnitRequest.objects.filter(
            event_id=self.event_id,
            department_request__allocation_key=self.allocation_key,
        ).order_by("directorate_key", "-sequence")
        latest = {}
        for row in rows:
            latest.setdefault(row.directorate_key, row)
        return list(latest.values())

    class Meta:
        db_table = "ops_department_requests"
        verbose_name = "Запрос департаменту"
        verbose_name_plural = "Запросы департаментам"
        unique_together = [("event", "allocation_key", "sequence")]
        ordering = ["event_id", "allocation_key", "sequence"]


class OpsUnitRequest(_AppendOnly):
    """Запрос управлению внутри департамента (`[СБС-22]`)."""

    event = models.ForeignKey(
        "operations.OpsSecurityEvent", on_delete=models.CASCADE,
        related_name="unit_request_rows",
    )
    #: ПРОВЕНАНС, а не адрес (см. шапку модуля, Plane №672): серия запроса
    #: департаменту, под которой строка записана. Живую разбивку читают через
    #: `OpsDepartmentRequest.live_unit_requests`.
    department_request = models.ForeignKey(
        OpsDepartmentRequest, on_delete=models.CASCADE, related_name="unit_requests",
    )
    directorate = models.ForeignKey(
        "divisions.Division", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
    )
    directorate_key = models.CharField(max_length=160)
    requested_count = models.PositiveIntegerField()
    sequence = models.PositiveIntegerField()

    class Meta:
        db_table = "ops_unit_requests"
        verbose_name = "Запрос управлению"
        verbose_name_plural = "Запросы управлениям"
        unique_together = [("event", "directorate_key", "sequence")]
        ordering = ["event_id", "directorate_key", "sequence"]


class OpsForceRequestMember(_AppendOnly):
    """Сотрудник в составе по запросу департамента. Исключение — `removed_at`."""

    MUTABLE = frozenset({"removed_at"})

    event = models.ForeignKey(
        "operations.OpsSecurityEvent", on_delete=models.CASCADE,
        related_name="force_member_rows",
    )
    #: ПРОВЕНАНС, а не адрес (см. шапку модуля, Plane №672): серия запроса
    #: департаменту, под которой человек записан в состав. Живой состав читают
    #: через `OpsDepartmentRequest.live_members`.
    department_request = models.ForeignKey(
        OpsDepartmentRequest, on_delete=models.CASCADE, related_name="members",
    )
    allocation_key = models.CharField(max_length=160)
    employee = models.ForeignKey(
        "employees.Employee", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
    )
    employee_key = models.CharField(max_length=40)
    directorate = models.ForeignKey(
        "divisions.Division", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
    )
    directorate_key = models.CharField(max_length=40, blank=True, default="")
    status_id = models.PositiveIntegerField(null=True, blank=True)
    added_at = models.DateTimeField()
    removed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ops_force_request_members"
        verbose_name = "Сотрудник в составе по запросу"
        verbose_name_plural = "Состав по запросам"
        ordering = ["event_id", "allocation_key", "added_at", "pk"]
