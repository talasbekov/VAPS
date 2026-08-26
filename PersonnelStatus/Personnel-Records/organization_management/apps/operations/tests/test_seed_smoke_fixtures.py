"""Сид фикстур смоука: собирается ли он ШТАТНЫМ путём и переживает ли повтор.

Ценность этого сида — в том, что после него сторожа трёх проб смоука перестают
объявлять «проверять нечего». Поэтому проверяется не «строки появились», а
ровно те свойства, на которые сторожа и смотрят: привлечённые есть на
СЕГОДНЯШНЮЮ дату, мероприятие стоит на «Запросе сил» с непустыми заявками,
объект «зелёный» И свежий одновременно.

Отдельно проверяется несовпадение чисел: проба недобора подменяет первую
заявку на 9/4 и ищет «не отдано 5». Если у второй заявки недобор тоже окажется
пятёркой, на экране два одинаковых текста — и проба падает строгим режимом, то
есть красит гейт ровно тем, что сид её и должен был вылечить.
"""
import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.management.commands import (
    seed_smoke_fixtures,
)
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventTransition,
)
from organization_management.apps.operations.models_object import (
    OpsPassportFreshnessPolicy,
    OpsSecurityObject,
)
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db


@pytest.fixture
def dictionary():
    """Только те типы, которые сид ищет по имени.

    Отпуск здесь не для полноты справочника: сид заводит им ОДНО отсутствие,
    чтобы «в строю» отличалось от «по списку» (Plane №169). Колонка отчёта у
    него намеренно НЕ `IN_SERVICE` — иначе строка появилась бы, а числа
    остались бы равны.
    """
    StatusType.objects.get_or_create(
        code=seed_smoke_fixtures.ASSIGNMENT_CODE,
        defaults={
            "name": "Привлечён на мероприятие",
            "priority": 80,
            "report_column_code": "IN_SERVICE",
        },
    )
    StatusType.objects.get_or_create(
        code=seed_smoke_fixtures.ABSENCE_CODE,
        defaults={
            "name": "Отпуск",
            "priority": 20,
            "report_column_code": "VACATION",
            "is_hard_block": True,
        },
    )


@pytest.fixture
def structure():
    """Корень с четырьмя отделами и человеком в каждом.

    Отделов несколько, а не один: сид обязан брать людей ИЗ РАЗНЫХ
    подразделений, и на одном отделе это правило не проверяется вовсе.

    ЛИШНИЙ человек нужен отсутствующему: сид берёт его ВНЕ привлечённых, и
    ровно на трёх при умолчании `assigned=3` ему просто некого было бы
    выбрать — отказ был бы свойством фикстуры, а не сида.
    """
    root = Division.objects.create(name="Департамент (тест)")
    for index, title in enumerate(
        ["Первый отдел", "Второй отдел", "Третий отдел", "Четвёртый отдел"],
        start=1,
    ):
        division = Division.objects.create(name=title, parent=root)
        employee = Employee.objects.create(
            last_name=f"Тестов{index}",
            first_name="Тест",
            employment_status=Employee.EmploymentStatus.WORKING,
            personnel_number=f"SMOKE{index:03d}",
            iin=f"8{index:011d}",
        )
        StaffUnit.objects.create(division=division, employee=employee, index=index)
    return root


@pytest.fixture
def policy():
    return OpsPassportFreshnessPolicy.objects.create(
        singleton_key=1,
        version="fp-test",
        verification_interval_days=120,
        due_soon_percent=25,
    )


@pytest.fixture
def persons_catalog():
    """Два охраняемых лица: фикстура истории разводит их по разным объектам."""
    return [
        OpsProtectedPerson.objects.create(name="Первое лицо", category="FOREIGN"),
        OpsProtectedPerson.objects.create(name="Второе лицо", category="OURS"),
    ]


@pytest.fixture
def stand(dictionary, structure, policy, persons_catalog):
    return structure


def seed(**options):
    call_command("seed_smoke_fixtures", **options)


def fixture_event():
    return OpsSecurityEvent.objects.get(title=seed_smoke_fixtures.EVENT_TITLE)


# ── Привлечённые ─────────────────────────────────────────────────────────


def test_assignments_land_on_todays_business_date(stand):
    """Сторож пробы спрашивает статусы на деловую дату РАСХОДА: строка на
    вчера или на неделю вперёд для него не существует."""
    seed(assigned=2)

    today = Clock.today_local()
    rows = OpsEmployeeStatus.objects.filter(
        status_type_code=seed_smoke_fixtures.ASSIGNMENT_CODE
    )
    assert rows.count() == 2
    for row in rows:
        assert row.date_start <= today < row.date_end


