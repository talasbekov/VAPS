"""Имя боевой группы (Plane №243).

Сценарий заказчика называет группу по имени: «на трассы в боевых группах
например мангилик ел - Кабанбай батыр НАЗВАНИЕ БОЕВОЙ ГРУППЫ БГ-1». До этого
среза имени было негде храниться: у смены есть дата, вид дежурства и набор
трасс, а группа была безымянной, и опознавать её приходилось по связке
«дата + трасса» — а на одной трассе за день бывает больше одной группы.
"""
import pytest

from organization_management.apps.operations.models_combat import (
    OpsCombatDutyType,
    OpsCombatRoute,
)
from organization_management.apps.ops import combat as combat_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def route_and_type():
    OpsCombatRoute.objects.create(
        route_code="route-probe", safe_label="Мангилик Ел — Кабанбай батыр"
    )
    OpsCombatDutyType.objects.create(
        duty_type_code="COMBAT_GROUP_SINGLE_ROUTE",
        safe_label="Дежурство боевой группы на одной Трассе",
        supports_multiple_routes=False,
    )


def _shift(**over):
    data = {
        "business_date": "2026-09-10",
        "duty_type_code": "COMBAT_GROUP_SINGLE_ROUTE",
        "route_ids": ["route-probe"],
        "coverage_mode": "RESERVE",
        "required_employees": 3,
    }
    data.update(over)
    return combat_service.create_shift(**data)


def test_the_group_keeps_the_name_it_is_called_by(route_and_type):
    """Имя группы доезжает до базы и обратно в контракт.

    Красная на мутации: убери `groupName` из сериализации — экран перестанет
    называть группу, и опознавать её снова придётся по дате и трассе.
    """
    shift = _shift(group_name="БГ-1")

    row = combat_service.serialize_combat_shift(shift)

    assert row["groupName"] == "БГ-1"
    assert row["routeSet"]["safeLabel"] == "Мангилик Ел — Кабанбай батыр"


def test_two_groups_on_one_route_and_one_day_are_told_apart(route_and_type):
    """Две группы на ОДНОЙ трассе в ОДИН день различаются именем.

    Это и есть причина поля: связка «дата + трасса» их не различает, а в
    жизни на трассе за день бывает не одна группа.
    """
    first = _shift(group_name="БГ-1")
    second = _shift(group_name="БГ-2")

    assert first.business_date == second.business_date
    assert first.route_set["routeIds"] == second.route_set["routeIds"]
    assert first.group_name != second.group_name


def test_a_shift_without_a_name_is_still_legal(route_and_type):
    """Имя необязательно: смены заводились до появления поля, и требовать его
    задним числом значило бы сломать их."""
    shift = _shift()

    assert combat_service.serialize_combat_shift(shift)["groupName"] == ""
