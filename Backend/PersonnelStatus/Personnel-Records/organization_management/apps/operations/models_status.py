"""Статусы сотрудников раздела ОМ (порт EmployeeStatus из Backend/VAPS
apps/operations/statuses/models/employee_status.py).

ТАБЛИЦА РЯДОМ со старой employee_statuses (решение Bratan, 04.08.2026):
раздел ОМ пишет сюда, старые экраны продолжают жить на своей таблице; мост
словарей — StatusType.legacy_code. Перенос строк и гашение старой таблицы —
отдельный разговор.

Отличия от источника:
- employee_id — целое, плоская ссылка на employees.Employee старого проекта
  (в источнике UUID новой core-структуры). Без FK намеренно: контексты
  разделены, каскады старой структуры не должны утаскивать факты ОМ.
- cancelled_by/created_by несут str(User.pk) — как и весь RBAC переезда.

Требует PostgreSQL: ExclusionConstraint, GiST-индекс и генерируемая колонка
периода — те самые гарантии, ради которых стенд переведён на Postgres.
"""
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateRangeField, RangeOperators
from django.contrib.postgres.indexes import GistIndex
from django.db import models
from django.db.models import Case, F, Func, Q, Value, When

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.conflict_matrix import (
    HARD_STATUS_TYPE_CODES,
)
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models import TimeStampedModel


class LifecycleState(models.TextChoices):
    """Выводимое состояние ОДНОЙ строки статуса (не победитель расхода)."""

    PLANNED = "PLANNED"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


def derive_state(date_start, date_end, cancelled_at, business_date):
    """Канон выводимого состояния — единственный источник правды и для
    @property, и для аннотации queryset (состояние не хранится).

    Полуинтервал [date_start, date_end), бизнес-дата через Clock (никогда не
    now()). CANCELLED — факт жизненного цикла, ортогональный датам, поэтому
    проверяется первым.
    """
    if cancelled_at is not None:
        return LifecycleState.CANCELLED
    if business_date < date_start:
        return LifecycleState.PLANNED
    if business_date < date_end:
        return LifecycleState.ACTIVE
    return LifecycleState.COMPLETED


class OpsEmployeeStatusQuerySet(models.QuerySet):
    def with_state(self, business_date=None):
        """Аннотация state_annotation (SQL Case/When), зеркалящая derive_state.

        Названа иначе, чем @property state: property — data descriptor и
        затенил бы одноимённую аннотацию.
        """
        if business_date is None:
            business_date = Clock.today_local()
        return self.annotate(
            state_annotation=Case(
                When(
                    cancelled_at__isnull=False,
                    then=Value(LifecycleState.CANCELLED.value),
                ),
                When(
                    date_start__gt=business_date,
                    then=Value(LifecycleState.PLANNED.value),
                ),
                When(
                    date_end__gt=business_date,
                    then=Value(LifecycleState.ACTIVE.value),
                ),
                default=Value(LifecycleState.COMPLETED.value),
                output_field=models.CharField(),
            )
        )