def test_assigned_people_come_from_different_divisions(stand):
    """Проба смотрит, что люди РАЗЛОЖЕНЫ по управлениям; трое из одного отдела
    оставили бы разнесение непроверенным."""
    seed(assigned=2)

    ids = OpsEmployeeStatus.objects.filter(
        status_type_code=seed_smoke_fixtures.ASSIGNMENT_CODE
    ).values_list("employee_id", flat=True)
    divisions = set(
        StaffUnit.objects.filter(employee_id__in=list(ids)).values_list(
            "division_id", flat=True
        )
    )
    assert len(divisions) == 2


def test_it_refuses_loudly_without_the_status_dictionary(structure, policy):
    """Пустой справочник — самая частая беда свежего стенда; отказ обязан
    назвать, чем лечится."""
    with pytest.raises(CommandError) as exc:
        seed()

    assert "seed_status_types" in str(exc.value)


# ── Мероприятие на «Запросе сил» ─────────────────────────────────────────


def test_the_event_reaches_forces_through_the_real_chain(stand):
    """Признак штатного пути, а не вставки строкой: переходы стадий записаны.

    Мероприятие с проставленной стадией показало бы заявки без потребности —
    состояние, которого система сама породить не может.

    Стадия фикстуры сменилась на «Расстановку» осознанно (Plane №110):
    «Потребность» и «Запрос сил» проходит сервер, и фикстура на них больше не
    останавливается. Пин не снят — он по-прежнему стережёт, что обе стадии в
    истории ЕСТЬ, то есть путь был штатным.
    """
    seed()

    event = fixture_event()
    assert event.stage == "PLACEMENT"
    assert event.demand_approved is True
    stages = list(
        OpsSecurityEventTransition.objects.filter(event=event).values_list(
            "to_stage", flat=True
        )
    )
    assert "DEMAND" in stages and "FORCES" in stages


def test_no_request_shortfall_collides_with_the_probes_number(stand):
    """Проба недобора подменяет первую заявку на 9/4 и ищет «не отдано 5».

    Заявка теперь ОДНА на мероприятие (Plane №110): групп, по которым они
    дробились, никто не вводит. Требование «вторая заявка даёт другое число»
    отпало вместе со второй заявкой, но сторож остался — ни одна заявка
    фикстуры не должна давать недобор 5, иначе на экране два одинаковых
    текста и проба падает строгим режимом.
    """
    seed()

    shortfalls = {
        int(row["requestedCount"]) - int(row["allocatedCount"])
        for row in fixture_event().force_requests
    }
    assert len(fixture_event().force_requests) == 1
    assert 5 not in shortfalls


# ── Мероприятие на «Рекогносцировке» ─────────────────────────────────────


def test_a_recon_event_exists_for_the_stage_filter(stand):
    """Отбор реестра по этапу проверяется пробой слоя прототипа, и до 25.08
    она стояла на МУСОРЕ — пробных строках, которые никто не убирал. Уборка
    мусор снесла, и без явной фикстуры проба видит пустую таблицу."""
    seed()

    event = OpsSecurityEvent.objects.get(title=seed_smoke_fixtures.RECON_TITLE)
    assert event.stage == "RECON"
    # Расчёт заполнен: карточку открывают глазом, и пустой этап показывал бы
    # не то состояние, ради которого фикстура заведена.
    assert event.recon_sector_posts != []


def test_running_it_twice_leaves_one_recon_event(stand):
    seed()
    seed()

    assert (
        OpsSecurityEvent.objects.filter(
            title=seed_smoke_fixtures.RECON_TITLE
        ).count()
        == 1
    )


def test_a_recon_fixture_moved_on_is_rebuilt(stand):
    """Фикстуру могли двинуть дальше по цепочке рукой или прогоном — тогда
    этап снова пуст, и переиспользовать её по одному лишь названию нельзя."""
    seed()
    moved = OpsSecurityEvent.objects.get(title=seed_smoke_fixtures.RECON_TITLE)
    moved.stage = "APPROVAL"
    moved.save(update_fields=["stage"])

    seed()

    rebuilt = OpsSecurityEvent.objects.get(title=seed_smoke_fixtures.RECON_TITLE)
    assert rebuilt.stage == "RECON"


# ── Закрытое мероприятие для истории ─────────────────────────────────────


def test_the_closed_fixture_has_two_persons_on_two_objects(stand):
    """История лица показывает объекты, которые посетило ИМЕННО оно (Plane
    №38). На фикстуре с одним лицом это правило не проверяется и не
    показывается: «отобрали по лицу» выглядит так же, как «взяли всё
    мероприятие»."""
    seed()

    event = OpsSecurityEvent.objects.get(title=seed_smoke_fixtures.CLOSED_TITLE)
    visits = list(event.visit_objects.all())
    assert event.stage == "CLOSED"
    assert len({visit.security_object_id for visit in visits}) == 2
    assert len({visit.protected_person_id for visit in visits}) == 2


