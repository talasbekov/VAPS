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
    # ЛИЦ У БЮЛЛЕТЕНЯ МОЖЕТ БЫТЬ НЕСКОЛЬКО (Plane №188). Поле выше при этом
    # ОСТАЁТСЯ и означает ГЛАВНОЕ лицо — то, что печатается в колонке «ОЛ»
    # бланка бюллетеня, где место ровно одно.
    #
    # Почему рядом, а не вместо: `protected_person` читают документы
    # (бюллетень, сводные данные, графики), история ГВО по лицу и сериализатор
    # мероприятия. Снять его одним движением значило бы переписать всех
    # читателей в один заход и без страховки; правило раздела — расширять, а
    # старое снимать отдельным шагом после переезда читателей.
    #
    # Порядок в связи не хранится: у списка лиц бюллетеня старшинства нет,
    # главное названо отдельным полем, а вывод сортируется по имени — иначе
    # он менялся бы от порядка вставки и читался как значимый.
    protected_persons = models.ManyToManyField(
        "operations.OpsProtectedPerson",
        blank=True,
        related_name="security_events_as_participant",
    )
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
    # Запрос личного состава с рекогносцировки (Plane «Реестр ОМ-23»): оценка
    # СТАРШЕГО НАРЯДА по итогам осмотра, которую получает штаб 2-го
    # департамента и раскладывает по департаментам в «Сборе сил на ОМ».
    #
    # Отдельное поле, а не `force_need`: `force_need` считается СИСТЕМОЙ из
    # утверждённой потребности (`approve_demand`), то есть появляется на три
    # шага позже и означает другое — «сколько выходит по расчёту», а не
    # «сколько просит старший наряда». Держать их одним числом значило бы
    # затирать запрос расчётом и терять разницу между ними, а именно на этой
    # разнице штаб и работает.
    recon_force_request = models.PositiveIntegerField(default=0)
    # Момент отправки запроса — не булев флаг: «отправлено» это МОМЕНТ, и
    # лента штаба ведётся по нему («что пришло с моего последнего захода»).
    recon_force_requested_at = models.DateTimeField(null=True, blank=True)
    demand_rows = models.JSONField()
    demand_approved = models.BooleanField()
    force_requests = models.JSONField()
    # Раскладка потребности по ДЕПАРТАМЕНТАМ (задача заказчика Plane №73,
    # шаг «СС-1»): штаб получает с рекогносцировки число и делит его между
    # департаментами, у каждого из которых свой ответственный за выделение
    # людей.
    #
    # Отдельное поле, а не `force_requests`: там ЧИСЛА по свободным «группам»
    # утверждённой потребности (строка потребности → сколько человек нужно
    # этому направлению), и адресата у них нет вовсе. Раскладка адресована:
    # заявка принадлежит конкретному подразделению, внутри неё живут
    # оповещённые управления и выделенные люди. Свести их в одно поле значило
    # бы потерять либо направление поста, либо адрес заявки.
    #
    # JSON-полем у мероприятия, как маршрут согласования и посты
    # рекогносцировки: раскладка живёт и умирает вместе с ОМ, отдельной жизни
    # у строки заявки нет.
    force_allocation = models.JSONField(default=list, blank=True)
    # СОСТАВ мероприятия: люди, которых штаб принял и отдал ОМ (шаг «СС-5»).
    #
    # Отдельно от `placement_assignments`: «кого дали на мероприятие» и «кто на
    # каком посту» — разные факты. Человек приходит в состав до расстановки и
    # остаётся в нём, когда его снимают с поста; сложить их в одно поле значило
    # бы терять первый факт при каждом снятии.
    force_roster = models.JSONField(default=list, blank=True)
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
    # Снимок расстановки в момент отправки на согласование. Согласуют не
    # «мероприятие вообще», а КОНКРЕТНУЮ расстановку: подпись под одним
    # составом людей ничего не говорит о другом. Строка-сигнатура, а не копия
    # назначений: хранить вторую копию значило бы завести второй источник
    # правды о том, кто на каком посту (задача заказчика «ОМ-37.3», эталон —
    # баннер «Расстановка была изменена. Необходимо повторное согласование»).
    approval_snapshot = models.TextField(blank=True, default="")
    # Замечания, порождённые ВОЗВРАТАМИ согласующих. Отдельный список, а не
    # поле у согласующего: один и тот же человек может вернуть дважды по
    # разным поводам, и последняя причина затёрла бы предыдущую — а закрывают
    # их по одной.
    approval_remarks = models.JSONField(default=list, blank=True)
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
    # День посещения и примечание переехали сюда из патча сводки ГВО (ключ
    # `visits`, Plane «Реестр ОМ-35.1»): до этого «какие объекты посещаются»
    # жило в ДВУХ местах — списком объектов мероприятия и свободным текстом
    # патча, — и два списка расходились молча. Теперь источник один.
    #
    # `visit_day` пустой — посещение идёт в день мероприятия: у однодневного
    # ОМ дата уже названа в бюллетене, и дублировать её в каждой строке
    # значило бы завести второй ответ на тот же вопрос. Заполняется, когда ОМ
    # многодневное и объекты разнесены по дням.
    visit_day = models.DateField(null=True, blank=True)
    # Примечание к посещению («основной объект», «резерв», время) — подпись
    # рядом с объектом в сводке ГВО, свободный текст без разбора.
    note = models.CharField(max_length=255, blank=True)
    # Старший ОБЪЕКТА посещения (Plane «Реестр ОМ-35.2») — не то же, что
    # старший мероприятия (`chief_employee_id` у ОМ): у визита иностранного ОЛ
    # объектов несколько, и на каждом свой ответственный за расстановку и
    # доклад. Пусто — старший не назначен, и это ответ: объект может стоять в
    # маршруте до того, как под него нашли человека.
    #
    # Плоская ссылка без FK — идиома раздела (см. `chief_employee_id` ОМ и
    # `employee_id` замещающего): контексты разделены, и каскад кадровой
    # структуры не вправе стирать факт назначения. Подпись рядом — снимок,
    # чтобы увольнение не превращало журнал в набор номеров.
    chief_employee_id = models.PositiveIntegerField(null=True, blank=True)
    chief_name = models.CharField(max_length=255, blank=True)

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


