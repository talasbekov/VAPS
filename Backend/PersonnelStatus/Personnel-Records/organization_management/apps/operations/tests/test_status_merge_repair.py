"""Починка слияния снятых кодов участия (Plane №752, дефект миграции №486).

🔴 ЧТО ЭТО СТЕРЕЖЁТ. Правило слияния жило ВНУТРИ `RunPython` миграции 0091 и
потому не проверялось ничем — а оно молча не работало: `forwards` рано выходит,
если типа `IN_EVENT` нет, а заводит его только `seed_status_types`, который
гоняется ПОСЛЕ `migrate`. На всякой базе, кроме правленого вручную стенда,
слияние не выполнялось, а миграция записывалась применённой.

Проба зовёт ту же функцию, что зовёт починочная миграция 0092, — на состоянии
«снятые типы есть, целевого нет», то есть ровно на том, где старая логика
сдавалась.
"""
import datetime as dt

import pytest

from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    OpsStatusParticipation,
)
from organization_management.apps.operations.status_merge import (
    GROUP,
    SQUAD,
    TARGET,
    merge_legacy_participation_types,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    make_employee,
)

pytestmark = pytest.mark.django_db

DAY = dt.date(2026, 9, 12)


def _legacy_types():
    for code, name, priority in (
        (SQUAD, "Привлечён на мероприятие (наряд)", 80),
        (GROUP, "Привлечён на мероприятие (боевая группа)", 81),
    ):
        StatusType.objects.get_or_create(
            code=code,
            defaults={
                "name": name,
                "priority": priority,
                "report_column_code": "IN_SERVICE",
            },
        )


def _status(employee, code, day=DAY):
    return OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code=code,
        date_start=day,
        date_end=day + dt.timedelta(days=1),
        source=OpsEmployeeStatus.Source.USER,
        created_by="test",
    )


def _merge():
    return merge_legacy_participation_types(
        StatusType, OpsEmployeeStatus, OpsStatusParticipation
    )


def test_merge_works_on_a_base_without_the_target_type():
    """База, на которой целевого типа ещё нет, — та самая, где 0091 сдавалась."""
    _legacy_types()
    # Целевой тип СНИМАЕТСЯ намеренно: тестовую базу собирают миграции, и
    # починочная 0092 его уже завела. Предмет пробы — база, на которой его нет
    # (всякая, где `seed_status_types` ещё не гонялся), и без этой строки проба
    # проверяла бы состояние, в котором старая логика и так работала.
    StatusType.objects.filter(code=TARGET).delete()
    squad_man = make_employee()
    group_man = make_employee()
    squad = _status(squad_man, SQUAD)
    group = _status(group_man, GROUP, DAY + dt.timedelta(days=10))

    report = _merge()

    assert report["target_created"] is True
    assert report["statuses"] == 2
    squad.refresh_from_db()
    group.refresh_from_db()
    assert squad.status_type_code == TARGET and group.status_type_code == TARGET
    # Различие «наряд / группа» переехало в строку участия, а не пропало.
    assert squad.participations.get().kind_code == "PHYSICAL_SQUAD"
    assert group.participations.get().kind_code == "SCREENING_GROUP"
    # Целевой тип заведён по образцу снятого, а не выдуман.
    target = StatusType.objects.get(code=TARGET)
    assert target.report_column_code == "IN_SERVICE"
    # И сами коды погашены — ради этого слияние и делалось.
    assert not StatusType.objects.filter(
        code__in=(SQUAD, GROUP), is_active=True
    ).exists()


def test_merge_keeps_the_kind_that_is_already_written():
    """Строке цепочки вид не переписывается: там он верный."""
    _legacy_types()
    man = make_employee()
    status = _status(man, GROUP)
    OpsStatusParticipation.objects.create(
        status=status, event_id=0, kind_code="PHYSICAL_SQUAD", role_code=""
    )

    _merge()

    assert status.participations.get().kind_code == "PHYSICAL_SQUAD"


def test_merge_is_idempotent_on_an_already_merged_base():
    """Повтор на слитой базе ничего не переводит и не плодит строк участия."""
    _legacy_types()
    man = make_employee()
    status = _status(man, SQUAD)
    _merge()
    rows_before = OpsStatusParticipation.objects.count()

    second = _merge()

    assert second["statuses"] == 0 and second["target_created"] is False
    assert OpsStatusParticipation.objects.count() == rows_before
    status.refresh_from_db()
    assert status.status_type_code == TARGET
