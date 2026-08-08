"""Массовое создание статусов раздела ОМ (порт теста Story 3.8).

Покрыто: атомарность (всё-или-ничего), поразрядная детализация (409/422 в
detail.rows[]), дубль в payload (400), увольнение (422 в строке), чужое
подразделение (403), старшинство агрегата (422 > 409) и контракт «нет N+1»
(число SQL-запросов постоянно при росте числа строк).

Своё, сверх источника: подразделение сотрудника здесь берётся из штатной
единицы, поэтому отдельно проверяется сотрудник БЕЗ штатной единицы —
он не принадлежит ничьей области видимости (403).
"""
from datetime import date, timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.bulk_status_service import (
    bulk_create_statuses,
)
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

TODAY = date(2026, 8, 4)
ACTOR = "7"


@pytest.fixture
def types():
    for code, hard, max_days in [
        ("VACATION", True, None),
        ("DUTY", False, None),
        ("STUDY", False, None),
        ("DETACHED", False, None),
        ("CONFERENCE", False, 5),
    ]:
        StatusType.objects.create(
            code=code,
            name=code,
            priority=10,
            report_column_code="X",
            is_hard_block=hard,
            max_duration_days=max_days,
            # DETACHED — ограничивающий тип (как в реальном справочнике); гвард
            # читает флаг restricts_editing, а не литерал кода.
            restricts_editing=(code == "DETACHED"),
        )


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


def make_employee(division=None, **overrides):
    # personnel_number/iin уникальны — счётчик держит фикстуры независимыми.
    seq = Employee.objects.count() + 1
    fields = {
        "first_name": "Иван",
        "last_name": "Иванов",
        "personnel_number": f"P{seq:05d}",
        "iin": f"{seq:012d}",
        "hire_date": date(2020, 1, 1),
    }
    fields.update(overrides)
    employee = Employee.objects.create(**fields)
    if division is not None:
        StaffUnit.objects.create(division=division, employee=employee, index=seq)
    return employee


def row(employee, code="DUTY", start=TODAY, end=TODAY + timedelta(days=3), **extra):
    payload = {
        "employee_id": employee.id,
        "status_type_code": code,
        "date_start": start,
        "date_end": end,
    }
    payload.update(extra)
    return payload


def live_status(employee, code="STUDY", start=TODAY, end=TODAY + timedelta(days=5)):
    return OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code=code,
        date_start=start,
        date_end=end,
    )


def bulk(rows, division, **overrides):
    kwargs = {
        "actor": ACTOR,
        "business_date": TODAY,
        "allowed_division_ids": {division.id},
    }
    kwargs.update(overrides)
    with clock.override(TODAY):
        return bulk_create_statuses(rows, **kwargs)


# ── Успешный путь ────────────────────────────────────────────────────────

def test_creates_rows_atomically(types, division):
    employees = [make_employee(division) for _ in range(3)]
    created = bulk([row(e) for e in employees], division)
    assert len(created) == 3
    assert OpsEmployeeStatus.objects.count() == 3
    stored = OpsEmployeeStatus.objects.all()
    assert all(s.source == OpsEmployeeStatus.Source.USER for s in stored)
    # Автор пачки проставляется каждой строке (в старом проекте created_by —
    # str(User.pk), как и во всём переезде).
    assert all(s.created_by == ACTOR for s in stored)


def test_optional_fields_are_carried(types, division):
    employee = make_employee(division)
    bulk(
        [row(employee, comment="в отпуске", document_basis="Приказ №5")],
        division,
    )
    stored = OpsEmployeeStatus.objects.get()
    assert stored.comment == "в отпуске"
    assert stored.document_basis == "Приказ №5"


# ── Структурные ошибки (fail-fast) ───────────────────────────────────────

def test_empty_payload_400(types, division):
    with pytest.raises(DomainError) as exc:
        bulk([], division)
    assert exc.value.http_status == 400