class OpsVisitObjectDeputy(TimeStampedModel):
    """Замещающий старшего на объекте посещения (Plane «Реестр ОМ-24»).

    Зачем отдельная таблица, а не список в JSON у объекта посещения: строка
    несёт ПРАВО. Право обязано быть проверяемым запросом (`exists()` на
    каждую операцию расстановки), а не разбором JSON в память; у него своя
    жизнь — выдаётся, отзывается, переживает правку объекта; и оно попадает в
    журнал мутаций поимённо. JSONB такого читателя обслуживает плохо.

    `employee_id` — плоская ссылка без FK, идиома раздела ОМ (см.
    `chief_employee_id` у мероприятия): контексты разделены, и каскад кадровой
    структуры не вправе стирать факт «этому человеку выдавали право».
    Подпись рядом — снимок: увольнение не должно превращать журнал в набор
    номеров.
    """

    visit_object = models.ForeignKey(
        OpsSecurityEventVisitObject,
        on_delete=models.CASCADE,
        related_name="deputies",
    )
    employee_id = models.PositiveIntegerField()
    employee_name = models.CharField(max_length=255)
    # Право правки расстановки СВОЕГО объекта. Отдельным флагом, а не «раз
    # назначен — значит может»: эталон разводит просмотр и правку («Просмотр
    # без права правки» стоит там третьей карточкой), и замещающий без флага
    # — это наблюдатель, которого назначили официально.
    can_edit_placement = models.BooleanField(default=True)
    # Кто выдал право — подпись, как owner_name у ОМ: журнал отвечает на
    # вопрос «кто пустил», а не «под каким номером учётки».
    assigned_by = models.CharField(max_length=255)

    class Meta:
        db_table = "ops_visit_object_deputies"
        verbose_name = "Замещающий на объекте посещения"
        verbose_name_plural = "Замещающие на объектах посещения"
        ordering = ["id"]
        constraints = [
            # Одному человеку право выдаётся один раз: две строки означали бы
            # два разных ответа на вопрос «может ли он править».
            models.UniqueConstraint(
                fields=["visit_object", "employee_id"],
                name="uniq_ops_visit_object_deputy",
            ),
            models.CheckConstraint(
                condition=models.Q(employee_name__regex=r"\S"),
                name="chk_ops_visit_object_deputy_name",
            ),
        ]

    def __str__(self):
        return f"{self.visit_object_id}: {self.employee_name}"

