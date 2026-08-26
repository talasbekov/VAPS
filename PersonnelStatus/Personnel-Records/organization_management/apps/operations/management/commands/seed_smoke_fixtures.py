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
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.ops import passport as passport_service
from organization_management.apps.ops import security_events as event_service
from organization_management.apps.staff_unit.models import StaffUnit

ACTOR = "stand-seed"
ASSIGNMENT_CODE = "EVENT_ASSIGNMENT"
EVENT_TITLE = "Стенд: мероприятие на запросе сил (фикстура смоука)"
RECON_TITLE = "Стенд: мероприятие на рекогносцировке (фикстура смоука)"
# Сколько человек выставляем на мероприятие. Три, а не один: проба разносит
# людей по управлениям и сверяет счётчик вкладки со строками таблицы — на
# одном человеке разнесение не проверяется вовсе.
ASSIGNED_COUNT = 3
# Объект с готовым паспортом — вторая фикстура: проба паспорта сторожит
# «нет готового объекта — молчание баннера не проверяется».
READY_OBJECT_NAME = "Стенд: объект с готовым паспортом"
CLOSED_TITLE = "Стенд: закрытое мероприятие (фикстура истории)"
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
        security_object, freshness = self._ready_object(day)
        recon = self._recon_event(day, security_object)
        closed = self._closed_event(day, security_object)

        for employee in assigned:
            self.stdout.write(f"STAND_ASSIGNED={employee.id} {employee.last_name}")
        self.stdout.write(f"STAND_DAY={day.isoformat()}")
        self.stdout.write(f"STAND_FORCES_EVENT={event.code}")
        self.stdout.write(f"STAND_RECON_EVENT={recon.code}")
        self.stdout.write(f"STAND_CLOSED_EVENT={closed.code}")
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

        🔴 `passport_state='GREEN'` пишется ПРЯМО В ПОЛЕ, и это не лень: пути,
        которым объект становится зелёным, в системе НЕТ вовсе — `create_object`
        жёстко ставит RED, а `publish_version` состояния не трогает. Пробел
        заведён отдельной карточкой; пока его нет, собрать фикстуру иначе
        нельзя.
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
        if not security_object.sectors.exists():
            passport_service.update_passport(
                security_object,
                [
                    {
                        "name": "Периметр",
                        "posts": [
                            {
                                "name": "Пост 1",
                                "task": "Охрана периметра",
                                "requirements": "Допуск",
                            }
                        ],
                    }
                ],
            )
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
        if security_object.passport_state != "GREEN":
            security_object.passport_state = "GREEN"
            security_object.save(update_fields=["passport_state", "updated_at"])
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
            return existing
        persons = list(OpsProtectedPerson.objects.filter(is_active=True)[:2])
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
        # Второй объект — с ДРУГИМ лицом: ровно та пара, на которой видно, что
        # история лица показывает его объекты, а не все объекты мероприятия.
        event_service.add_visit_object(
            event.id,
            object_id=str(second_object.pk),
            protected_person_id=str(persons[1].pk),
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
        return event_service.close_event(
            event.id,
            direction_summaries=[
                {"direction": direction, "summary": "Замечаний нет."}
                for direction in directions
            ],
            actor=ACTOR,
        )
