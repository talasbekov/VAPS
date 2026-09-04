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
        # ПРОМЕЖУТОЧНАЯ МОДЕЛЬ (Plane №418, `[МД-03]`): у лица на мероприятии
        # есть свои атрибуты — время, вылет/прилёт, борт, признак старшего.
        # Таблица та же, что была у авто-связи (`db_table` совпадает), строки
        # сохранены — см. миграцию 0079.
        through="operations.OpsSecurityEventPerson",
        through_fields=("event", "person"),
    )
    # ЛОКАЦИЯ СТРУКТУРОЙ (Plane №418, `[МД-02]`): страна → город → адрес.
    # Строка `location` ОСТАЁТСЯ и читается всеми, кто читал её вчера
    # (реестр, бюллетень, заявки, сборы): сервер собирает её из структуры при
    # каждой правке (`compose_location`), а у строк, заведённых раньше,
    # `address` бэкфиллен из неё. SET_NULL: скрытие города из справочника не
    # вправе стирать историю мероприятий — подпись живёт в `location`.
    country = models.ForeignKey(
        "operations.OpsCountry", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="+",
    )
    city = models.ForeignKey(
        "operations.OpsCity", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="+",
    )
    address = models.CharField(max_length=255, blank=True)
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
    # ПЕРЕДАЧА СОБРАННЫХ НА РАССТАНОВКУ (Plane №390, `[СБС-13]`): штаб разложил
    # состав по объектам посещения (`visitObjectId` в строках `force_roster`)
    # и передал его старшим объектов. `{}` — ещё не передано. При недоборе —
    # обязательный комментарий («передать с недобором»): решение штаба
    # отдать меньше, чем просили, остаётся записанным, а не растворяется.
    force_handover = models.JSONField(default=dict, blank=True)
    placement_assignments = models.JSONField()
    approval_status = models.CharField(
        max_length=20, choices=ApprovalStatus.choices
    )
    approval_comment = models.TextField(blank=True)
    # 🔴 МАРШРУТ, ЗАМЕЧАНИЯ И СНИМОК РАССТАНОВКИ СНЯТЫ ОТСЮДА (Plane №413,
    # Ш-7 плана №385). Требование `[МД-04]`: «у объекта свой документ
    # „Расстановка сил“ с версиями». С Ш-5 (№411) согласуют ОБЪЕКТ посещения —
    # `OpsSecurityEventVisitObject.approval_route/remarks/snapshot`, и все
    # мутации пишут ТОЛЬКО туда; каждый ОМ несёт хотя бы один объект посещения
    # (миграция 0068), а завести согласование без объекта нельзя вовсе
    # (`pick_visit_object` отказывает `VISIT_OBJECT_REQUIRED`). Эти три поля
    # с Ш-5 не писал никто — снесены без бэкфилла, копия уже лежит в объекте.
    #
    # `approval_status`/`approval_comment` ОСТАЮТСЯ: это СВОДНЫЕ поля
    # (`_sync_event_approval`, Ш-6, Plane №412) — по ним считается стадия
    # мероприятия, и они не копия чужого поля, а вывод по всем объектам.
    journal_entries = models.JSONField()
    closure_direction_summaries = models.JSONField()
    # Один необязательный итоговый комментарий (`[ЗАК-04]`, Plane №448) —
    # вместо обязательных итогов по направлениям; старые итоги остаются в
    # данных закрытых ОМ и показываются в истории.
    closing_comment = models.TextField(blank=True, default="")
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

    # ── Ход работы ПО ОБЪЕКТУ (Plane №385, шаг Ш-1) ──────────────────────
    #
    # Требование спецификации `[МД-04]`: «У объекта свои этапы 1–5 и свой
    # документ „Расстановка сил“ с версиями». До этого шага чек-лист, посты,
    # потребность, расстановка, согласование, журнал и закрытие были полями
    # МЕРОПРИЯТИЯ, и экран говорил об этом прямо: «Этапы ниже ведутся по
    # мероприятию целиком». Мероприятие с двумя объектами вести было нельзя:
    # расчёт постов у него один на оба.
    #
    # 🔴 ПОЛЯ ЗАВЕДЕНЫ РЯДОМ, А НЕ ВМЕСТО. У одноимённых полей
    # `OpsSecurityEvent` около 160 читателей на сервере и 250 на клиенте
    # (замер грепом 03.09.2026); снести их одним движением значило бы
    # оставить раздел нерабочим на всё время переезда. Читатели переезжают
    # шагами Ш-2…Ш-6, поля мероприятия снимает Ш-7 (Plane №413).
    #
    # Типы повторяют одноимённые поля мероприятия НАМЕРЕННО: разойдись они —
    # и перенос значения перестал бы быть переносом. Отличие одно: здесь у
    # всех есть дефолт, потому что объект посещения заводится в реестре
    # кнопкой «+», а не через конструктор мероприятия.
    stage = models.CharField(
        max_length=20,
        choices=OpsSecurityEvent.Stage.choices,
        default=OpsSecurityEvent.Stage.BULLETIN,
    )
    # 🔴 `recon_checklist`, `recon_sector_posts`, `recon_notes`,
    # `placement_assignments`, `journal_entries` ЗАВЕДЕНЫ Ш-1 И НЕ ПРИЖИЛИСЬ
    # (Plane №413, Ш-7 плана №385): Ш-1 задумывал их как дубликат
    # одноимённых полей мероприятия, но Ш-2 выбрал ДРУГОЙ путь — ОДИН общий
    # расчёт постов мероприятия (`event.recon_sector_posts`), где строка несёт
    # `visitObjectId` (Plane №408). Разметка внутри общего массива работает
    # лучше дублирования: два ОМ-2026-11 с 32 назначениями на 5 постов не
    # завели бы второй источник расхождения. Пять полей ни разу не получили
    # писателя — грепом подтверждено при взятии этого шага — и снимаются без
    # бэкфилла: переносить в них было нечего.
    #
    # «Потребность N, назначено 0» из `[РЕК-08]`: обе цифры показывает реестр
    # в раскрытой строке (Plane №387). `force_assigned` — снимок счёта, а не
    # длина `event.placement_assignments`: назначение переживает снятие с
    # поста, и два ответа на «сколько дали» разошлись бы.
    force_need = models.PositiveIntegerField(default=0)
    force_assigned = models.PositiveIntegerField(default=0)
    approval_status = models.CharField(
        max_length=20,
        choices=OpsSecurityEvent.ApprovalStatus.choices,
        default=OpsSecurityEvent.ApprovalStatus.PENDING,
    )
    approval_route = models.JSONField(default=list, blank=True)
    approval_remarks = models.JSONField(default=list, blank=True)
    approval_snapshot = models.TextField(blank=True, default="")
    # Причина последнего возврата расстановки (Plane №411, Ш-5). Ш-1 её
    # пропустил: у мероприятия она есть (`approval_comment`), а у объекта
    # не было — и возврат по одному объекту писал бы причину на всё
    # мероприятие, то есть в карточку соседнего объекта, где никто ничего не
    # возвращал. Замечания маршрута (`approval_remarks`) её не заменяют: они
    # приходят от согласующих, а это решение того, кто вернул этап целиком.
    approval_comment = models.TextField(blank=True, default="")
    # Номер версии документа «Расстановка сил» ОБЪЕКТА (Plane №411, Ш-5).
    # Требование `[МД-04]`: «свой документ „Расстановка сил“ с версиями».
    #
    # 0 — документ ещё не уходил согласующим, и это ответ, а не «первая
    # версия»: до отправки согласовывать нечего, печатать нечего, ссылаться
    # в возврате не на что. Номер растёт ОТПРАВКОЙ на согласование
    # (`send_for_approval`), а не правкой расстановки: версия — это то, под
    # чем подписываются, а не каждое движение человека по постам.
    #
    # Здесь ТОЛЬКО НОМЕР текущей версии. Историю версий (снимки, кто и когда,
    # «Возвращено (v N)») ведёт соседняя карточка №398 [СОГ-04] — ей нужна
    # своя таблица, и заводить её тут значило бы сделать её работу наполовину.
    document_version = models.PositiveIntegerField(default=0)
    # Закрытие объекта `[ЗАК-05]` (Plane №404): момент закрытия и итоговый
    # комментарий по объекту (`[ЗАК-04]`, необязателен). Мероприятие
    # закрывается САМО, когда закрыт последний объект (`[ЗАК-12]`) —
    # `recompute_event_stage` берёт наименьшую стадию, и «Закрыто» у всех
    # даёт «Закрыто» у мероприятия.
    closed_at = models.DateTimeField(null=True, blank=True)
    closing_comment = models.TextField(blank=True, default="")

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
            # Стадия без дефолта в базе была бы пустой строкой у любой
            # вставки мимо ORM — ту же мерку держит `OpsSecurityEvent`.
            models.CheckConstraint(
                condition=models.Q(stage__in=_STAGES),
                name="chk_ops_event_visit_object_stage",
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



class OpsPlacementDocumentVersion(TimeStampedModel):
    """Версия документа «Расстановка сил» объекта посещения (`[СОГ-04]`,
    Plane №398).

    Требование спецификации: «После согласования версия замораживается:
    правка невозможна; любое изменение = новая версия → повторное
    согласование. Все версии хранятся, видны в „Истории версий“; отменённые
    помечены». До этой таблицы у объекта был только НОМЕР текущей версии
    (`document_version`, №396/№411) — сам состав, под которым подписывались,
    жил лишь строкой-подписью `approval_snapshot` и терялся при следующей
    отправке.

    ОТДЕЛЬНОЙ ТАБЛИЦЕЙ, а не JSONB у объекта: версия несёт СНИМОК расчёта и
    расстановки, её читают поимённо (история, PDF «версия N», diff в
    `[ВОЗ-06]`), она append-only и переживает любую правку объекта. Это ровно
    тот случай, который оговорка в докстринге модуля выносит за скобки.

    `number` — тот же счётчик, что `visit_object.document_version`: строка с
    наибольшим номером и есть текущая версия. `status` — жизнь ЭТОЙ версии
    (`Черновик → На согласовании → Согласовано | Возвращено`, `[СОГ-01]`);
    `superseded_at` — момент, когда версию сменила следующая: «отменённые
    помечены», но статус при этом не стирается — согласованная и позже
    заменённая версия остаётся согласованной в истории.

    Снимок — ПОСТЫ и НАЗНАЧЕНИЯ объекта в форме контракта: ровно то, что
    подписывают; подпись (`signature`) — та же строка, что `approval_snapshot`,
    чтобы «расстановка изменилась после отправки» считалось по одному правилу.
    """

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Черновик"
        SUBMITTED = "SUBMITTED", "На согласовании"
        APPROVED = "APPROVED", "Согласовано"
        RETURNED = "RETURNED", "Возвращено"

    visit_object = models.ForeignKey(
        OpsSecurityEventVisitObject,
        on_delete=models.CASCADE,
        related_name="document_versions",
    )
    number = models.PositiveIntegerField()
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.DRAFT
    )
    signature = models.TextField(blank=True, default="")
    snapshot = models.JSONField(default=dict, blank=True)
    # Подпись того, кто открыл версию (завершил расстановку / отправил
    # повторно) — снимок имени, как `owner_name` у ОМ.
    created_by = models.CharField(max_length=255, blank=True, default="")
    sent_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    superseded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ops_placement_document_versions"
        verbose_name = "Версия документа «Расстановка сил»"
        verbose_name_plural = "Версии документа «Расстановка сил»"
        ordering = ["visit_object_id", "number"]
        constraints = [
            # Номер версии у объекта уникален: две «версии 3» — это не две
            # версии, а сбой счётчика.
            models.UniqueConstraint(
                fields=["visit_object", "number"],
                name="uniq_ops_placement_document_version",
            ),
            models.CheckConstraint(
                condition=models.Q(number__gte=1),
                name="chk_ops_placement_document_version_number",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    status__in=("DRAFT", "SUBMITTED", "APPROVED", "RETURNED")
                ),
                name="chk_ops_placement_document_version_status",
            ),
        ]

    def __str__(self):
        return f"{self.visit_object_id}: v{self.number} ({self.status})"