def test_actor_required_400(types, division):
    employee = make_employee(division)
    with pytest.raises(DomainError) as exc:
        bulk([row(employee)], division, actor="   ")
    assert exc.value.http_status == 400
    assert OpsEmployeeStatus.objects.count() == 0


def test_none_business_date_400(types, division):
    # business_date=None дошёл бы до detect_conflicts как `date > None` →
    # TypeError → 500, и построчный except его НЕ ловит.
    employee = make_employee(division)
    with pytest.raises(DomainError) as exc:
        bulk([row(employee)], division, business_date=None)
    assert exc.value.http_status == 400
    assert exc.value.code == "VALIDATION_ERROR"
    assert OpsEmployeeStatus.objects.count() == 0


def test_missing_required_row_key_400(types, division):
    employee = make_employee(division)
    payload = row(employee)
    del payload["date_end"]
    with pytest.raises(DomainError) as exc:
        bulk([payload], division)
    assert exc.value.http_status == 400
    assert exc.value.detail["index"] == 0
    assert "date_end" in exc.value.detail["missing"]
    assert OpsEmployeeStatus.objects.count() == 0


def test_duplicate_employee_in_payload_400(types, division):
    employee = make_employee(division)
    with pytest.raises(DomainError) as exc:
        bulk([row(employee), row(employee, code="STUDY")], division)
    assert exc.value.http_status == 400
    assert exc.value.code == "VALIDATION_ERROR"
    assert exc.value.detail["employee_ids"] == [str(employee.id)]
    assert OpsEmployeeStatus.objects.count() == 0


def test_missing_employee_404(types, division):
    employee = make_employee(division)
    ghost = {**row(employee), "employee_id": 999999}
    with pytest.raises(DomainError) as exc:
        bulk([row(employee), ghost], division)
    assert exc.value.http_status == 404
    assert exc.value.detail["employee_ids"] == ["999999"]
    assert OpsEmployeeStatus.objects.count() == 0


# ── Область видимости и гард откомандированного ──────────────────────────

def test_cross_division_403(types, division):
    other = Division.objects.create(name="Управление 2")
    employee = make_employee(other)
    with pytest.raises(DomainError) as exc:
        bulk([row(employee)], division)
    assert exc.value.http_status == 403
    assert exc.value.code == "PERMISSION_DENIED"
    assert exc.value.detail["employee_ids"] == [str(employee.id)]
    assert OpsEmployeeStatus.objects.count() == 0


def test_employee_without_staff_unit_403(types, division):
    # Расхождение с источником: у старого Employee нет прямой ссылки на
    # подразделение, оно берётся из штатной единицы. Сотрудник без слота не
    # принадлежит ничьей области — гейт закрыт по умолчанию.
    employee = make_employee(division=None)
    with pytest.raises(DomainError) as exc:
        bulk([row(employee)], division)
    assert exc.value.http_status == 403
    assert OpsEmployeeStatus.objects.count() == 0


def test_detached_employee_403(types, division):
    ok, detached = make_employee(division), make_employee(division)
    live_status(detached, code="DETACHED", start=TODAY - timedelta(days=1))
    with pytest.raises(DomainError) as exc:
        bulk([row(ok), row(detached)], division)
    assert exc.value.http_status == 403
    assert exc.value.detail["employee_ids"] == [str(detached.id)]
    # Гард — fail-fast: чужая валидная строка тоже не записана.
    assert OpsEmployeeStatus.objects.filter(status_type_code="DUTY").count() == 0


def test_finished_detachment_does_not_block(types, division):
    employee = make_employee(division)
    live_status(
        employee,
        code="DETACHED",
        start=TODAY - timedelta(days=10),
        end=TODAY - timedelta(days=5),
    )
    created = bulk([row(employee)], division)
    assert len(created) == 1