class OpsEmployeeStatus(TimeStampedModel):
    class Source(models.TextChoices):
        USER = "USER"  # создан оператором
        KU_SYNC = "KU_SYNC"  # синк из КУ (заглушка, КУ отложен)
        OM_AUTO = "OM_AUTO"  # принадлежит проекции дежурств/мероприятий

    # Плоская ссылка на сотрудника старой структуры, без FK.
    employee_id = models.IntegerField()
    # Код типа из справочника ops_status_types (валидируется сервисом).
    status_type_code = models.CharField(max_length=50)
    # Календарные дни, полуинтервал [date_start, date_end).
    date_start = models.DateField()
    date_end = models.DateField()
    # Факты отмены пишутся один раз и не переписываются на уровне сервиса.
    # cancelled_at также даёт состояние CANCELLED и выводит строку из
    # периметра конфликтов/ограничения.
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.CharField(max_length=255, null=True, blank=True)
    cancelled_reason = models.TextField(blank=True, default="")
    # Происхождение: проекция дежурств подключается через OM_AUTO/source_ref,
    # не вскрывая сервис.
    source = models.CharField(
        max_length=20, choices=Source.choices, default=Source.USER
    )
    # Ключ владельца/идемпотентности для строк, написанных проекцией.
    source_ref = models.CharField(max_length=255, null=True, blank=True)
    comment = models.TextField(blank=True, default="")
    # Текстовое основание («Приказ №…»); файлы-вложения — отдельная тема.
    document_basis = models.CharField(max_length=255, blank=True, default="")
    period = models.GeneratedField(
        expression=Func(
            F("date_start"),
            F("date_end"),
            Value("[)"),
            function="daterange",
            output_field=DateRangeField(),
        ),
        output_field=DateRangeField(),
        db_persist=True,
    )

    objects = OpsEmployeeStatusQuerySet.as_manager()

    LifecycleState = LifecycleState

    def state_on(self, business_date):
        """Выводимое состояние на бизнес-дату (зеркало with_state)."""
        return derive_state(
            self.date_start, self.date_end, self.cancelled_at, business_date
        )

    @property
    def state(self):
        """Выводимое состояние на текущую бизнес-дату (Clock)."""
        return self.state_on(Clock.today_local())

    def assert_user_editable(self):
        """Гард: оператор правит только строки source=USER.

        Строки проекции (OM_AUTO/KU_SYNC) — 422: у проекции единственный
        писатель. Вне clean() намеренно: системное закрытие таких строк
        должно оставаться возможным.
        """
        if self.source != self.Source.USER:
            raise DomainError(
                "AUTO_STATUS_READONLY",
                422,
                detail={"source": self.source},
                message="Запись принадлежит проекции (source != USER); "
                "ручная правка запрещена.",
            )

    class Meta:
        db_table = "ops_employee_statuses"
        verbose_name = "Статус сотрудника (ОМ)"
        verbose_name_plural = "Статусы сотрудников (ОМ)"
        constraints = [
            models.CheckConstraint(
                condition=Q(date_start__lt=F("date_end")),
                name="chk_status_dates",
            ),
            # Неотменённые жёсткие статусы одного сотрудника не пересекаются;
            # IntegrityError отображается сервисом в 422
            # OVERLAPPING_HARD_STATUS по этому имени.
            ExclusionConstraint(
                name="excl_hard_status_overlap",
                expressions=[
                    (F("employee_id"), RangeOperators.EQUAL),
                    (F("period"), RangeOperators.OVERLAPS),
                ],
                condition=Q(status_type_code__in=HARD_STATUS_TYPE_CODES)
                & Q(cancelled_at__isnull=True),
            ),
        ]
        indexes = [
            # Полный (не частичный) GiST для выборок по всем типам: индекс
            # ограничения — частичный.
            GistIndex(
                fields=["employee_id", "period"],
                name="gist_status_employee_period",
            ),
        ]

    def __str__(self):
        return f"{self.employee_id}:{self.status_type_code}"


class SecondmentState(models.TextChoices):
    """Стадия рукопожатия возврата — выводится из фактов, не хранится."""

    INITIATED = "INITIATED"  # откомандирован, возврат не запрашивали
    RETURN_REQUESTED = "RETURN_REQUESTED"  # запрошен, ждёт подтверждения
    RETURNED = "RETURNED"  # подтверждён, ноги закрыты


def derive_secondment_state(return_requested_at, return_confirmed_at):
    """Канон стадии — единственный источник правды и для @property, и для
    аннотации queryset (как у выводимого состояния статуса).

    Подтверждение проверяется первым: оно старше запроса по смыслу, и порядок
    «запрос → подтверждение» держит база, а не этот вывод.
    """
    if return_confirmed_at is not None:
        return SecondmentState.RETURNED
    if return_requested_at is not None:
        return SecondmentState.RETURN_REQUESTED
    return SecondmentState.INITIATED


