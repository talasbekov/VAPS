"""Селекторы раздела ОМ (порт apps/operations/selectors.py + часть
apps/core/selectors.py из Backend/VAPS).

DivisionTreeSelector работает по СТАРОЙ структуре (divisions.Division, int-pk,
MPTT): переезд «женит» новый RBAC со старым деревом. Адъяценси-обход оставлен
вместо mptt-запросов намеренно — children_map() переносится один-в-один и
переживёт будущую смену модели дерева.
"""
import operator
from functools import reduce

from django.db import models
from django.db.models import Count

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models import StatusType, UserRole
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_document import (
    OpsAttachment,
    OpsDocumentSequence,
    OpsIssuedDocument,
)
from organization_management.apps.operations.models_notification import (
    OpsNotification,
)
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
)
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
    OpsDivisionNotifyRecipient,
    OpsSubmissionControlSettings,
    OpsTomorrowBlockOverride,
)
from organization_management.apps.staff_unit.models import StaffUnit


class OpsUserRoleSelector:
    """Read-only доступ к назначениям ролей."""

    @staticmethod
    def active_for_user(user_id):
        return list(
            UserRole.objects.filter(user_id=user_id, is_active=True).select_related(
                "role_code"
            )
        )


class DivisionTreeSelector:
    """Read-only доступ к дереву подразделений (единая точка для RBAC)."""

    @staticmethod
    def children_map() -> dict:
        """{parent_id: [child_id, ...]} на всё дерево, ОДИН запрос.

        parent_id верхних узлов — None. Полный скан Division: звать один раз
        и переиспользовать, не в цикле по узлам.
        """
        children: dict = {}
        for did, parent_id in Division.objects.values_list("id", "parent_id"):
            children.setdefault(parent_id, []).append(did)
        return children

    @staticmethod
    def names_map(division_ids=None) -> dict:
        """{id: name} для подписи строк отчёта, ОДИН запрос."""
        queryset = Division.objects.all()
        if division_ids is not None:
            queryset = queryset.filter(id__in=list(division_ids))
        return dict(queryset.values_list("id", "name"))

    @staticmethod
    def all_ids() -> set:
        """Все подразделения дерева, ОДИН запрос.

        Нужен там, где безскоуповый (глобальный) грант надо развернуть в
        конкретное множество: сервисы раздела ждут множество id, а None
        уронил бы их TypeError'ом.
        """
        return set(Division.objects.values_list("id", flat=True))

    @staticmethod
    def active_ids(division_ids) -> set:
        """Какие из указанных id — ЖИВЫЕ подразделения, ОДИН запрос.

        Отвечает на «кого из этого списка ещё можно спросить»: удалённого в
        ответе нет вовсе, отключённого — тоже. Отдельного «удалён» и
        «отключён» здесь нет намеренно: спросить нельзя ни с того, ни с
        другого, и различать их значило бы обещать читателю разницу, которой
        он не может воспользоваться.
        """
        return set(
            Division.objects.filter(
                id__in=list(division_ids), is_active=True
            ).values_list("id", flat=True)
        )

    @staticmethod
    def exists(division_id) -> bool:
        """Есть ли такое подразделение. Нужен там, где отсутствие обязано
        стать 404 ДО работы: снимок несуществующего подразделения собрался бы
        пустым, и раздел записал бы «сдачу» призрака с пустым списком."""
        return Division.objects.filter(pk=division_id).exists()

    @classmethod
    def subtree_ids(cls, division_id, *, children_map=None) -> set:
        # children_map позволяет решающему НЕСКОЛЬКО поддеревьев вызову
        # переиспользовать один скан вместо повторного на каждый вызов.
        children = cls.children_map() if children_map is None else children_map
        result, stack = set(), [division_id]
        while stack:
            current = stack.pop()
            if current in result:
                continue
            result.add(current)
            stack.extend(children.get(current, []))
        return result


class StatusTypeSelector:
    """Read-only доступ к справочнику типов статусов."""

    @staticmethod
    def catalog_rows():
        """Проекция каталога для расхода, ОДИН запрос.

        Деактивированные типы включены намеренно: строка статуса, написанная
        до деактивации типа, обязана остаться разрешимой — иначе расход за
        прошлую дату упал бы на «неизвестном коде».
        """
        return list(
            StatusType.objects.values(
                "code", "priority", "report_column_code", "counts_in_staff"
            )
        )


    @staticmethod
    def names_map():
        """{код: название} справочника, ОДИН запрос.

        Деактивированные типы включены, как и в проекции каталога: копия
        сданного дня обязана назвать статус, который был написан до
        деактивации типа, — иначе она показала бы код там, где у сдачи было
        имя.
        """
        return dict(StatusType.objects.values_list("code", "name"))