def test_second_restricting_type_also_blocks(types, division):
    """Гвард читает справочник, а не литерал: админ пометил ещё один тип
    restricts_editing=True — пачка обязана исполнить его так же, как одиночный
    путь. Раньше bulk знал только литерал DETACHED и такой тип пропускал."""
    StatusType.objects.create(
        code="ARREST", name="Арест", priority=10, report_column_code="X",
        is_hard_block=False, restricts_editing=True,
    )
    ok, arrested = make_employee(division), make_employee(division)
    live_status(arrested, code="ARREST", start=TODAY - timedelta(days=1))
    with pytest.raises(DomainError) as exc:
        bulk([row(ok), row(arrested)], division)
    assert exc.value.http_status == 403
    assert exc.value.detail["employee_ids"] == [str(arrested.id)]
    # Fail-fast: чужая валидная строка тоже не записана.
    assert OpsEmployeeStatus.objects.filter(status_type_code="DUTY").count() == 0


def test_confirmed_return_does_not_block_bulk(types, division):
    """Нога с подтверждённым возвратом больше не блокирует правку: ограничение
    снимает РЕШЕНИЕ, а не календарь. Одиночный путь это исполнял; пачка (литерал
    без исключения возврата) — нет. Живой DETACHED остаётся, но возврат по нему
    подтверждён, поэтому массовое обновление проходит."""
    employee = make_employee(division)
    out_leg = live_status(
        employee, code="DETACHED",
        start=TODAY - timedelta(days=3), end=TODAY + timedelta(days=1),
    )
    in_leg = live_status(
        employee, code="ATTACHED",
        start=TODAY - timedelta(days=3), end=TODAY + timedelta(days=1),
    )
    # Возврат — рукопожатие из двух фактов: сначала запрос, затем подтверждение
    # позже (CHECK «confirm after request»). Гварду важен лишь факт
    # подтверждения (не время), но данные должны быть валидны.
    requested = clock.Clock.now()
    Secondment.objects.create(
        employee_id=employee.id,
        out_status=out_leg,
        in_status=in_leg,
        from_division_id=division.id,
        to_division_id=division.id + 1,  # ≠ from (CHECK «не в самого себя»)
        return_requested_at=requested,
        return_requested_by="asker",
        return_confirmed_at=requested + timedelta(minutes=1),
        return_confirmed_by="returner",
    )
    # Новая строка после ноги — без пересечения, чтобы 403 гварда (а не 409/422
    # конфликта) был единственным возможным исходом до фикса.
    created = bulk(
        [row(employee, start=TODAY + timedelta(days=3), end=TODAY + timedelta(days=5))],
        division,
    )
    assert len(created) == 1


# ── Построчные бизнес-ошибки (агрегация) ─────────────────────────────────

def test_soft_overlap_409_nothing_written(types, division):
    clean, conflicting = make_employee(division), make_employee(division)
    live_status(conflicting, code="STUDY")
    before = OpsEmployeeStatus.objects.count()
    with pytest.raises(DomainError) as exc:
        bulk([row(clean), row(conflicting)], division)
    assert exc.value.http_status == 409
    assert exc.value.code == "STATUS_OVERLAP_WARNING"
    rows = exc.value.detail["rows"]
    assert [r["employee_id"] for r in rows] == [str(conflicting.id)]
    assert rows[0]["index"] == 1
    # Валидная строка пачки тоже не записана — всё-или-ничего.
    assert OpsEmployeeStatus.objects.count() == before


def test_hard_overlap_422(types, division):
    employee = make_employee(division)
    live_status(employee, code="VACATION")
    with pytest.raises(DomainError) as exc:
        bulk([row(employee, code="VACATION")], division)
    assert exc.value.http_status == 422
    assert exc.value.detail["rows"][0]["code"] == "OVERLAPPING_HARD_STATUS"


def test_unknown_status_type_422(types, division):
    employee = make_employee(division)
    with pytest.raises(DomainError) as exc:
        bulk([row(employee, code="NO_SUCH_TYPE")], division)
    assert exc.value.http_status == 422
    assert exc.value.detail["rows"][0]["code"] == "INVALID_STATUS_TYPE"
    assert OpsEmployeeStatus.objects.count() == 0