class SecondmentQuerySet(models.QuerySet):
    def with_state(self):
        """Аннотация state_annotation (SQL Case/When), зеркалящая канон.

        Ею же фильтруют по стадии: второй набор условий разошёлся бы с
        выводом, и ответ на фильтр перестал бы совпадать с полем в строке.
        Названа иначе, чем @property state: property — data descriptor и
        затенил бы одноимённую аннотацию.
        """
        return self.annotate(
            state_annotation=Case(
                When(
                    return_confirmed_at__isnull=False,
                    then=Value(SecondmentState.RETURNED.value),
                ),
                When(
                    return_requested_at__isnull=False,
                    then=Value(SecondmentState.RETURN_REQUESTED.value),
                ),
                default=Value(SecondmentState.INITIATED.value),
                output_field=models.CharField(),
            )
        )


#: «Мероприятие неизвестно» у строки участия (Plane №753).
#:
#: Ссылка на ОМ плоская, внешнего ключа нет, и `NULL` тут не годится:
#: ограничение уникальности берёт пару (статус, мероприятие), а в Postgres
#: два `NULL` не равны — у одного статуса накопилось бы сколько угодно строк
#: «неизвестно». Ноль же — обычное значение, и пара работает как задумано.
#:
#: 🔴 ЭТО НЕ СИРОТА. Уборка `status_cleanup` считает сиротой участие, чьё ОМ
#: не существует, — и по букве определения маркер под неё подпадает. Разница
#: в смысле: у сироты мероприятие БЫЛО и его снесли, у маркера его не было
#: никогда. Строки с маркером завело слияние снятых кодов (`status_merge`,
#: Plane №486) ровно там, где вид наряда жил в коде статуса и другого места
#: для него нет, — уборка уносила бы их вместе с историей, которую слияние и
#: спасало.
UNKNOWN_EVENT_ID = 0