def test_the_closed_fixture_refuses_without_two_persons(
    dictionary, structure, policy  # noqa: F811
):
    """Отказ обязан назвать, чего не хватает: молча собранная фикстура с одним
    лицом сделала бы историю нечитаемой, а причина осталась бы неизвестной."""
    with pytest.raises(CommandError) as exc:
        seed()

    assert "seed_protected_persons" in str(exc.value)


# ── Объект с готовым паспортом ───────────────────────────────────────────


def test_the_ready_object_is_green_and_fresh_at_once(stand):
    """Сторож пробы паспорта требует ОБА признака сразу, и они независимы:
    «зелёный» — поле карточки, «свежий» — вывод из даты версии."""
    from organization_management.apps.ops import passport as passport_service

    seed()

    security_object = OpsSecurityObject.objects.get(
        name=seed_smoke_fixtures.READY_OBJECT_NAME
    )
    assert security_object.passport_state == "GREEN"
    freshness = passport_service.resolve_freshness(
        security_object, passport_service.read_policy(), Clock.today_local()
    )
    assert freshness["state"] == "FRESH"


# ── Повтор ───────────────────────────────────────────────────────────────


def test_running_it_twice_leaves_one_fixture_event(stand):
    """Две строки на «Запросе сил» дают на экране два текста недобора — то
    самое, из-за чего проба падает."""
    seed()
    seed()

    assert (
        OpsSecurityEvent.objects.filter(
            title=seed_smoke_fixtures.EVENT_TITLE
        ).count()
        == 1
    )


def test_running_it_twice_does_not_duplicate_assignments(stand):
    seed(assigned=2)
    seed(assigned=2)

    assert (
        OpsEmployeeStatus.objects.filter(
            status_type_code=seed_smoke_fixtures.ASSIGNMENT_CODE
        ).count()
        == 2
    )


def test_a_fixture_with_stale_numbers_is_rebuilt(stand):
    """Фикстура прошлого запуска могла быть собрана с другими числами — и
    именно её недобор столкнулся бы с пробой. Повтор обязан её пересобрать,
    а не переиспользовать по одному лишь названию."""
    seed()
    stale = fixture_event()
    stale.force_requests = [
        {**row, "requestedCount": 5} for row in stale.force_requests
    ]
    stale.save(update_fields=["force_requests"])

    seed()

    rebuilt = fixture_event()
    assert rebuilt.pk != stale.pk
    assert sorted(
        int(row["requestedCount"]) for row in rebuilt.force_requests
    ) == seed_smoke_fixtures.EXPECTED_REQUESTED


# ── Отсутствующий: «в строю» ≠ «по списку» ───────────────────────────────


def test_the_seed_puts_exactly_one_person_out_of_service(stand):
    """После сида «в строю» ОТЛИЧАЕТСЯ от «по списку» — и ровно на одного.

    Без этой строки проба кадровых показателей аналитики службы падает
    собственным сторожем: пока все в строю, плитка, взявшая не то поле,
    показывала бы то же самое число, и сторожить было бы нечего (Plane №169).

    «Ровно на одного» — не придирка: задача фикстуры развести два числа, а не
    изобразить убыль, и каждый лишний отсутствующий двигает знаменатели, по
    которым считают соседние пробы.
    """
    seed(assigned=2)

    today = Clock.today_local()
    absences = OpsEmployeeStatus.objects.filter(
        status_type_code=seed_smoke_fixtures.ABSENCE_CODE,
        date_start__lte=today,
        date_end__gt=today,
    )

    assert absences.count() == 1


def test_the_absent_person_is_not_one_of_the_assigned(stand):
    """Отсутствующий взят ВНЕ привлечённых.

    Отпуск — жёсткий статус: на человеке с привлечённостью он даёт конфликт,
    и сид упал бы на собственной правильной проверке. Проба стережёт именно
    выбор человека, а не факт записи.
    """
    seed(assigned=2)

    assigned = set(
        OpsEmployeeStatus.objects.filter(
            status_type_code=seed_smoke_fixtures.ASSIGNMENT_CODE
        ).values_list("employee_id", flat=True)
    )
    absent = set(
        OpsEmployeeStatus.objects.filter(
            status_type_code=seed_smoke_fixtures.ABSENCE_CODE
        ).values_list("employee_id", flat=True)
    )

    assert absent and not (absent & assigned)


def test_the_absence_is_reported_outside_in_service(stand):
    """Тип отсутствия отчитывается НЕ в колонку «в строю».

    Сид мог бы завести статус, который в отчёте всё равно считается строем —
    так устроена сама привлечённость (`EVENT_ASSIGNMENT` отчитывается в
    `IN_SERVICE`, и это верно по существу: человек на мероприятии в строю).
    Тогда строка появилась бы, а числа остались бы равны, и проба выше
    зеленела бы впустую.
    """
    absence_type = StatusType.objects.get(code=seed_smoke_fixtures.ABSENCE_CODE)

    assert absence_type.report_column_code != "IN_SERVICE"
