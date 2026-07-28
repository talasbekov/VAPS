"""Story 7.7 — режим «без двойного ввода»: submit_day гейт (AC-1).

Отдельный файл от test_day_submission_service.py (Story 5.3b) — новый срез
поведения, не расширение существующих тестов Story 5.3b."""

import itertools
import uuid
from datetime import date

import pytest

from apps.core import clock, parallel_run_mode
from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.submissions.services import submit_day

pytestmark = pytest.mark.django_db

TODAY = date(2026, 6, 4)
_iin = itertools.count(900)


@pytest.fixture
def division():
    org = Organization.objects.create(name="Орг", code="ORG-PRM")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dtp, name="Отдел", code="PRM-A"
    )


def make_employee(division):
    n = next(_iin)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )


def test_mode_disabled_default_submit_unaffected(division):
    """Дефолт (нет строки переключателя) = выключено — существующее
    поведение submit_day НЕ меняется (нулевая регрессия)."""
    make_employee(division)
    with clock.override(TODAY):
        sub = submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert sub is not None


def test_mode_enabled_blocks_non_pilot_division(division):
    make_employee(division)
    parallel_run_mode.enable(actor="test-setup")
    with clock.override(TODAY):
        with pytest.raises(DomainError) as ei:
            submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert ei.value.code == "PARALLEL_RUN_MANUAL_INPUT_BLOCKED"
    assert ei.value.http_status == 409


def test_mode_enabled_allows_pilot_division(division):
    make_employee(division)
    parallel_run_mode.enable(actor="test-setup")
    parallel_run_mode.add_pilot_division(division.id, actor="test-setup")
    with clock.override(TODAY):
        sub = submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert sub is not None


def test_mode_disabled_after_enable_unblocks(division):
    """AC-2: явный выключатель — disable() снимает блок для всех
    подразделений (симулирует cutover, Story 7.10)."""
    make_employee(division)
    parallel_run_mode.enable(actor="test-setup")
    parallel_run_mode.disable(actor="test-setup")
    with clock.override(TODAY):
        sub = submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert sub is not None


def test_blocked_before_existence_check_not_leaking_404(division):
    """Гейт режима срабатывает ДО проверки существования подразделения —
    несуществующая division_id при включённом режиме и без пилот-статуса
    получает 409 (состояние режима), а не 404 (это по design порядка
    гейтов в submit_day, задокументированного в докстринге)."""
    parallel_run_mode.enable(actor="test-setup")
    with clock.override(TODAY):
        with pytest.raises(DomainError) as ei:
            submit_day(division_id=uuid.uuid4(), business_date=TODAY, actor="op")
    assert ei.value.code == "PARALLEL_RUN_MANUAL_INPUT_BLOCKED"