class EmployeeStatusSelector:
    """Пакетное чтение статусов — единственный канал данных для агрегации."""

    @staticmethod
    def _live_overlapping(on_date, employee_ids=None):
        """Общий ПРЕДИКАТ живых фактов, накрывающих дату.

        Один на всех читателей намеренно: у расхода и у снимка сдачи разные
        проекции, но «какие строки действуют на дату» обязано быть одним
        правилом. Два похожих набора условий разошлись бы на первом же
        уточнении (например, на трактовке отменённых), и снимок перестал бы
        объяснять расход.

        period__contains едет по полному GiST-индексу, построенному ровно под
        такие выборки; отменённые строки не существуют (cancelled_at — это
        «записи нет»).
        """
        queryset = OpsEmployeeStatus.objects.filter(
            cancelled_at__isnull=True, period__contains=on_date
        )
        if employee_ids is not None:
            queryset = queryset.filter(employee_id__in=employee_ids)
        return queryset

    @classmethod
    def overlapping_on(cls, on_date, employee_ids=None):
        """Проекция для расхода: кто и с каким типом, ОДИН запрос."""
        return list(
            cls._live_overlapping(on_date, employee_ids).values(
                "employee_id", "status_type_code", "date_start", "date_end"
            )
        )

    @classmethod
    def snapshot_facts_on(cls, on_date, employee_ids=None):
        """Проекция для снимка сдачи: те же строки плюс их удостоверение.

        Снимок обязан нести id строки и её происхождение: по ним поправка
        задним числом указывает на конкретный факт, а читатель отличает
        занесённое оператором от материализованного разделом.
        """
        return list(
            cls._live_overlapping(on_date, employee_ids).values(
                "id",
                "employee_id",
                "status_type_code",
                "date_start",
                "date_end",
                "source",
            )
        )


class EmployeeSelector:
    """Денормализация сотрудника для снимка сдачи.

    Раздел не тащит в снимок объект Employee и не ссылается на него: сдача —
    заявление НА МОМЕНТ, и позднее переименование или присвоение звания не
    должны переписывать сданное. Поэтому здесь готовые строки, а не ссылки.
    """

    @staticmethod
    def denorm_for(employee_ids):
        """{employee_id: {"full_name": str, "rank": str}}, ОДИН запрос.

        Звание берётся через связь справочника; его отсутствие — пустая
        строка, а не None: снимок хранит значения, и «звания не указано»
        читается одинаково с любым потребителем JSON.
        """
        rows = Employee.objects.filter(id__in=list(employee_ids)).values(
            "id", "last_name", "first_name", "middle_name", "rank__name"
        )
        result = {}
        for row in rows:
            parts = [row["last_name"], row["first_name"], row["middle_name"]]
            result[row["id"]] = {
                "full_name": " ".join(part for part in parts if part).strip(),
                "rank": row["rank__name"] or "",
            }
        return result


class SecondmentSelector:
    """Пакетное чтение пар прикомандирования для агрегации."""

    @staticmethod
    def attached_counts_on(on_date, division_ids=None):
        """{to_division_id: N} прикомандированных на дату, ОДИН запрос.

        Считает ЖИВАЯ ЛИ НОГА ATTACHED на эту дату — не факты возврата: у
        подтверждённого возврата нога закрыта датой, и «до какого дня человек
        числится у принимающего» решает ровно её интервал. Читать вместо
        этого return_confirmed_at значило бы завести второе правило о том же
        и разойтись с ним на день возврата.

        Отменённая нога не существует для расхода — тот же предикат, которым
        её не видит выборка статусов.
        """
        queryset = Secondment.objects.filter(
            in_status__cancelled_at__isnull=True,
            in_status__period__contains=on_date,
        )
        if division_ids is not None:
            queryset = queryset.filter(to_division_id__in=list(division_ids))
        return dict(
            queryset.values("to_division_id")
            .annotate(count=Count("id"))
            .values_list("to_division_id", "count")
        )


