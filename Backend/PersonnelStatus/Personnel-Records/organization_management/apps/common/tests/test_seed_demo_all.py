"""Единая точка входа: порядок, повтор, границы, снос (Plane №209).

Пробы стерегут то, ради чего оркестратор и заводился:

1. ПОРЯДОК. Штатка ссылается на должности, люди — на слоты, аватарки — на
   людей. Перепутанный порядок даёт не «немного не так», а падение по середине
   и половину стенда.
2. ОДНА КОМАНДА ДАЁТ ВЕСЬ СТЕНД: после неё нет ни одного пустого слота и ни
   одного человека без фотографии.
3. ПОВТОР ничего не добавляет — иначе на живом стенде вторая попытка удвоила
   бы людей.
4. `--skip-ops` действительно не трогает раздел ОМ, а `--wipe` уносит кадры и
   ЧЕСТНО говорит, что раздел ОМ остался.
"""
import pytest
from django.core.management import call_command

from organization_management.apps.common.management.commands.seed_demo_all import (
    OPS_STEPS,
    PERSONNEL_STEPS,
)
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

SEED = "SEED-"
PREFIX = "SD"


def test_the_order_of_the_steps_is_the_order_of_the_dependencies():
    """Порядок объявлен явно и читается сверху вниз."""
    assert [command for command, _ in PERSONNEL_STEPS] == [
        "seed_org_structure",
        "seed_positions_ranks",
        "seed_staffing",
        "seed_employees",
        "seed_employee_photos",
    ]


def test_one_command_fills_the_whole_stand(monkeypatch, tmp_path):
    _photos(monkeypatch, tmp_path)

    call_command("seed_demo_all", "--skip-ops")

    # По типам, а не одним числом: на ЧИСТОЙ базе корня организации ещё нет, и
    # первый шаг заводит его сам — общее число узлов тогда 49, а не 48, и
    # круглое число молча разошлось бы с арифметикой заказчика.
    seeded = Division.objects.filter(code__startswith=SEED)
    assert seeded.filter(division_type=Division.DivisionType.DEPARTMENT).count() == 3
    assert seeded.filter(division_type=Division.DivisionType.DIRECTORATE).count() == 18
    assert seeded.filter(division_type=Division.DivisionType.DIVISION).count() == 27
    assert StaffUnit.objects.filter(division__code__startswith=SEED).count() == 426
    assert (
        StaffUnit.objects.filter(division__code__startswith=SEED, employee__isnull=True).count() == 0
    ), "остались незанятые слоты"
    assert Employee.objects.filter(personnel_number__startswith=PREFIX, photo="").count() == 0


def test_the_second_run_changes_nothing(monkeypatch, tmp_path):
    _photos(monkeypatch, tmp_path)
    call_command("seed_demo_all", "--skip-ops")
    before = (Division.objects.count(), StaffUnit.objects.count(), Employee.objects.count())

    call_command("seed_demo_all", "--skip-ops")

    assert (Division.objects.count(), StaffUnit.objects.count(), Employee.objects.count()) == before


def test_skip_ops_leaves_the_section_alone(monkeypatch, tmp_path):
    _photos(monkeypatch, tmp_path)

    call_command("seed_demo_all", "--skip-ops")

    assert not StatusType.objects.exists(), "раздел ОМ тронут, хотя его просили не трогать"


def test_ops_steps_are_declared_and_run_after_personnel():
    """Раздел ОМ идёт ПОСЛЕ кадров: его сиды берут людей, которые уже есть."""
    assert [command for command, _ in OPS_STEPS] == [
        "seed_status_types",
        "seed_operations",
        "seed_legal_documents",
    ]


def test_wipe_removes_the_personnel_and_says_what_is_left(monkeypatch, tmp_path, capsys):
    _photos(monkeypatch, tmp_path)
    call_command("seed_demo_all", "--skip-ops")

    call_command("seed_demo_all", "--wipe")

    assert Division.objects.filter(code__startswith=SEED).count() == 0
    assert StaffUnit.objects.filter(division__code__startswith=SEED).count() == 0
    assert Employee.objects.filter(personnel_number__startswith=PREFIX).count() == 0
    assert "раздела ОМ" in capsys.readouterr().out, "снос обязан назвать, чего он НЕ трогал"


def _photos(monkeypatch, tmp_path):
    """Три маленьких снимка вместо папки заказчика: 192 МБ в тесте не нужны."""
    from PIL import Image

    for index in range(3):
        Image.new("RGB", (60, 40), (index * 60, 90, 160)).save(tmp_path / f"{index}.png")
    monkeypatch.setattr(
        "organization_management.apps.employees.management.commands.seed_employee_photos.DEFAULT_SOURCE",
        tmp_path,
    )
