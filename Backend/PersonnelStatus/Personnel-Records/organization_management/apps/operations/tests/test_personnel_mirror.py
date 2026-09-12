"""Кадровый статус → факт раздела ОМ (Plane №1209).

Начальник управления ставит статусы в «Статусах сотрудников» — это кадровая
таблица `employee_statuses`. Расход, снимок сдачи, светофор и таблица
ответственного читают ТОЛЬКО факты раздела `ops_employee_statuses`. Без
проекции «Сдать день» со «Статусов» сдавал не то, что начальник видел и правил
(на стенде 12.09.2026: кадровый больничный 08–18.09 — в расходе «в строю»).

Здесь проверяется сама проекция (сигнал + модуль) и то, что снимок сдачи её
видит. Правила чтения раздела не меняются — они покрыты своими пробами.
"""
from datetime import timedelta

import pytest
from django.contrib.auth.models import User
from django.core.management import call_command
from django.utils import timezone

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.personnel_mirror import (
    SYSTEM_ACTOR,
    mirror_personnel_status,
    source_ref_for,
)
from organization_management.apps.operations.snapshot import build_division_snapshot
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.tests.test_status_service import (
    make_employee,
)
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus

pytestmark = pytest.mark.django_db

PERSONNEL = "PERSONNEL"


@pytest.fixture(autouse=True)
def catalog():
    """Настоящий каталог с мостом `legacy_code` — проекция ищет пару по нему."""
    call_command("seed_status_types", verbosity=0)


@pytest.fixture
def actor():
    return User.objects.create_user(username="kadry", password="x")


def today():
    return timezone.localdate()


def personnel(employee, kind, start, end, *, actor=None, **extra):
    return EmployeeStatus.objects.create(
        employee=employee,
        status_type=kind,
        start_date=start,
        end_date=end,
        created_by=actor,
        **extra,
    )


def projections(status):
    return list(
        OpsEmployeeStatus.objects.filter(source_ref=source_ref_for(status.pk)).order_by("pk")
    )


def live(status):
    rows = [row for row in projections(status) if row.cancelled_at is None]
    assert len(rows) <= 1, "у одной кадровой строки не бывает двух живых проекций"
    return rows[0] if rows else None


# ── Создание ────────────────────────────────────────────────────────────────


def test_vacation_becomes_a_section_fact_with_half_open_interval(actor):
    employee = make_employee()
    t = today()
    status = personnel(employee, "vacation", t, t + timedelta(days=3), actor=actor)

    row = live(status)
    assert row is not None
    assert row.employee_id == employee.id
    assert row.status_type_code == "VACATION"
    # Кадровая дата окончания ВКЛЮЧИТЕЛЬНАЯ, раздел хранит [start, end).
    assert (row.date_start, row.date_end) == (t, t + timedelta(days=4))
    assert row.source == PERSONNEL
    assert row.created_by == SYSTEM_ACTOR
    assert row.document_basis == f"Кадровый статус №{status.pk}"


def test_in_service_is_not_projected():
    employee = make_employee()
    status = personnel(employee, "in_service", today(), None)
    assert projections(status) == []


def test_type_without_a_pair_in_the_catalog_is_not_projected():
    employee = make_employee()
    t = today()
    status = personnel(employee, "mystery", t, t + timedelta(days=1))
    assert projections(status) == []


def test_planned_without_end_date_is_not_projected():
    employee = make_employee()
    t = today()
    status = personnel(
        employee, "vacation", t + timedelta(days=2), None,
        state=EmployeeStatus.StatusState.PLANNED,
    )
    assert projections(status) == []


def test_projection_is_idempotent_on_repeated_save(actor):
    employee = make_employee()
    t = today()
    status = personnel(employee, "sick_leave", t, t + timedelta(days=2), actor=actor)
    status.save()
    status.save()
    assert len(projections(status)) == 1


# ── Жизненный цикл ──────────────────────────────────────────────────────────


def test_extend_moves_the_projected_end(actor):
    employee = make_employee()
    t = today()
    status = personnel(employee, "vacation", t, t + timedelta(days=3), actor=actor)
    status.extend(t + timedelta(days=6))
    assert live(status).date_end == t + timedelta(days=7)
    assert len(projections(status)) == 1


def test_early_termination_shrinks_the_projection(actor):
    employee = make_employee()
    t = today()
    status = personnel(
        employee, "business_trip", t - timedelta(days=2), t + timedelta(days=5), actor=actor
    )
    status.terminate_early(t - timedelta(days=1), "вернулся раньше")
    row = live(status)
    assert row.status_type_code == "COMMAND"
    assert row.date_end == t  # actual_end_date + 1


def test_cancelled_plan_cancels_the_projection(actor):
    employee = make_employee()
    t = today()
    status = personnel(
        employee, "vacation", t + timedelta(days=2), t + timedelta(days=4), actor=actor
    )
    assert live(status) is not None
    status.cancel("передумали")
    rows = projections(status)
    assert len(rows) == 1
    assert rows[0].cancelled_at is not None
    assert rows[0].cancelled_by == SYSTEM_ACTOR
    assert live(status) is None


def test_deleted_personnel_row_cancels_the_projection(actor):
    employee = make_employee()
    t = today()
    status = personnel(employee, "vacation", t, t + timedelta(days=1), actor=actor)
    pk = status.pk
    status.delete()
    rows = list(OpsEmployeeStatus.objects.filter(source_ref=source_ref_for(pk)))
    assert len(rows) == 1 and rows[0].cancelled_at is not None