class StaffUnitSelector:
    """Знаменатель расхода — штатные слоты старой структуры."""

    @staticmethod
    def divisions_of(employee_ids):
        """{employee_id: division_id} по штатным единицам, ОДИН запрос.

        Подразделение сотрудника в старой структуре живёт ТОЛЬКО в штатной
        единице (у Employee своего division_id нет), поэтому здесь общий
        источник области видимости и для пачки, и для одиночной правки:
        сотрудник без слота отсутствует в ответе и не попадает ни в чью
        область (fail-closed — решение принимает вызывающий).
        """
        return dict(
            StaffUnit.objects.filter(employee_id__in=list(employee_ids)).values_list(
                "employee_id", "division_id"
            )
        )

    @staticmethod
    def employee_ids_in(division_ids):
        """{employee_id} обитателей штатных единиц указанных подразделений,
        ОДИН запрос.

        Обратная сторона divisions_of: там спрашивают «в чьей области ЭТОТ
        сотрудник», здесь — «кто вообще попадает в область» для списочного
        чтения. Сотрудник без штатной единицы не принадлежит ничьей области и
        в ответ скоупованному оператору не попадает: тот же fail-closed выбор,
        что и у одиночной правки, где такая строка даёт 403.

        Свободные слоты (employee_id IS NULL) отсеиваются в запросе: None в
        множестве превратился бы в `employee_id IN (..., NULL)` — лишний
        элемент фильтра, ничего не значащий для выборки статусов.
        """
        return set(
            StaffUnit.objects.filter(
                division_id__in=list(division_ids), employee_id__isnull=False
            ).values_list("employee_id", flat=True)
        )

    @staticmethod
    def occupied_division_ids(division_ids=None):
        """{подразделения, где есть хоть один РАБОТАЮЩИЙ обитатель}, ОДИН запрос.

        Отвечает на «есть ли тут кому сдавать». Уволенный обитатель слота не
        считается — тем же правилом, что и в знаменателе расхода: иначе
        расформированное подразделение с неубранными слотами вечно значилось
        бы обязанным сдавать, и сводка уровня выше не собралась бы никогда.
        """
        queryset = StaffUnit.objects.filter(
            employee_id__isnull=False,
            employee__employment_status=Employee.EmploymentStatus.WORKING,
        )
        if division_ids is not None:
            queryset = queryset.filter(division_id__in=list(division_ids))
        return set(queryset.values_list("division_id", flat=True))

    @staticmethod
    def slots_with_working_occupants(division_ids=None):
        """([{division_id, employee_id|None}], {id уволенных в слотах}).

        Два запроса независимо от числа слотов: слоты и работающие среди их
        обитателей. Занятый уволенным слот возвращается как СВОБОДНЫЙ
        (employee_id=None) — уволенный не попадает ни в список, ни в колонки,
        а сам факт уезжает вторым значением, чтобы вызывающий сообщил о нём.
        Слот без подразделения пропускается: подразделение — ключ агрегации.
        """
        queryset = StaffUnit.objects.filter(division_id__isnull=False)
        if division_ids is not None:
            queryset = queryset.filter(division_id__in=list(division_ids))
        raw = list(queryset.values("division_id", "employee_id"))
        occupied = {row["employee_id"] for row in raw if row["employee_id"]}
        working = set(
            Employee.objects.filter(
                id__in=occupied,
                employment_status=Employee.EmploymentStatus.WORKING,
            ).values_list("id", flat=True)
        )
        dismissed = occupied - working
        slots = [
            {
                "division_id": row["division_id"],
                "employee_id": (
                    row["employee_id"] if row["employee_id"] in working else None
                ),
            }
            for row in raw
        ]
        return slots, dismissed