class OpsStatusParticipation(TimeStampedModel):
    """Участие статуса в КОНКРЕТНОМ мероприятии (Plane №274, Ш-3).

    ЗАЧЕМ ОТДЕЛЬНАЯ ТАБЛИЦА, а не поле у статуса. Заказчик просит выбирать
    «несколько причастных ОМ», а шаг Ш-5 требует обратного вопроса — «кто
    участвует в мероприятии X»: список департамента собирается по нему. Ответ
    должен быть соединением таблиц, а не перебором JSON у каждой строки
    статуса — на 440 сотрудниках это разница между запросом и обходом.

    ВИД УЧАСТИЯ ЛЕЖИТ ЗДЕСЬ, а не у статуса, и это не избыточность: на разных
    мероприятиях один человек в один день идёт по-разному — в один физическим
    нарядом, в другой в группе досмотра. Вид у статуса целиком запретил бы это
    молча.

    Коды берутся из справочников `EVENT_PARTICIPATION_KINDS` и
    `EVENT_GROUP_ROLES` (Ш-2); валидирует их сервис — модель хранит коды, как
    и `status_type_code` у самого статуса.

    `role_code` пуст у физического наряда: ролей внутри у него нет вовсе, и
    подставлять туда роль расстановки нельзя — это другой справочник и другой
    вопрос («кем стоит на посту», а не «кем идёт в группе»).
    """

    status = models.ForeignKey(
        "operations.OpsEmployeeStatus",
        on_delete=models.CASCADE,
        related_name="participations",
    )
    # Плоская ссылка на мероприятие — как и остальные ссылки этой модели.
    event_id = models.IntegerField()
    # Код из EVENT_PARTICIPATION_KINDS: физнаряд либо группа.
    kind_code = models.CharField(max_length=100)
    # Код из EVENT_GROUP_ROLES; пусто у физнаряда.
    role_code = models.CharField(max_length=100, blank=True, default="")

    class Meta:
        db_table = "ops_status_participations"
        verbose_name = "Участие в мероприятии"
        verbose_name_plural = "Участия в мероприятиях"
        ordering = ["status_id", "event_id", "id"]
        constraints = [
            # 🔴 ОГРАНИЧЕНИЕ ПО ПАРЕ (СТРОКА СТАТУСА, МЕРОПРИЯТИЕ), А НЕ
            # (СОТРУДНИК, МЕРОПРИЯТИЕ). Здесь стоял комментарий «один человек
            # участвует в одном мероприятии ОДИН раз» — он обещал больше, чем
            # ограничение делает, и потому снят (Plane №833, найдено ревью
            # №819).
            #
            # ЧТО ОГРАНИЧЕНИЕ ДЕЙСТВИТЕЛЬНО ЗАПРЕЩАЕТ: два участия в одном ОМ
            # у ОДНОЙ строки статуса. Строк статуса у сотрудника на день бывает
            # несколько, и тогда одно мероприятие законно висит на каждой из
            # них: замерено 06.09.2026 — участие ОМ-2026-11#3264 лежало на
            # строках 2372 и 1818 одного человека.
            #
            # ПОЧЕМУ ЭТО НЕ ЗАВЫШАЕТ РАСХОД: `strength_report.resolve_status_row`
            # берёт одну строку-победителя. Дефект и не проявлялся нигде, кроме
            # ячейки «По разделу ОМ», где две строки печатались подряд (№819,
            # починено на клиенте коммитом 029a6d79).
            #
            # ⚠️ ОТКРЫТЫЙ ВОПРОС, И ОН НЕ К КОДУ (Plane №833): верно ли само
            # намерение. Если да — ограничение надо расширить до (сотрудник,
            # деловая дата, мероприятие) и разобрать уже существующие пары на
            # стенде; если нет — участие живёт у СТРОКИ статуса, и нынешняя
            # форма верна. Решение заказчика; до него здесь описано ровно то,
            # что ограничение делает, и ничего сверх.
            models.UniqueConstraint(
                fields=["status", "event_id"],
                name="uniq_status_participation_event",
            ),
        ]
        indexes = [
            # Ш-5 спрашивает «кто на мероприятии X» — это и есть его запрос.
            models.Index(fields=["event_id"], name="idx_participation_event"),
        ]

    def __str__(self):
        return f"{self.status_id} → ОМ {self.event_id} ({self.kind_code})"