class OpsSecurityEventPerson(models.Model):
    """Охраняемое лицо НА МЕРОПРИЯТИИ с атрибутами визита (Plane №418).

    Таблица — та же, что у прежней авто-связи `protected_persons`
    (`db_table` и имена колонок совпадают), поэтому переезд на промежуточную
    модель не тронул ни одной строки. Атрибуты необязательны: бюллетень
    заводят до того, как известен борт; «не указано» — честное состояние.
    """

    event = models.ForeignKey(
        OpsSecurityEvent, on_delete=models.CASCADE,
        db_column="opssecurityevent_id", related_name="person_links",
    )
    person = models.ForeignKey(
        "operations.OpsProtectedPerson", on_delete=models.CASCADE,
        db_column="opsprotectedperson_id", related_name="event_links",
    )
    arrival_at = models.DateTimeField(null=True, blank=True)
    departure_at = models.DateTimeField(null=True, blank=True)
    flight_arrival = models.CharField(max_length=100, blank=True)
    flight_departure = models.CharField(max_length=100, blank=True)
    # Старший делегации — тот, «за кого» мероприятие; главное лицо бланка
    # (`protected_person`) остаётся отдельным полем и им не подменяется.
    is_senior = models.BooleanField(default=False)
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        db_table = "ops_security_events_protected_persons"
        unique_together = (("event", "person"),)
        verbose_name = "Лицо на мероприятии"
        verbose_name_plural = "Лица на мероприятии"

    def __str__(self):
        return f"{self.event.code}: {self.person.name}"
