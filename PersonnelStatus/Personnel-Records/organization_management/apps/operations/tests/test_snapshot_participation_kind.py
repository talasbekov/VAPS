"""Снимок сданного дня несёт вид участия — иначе бумага врёт (Plane №751).

🔴 ЧТО СТЕРЕГУТ ЭТИ ПРОБЫ. После слияния статусов «Привлечён на мероприятие»
(№486) вид занятости — «наряд» или «боевая группа» — живёт ТОЛЬКО в строке
участия: код у обоих один. Живой расход это уже умеет (`overlapping_on`
отдаёт `participations`), и читатель документа тоже (`_parsed_facts` их
переносит в факт). А СБОРЩИК СНИМКА — нет: он пользовался
`snapshot_facts_on`, куда участия не дописывались вовсе.

Разрыв не заметили потому, что проба разбивки (`test_expense_event_kind_from_
participation.py`) собирает форму снимка РУКАМИ. Настоящий сборщик такой формы
не производил никогда, и печатный документ за любой день, сданный после
слияния, показывал «2 (0/0)» вместо «2 (1/1)».

Поэтому здесь снимок собирается настоящим `build_division_snapshot`, а
документ строится из того, что он вернул, — без единого словаря, набранного
рукой. Это и есть предмет пробы: не «формат правильный», а «сборщик его
производит».
"""
from datetime import timedelta

import pytest

from organization_management.apps.operations.expense_document import (
    build_expense_document,
)
from organization_management.apps.operations.models_status import (
    OpsStatusParticipation,
)
from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.snapshot import (
    SCHEMA_VERSION,
    build_division_snapshot,
)
from organization_management.apps.operations.strength_report import StatusCatalog
from organization_management.apps.operations.tests.test_day_submission_service import (
    TODAY,
    fact,
    in_slot,
)
from organization_management.apps.operations.tests.test_traffic_light import (  # noqa: F401
    division,
    types,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def merged_types(types):  # noqa: F811
    """Каталог ПОСЛЕ слияния: `IN_EVENT` есть, обоих старых кодов нет.

    Колонка та же, что у «в строю»: человек на мероприятии из строя не
    выбывает (Plane №169), и своя колонка сломала бы инвариант
    «Σ колонок == Список».
    """
    StatusType.objects.filter(
        code__in=("EVENT_ASSIGNMENT", "EVENT_ASSIGNMENT_GROUP")
    ).update(is_active=False)
    StatusType.objects.update_or_create(
        code="IN_EVENT",
        defaults={
            "name": "Участие в ОМ",
            "priority": 75,
            "report_column_code": "IN_SERVICE",
            "counts_in_staff": True,
        },
    )


def on_event(division, kind_code, **overrides):  # noqa: F811
    """Сотрудник в штате, привлечённый на ОМ, с видом участия в строке."""
    employee = in_slot(division, **overrides)
    status = fact(employee, code="IN_EVENT", end=TODAY + timedelta(days=2))
    OpsStatusParticipation.objects.create(
        status=status, event_id=41, kind_code=kind_code, role_code=""
    )
    return employee


def test_the_builder_puts_participations_into_the_snapshot(
    merged_types, division  # noqa: F811
):
    """Строка снимка несёт `participations` — по-настоящему, из сборщика."""
    squad = on_event(division, "PHYSICAL_SQUAD", last_name="Абаев")
    group = on_event(division, "SCREENING_GROUP", last_name="Букеев")

    snapshot = build_division_snapshot(division.id, TODAY)

    by_employee = {row["employee_id"]: row for row in snapshot["rows"]}
    assert by_employee[squad.id]["participations"] == [
        {"event_id": 41, "kind_code": "PHYSICAL_SQUAD"}
    ]
    assert by_employee[group.id]["participations"] == [
        {"event_id": 41, "kind_code": "SCREENING_GROUP"}
    ]


def test_the_submitted_day_prints_the_kind_split(merged_types, division):  # noqa: F811
    """«2 (1/1)», а не «2 (0/0)» — то самое число, ради которого всё это.

    Документ строится ИЗ СНИМКА СБОРЩИКА: подменить его словарём здесь нельзя,
    иначе проба вернулась бы к той же слепоте, из-за которой дефект и дожил.
    """
    on_event(division, "PHYSICAL_SQUAD", last_name="Абаев")
    on_event(division, "SCREENING_GROUP", last_name="Букеев")
    in_slot(division, last_name="Вагнер")

    snapshot = build_division_snapshot(division.id, TODAY)
    document = build_expense_document(
        snapshot,
        TODAY,
        catalog=StatusCatalog.from_rows(snapshot["catalog"]),
        division_title=snapshot["division_title"],
        staff_total=snapshot["staff_total"],
        vacancies=snapshot["vacancies"],
        attached=snapshot["attached"],
    )

    row = document.rows[0]
    assert (row.event["total"], row.event["squad"], row.event["group"]) == (2, 1, 1)


def test_a_status_without_participations_carries_an_empty_list(
    merged_types, division  # noqa: F811
):
    """Пустой список, а не отсутствие ключа: «занят, а чем — неизвестно».

    Читатель документа отличает пустой список от старого снимка (там ключа
    нет вовсе) только по тому, что новый сборщик его ВСЕГДА кладёт.
    """
    idle = in_slot(division, last_name="Вагнер")
    fact(idle, code="DUTY")

    snapshot = build_division_snapshot(division.id, TODAY)

    assert [row["participations"] for row in snapshot["rows"]] == [[]]


def test_the_schema_version_was_raised(merged_types, division):  # noqa: F811
    """Поле добавлено — версия поднята.

    Пин версии живёт и в `test_snapshot_position_level.py`; там он правится
    осознанно тем же коммитом. Своя строка здесь нужна затем, чтобы
    расширение снимка нельзя было выкатить, забыв про версию: читатель
    личной копии сверяет её со списком поддерживаемых.
    """
    assert SCHEMA_VERSION == 8
    assert build_division_snapshot(division.id, TODAY)["schema_version"] == 8