class Secondment(TimeStampedModel):
    """Связь пары прикомандирования (порт Secondment из источника).

    Откомандирование заводит штатное подразделение: сотрудник получает
    DETACHED (остаётся «по списку» своего) И ATTACHED («+N» у принимающего).
    Эта запись СВЯЗЫВАЕТ обе ноги, чтобы возврат закрывал их как одно целое,
    и несёт принимающее подразделение: у строки статуса подразделения нет
    вообще, поэтому «+N» у принимающего читается отсюда.

    Отличия от источника: employee_id и оба подразделения — целые ссылки
    старой структуры (в источнике UUID новой core). Ноги — FK PROTECT: нога
    не исчезает из-под связи (как у StatusOverride). Проекция «+N» в расход
    отложена, как и в источнике.
    """

    employee_id = models.IntegerField()
    out_status = models.ForeignKey(
        OpsEmployeeStatus, on_delete=models.PROTECT, related_name="secondment_out"
    )
    in_status = models.ForeignKey(
        OpsEmployeeStatus, on_delete=models.PROTECT, related_name="secondment_in"
    )
    # Штатное подразделение на момент откомандирования: снимок, а не ссылка на
    # текущее место сотрудника — перевод по штату не должен задним числом
    # переписывать, ОТКУДА человека откомандировали.
    from_division_id = models.IntegerField()
    to_division_id = models.IntegerField()
    document_basis = models.TextField(blank=True, default="")
    # Возврат — рукопожатие из двух ФАКТОВ, а не переключаемое состояние:
    # штатное подразделение запрашивает, принимающее подтверждает, и
    # подтверждение закрывает обе ноги. Хранимого признака «вернулся» нет —
    # состояние сотрудника после возврата выводится из статусов.
    return_requested_at = models.DateTimeField(null=True, blank=True)
    return_requested_by = models.CharField(max_length=255, null=True, blank=True)
    return_confirmed_at = models.DateTimeField(null=True, blank=True)
    return_confirmed_by = models.CharField(max_length=255, null=True, blank=True)

    objects = SecondmentQuerySet.as_manager()

    State = SecondmentState

    @property
    def state(self):
        """Стадия рукопожатия (зеркало with_state)."""
        return derive_secondment_state(
            self.return_requested_at, self.return_confirmed_at
        )

    class Meta:
        db_table = "ops_status_secondments"
        verbose_name = "Прикомандирование (ОМ)"
        verbose_name_plural = "Прикомандирования (ОМ)"
        constraints = [
            # Инвариант на уровне БД, а не только сервиса: откомандирование
            # «в самого себя» бессмысленно, и второй писатель (импорт,
            # будущая проекция) не должен уметь его записать.
            models.CheckConstraint(
                condition=~Q(from_division_id=F("to_division_id")),
                name="chk_secondment_divisions_differ",
            ),
            models.CheckConstraint(
                condition=~Q(out_status=F("in_status")),
                name="chk_secondment_legs_differ",
            ),
            # Факт возврата целиком или его нет: «когда» без «кто» — след,
            # по которому уже не спросить, кто принял решение. Пустая строка
            # закрывается явно: она не NULL и проскочила бы проверку на NULL.
            models.CheckConstraint(
                condition=(
                    Q(return_requested_at__isnull=True, return_requested_by__isnull=True)
                    | (
                        Q(return_requested_at__isnull=False)
                        & Q(return_requested_by__isnull=False)
                        & ~Q(return_requested_by="")
                    )
                ),
                name="chk_secondment_request_fact_complete",
            ),
            models.CheckConstraint(
                condition=(
                    Q(return_confirmed_at__isnull=True, return_confirmed_by__isnull=True)
                    | (
                        Q(return_confirmed_at__isnull=False)
                        & Q(return_confirmed_by__isnull=False)
                        & ~Q(return_confirmed_by="")
                    )
                ),
                name="chk_secondment_confirm_fact_complete",
            ),
            # Порядок рукопожатия — тоже инвариант данных, а не только
            # сервиса: подтверждения без запроса не существует.
            models.CheckConstraint(
                condition=(
                    Q(return_confirmed_at__isnull=True)
                    | Q(return_requested_at__isnull=False)
                ),
                name="chk_secondment_confirm_after_request",
            ),
        ]
        indexes = [
            models.Index(
                fields=["employee_id", "-created_at"],
                name="idx_secondment_emp_created",
            ),
        ]

    def __str__(self):
        return f"secondment:{self.employee_id}:{self.to_division_id}"


class StatusOverride(TimeStampedModel):
    """Запись обхода мягкого конфликта (порт Override из источника).

    Пишется ТОЛЬКО когда мягкий конфликт был реально обойдён: «нет конфликта —
    нет записи». Хранит снимок обойдённых пересечений, чтобы причина решения
    осталась читаемой после изменения самих статусов.
    """

    status = models.ForeignKey(
        OpsEmployeeStatus, on_delete=models.CASCADE, related_name="overrides"
    )
    employee_id = models.IntegerField()
    status_type_code = models.CharField(max_length=50)
    reason = models.TextField()
    conflicts = models.JSONField(default=list)

    class Meta:
        db_table = "ops_status_overrides"
        verbose_name = "Обход статуса"
        verbose_name_plural = "Обходы статусов"

    def __str__(self):
        return f"override:{self.status_id}"