class DailySubmissionSelector:
    """Чтение сдач дня — единственный канал для сервиса сдачи и её маршрутов."""

    @staticmethod
    def list(*, scope=None, division_id=None, business_date=None, history=False):
        """Список сдач с ПОЛНЫМ порядком; снимок НЕ выбирается.

        scope=None — область не сужает (безскоуповый или wildcard-грант),
        иначе множество допустимых подразделений считает вьюха тем же общим
        резолвером, что и списки статусов: двум спискам, отвечающим на вопрос
        «что мне видно», расходиться незачем.

        По умолчанию отдаются ТОЛЬКО текущие версии. История доступна флагом:
        иначе спросивший «кто сдал за 4 августа» получил бы вперемешку
        вытесненные заявления и не смог бы отличить их от действующих иначе
        как вычитанием по номеру версии.

        `defer("snapshot")` обязателен: снимок весит десятки-сотни килобайт на
        строку, и страница в 50 строк вытащила бы мегабайты ради девяти полей.
        Порядок: свежий день первым, внутри дня — свежая версия, id последним
        разрывом ничьей (без него страничная выдача теряет и дублирует строки).
        """
        queryset = OpsDailySubmission.objects.all()
        if scope is not None:
            queryset = queryset.filter(division_id__in=scope)
        if division_id is not None:
            queryset = queryset.filter(division_id=division_id)
        if business_date is not None:
            queryset = queryset.filter(business_date=business_date)
        if not history:
            queryset = queryset.filter(is_current=True)
        return queryset.defer("snapshot").order_by(
            "-business_date", "division_id", "-version", "id"
        )

    @staticmethod
    def exists_for(division_id, business_date):
        """Есть ли У ЭТОГО дня ХОТЬ ОДНА версия сдачи.

        Предпроверка первичной сдачи стоит на ЛЮБОЙ версии, а не только на
        текущей (в источнике — на текущей). Первичная сдача пишет версию 1, и
        день с историей поправок она заведомо не создаст: снятая с текущих
        версия 1 никуда не девается, и вставка упёрлась бы в уникальность
        номера версии — то есть в 500 вместо внятного отказа. Ограничение БД
        остаётся подстраховкой гонки, а не способом узнавать об уже сданном
        дне через исключение.
        """
        return OpsDailySubmission.objects.filter(
            division_id=division_id, business_date=business_date
        ).exists()

    @staticmethod
    def current_for(division_id, business_date):
        """ДЕЙСТВУЮЩАЯ версия дня или None.

        Читатели сданного (светофор, расход по сдаче) спрашивают именно её, а
        не голову цепочки: голова и текущая совпадают всегда, кроме
        вырожденного «ноль текущих», и в этом случае читателю честнее
        ответить «сдачи нет», чем показать версию, которую сам раздел
        действующей не считает.
        """
        return OpsDailySubmission.objects.filter(
            division_id=division_id, business_date=business_date, is_current=True
        ).first()

    @staticmethod
    def current_for_many(division_ids, business_date):
        """{подразделение: действующая сдача} ОДНИМ запросом.

        Пакетная форма current_for для свода по дереву: поимённый вызов на
        каждый узел вернул бы число запросов, растущее с размером дерева, —
        ровно ту зависимость, от которой умер донор. Узлы без сдачи в ответе
        просто отсутствуют.
        """
        rows = OpsDailySubmission.objects.filter(
            division_id__in=list(division_ids),
            business_date=business_date,
            is_current=True,
        )
        return {row.division_id: row for row in rows}

    @staticmethod
    def previous_for(division_id, business_date):
        """Ближайшая ПРЕДЫДУЩАЯ текущая сдача (строго раньше даты) или None.

        Именно ближайшая, а не «вчерашняя» буквально: между сдачами бывают
        выходные и пропуски, и сравнение с несуществующим вчера объявляло бы
        изменением всё подряд. Едет по индексу (division_id, business_date,
        -version).
        """
        return (
            OpsDailySubmission.objects.filter(
                division_id=division_id,
                business_date__lt=business_date,
                is_current=True,
            )
            .order_by("-business_date", "-version")
            .first()
        )

    @staticmethod
    def latest_for(division_id, business_date, *, lock=False):
        """ГОЛОВА цепочки версий дня (старшая версия) или None.

        Именно старшая версия, а не текущая: «ровно одна текущая» —
        прикладной инвариант (база держит лишь «не более одной»), и в
        вырожденном состоянии «ноль текущих» поиск по is_current вернул бы
        None, то есть «день не сдан» — и поправка пошла бы писать версию 1
        поверх существующей истории.

        lock=True берёт строку под SELECT ... FOR UPDATE: две одновременные
        поправки обязаны выстроиться в очередь, иначе обе прочитают одну и ту
        же голову и запросят один номер версии.
        """
        queryset = OpsDailySubmission.objects.filter(
            division_id=division_id, business_date=business_date
        )
        if lock:
            queryset = queryset.select_for_update()
        return queryset.order_by("-version").first()

    @staticmethod
    def covering_many(employee_ids, business_dates):
        """Действующие сдачи, заявлявшие ХОТЬ ОДНОГО из сотрудников в эти дни.

        Пакетная форма `covering` для массового пути. Возвращается СДАЧА, а
        не пара (сотрудник, сдача): у дня одна поправка независимо от того,
        скольких его людей задела правка. Поштучное обнаружение выдало бы
        по строке на каждого и породило бы версии 2, 3, 4… на один акт —
        читатель истории дня увидел бы двадцать поправок там, где было одно
        массовое обновление.

        Условие принадлежности ТО ЖЕ, что у поштучного пути (containment по
        снимку), просто перечисленное через ИЛИ: два способа спросить «был
        ли человек в знаменателе» разошлись бы там же, где и всё остальное, —
        на редком случае. Запрос один; день и флаг текущей сужают выборку
        ДО проверки принадлежности, поэтому перечисление растёт вширь по
        сотрудникам, а не вглубь по сданному.
        """
        employee_ids = list(employee_ids)
        business_dates = list(business_dates)
        if not employee_ids:
            return []
        membership = reduce(
            operator.or_,
            (
                models.Q(snapshot__roster__contains=[{"employee_id": employee_id}])
                for employee_id in employee_ids
            ),
        )
        return list(
            OpsDailySubmission.objects.filter(
                membership, business_date__in=business_dates, is_current=True
            ).order_by("business_date", "division_id")
        )

    @staticmethod
    def covering(employee_id, business_dates):
        """Действующие сдачи, чей СНИМОК содержит сотрудника в эти дни.

        Обнаружение идёт по ПРИНАДЛЕЖНОСТИ СНИМКУ, а не по сегодняшнему
        подразделению сотрудника. Снимок заморозил, за кого подразделение
        отчиталось на момент сдачи; перевод по штату между сдачей и правкой
        меняет живую принадлежность — и вычисленное на момент правки
        подразделение увело бы поиск к чужому дню, оставив накрытый без
        поправки. Ровно те «две правды», ради запрета которых поправка и
        заведена.

        ОДИН запрос на все затронутые дни: containment по JSONB
        (`snapshot->'roster' @> [{"employee_id": …}]`), а не разбор снимков в
        питоне — снимок весит десятки килобайт на строку, и вытаскивать их
        все ради проверки принадлежности значило бы платить за правку одного
        статуса чтением всего сданного.

        Только ДЕЙСТВУЮЩИЕ версии: у дня без текущей сдачи нет и
        действующего расхода, который поправка приводила бы в соответствие.
        """
        return list(
            OpsDailySubmission.objects.filter(
                business_date__in=list(business_dates),
                is_current=True,
                snapshot__roster__contains=[{"employee_id": employee_id}],
            ).order_by("business_date", "division_id")
        )