def test_inactive_status_type_422(types, division):
    StatusType.objects.filter(code="DUTY").update(is_active=False)
    employee = make_employee(division)
    with pytest.raises(DomainError) as exc:
        bulk([row(employee)], division)
    assert exc.value.http_status == 422
    assert exc.value.detail["rows"][0]["code"] == "INVALID_STATUS_TYPE"


def test_dismissed_employee_row_422(types, division):
    employee = make_employee(division, dismissal_date=TODAY + timedelta(days=1))
    with pytest.raises(DomainError) as exc:
        bulk([row(employee)], division)
    assert exc.value.http_status == 422
    assert exc.value.detail["rows"][0]["code"] == "DATE_OUTSIDE_EMPLOYMENT"
    assert OpsEmployeeStatus.objects.count() == 0


def test_max_duration_exceeded_row_422(types, division):
    # CONFERENCE ограничен 5 днями: 7-дневная строка ловится
    # переиспользованным _validate_interval ещё до детекта конфликтов.
    employee = make_employee(division)
    with pytest.raises(DomainError) as exc:
        bulk(
            [row(employee, code="CONFERENCE", end=TODAY + timedelta(days=7))],
            division,
        )
    assert exc.value.http_status == 422
    assert exc.value.detail["rows"][0]["code"] == "MAX_DURATION_EXCEEDED"
    assert OpsEmployeeStatus.objects.count() == 0


def test_inverted_interval_row_422(types, division):
    employee = make_employee(division)
    with pytest.raises(DomainError) as exc:
        bulk([row(employee, start=TODAY, end=TODAY)], division)
    assert exc.value.http_status == 422
    assert exc.value.detail["rows"][0]["code"] == "INVALID_DATE_RANGE"


def test_mixed_errors_aggregate_to_worst(types, division):
    hard = make_employee(division)
    live_status(hard, code="VACATION")
    soft = make_employee(division)
    live_status(soft, code="STUDY")
    with pytest.raises(DomainError) as exc:
        bulk([row(soft), row(hard, code="VACATION")], division)
    # 422 старше 409, но detail несёт ОБЕ строки со своими кодами.
    assert exc.value.http_status == 422
    rows = exc.value.detail["rows"]
    assert [r["code"] for r in rows] == [
        "STATUS_OVERLAP_WARNING",
        "OVERLAPPING_HARD_STATUS",
    ]
    assert [r["http_status"] for r in rows] == [409, 422]
    # Записаны только две предсуществующие строки.
    assert OpsEmployeeStatus.objects.count() == 2


def test_cancelled_status_leaves_conflict_perimeter(types, division):
    employee = make_employee(division)
    stale = live_status(employee, code="VACATION")
    stale.cancelled_at = clock.Clock.now()
    stale.save(update_fields=["cancelled_at"])
    created = bulk([row(employee, code="VACATION")], division)
    assert len(created) == 1


# ── Контракт «нет N+1» ───────────────────────────────────────────────────

def test_query_count_is_constant(types, division):
    # Число запросов не должно расти с числом строк: донор умер именно на
    # запросе-в-цикле. Сравниваем 5 и 50 строк — при N+1 второй прогон был бы
    # на ~45 запросов тяжелее.
    few = [make_employee(division) for _ in range(5)]
    with CaptureQueriesContext(connection) as ctx_few:
        bulk([row(e) for e in few], division)
    many = [make_employee(division) for _ in range(50)]
    with CaptureQueriesContext(connection) as ctx_many:
        bulk([row(e) for e in many], division)
    assert len(ctx_few) == len(ctx_many), (
        f"N+1: 5 строк — {len(ctx_few)} запросов, 50 строк — {len(ctx_many)}"
    )
    # И сама константа мала — страховка от «постоянного, но огромного».
    # 11-й — поиск сданных дней, накрытых пачкой (шов поправки); 12-й и 13-й —
    # единый гвард откомандированного (restricted_employee_ids: справочник
    # ограничивающих типов + один запрос по всем сотрудникам пачки). Все три —
    # по одному на всю пачку, а не на строку.
    assert len(ctx_many) <= 13