def test_type_change_to_in_service_cancels_the_projection(actor):
    employee = make_employee()
    t = today()
    status = personnel(employee, "vacation", t, t + timedelta(days=1), actor=actor)
    status.status_type = "in_service"
    status.end_date = None
    status.save()
    assert live(status) is None
    assert len(projections(status)) == 1


# ── Конфликты ───────────────────────────────────────────────────────────────


def test_hard_conflict_in_the_section_is_skipped_without_breaking_the_personnel_save(actor):
    employee = make_employee()
    t = today()
    OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code="SICK_LEAVE",
        date_start=t,
        date_end=t + timedelta(days=4),
        source=OpsEmployeeStatus.Source.USER,
        created_by="7",
    )
    status = personnel(employee, "vacation", t, t + timedelta(days=3), actor=actor)

    assert EmployeeStatus.objects.filter(pk=status.pk).exists()
    assert projections(status) == []
    # Ручной факт раздела не тронут.
    assert OpsEmployeeStatus.objects.filter(source=OpsEmployeeStatus.Source.USER).count() == 1


def test_the_projection_is_read_only_for_section_operators(actor):
    employee = make_employee()
    t = today()
    status = personnel(employee, "vacation", t, t + timedelta(days=1), actor=actor)
    row = live(status)
    with pytest.raises(Exception) as caught:
        row.assert_user_editable()
    assert getattr(caught.value, "code", None) == "AUTO_STATUS_READONLY"


# ── Прямой вызов (бэкфилл миграции) ─────────────────────────────────────────


def test_direct_call_reports_outcome(actor):
    employee = make_employee()
    t = today()
    status = personnel(employee, "vacation", t, t + timedelta(days=1), actor=actor)
    assert mirror_personnel_status(status) == "unchanged"
    status.end_date = t + timedelta(days=2)
    EmployeeStatus.objects.filter(pk=status.pk).update(end_date=status.end_date)
    assert mirror_personnel_status(status) == "updated"


def test_direct_call_accepts_model_classes_for_migrations(actor):
    employee = make_employee()
    t = today()
    status = personnel(employee, "sick_leave", t, t + timedelta(days=1), actor=actor)
    OpsEmployeeStatus.objects.filter(source_ref=source_ref_for(status.pk)).delete()
    outcome = mirror_personnel_status(
        status, ops_status_model=OpsEmployeeStatus, status_type_model=StatusType
    )
    assert outcome == "created"
    assert live(status).status_type_code == "SICK_LEAVE"


# ── Снимок сдачи видит кадровый статус ─────────────────────────────────────


def test_day_snapshot_includes_the_personnel_vacation(actor):
    division = Division.objects.create(name="Управление 1")
    employee = make_employee()
    StaffUnit.objects.create(division=division, employee=employee, index=employee.id)
    t = today()
    status = personnel(
        employee, "vacation", t + timedelta(days=1), t + timedelta(days=3), actor=actor
    )

    snapshot = build_division_snapshot(division.id, t + timedelta(days=1))

    rows = [row for row in snapshot["rows"] if row["employee_id"] == employee.id]
    assert [(row["status_type_code"], row["source"]) for row in rows] == [
        ("VACATION", PERSONNEL)
    ]
    assert rows[0]["status_id"] == live(status).id


# ── Бэкфилл миграции 0124 ───────────────────────────────────────────────────


def test_migration_backfill_projects_existing_personnel_rows(actor, capsys):
    from django.apps import apps as registry
    from importlib import import_module

    backfill = import_module(
        "organization_management.apps.operations.migrations.0124_personnel_mirror"
    )._backfill
    employee = make_employee()
    t = today()
    active = personnel(employee, "vacation", t, t + timedelta(days=1), actor=actor)
    in_service = personnel(
        make_employee(), "in_service", t - timedelta(days=30), None, actor=actor
    )
    # Как на базе до миграции: кадровые строки есть, проекций нет.
    OpsEmployeeStatus.objects.filter(source=PERSONNEL).delete()

    backfill(registry, None)

    assert live(active).status_type_code == "VACATION"
    assert projections(in_service) == []
    assert "created=1" in capsys.readouterr().out
    # Повторный прогон ничего не дублирует.
    backfill(registry, None)
    assert len(projections(active)) == 1


# ── Сдача управления накрывает отделы ──────────────────────────────────────


def test_day_submission_of_a_directorate_covers_its_sections(actor):
    from organization_management.apps.operations.day_submission_service import submit_day

    directorate = Division.objects.create(name="Управление 1")
    section = Division.objects.create(name="Отдел 1", parent=directorate)
    employee = make_employee()
    StaffUnit.objects.create(division=section, employee=employee, index=employee.id)
    t = today()
    personnel(employee, "vacation", t + timedelta(days=1), t + timedelta(days=2), actor=actor)

    submission = submit_day(
        division_id=directorate.id,
        business_date=t + timedelta(days=1),
        actor="7",
        window_dates=[t + timedelta(days=1)],
    )

    roster = [row["employee_id"] for row in submission.snapshot["roster"]]
    assert roster == [employee.id], "человек отдела обязан войти в сдачу управления"
    assert [(row["status_type_code"], row["source"]) for row in submission.snapshot["rows"]] == [
        ("VACATION", PERSONNEL)
    ]
    assert submission.snapshot["staff_total"] == 1
    # Сводка родителя берёт СВОЙ уровень: билдер без флага — как прежде.
    own = build_division_snapshot(directorate.id, t + timedelta(days=1))
    assert own["roster"] == [] and own["staff_total"] == 0