class SubmissionControlSettingsSelector:
    """Чтение справочника контроля сдачи — единственный канал.

    Отступление от общей манеры селекторов раздела (никакого сужения по
    актору): это одна глобальная строка настроек, и вопрос «что мне видно» к
    ней не применим — контрольный час у всех один.

    `get_or_create`, а не `get`: строку сеет миграция, поэтому обычно тут
    чтение, но пропажа строки (перенос данных, ручная чистка) не должна
    ронять сдачу дня 500-й — раздел самолечится дефолтом. Расхождения при
    этом не возникает: дефолт один и живёт в модели.
    """

    @classmethod
    def get(cls):
        settings, _ = OpsSubmissionControlSettings.objects.get_or_create(
            singleton_key=1
        )
        return settings

    @classmethod
    def control_hour(cls):
        return cls.get().control_hour

    @classmethod
    def required_division_ids(cls):
        """Список «необходимых управлений».

        Копии здесь НЕТ намеренно: `get()` читает строку заново на каждый
        вызов, поэтому список и так принадлежит одноразовому объекту —
        обёртка `list(...)` не роняла ни одного теста (проверено красной
        пробой) и была бы вторым владельцем правила о свежести. Владелец
        один — запрос; сторожит его тест «правка видна следующему вызову»,
        и он же покраснеет у того, кто вздумает закешировать строку.
        """
        return cls.get().required_division_ids


