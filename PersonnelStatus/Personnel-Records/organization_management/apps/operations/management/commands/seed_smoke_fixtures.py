"""Фикстуры стенда под сторожей смоука: привлечённые на ОМ и запрос сил.

ЗАЧЕМ. Три пробы смоука падают не ассертом о коде, а СТОРОЖЕМ ПРОТИВ
ВАКУУМНОСТИ: `forces-gathering` дважды объявляет «на стенде никого не выставили
на ОМ» / «нет привлечённых», а проба недобора по заявке молча зеленела бы, не
найдя ни одного мероприятия на стадии «Запрос сил». Сторожа правы: без этих
данных пробы проверяют пустоту. Но пока данных нет, гейт всегда красный на три
теста — и настоящий регресс в них неотличим от фона (Plane №43).

ЧТО ЗАВОДИТСЯ:

1. **Привлечённые на мероприятие** — строки `OpsEmployeeStatus` с кодом
   `EVENT_ASSIGNMENT` на СЕГОДНЯШНЮЮ деловую дату. Привлечённость в домене —
   это обычный статус, отдельной сущности у неё нет.
2. **Мероприятие на стадии «Запрос сил»** с непустым `force_requests`.
3. **Мероприятие на стадии «Рекогносцировка»** — по нему проба слоя прототипа
   проверяет, что отбор реестра по этапу сужает выдачу. До 25.08.2026 эту роль
   играл МУСОР: на стенде копились пробные строки, и отбор находил их. Уборка
   за пробами (Plane №62) мусор снесла — и вместе с ним данные, на которых
   проба стояла. Фикстура заменяет случайность явным условием.
4. **Объект с готовым паспортом** — «зелёный» и со свежей версией сразу.
5. **Один отсутствующий** — строка `VACATION` на сегодня. Без неё «в строю»
   РАВНО «по списку», и проба кадровых показателей аналитики службы падает
   собственным сторожем: плитка, взявшая не то поле, показывала бы то же самое
   число, и сторожить было бы нечего (Plane №169). Привлечённость для этого не
   годится — `EVENT_ASSIGNMENT` отчитывается в колонку `IN_SERVICE`: человек на
   мероприятии остаётся в строю, и это верно по существу.

ЧЕГО КОМАНДА НЕ ДЕЛАЕТ. Дня не сдаёт и документов не выпускает: этим занят
`seed_expense_chain`, и его сдача краснит `day-submission` (см.
`Personnel-Records/Known-Issues.md`). Людей и подразделения тоже не заводит —
берёт тех, кто на стенде уже есть: выдуманный человек в расходе исказил бы
знаменатели, по которым пробы и считают.

СТАДИИ НАБИРАЮТСЯ ШТАТНЫМИ СЕРВИСАМИ, а не записью стадии в базу.
Мероприятие, проставленное вставкой, показывает состояние, которого система
сама породить не может: заявки без потребности, потребность без расчёта постов.

ИДЕМПОТЕНТНОСТЬ. Статусы ищутся по (сотрудник, код, дата начала); мероприятие —
по названию. Второй запуск в тот же день не заводит ничего нового, а на
следующий день дозаводит статусы на новую дату — привлечённость дневная.

ИМЯ МЕРОПРИЯТИЯ НАМЕРЕННО БЕЗ «(e2e)»: `purge_probe_events` чистит стенд
именно по этой метке, и фикстура с ней исчезала бы при каждой уборке.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    OpsStatusParticipation,
)
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.ops import passport as passport_service
from organization_management.apps.ops import security_events as event_service
from organization_management.apps.staff_unit.models import StaffUnit

ACTOR = "stand-seed"
# Код слит в единственный «Участие в ОМ» (Plane №486): фикстура обязана
# заводить то же, что пишет цепочка, иначе смоук проверял бы мёртвый код.
ASSIGNMENT_CODE = "IN_EVENT"
#: Вид участия для фикстуры: физический наряд. Роли внутри у него нет вовсе,
#: поэтому `role_code` остаётся пустым — см. комментарий у модели участия.
PARTICIPATION_KIND = "PHYSICAL_SQUAD"
#: Второй вид участия: боевая группа. Стенду он нужен ЖИВЫМ — на нём стоит
#: проба «привлечённый ГРУППОЙ считается выделенным, а не оставшимся в строю»
#: (Plane №274, Ш-5), а с Plane №486 отличить группу можно только по нему.
GROUP_PARTICIPATION_KIND = "SCREENING_GROUP"
#: Отсутствие для РАЗВЕДЕНИЯ «в строю» и «по списку». Отпуск, а не болезнь:
#: болезнь — сведение о здоровье, и держать её выдумкой на стенде незачем,
#: когда любой отпуск даёт ровно тот же эффект в отчёте.
ABSENCE_CODE = "VACATION"
EVENT_TITLE = "Стенд: мероприятие на запросе сил (фикстура смоука)"
#: Насколько «из прошлого» первая версия паспорта готового объекта.
#: 30 дней с запасом накрывают деловые даты, которыми пробы заводят
#: свои мероприятия (самая ранняя — 22-е число текущего месяца).
HISTORY_VERSION_DAYS = 30
#: Охраняемое лицо, которого НЕТ НИ В ОДНОЙ сводке ГВО (Plane №197).
#: Проба каталога начинает мутирующий сценарий с пустой связи «лицо → ОМ»,
#: и любое лицо из общего справочника рано или поздно оказывается названо:
#: закрытая фикстура истории берёт двух первых, а данные заказчика — третьего.
#: Имя намеренно говорит, что это фикстура: человека с таким именем не бывает,
#: и подставить его в отчёт наружу нельзя по недосмотру.
CLEAN_PERSON_NAME = "Стенд: лицо без сводок (фикстура смоука)"
#: Паспорт готового объекта. Состав выбран НЕ на глаз: сектор из ДВУХ постов
#: нужен `forces-gathering` (счётчик сектора обязан быть больше счётчика
#: одного поста), а три поста всего — `acknowledgement-stage`, которому нужны
#: минимум два неподтверждённых назначения.
READY_OBJECT_PASSPORT = [
    {
        "name": "Периметр",
        "posts": [
            {"name": "Пост 1", "task": "Охрана периметра", "requirements": "Допуск"},
            {"name": "Пост 2", "task": "Наблюдение", "requirements": "Допуск"},
        ],
    },
    {
        "name": "КПП",
        "posts": [
            {"name": "Пост 3", "task": "Пропускной режим", "requirements": "Допуск"},
        ],
    },
]


def _wanted_shape():
    """Состав паспорта фикстуры как список «постов в секторе»."""
    return [len(sector["posts"]) for sector in READY_OBJECT_PASSPORT]


def _passport_shape(security_object):
    """Тот же состав, но у ЧЕРНОВИКА объекта."""
    return [
        sector.posts.count() for sector in security_object.sectors.order_by("position")
    ]


def _snapshot_shape(version):
    """И у СНИМКА опубликованной версии — импорт постов читает именно его."""
    return [len(sector.get("posts") or []) for sector in (version.sectors_snapshot or [])]
RECON_TITLE = "Стенд: мероприятие на рекогносцировке (фикстура смоука)"
# Сколько человек выставляем на мероприятие. Три, а не один: проба разносит
# людей по управлениям и сверяет счётчик вкладки со строками таблицы — на
# одном человеке разнесение не проверяется вовсе.
ASSIGNED_COUNT = 3
# Объект с готовым паспортом — вторая фикстура: проба паспорта сторожит
# «нет готового объекта — молчание баннера не проверяется».
READY_OBJECT_NAME = "Стенд: объект с готовым паспортом"
CLOSED_TITLE = "Стенд: закрытое мероприятие (фикстура истории)"
# ОМ, стоящее НА «Проведении». Без него ТРИ пробы закрытия молча уходили в
# skip: «на стенде нет ОМ на стадии „Проведение“» (Plane №75). Закрытая
# фикстура эту роль не играет — она проходит «Проведение» насквозь и
# останавливается на «Закрыто».
CONDUCT_TITLE = "Стенд: мероприятие на проведении (фикстура смоука)"
SECOND_OBJECT_NAME = "Стенд: второй объект посещения"
# Численность заявок фикстуры. Числа НЕ произвольны: проба недобора подменяет
# первую заявку на «запрошено 9, выделено 4» и ищет на экране ровно
# «не отдано 5» — значит ни у одной другой заявки недобор не должен равняться
# пяти, иначе на экране два одинаковых текста и проба падает строгим режимом.
# Отсюда 4 и 7, а сверка `EXPECTED_REQUESTED` не даёт переиспользовать
# фикстуру прошлых запусков с другими числами.
DEMAND_NEEDS = (4, 7)
# Заявка на силы теперь ОДНА на мероприятие: стадии «Потребность» и «Запрос
# сил» проходит сервер расчётом рекогносцировки (Plane №110), и групп, по
# которым заявки прежде дробились, никто больше не вводит. Сверка держит сумму
# расчёта — по ней видно, что фикстуру не переиспользовали с чужими числами.
EXPECTED_REQUESTED = [sum(DEMAND_NEEDS)]


class Command(BaseCommand):
    help = (
        "Завести на стенде фикстуры под сторожей смоука: привлечённых на ОМ на "
        "сегодня и мероприятие со сбором сил на «Расстановке». Идемпотентна."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--assigned",
            type=int,
            default=ASSIGNED_COUNT,
            help="Сколько человек выставить на мероприятие (по умолчанию 3).",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        day = Clock.today_local()
        assigned = self._assignments(day, options["assigned"])
        event = self._forces_event(day)
        attached = self._attach_participations(day, assigned, event)
        security_object, freshness = self._ready_object(day)
        recon = self._recon_event(day, security_object)
        closed = self._closed_event(day, security_object)
        conduct = self._conduct_event(day, security_object)
        absent = self._absence(day, assigned)
        clean_person = self._clean_person()

        self.stdout.write(f"STAND_ABSENT={absent.id} {absent.last_name}")
        for employee in assigned:
            self.stdout.write(f"STAND_ASSIGNED={employee.id} {employee.last_name}")
        self.stdout.write(f"STAND_DAY={day.isoformat()}")
        self.stdout.write(f"STAND_FORCES_EVENT={event.code}")
        self.stdout.write(f"STAND_PARTICIPATIONS={attached}")
        self.stdout.write(f"STAND_RECON_EVENT={recon.code}")
        self.stdout.write(f"STAND_CLOSED_EVENT={closed.code}")
        self.stdout.write(f"STAND_CLEAN_PERSON={clean_person.id} {clean_person.name}")
        self.stdout.write(f"STAND_CONDUCT_EVENT={conduct.code}")
        self.stdout.write(
            f"STAND_READY_OBJECT={security_object.code} "
            f"{security_object.passport_state}/{freshness}"
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"фикстуры готовы: привлечённых {len(assigned)}, "
                f"мероприятие на «{event.stage}» с {len(event.force_requests)} заявками"
            )
        )

    # ── Привлечённые на мероприятие ─────────────────────────────────────────

    def _attach_participations(self, day, assigned, event):
        """Привязать привлечённых к ЖИВОМУ мероприятию фикстуры (Plane №346).

        🔴 ЗАЧЕМ ЭТО ВООБЩЕ ПОЯВИЛОСЬ. Участий на стенде не заводил НИ ОДИН
        сид: единственным их источником были сами пробы, а уборка сносит
        заведённые ими мероприятия — и участия оставались ссылаться в пустоту.
        Круг замыкался: свежих участий взять негде, старые непригодны, и проба
        `tables-data.spec.ts:289` отвечала «на стенде сегодня нет ни одного
        привлечения на ОМ — проверять нечего». Убрать сирот было половиной
        дела; вторая половина — завести годные.

        Мероприятие берётся ФИКСТУРНОЕ, а не пробное: его название намеренно
        без метки «(e2e)», поэтому `purge_probe_events` его не трогает и
        участие переживает любую уборку.

        Идемпотентно: повторный запуск в тот же день ничего не добавляет.
        """
        # ДЕНЬ В ФИЛЬТРЕ ОБЯЗАТЕЛЕН. Без него берутся привлечённости человека
        # за ВСЕ даты, накопленные прошлыми запусками: на трёх сотрудниках
        # первый прогон завёл 20 участий вместо трёх и привязал вчерашние дни
        # к сегодняшнему мероприятию.
        statuses = OpsEmployeeStatus.objects.filter(
            employee_id__in=[employee.id for employee in assigned],
            status_type_code=ASSIGNMENT_CODE,
            date_start=day,
        )
        attached = 0
        rows = []
        for status in statuses:
            row, created = OpsStatusParticipation.objects.get_or_create(
                status=status,
                event_id=event.id,
                defaults={"kind_code": PARTICIPATION_KIND, "role_code": ""},
            )
            rows.append(row)
            attached += int(created)
        # 🔴 ОДНА СТРОКА — БОЕВОЙ ГРУППОЙ (Plane №486). До слияния статусов
        # «группа» отличалась КОДОМ, и проба «привлечённый ГРУППОЙ считается
        # выделенным» находила такую строку среди легаси-данных стенда. Теперь
        # код один, различает вид участия, и легаси-строк не осталось: без
        # явной фикстуры проба падала бы «на стенде нет фикстуры» — что она и
        # сделала при первом прогоне после слияния. Сообщение самой пробы уже
        # отсылало сюда («заводится сидом»), так что место верное.
        #
        # ЧЕЛОВЕК ВЫБИРАЕТСЯ НЕ ПЕРВЫЙ ПОПАВШИЙСЯ, А ИЗ ДЕПАРТАМЕНТА ЗАЯВКИ:
        # экран «Сбор сил» показывает вкладки по департаменту раскладки, и
        # строка человека из чужого поддерева на него не попадает вовсе.
        # Проверено прогоном: с сотрудником из отдела вне заявки проба падала
        # «привлечённый группой обязан стоять в „Участии в ОМ“», с сотрудником
        # департамента заявки — зелёная.
        if rows and not any(
            row.kind_code == GROUP_PARTICIPATION_KIND for row in rows
        ):
            group_row = self._row_in_allocation_department(event, rows)
            group_row.kind_code = GROUP_PARTICIPATION_KIND
            group_row.save(update_fields=["kind_code"])
        return attached

    def _row_in_allocation_department(self, event, rows):
        """Строка участия человека из департамента раскладки; иначе первая."""
        from organization_management.apps.divisions.models import Division
        from organization_management.apps.staff_unit.models import StaffUnit

        department_ids = {
            str(item.get("departmentId"))
            for item in (event.force_allocation or [])
            if item.get("departmentId")
        }
        if not department_ids:
            return rows[0]
        allowed = set()
        for department in Division.objects.filter(pk__in=department_ids):
            allowed.update(
                department.get_descendants(include_self=True).values_list(
                    "pk", flat=True
                )
            )
        by_employee = {
            unit.employee_id: unit.division_id
            for unit in StaffUnit.objects.filter(
                employee_id__in=[row.status.employee_id for row in rows]
            )
        }
        for row in rows:
            if by_employee.get(row.status.employee_id) in allowed:
                return row
        return rows[0]


    def _assignments(self, day, count):
        """Статусы `EVENT_ASSIGNMENT` на сегодня.

        Люди берутся ИЗ ПОДДЕРЕВА ПЕРВОГО КОРНЯ: реестр кадров, с которым
        пробы сверяют счётчик, для суперпользователя строится именно от него
        (`staff-units/directorate/`), и человек из другого корня попал бы в
        статусы, но не в таблицу — счётчик разошёлся бы со строками.

        Статус пишется напрямую, как и в `seed_expense_chain`: сервис создания
        требует актора и справочника, а привлечённость — мягкий статус, за
        пересечения БД не ругается.
        """
        if not StatusType.objects.filter(code=ASSIGNMENT_CODE).exists():
            raise CommandError(
                f"в справочнике нет типа {ASSIGNMENT_CODE!r} — сначала засейте "
                "типы статусов (seed_status_types)"
            )
        root = Division.objects.filter(level=0).order_by("pk").first()
        if root is None:
            raise CommandError("в структуре нет ни одного корневого подразделения")
        divisions = root.get_descendants(include_self=True)
        units = (
            StaffUnit.objects.filter(
                division__in=divisions,
                employee__isnull=False,
                employee__employment_status=Employee.EmploymentStatus.WORKING,
            )
            .select_related("employee", "division")
            .order_by("division_id", "index", "id")
        )
        # По одному человеку на подразделение, пока хватает подразделений:
        # проба смотрит, что люди РАЗЛОЖЕНЫ по управлениям, и трое из одного
        # отдела оставили бы разнесение непроверенным.
        picked, seen_divisions = [], set()
        for unit in units:
            if len(picked) >= count:
                break
            if unit.division_id in seen_divisions:
                continue
            seen_divisions.add(unit.division_id)
            picked.append(unit.employee)
        for unit in units:
            if len(picked) >= count:
                break
            if unit.employee not in picked:
                picked.append(unit.employee)
        if not picked:
            raise CommandError(
                "в поддереве корневого подразделения нет ни одного работающего "
                "сотрудника на штатном слоте — засейте кадры"
            )
        for employee in picked:
            OpsEmployeeStatus.objects.get_or_create(
                employee_id=employee.id,
                status_type_code=ASSIGNMENT_CODE,
                date_start=day,
                defaults={
                    # Один день: привлечённость на завтра — это завтрашний
                    # факт, и растянутый статус врал бы про следующий день.
                    "date_end": day + timedelta(days=1),
                    "source": OpsEmployeeStatus.Source.USER,
                    "created_by": ACTOR,
                },
            )
        return picked

    # ── Один отсутствующий ──────────────────────────────────────────────────

    def _absence(self, day, assigned):
        """Строка `VACATION` на сегодня — ровно одному человеку.

        ЗАЧЕМ РОВНО ОДИН. Задача фикстуры — РАЗВЕСТИ «в строю» и «по списку»,
        а не изобразить убыль. Чем больше отсутствующих, тем сильнее фикстура
        двигает знаменатели, по которым считают соседние пробы.

        ЗАЧЕМ ОДИН ДЕНЬ. Отпуск на неделю выглядел бы правдоподобнее, но он
        менял бы отчёт и в те дни, когда фикстуру никто не звал, — то есть
        стенд вёл бы себя по-разному в зависимости от того, гоняли ли смоук
        неделю назад. Дневной статус повторяет уже принятое здесь решение по
        привлечённости.

        БЕРЁТСЯ НЕ ИЗ ПРИВЛЕЧЁННЫХ. Отпуск — жёсткий статус, и на человеке с
        привлечённостью он даёт конфликт: фикстура упала бы на собственной
        правильной проверке.
        """
        if not StatusType.objects.filter(code=ABSENCE_CODE).exists():
            raise CommandError(
                f"в справочнике нет типа {ABSENCE_CODE!r} — сначала засейте "
                "типы статусов (seed_status_types)"
            )
        root = Division.objects.filter(level=0).order_by("pk").first()
        taken = {employee.id for employee in assigned}
        unit = (
            StaffUnit.objects.filter(
                division__in=root.get_descendants(include_self=True),
                employee__isnull=False,
                employee__employment_status=Employee.EmploymentStatus.WORKING,
            )
            .exclude(employee_id__in=taken)
            .select_related("employee")
            .order_by("division_id", "index", "id")
            .first()
        )
        if unit is None:
            raise CommandError(
                "в поддереве корневого подразделения не нашлось работающего "
                "сотрудника вне привлечённых — засейте кадры"
            )
        OpsEmployeeStatus.objects.get_or_create(
            employee_id=unit.employee_id,
            status_type_code=ABSENCE_CODE,
            date_start=day,
            defaults={
                "date_end": day + timedelta(days=1),
                "source": OpsEmployeeStatus.Source.USER,
                "created_by": ACTOR,
            },
        )
        return unit.employee

    # ── Мероприятие со сбором сил ───────────────────────────────────────────

    def _forces_event(self, day):
        # Строки этого имени идут от новой к старой (`Meta.ordering`), поэтому
        # первая — фикстура последнего запуска.
        existing = OpsSecurityEvent.objects.filter(title=EVENT_TITLE).first()
        if (
            existing is not None
            and existing.stage == "PLACEMENT"
            and self._requested(existing) == EXPECTED_REQUESTED
        ):
            return existing
        # Прошлая фикстура не годится: её довели дальше по цепочке, бросили на
        # полпути или собрали с другими числами. Стадию назад не переводим —
        # это подделка истории переходов; вместо этого СТАРАЯ УБИРАЕТСЯ ТОЙ ЖЕ
        # ручкой, что чистит реестр от проб, и заводится новая. Оставлять её в
        # реестре нельзя: две строки одного сбора дают на экране два
        # одинаковых текста недобора, и проба падает строгим режимом.
        for stale in OpsSecurityEvent.objects.filter(title=EVENT_TITLE):
            try:
                event_service.delete_event(stale.id, actor=ACTOR, force=True)
            except DomainError as error:
                # Закрытое ОМ не удаляется даже принудительно — и правильно:
                # у него внешний след. Такую строку оставляем и говорим вслух.
                self.stderr.write(
                    f"старая фикстура {stale.code} не убрана ({error.code})"
                )
        return self._build(day)

    @staticmethod
    def _requested(event):
        return sorted(int(r.get("requestedCount", 0)) for r in event.force_requests)

    def _build(self, day):
        """Штатная цепочка: заведение → расчёт постов → завершение осмотра.

        Дальше мероприятие ведёт сервер сам: завершение рекогносцировки
        проходит «Потребность» и «Запрос сил» и оставляет ОМ на «Расстановке»
        (Plane №110). Заявка на силы одна, её число — сумма расчёта постов.
        """
        event = event_service.create_event(
            title=EVENT_TITLE,
            object_id=None,
            business_date=day,
            kind=OpsSecurityEvent.Kind.INTERNAL,
            actor=ACTOR,
        )
        event = event_service.update_bulletin(
            event.id,
            brief_description="Фикстура стенда: мероприятие доведено до запроса сил.",
            initial_tasks="Обеспечить посты по расчёту.",
        )
        # ОМ без объекта стартует с бюллетеня — его надо закрыть руками; ОМ с
        # объектом заводится сразу на рекогносцировке (Plane «Реестр ОМ-5»).
        if event.stage == "BULLETIN":
            event = event_service.complete_bulletin(event.id)
        posts = [
            {
                "id": f"seed-post-{index}",
                "sector": sector,
                "post": post,
                "task": "Охрана периметра",
                "need": need,
                "requirements": "",
                "result": None,
                "comment": "",
                "sourceSectorId": None,
                "sourcePostId": None,
                "minRating": None,
            }
            for index, (sector, post, need) in enumerate(
                [("Периметр", "Пост 1", DEMAND_NEEDS[0]), ("КПП", "Пост 2", DEMAND_NEEDS[1])], start=1
            )
        ]
        event = event_service.update_recon(
            event.id,
            checklist=[
                {**item, "done": True} for item in (event.recon_checklist or [])
            ],
            sector_posts=posts,
        )
        event = event_service.complete_recon(event.id)
        # Потребность и заявку на силы собрал сервер: своих строк фикстура
        # больше не пишет. Ручной `approve_demand` здесь стоял до Plane №110 —
        # теперь он отбился бы «не на этом этапе».
        return event

    # ── Объект с готовым паспортом ──────────────────────────────────────────

    def _ready_object(self, day):
        """Объект, у которого паспорт «зелёный» И версия свежая.

        Сторож пробы паспорта требует ОБА признака сразу, а они независимы:
        `passportState` — поле карточки, `freshness` — вывод из даты последней
        опубликованной версии и политики актуальности. На стенде «зелёный»
        объект был, но его версия дожила до «скоро истекает» — и сторож честно
        объявлял, что проверять нечего.

        Свой объект, а не правка чужого: у существующих строк реестра свои
        состояния, и подкручивать их под пробу значило бы стирать то, что они
        показывают (в том числе просроченный паспорт, который проверяется рядом).

        Состояние паспорта фикстура БОЛЬШЕ НЕ ПИШЕТ РУКАМИ: с Plane №66 у него
        есть свой путь — публикация версии переводит объект в «зелёное», и
        фикстура получает GREEN тем же способом, что живая работа. Раньше
        здесь стояла запись прямо в поле, потому что пути не существовало
        вовсе.
        """
        security_object = OpsSecurityObject.objects.filter(
            name=READY_OBJECT_NAME
        ).first()
        if security_object is None:
            security_object = passport_service.create_object(
                name=READY_OBJECT_NAME,
                object_type="Государственное учреждение",
                region="г. Астана",
                address="пр. Мәңгілік Ел, 1",
            )
        # Состав паспорта СВЕРЯЕТСЯ, а не заводится «если пусто» (Plane №196):
        # соседние пробы этапов читают его через импорт постов, и одного поста
        # им мало — `acknowledgement-stage` ищет ОМ, где НЕ ПОДТВЕРЖДЕНО хотя
        # бы два назначения, а `forces-gathering` проверяет, что счётчик
        # СЕКТОРА больше счётчика ОДНОГО поста (на секторе из одного поста они
        # совпадут, и сторож пробы честно объявляет фикстуру негодной).
        if _passport_shape(security_object) != _wanted_shape():
            passport_service.update_passport(security_object, READY_OBJECT_PASSPORT)
            security_object.refresh_from_db()
        # ── История версий, а не одна сегодняшняя (Plane №196) ──────────
        # Пробы заводят свои ОМ ПРОШЛОЙ деловой датой, а версия паспорта
        # привязывается к мероприятию по правилу «последняя, чей
        # effective_from не позже деловой даты». Пока у объекта была ровно
        # одна версия, вступившая в силу СЕГОДНЯ, у такого ОМ не находилось
        # ни одной применимой — `passportBinding` оставался пустым,
        # `recon/import-from-passport/` отвечал 422 NO_PASSPORT_VERSION, и
        # проба падала уже на завершении этапа сообщением про пустой расчёт
        # постов. Виноваты были не посты (они в снимке есть), а даты.
        #
        # Порядок публикаций ЗНАЧИМ: свежесть считается по ПОСЛЕДНЕЙ ПО
        # НОМЕРУ версии, поэтому старая публикуется первой, свежая — второй.
        # Дописать старую к уже опубликованной сегодняшней нельзя: она стала
        # бы последней по номеру и объявила бы паспорт просроченным.
        history_date = day - timedelta(days=HISTORY_VERSION_DAYS)
        applicable = event_service.resolve_applicable_version(
            security_object, history_date
        )
        if applicable is None or _snapshot_shape(applicable) != _wanted_shape():
            # Версии этого объекта — целиком фикстурные: объект заводит эта же
            # команда, живой работы на нём нет. Пересобрать их в правильном
            # порядке честнее, чем дописывать номер задним числом мимо
            # сервиса публикации.
            security_object.passport_versions.all().delete()
            passport_service.publish_version(
                security_object,
                effective_from=history_date.isoformat(),
                note="Фикстура стенда: версия из прошлого под ОМ прошлой даты.",
                actor=ACTOR,
            )
            passport_service.publish_version(
                security_object,
                effective_from=day.isoformat(),
                note="Фикстура стенда: свежая версия паспорта под пробу.",
                actor=ACTOR,
            )
            security_object.refresh_from_db()
        policy = passport_service.read_policy()
        freshness = passport_service.resolve_freshness(security_object, policy, day)
        if freshness["state"] != "FRESH":
            # Версия публикуется СЕГОДНЯШНИМ числом: свежесть считается от даты
            # вступления в силу, и версия задним числом дала бы ту же
            # «скоро истекает», из-за которой сторож и молчал.
            passport_service.publish_version(
                security_object,
                effective_from=day.isoformat(),
                note="Фикстура стенда: свежая версия паспорта под пробу.",
                actor=ACTOR,
            )
            security_object.refresh_from_db()
            freshness = passport_service.resolve_freshness(
                security_object, policy, day
            )
        security_object.refresh_from_db()
        # Сторож фикстуры: объект обязан стать «зелёным» САМ, публикацией.
        # Красный или жёлтый здесь означает, что путь сломался, — и молча
        # дописывать состояние в поле, как делалось до №66, нельзя: проба
        # смотрела бы на значение, которого система не производит.
        if security_object.passport_state != "GREEN":
            raise CommandError(
                "объект фикстуры не стал «зелёным» после публикации версии "
                f"({security_object.passport_state}) — сломан путь состояния "
                "паспорта (Plane №66)"
            )
        # Сторож фикстуры: ОМ ПРОШЛОЙ датой обязан найти применимую версию.
        # Без этого пробы этапов падают не своим ассертом, а сообщением про
        # пустой расчёт постов — то есть врут о причине (Plane №196).
        applicable = event_service.resolve_applicable_version(
            security_object, history_date
        )
        if applicable is None:
            raise CommandError(
                "у объекта фикстуры нет версии паспорта, действующей на "
                f"{history_date.isoformat()} — ОМ прошлой датой останется без "
                "привязки, и импорт постов ответит NO_PASSPORT_VERSION "
                "(Plane №196)"
            )
        if _snapshot_shape(applicable) != _wanted_shape():
            raise CommandError(
                "версия паспорта, действующая на "
                f"{history_date.isoformat()}, отдаёт посты "
                f"{_snapshot_shape(applicable)} вместо {_wanted_shape()} — "
                "пробам этапов не хватит назначений (Plane №196)"
            )
        return security_object, freshness["state"]

    # ── Мероприятие на стадии «Рекогносцировка» ─────────────────────────────

    def _recon_event(self, day, security_object):
        """ОМ, остановленное НА рекогносцировке.

        Нужно отбору реестра по этапу: без единой строки на этом этапе проба
        «Сбросить фильтры» видит пустую таблицу и падает — причём падает
        честно, потому что сужение отбора на пустоте не проверяется.

        ОМ заводится С ОБЪЕКТОМ: такое стартует сразу с рекогносцировки, и
        цепочку бюллетеня проходить не нужно. Расчёт постов заполняется, чтобы
        карточку можно было открыть и посмотреть глазом.
        """
        existing = OpsSecurityEvent.objects.filter(title=RECON_TITLE).first()
        if existing is not None and existing.stage == "RECON":
            return existing
        for stale in OpsSecurityEvent.objects.filter(title=RECON_TITLE):
            try:
                event_service.delete_event(stale.id, actor=ACTOR, force=True)
            except DomainError as error:
                self.stderr.write(
                    f"старая фикстура {stale.code} не убрана ({error.code})"
                )
        event = event_service.create_event(
            title=RECON_TITLE,
            object_id=str(security_object.pk),
            business_date=day,
            kind=OpsSecurityEvent.Kind.INTERNAL,
            actor=ACTOR,
        )
        self._assign_visit_chief(event)
        event = event_service.update_bulletin(
            event.id,
            brief_description="Фикстура стенда: мероприятие стоит на рекогносцировке.",
            initial_tasks="Осмотреть объект, составить расчёт постов.",
        )
        if event.stage == "BULLETIN":
            event = event_service.complete_bulletin(event.id)
        return event_service.update_recon(
            event.id,
            checklist=list(event.recon_checklist or []),
            sector_posts=[
                {
                    "id": "seed-recon-post-1",
                    "sector": "Периметр",
                    "post": "Пост 1",
                    "task": "Охрана периметра",
                    "need": 2,
                    "requirements": "Допуск",
                    "result": None,
                    "comment": "",
                    "sourceSectorId": None,
                    "sourcePostId": None,
                    "minRating": None,
                }
            ],
        )

    # ── Мероприятие на «Проведении» ─────────────────────────────────────────

    def _conduct_event(self, day, security_object):
        """ОМ, остановленное НА «Проведении», с расчётом постов и расстановкой.

        Три пробы закрытия (`готовность считается по итогам`, `контроль постов`
        и `недобор на посту`) ищут такое ОМ на стенде и без него уходили в
        skip — то есть молча ничего не проверяли, а прогон выглядел зелёным
        (Plane №75). Закрытая фикстура их не спасает: она проходит «Проведение»
        насквозь.

        Человек на посту НУЖЕН: `complete_placement` требует хотя бы одного
        назначенного, а проба контроля постов считает по расстановке
        укомплектованность. Пост с `need: 3` и одним человеком — это и есть
        недобор, который пробы показывают на экране.

        Идемпотентна: если фикстура уже стоит на «Проведении», она возвращается
        как есть; недоведённые остатки прошлых запусков сносятся.
        """
        existing = OpsSecurityEvent.objects.filter(title=CONDUCT_TITLE).first()
        if existing is not None and existing.stage == "CONDUCT":
            return existing
        # Второй пост всегда просит одного, первый — двоих, если люди есть.
        # Меньше двух сотрудников в кадрах — фикстуру не собрать вовсе, и об
        # этом надо сказать словами, а не молча получить недобор.
        available = self._employee_count()
        if available < 2:
            raise CommandError(
                f"в кадрах {available} сотрудников, фикстуре «Проведения» нужно "
                "минимум 2 — засейте кадры"
            )
        first_need = 2 if available >= 3 else 1
        for stale in OpsSecurityEvent.objects.filter(title=CONDUCT_TITLE):
            try:
                event_service.delete_event(stale.id, actor=ACTOR, force=True)
            except DomainError as error:
                self.stderr.write(
                    f"старая фикстура {stale.code} не убрана ({error.code})"
                )
        event = event_service.create_event(
            title=CONDUCT_TITLE,
            object_id=str(security_object.pk),
            business_date=day,
            kind=OpsSecurityEvent.Kind.INTERNAL,
            actor=ACTOR,
        )
        self._assign_visit_chief(event)
        if event.stage == "BULLETIN":
            event = event_service.complete_bulletin(event.id)
        event = event_service.update_recon(
            event.id,
            checklist=[{**item, "done": True} for item in (event.recon_checklist or [])],
            # ДВА направления — требование самих проб, а не выдумка:
            # «готовность считается по итогам» сторожит `фикстуре нужно ≥2
            # направления` (на одном направлении «1 из 2 готовы» не
            # проверяется вовсе).
            #
            # Потребность первого поста зависит от того, сколько людей есть в
            # кадрах: расстановка должна быть УКОМПЛЕКТОВАНА ПОЛНОСТЬЮ (проба
            # недобора поднимает потребность на два и ищет ровно «Недобор 2»),
            # а людей на стенде много, но в пробах самого сида их бывает двое.
            # Жёсткое «нужно три» ломало эти пробы — фикстура подстраивается.
            sector_posts=[
                {
                    "id": "seed-conduct-post-1",
                    "sector": "Периметр",
                    "post": "Пост 1",
                    "task": "Охрана периметра",
                    "need": first_need,
                    "requirements": "Допуск",
                    "result": None,
                    "comment": "",
                    "sourceSectorId": None,
                    "sourcePostId": None,
                    "minRating": None,
                },
                {
                    "id": "seed-conduct-post-2",
                    "sector": "КПП",
                    "post": "Пост 2",
                    "task": "Пропускной режим",
                    "need": 1,
                    "requirements": "Допуск",
                    "result": None,
                    "comment": "",
                    "sourceSectorId": None,
                    "sourcePostId": None,
                    "minRating": None,
                },
            ],
        )
        # Идентификаторы постов выдаёт СЕРВЕР: присланные «seed-conduct-post-N»
        # он заменяет своими, и назначение по придуманному id отбивается 404.
        posts = [
            (row["id"], int(row.get("need") or 0)) for row in event.recon_sector_posts
        ]
        # Завершение рекогносцировки само проводит «Потребность» и «Запрос
        # сил» и оставляет ОМ на «Расстановке» (Plane №110) — расставлять
        # людей можно только там.
        if event.stage == "RECON":
            event = event_service.complete_recon(event.id)
        # Расстановка УКОМПЛЕКТОВАНА ПОЛНОСТЬЮ: проба недобора поднимает
        # потребность первого поста на два и ищет на экране ровно «Недобор 2».
        # Оставь фикстуру недоукомплектованной — на экране будет другое число,
        # и проба покраснеет не на дефекте, а на фикстуре.
        people = self._some_employees(sum(need for _id, need in posts))
        seat = 0
        for post_id, need in posts:
            for _ in range(need):
                event = event_service.assign_placement(
                    event.id,
                    post_id=post_id,
                    employee_id=str(people[seat].pk),
                    override=None,
                    override_reason=None,
                )
                seat += 1
        # Перевод этапа — админ-полномочие и штатный путь: он оставляет след в
        # журнале переходов, а запись в поле — нет.
        return event_service.override_stage(event.id, stage="CONDUCT", actor=ACTOR)

    def _assign_visit_chief(self, event):
        """Старший объекта — условие рекогносцировки (`[РЕК-02]`/`[РЕК-07]`,
        Plane №424): без него импорт постов и «Завершить» отвечают 422."""
        chief = Employee.objects.order_by("id").first()
        if chief is None:
            raise CommandError("нет сотрудников — старшего объекта взять неоткуда")
        for visit in event.visit_objects.all():
            if visit.chief_employee_id is None:
                event_service.assign_visit_object_chief(
                    event.id, visit.pk, employee_id=str(chief.pk), actor=ACTOR
                )
        event.refresh_from_db()
        return event

    def _employee_count(self):
        from organization_management.apps.employees.models import Employee

        return Employee.objects.count()

    def _some_employees(self, count, linked_first=False):
        """Кто угодно из кадров: пробам важен факт назначения, а не человек.

        Людей должно хватить на ВСЕ посты фикстуры — иначе расстановка выйдет
        неполной, и проба недобора покраснеет на фикстуре, а не на дефекте.

        `linked_first` ставит вперёд тех, у кого кадровая запись СВЯЗАНА С
        УЧЁТКОЙ: их и только их видит «мой профиль», и без них история
        заступлений пуста у любого, кто зашёл на стенд (Plane №196). Имени
        учётки фикстура при этом не знает и знать не должна — связь одна на
        всех, и годится любая.
        """
        from organization_management.apps.employees.models import Employee

        if linked_first:
            linked = list(Employee.objects.filter(user__isnull=False).order_by("id"))
            rest = list(Employee.objects.filter(user__isnull=True).order_by("id"))
            people = (linked + rest)[:count]
        else:
            people = list(Employee.objects.order_by("id")[:count])
        if len(people) < count:
            raise CommandError(
                f"в кадрах {len(people)} сотрудников, фикстуре нужно {count} — "
                "засейте кадры"
            )
        return people

    # ── Охраняемое лицо без сводок ──────────────────────────────────────────

    def _clean_person(self):
        """Лицо каталога, которого нет ни в одной сводке ГВО (Plane №197).

        Проба каталога охраняемых лиц начинает со слов «до правки связи нет» и
        сама вносит лицо в сводку. Любое лицо ОБЩЕГО справочника для этого не
        годится: закрытая фикстура истории называет двух первых, данные
        заказчика — третьего, и проба падала на собственном первом ассерте,
        не добравшись до предмета проверки.

        Своё лицо, а не правка чужих строк: у названных лиц свои сводки, и
        вычищать их значило бы стирать то, что они показывают.

        Ни в одно мероприятие фикстура его НЕ ставит — выборки лиц в этой
        команде его исключают по имени.
        """
        person, _created = OpsProtectedPerson.objects.get_or_create(
            name=CLEAN_PERSON_NAME,
            defaults={
                "category": OpsProtectedPerson.Category.OURS,
                "callsign": "",
                "bio": (
                    "Фикстура смоука: лицо намеренно не названо ни в одной "
                    "сводке ГВО — на нём проверяется пустое состояние связи "
                    "«лицо → мероприятие»."
                ),
                "is_active": True,
            },
        )
        return person

    # ── Закрытое мероприятие для истории ────────────────────────────────────

    def _closed_event(self, day, security_object):
        """Закрытое ОМ с ДВУМЯ объектами посещения у РАЗНЫХ лиц.

        История в карточке лица показывает объекты, которые посетило ИМЕННО
        оно (задача заказчика Plane №38). На фикстуре с одним лицом это
        правило не проверяется и не показывается: «отобрали по лицу» выглядит
        так же, как «взяли всё мероприятие».

        Стадия ставится ПЕРЕВОДОМ ЭТАПА, а не записью в поле: перевод — штатное
        действие администратора, оно оставляет след в журнале переходов, и
        закрытое ОМ на стенде получается тем же путём, что в жизни.
        """
        existing = OpsSecurityEvent.objects.filter(title=CLOSED_TITLE).first()
        if existing is not None and existing.stage == "CLOSED":
            # Закрытое БЕЗ ИТОГОВ НАПРАВЛЕНИЙ не годится: архив дела проверяет
            # именно их, и проба `closure-stage` падает сторожем «на стенде
            # нет фикстуры». Такое ОМ оставалось на стенде от прежних заходов,
            # когда расчёт постов у него выходил пустым (Plane №196) —
            # направления берутся из секторов расчёта, и без постов их ноль.
            if existing.closure_direction_summaries and existing.placement_assignments:
                return existing
            existing.delete()
        # «Чистое» лицо ИСКЛЮЧЕНО из выбора: оно заведено ровно для того,
        # чтобы не быть названным ни в одной сводке (Plane №197).
        persons = list(
            OpsProtectedPerson.objects.filter(is_active=True)
            .exclude(name=CLEAN_PERSON_NAME)[:2]
        )
        if len(persons) < 2:
            raise CommandError(
                "в справочнике меньше двух охраняемых лиц — засейте их "
                "(seed_protected_persons)"
            )
        second_object = OpsSecurityObject.objects.filter(
            name=SECOND_OBJECT_NAME
        ).first()
        if second_object is None:
            # Через сервис, а не вставкой: код объекта выдаёт он, и придуманный
            # на месте номер уперся бы в уникальность реестра.
            second_object = passport_service.create_object(
                name=SECOND_OBJECT_NAME,
                object_type="Государственное учреждение",
                region="г. Астана",
                address="пр. Мәңгілік Ел, 2",
            )
        event = event_service.create_event(
            title=CLOSED_TITLE,
            object_id=str(security_object.pk),
            business_date=day - timedelta(days=7),
            kind=OpsSecurityEvent.Kind.FOREIGN,
            protected_person_id=str(persons[0].pk),
            actor=ACTOR,
        )
        self._assign_visit_chief(event)
        # Расчёт постов — ИМПОРТОМ ИЗ ПАСПОРТА, а не пустой: итоги закрытия
        # собираются ПО НАПРАВЛЕНИЯМ, а направления — это секторы расчёта.
        # Пока расчёт был пуст, `close_event` получал пустой список итогов, и
        # закрытое ОМ на стенде было закрыто «ни по чему» (Plane №196).
        event = event_service.import_recon_from_passport(event.id)
        # Второй объект — с ДРУГИМ лицом: ровно та пара, на которой видно, что
        # история лица показывает его объекты, а не все объекты мероприятия.
        event_service.add_visit_object(
            event.id,
            object_id=str(second_object.pk),
            protected_person_id=str(persons[1].pk),
        )
        event = self._assign_visit_chief(event)
        # ЛЮДИ НА ПОСТАХ, а не пустая расстановка (Plane №196): вкладка
        # «История» своего профиля показывает закрытые ОМ, в расстановке
        # которых человек НАЗВАН, и оттуда же берёт форму одежды, вооружение и
        # балл. Пока закрытое ОМ стенда стояло без единого назначения, история
        # была пуста у всех, и колонки таблицы на экране не появлялись вовсе —
        # проба «мой профиль» падала на них.
        event = event_service.update_recon(
            event.id,
            checklist=[
                {**item, "done": True} for item in (event.recon_checklist or [])
            ],
            sector_posts=event.recon_sector_posts,
        )
        if event.stage == "RECON":
            event = event_service.complete_recon(event.id)
        # ОДИН человек, а не полная расстановка. Истории заступлений хватает
        # одного НАЗВАННОГО, а полная расстановка сравнялась бы по числу
        # назначенных с ОМ на «Проведении» — и проба порядка в аналитике
        # («поиск и порядок правят снимок обратимо») упиралась бы в
        # собственного сторожа «порядок сервера уже совпал с сортировкой по
        # назначенным — проба вакуумна»: сортировать было бы нечего.
        people = self._some_employees(1, linked_first=True)
        event = event_service.assign_placement(
            event.id,
            post_id=event.recon_sector_posts[0]["id"],
            employee_id=str(people[0].pk),
            override=None,
            override_reason=None,
        )
        # На «Закрыто» перевода нет и быть не должно: закрывают ИТОГАМИ
        # направлений, а не переводом этапа. Поэтому фикстура доводится до
        # «Проведения» переводом (админ-полномочие) и закрывается штатно —
        # с итогом по каждому направлению расчёта.
        event = event_service.override_stage(
            event.id, stage="CONDUCT", actor=ACTOR
        )
        directions = sorted(
            {row.get("sector") for row in (event.recon_sector_posts or [])}
        )
        if not directions:
            raise CommandError(
                "у закрытого ОМ фикстуры нет ни одного направления — расчёт "
                "постов пуст, и архив дела проверять нечем (Plane №196)"
            )
        return event_service.close_event(
            event.id,
            direction_summaries=[
                {"direction": direction, "summary": "Замечаний нет."}
                for direction in directions
            ],
            actor=ACTOR,
        )