class NotifyRecipientSelector:
    """Разрешение «подразделение → получатель» для уведомлений об отставании.

    Правило одно и в одном месте: СВОЙ получатель подразделения побеждает
    общего дежурного; нет ни того, ни другого — подразделения нет в ответе
    вовсе. Отсутствие ключа, а не пустая строка в значении: «некому сообщать»
    — это не получатель по имени «», и разбирать такое значение пришлось бы
    каждому вызывающему заново.

    Сужения по актору здесь нет — как и у настроек контроля: закрепление
    ответственного одинаково для всех, кто вправе его читать, а правом
    распоряжается маршрут.
    """

    @staticmethod
    def resolve_many(division_ids) -> dict:
        """`{подразделение: получатель}` для разрешимых — ПАЧКОЙ.

        Один запрос по справочнику (`division_id__in`) плюс одно чтение
        настроек, СКОЛЬКО БЫ подразделений ни пришло: запрос на каждое в цикле
        превратил бы утренний прогон по отставшим в сотню обращений.

        Вход материализуется первой же строкой: генератор ушёл бы в `__in`
        целиком и до склейки не дожил бы — ответ вышел бы пустым, и это ровно
        тот отказ, который выглядит как «отставших нет».

        Получатель обрезается по краям: `.create()` и `bulk_create()` минуют
        `clean()`, а CHECK отвергает лишь целиком пробельное, поэтому «  7  »
        доезжает до базы. Ключ «одно на день» — по строке получателя, и
        необрезанное значение развело бы одного человека на двух адресатов.

        Отличия от источника: ключи не приводятся к строке — здесь id
        подразделений ЦЕЛЫЕ, текстовой формы в обороте нет (в источнике UUID
        приезжал и строкой из JSON, оттого и приведение).
        """
        division_ids = [did for did in division_ids if did is not None]
        specific = {
            row.division_id: row.recipient
            for row in OpsDivisionNotifyRecipient.objects.filter(
                division_id__in=division_ids
            )
        }
        # `or ""` — на случай NULL из переноса данных: поле не nullable, но
        # .strip() у None упал бы AttributeError вместо «дежурного нет».
        duty = (
            SubmissionControlSettingsSelector.get().default_notify_recipient or ""
        ).strip()
        resolved = {}
        for division_id in division_ids:
            recipient = specific.get(division_id) or duty
            if recipient:
                resolved[division_id] = recipient.strip()
        return resolved


class TomorrowBlockOverrideSelector:
    """Чтение законных обходов блокировки завтрашнего дня."""

    @staticmethod
    def active_for(business_date) -> bool:
        """Есть ли обход на эту дату, ОДИН запрос.

        Уровень — дата: обход снимает блокировку целиком, поэтому вопрос
        двоичный и подразделение в него не входит. Строка возвращается не
        сама, а фактом её наличия: вывод решает только «снят ли замок», а
        «кто и почему» читают из журнала и из самой строки те, кто
        разбирается — вывод же, получив объект, начал бы соблазнять брать из
        него причину и стал бы вторым рассказчиком об ответственности.
        """
        return OpsTomorrowBlockOverride.objects.filter(
            business_date=business_date
        ).exists()


class OpsAuditLogSelector:
    """Чтение журнала раздела: фильтры и ПОЛНЫЙ порядок.

    Единственный канал чтения журнала — как audit_service единственный канал
    записи. Вьюха сюда не заглядывает мимо: разъехавшийся порядок сортировки
    у двух читателей означал бы, что «страница 2» у них про разные строки.

    ОБЛАСТЬ ВИДИМОСТИ ПЛОСКАЯ: держатель audit.view видит журнал целиком.
    Так же ведёт себя источник, и здесь это не недосмотр, а следствие
    раскладки прав — audit.view выдан ORGD и админу, а не операторам
    подразделений (см. seed_operations). Сузить журнал по подразделению
    нечем одинаково для всех строк: у события статуса подразделение выводится
    через сотрудника и штатную единицу, у события пары — через две стороны, а
    у события сотрудника его нет вовсе. Разные правила на разные типы событий
    дали бы читателю дырявую ленту, в которой пропажу не отличить от отказа.
    Если область когда-нибудь понадобится, начинать надо отсюда.
    """

    @staticmethod
    def list(
        *,
        entity_type=None,
        entity_id=None,
        actor_user_id=None,
        action=None,
        created_from=None,
        created_to=None,
    ):
        """Строки журнала под И-фильтрами (применяются только заданные).

        created_from/created_to — ПОЛУИНТЕРВАЛ [from, to), тот же уговор о
        границах, что у периодов статусов: сосед, начинающийся ровно в `to`,
        в окно не попадает, и два соседних окна не покажут одну строку дважды.
        """
        queryset = OpsAuditLog.objects.all()
        if entity_type is not None:
            queryset = queryset.filter(entity_type=entity_type)
        if entity_id is not None:
            queryset = queryset.filter(entity_id=entity_id)
        if actor_user_id is not None:
            queryset = queryset.filter(actor_user_id=actor_user_id)
        if action is not None:
            queryset = queryset.filter(action=action)
        if created_from is not None:
            queryset = queryset.filter(created_at__gte=created_from)
        if created_to is not None:
            queryset = queryset.filter(created_at__lt=created_to)
        # Свежие первыми, id — ОБЯЗАТЕЛЬНЫЙ разрыв ничьей, а не украшение:
        # record_many ставит всей пачке ОДНО время (см. audit_service), то
        # есть равный created_at здесь — обычное дело, а не край. Без второго
        # ключа страничная выдача теряла бы и дублировала строки пачки между
        # страницами.
        return queryset.order_by("-created_at", "-id")


class OpsNotificationSelector:
    """Чтение уведомлений раздела: ЛИЧНАЯ лента.

    Единственный канал чтения ops_notifications — как notify() единственный
    канал записи.

    Область видимости здесь противоположна журналу. Журнал плоский: держатель
    audit.view видит его целиком. Лента — ЛИЧНАЯ: фильтр по получателю
    накладывается БЕЗУСЛОВНО, и он же, а не код права, и есть разграничение
    доступа. Иначе говоря, чужую строку отсюда достать нечем — не «не выдаётся
    без права», а не существует запроса, который её вернёт.

    Отличия от источника: свои модель и имена (ops_notifications), получатель
    строкой.
    """

    @staticmethod
    def list(actor, *, since=None):
        """Свои уведомления `actor`, свежие сверху.

        `since` — СТРОГАЯ нижняя граница по created_at (created_at > since):
        это курсор опроса, и он отдаёт только то, что новее уже виденного.
        Нестрогая возвращала бы последнюю строку предыдущего ответа при каждом
        опросе — читающий экран показывал бы её как новую снова и снова.

        Порядок — (-created_at, id): свежие сверху, id — ОБЯЗАТЕЛЬНЫЙ разрыв
        ничьей, а не украшение. Равный created_at здесь обычное дело (догон
        рассылает всех отставших дня одним проходом), и без второго ключа
        страничная выдача теряла бы и дублировала строки между страницами.
        Возрастающий id, а не убывающий как у журнала: ровно в этом порядке
        лежит индекс ленты (recipient, -created_at, id), и разойтись с ним
        значило бы заставить базу пересортировывать каждую страницу.

        Пустой/не-строковый `actor` — ValueError, а не пустая выдача (зеркало
        гварда notify()): это ошибка вызывающего, и молча вернуть «ничего»
        значило бы выдать сбой несущего фильтра за законный пустой ответ.

        Отличие от источника: получатель ОБРЕЗАЕТСЯ по краям — ровно как в
        notify(). Там «7» и «7 » уже сведены в одного человека, и не обрезать
        здесь значило бы, что писали одному, а читает другой: лента вернулась
        бы пустой, и пустота эта неотличима от «уведомлений нет».
        """
        if not isinstance(actor, str) or not actor.strip():
            raise ValueError("OpsNotificationSelector.list требует получателя")
        queryset = OpsNotification.objects.filter(recipient=actor.strip())
        if since is not None:
            queryset = queryset.filter(created_at__gt=since)
        return queryset.order_by("-created_at", "id")


class OpsAttachmentSelector:
    """Чтение вложений — как document_service единственный канал их записи.

    У селектора одна обязанность сверх выборки: НЕ ПУСТИТЬ мусорный
    идентификатор в запрос. Идентификатор приходит из адреса маршрута, то есть
    строкой произвольного вида, и переданный в фильтр как есть он поднимает
    ValueError уже внутри драйвера базы — то есть 500 там, где по существу
    «такого нет». Мусорный и несуществующий здесь НЕОТЛИЧИМЫ намеренно: разница
    в ответе рассказывала бы спрашивающему, какие идентификаторы бывают.

    Отказ не поднимается: селекторы раздела возвращают строку или None, а в
    отказ это переводит маршрут — он же владеет и кодом, и текстом.
    """

    @staticmethod
    def get(attachment_id):
        """Вложение по идентификатору из адреса; мусор и пропажа — одинаково None."""
        # Через str(), а не int() напрямую, и это несущее: bool — подкласс
        # int, и True, поданный в разбор целым, стал бы pk=1 — то есть выдал бы
        # ЧУЖОЙ файл вместо «нет такого». str(True) даёт "True", и разбор его
        # отвергает; отдельный гвард на bool был бы вторым владельцем одного
        # правила, а проба на нём — вакуумной.
        try:
            canonical = int(str(attachment_id).strip())
        except (TypeError, ValueError):
            return None
        return OpsAttachment.objects.filter(pk=canonical).first()


class OpsDocumentSequenceSelector:
    """Чтение счётчика номеров — единственное место, где берётся его замок.

    Замок построчный (`select_for_update`) и живёт до коммита ВЫЗЫВАЮЩЕГО: в
    этом весь смысл нумерации через обычное целое, а не через последовательность
    базы. Отпусти его раньше — и две транзакции прочитали бы одно значение и
    обе записали бы +1, выдав один номер дважды.

    Вне транзакции `select_for_update` поднимает TransactionManagementError, и
    это намеренно не смягчается: замок, взятый в autocommit, отпускается тем же
    оператором, то есть не защищает ничего — а «работает, но не защищает» хуже
    внятного отказа.
    """

    @staticmethod
    def lock(*, doc_type, year):
        """Строка счётчика под построчным замком. Строка обязана существовать."""
        return OpsDocumentSequence.objects.select_for_update().get(
            doc_type=doc_type, year=year
        )


class OpsIssuedDocumentSelector:
    """Чтение выпусков документов.

    Всё, что здесь есть, отвечает на один вопрос: КАКОЙ выпуск действует. Он
    ровно один — это держит частичная уникальность (вид, подразделение, день)
    по состоянию «выпущен», — и потому метод возвращает строку, а не выборку:
    выборка заставляла бы каждого читателя решать, что делать со вторым
    элементом, которого не бывает.
    """

    @staticmethod
    def for_attachment(attachment):
        """Выпуск, которому принадлежат эти байты, или None.

        Нужен разграничению доступа. У вложения нет ни подразделения, ни дня —
        оно знает только про файл, — а решать, кому его отдавать, можно лишь
        зная, ЧТО в нём. Ответ даёт владелец: выпуск несёт и подразделение, и
        день. Отсутствие владельца — законный ответ «нечего отдавать»: байты
        откатившегося выпуска на диске остаются, и адресовать их снаружи не
        должно быть можно (см. document_service про принятый мусор).

        Заменённый выпуск сюда попадает наравне с действующим: отозванный
        документ по-прежнему предъявляют, и отказать в его байтах значило бы
        стереть историю у того, кто держит его на руках.
        """
        return OpsIssuedDocument.objects.filter(attachment=attachment).first()

    @staticmethod
    def current(*, doc_type, division_id, business_date):
        """Действующий выпуск дня, или None.

        КОНТРАКТ ВЫЗОВА: сервис выпуска читает это ВНУТРИ своей транзакции, уже
        держа замок головы сдачи. Своего `select_for_update` здесь нет намеренно
        — выпуск и поправка сериализуются на ТОМ ЖЕ замке сдачи, и второй замок
        поверх первого только добавил бы порядок блокировок, в котором можно
        встать в клинч. Частичная уникальность остаётся ремнём на тот же
        инвариант: проиграв гонку, вторая транзакция упрётся в неё, а не выпустит
        второй действующий документ.

        Заменённые сюда не попадают ВООБЩЕ. Фильтр по состоянию несущий: без
        него метод вернул бы самый старый выпуск дня (порядка нет), то есть
        документ, который уже отозван.
        """
        return OpsIssuedDocument.objects.filter(
            doc_type=doc_type,
            division_id=division_id,
            business_date=business_date,
            status=OpsIssuedDocument.Status.ISSUED,
        ).first()
