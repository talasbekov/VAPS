"""Фикс гонок легаси-эндпоинтов core (ревью 2026-08-08).

archive/restore/assign_employee/release получили лок строки, state-гвард и
аудит. Проверяется зона фикса:

- archive/restore идут под ``select_for_update`` и отвечают конфликтом на
  повтор (второй вызывающий узнаёт, что состояние изменил не он, а не
  получает молчаливое «ок»);
- assign-employee отклоняет занятый слот (без гварда два конкурирующих
  assign создавали ДВА открытых назначения), проверяет вход и существование
  сотрудника;
- release закрывает действующие назначения; пустой release ничего не пишет
  в аудит — аудит рассказывает о случившемся;
- каждая успешная мутация оставляет строку аудита с актором из
  аутентификации; лок-ассерты — по ИМЕНИ ТАБЛИЦЫ (любое "FOR UPDATE"
  вакуумно).
"""
import datetime as dt

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    EmployeeStaffingAssignment,
    Organization,
    Position,
    Rank,
    StaffingSlot,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def env():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    div = Division.objects.create(
        organization=org, type_code=dtp, name="D", code="D"
    )
    pos = Position.objects.create(code="OPER", name="Опер")
    Rank.objects.create(code="MAJOR", name="Майор", rank_index=30)
    return div, pos


def make_employee(div, iin="900101300800"):
    return Employee.objects.create(
        iin=iin,
        full_name="X",
        rank_code="MAJOR",
        position_code="OPER",
        division=div,
    )


def make_slot(div, pos):
    return StaffingSlot.objects.create(
        division=div,
        position_code=pos,
        valid_from=timezone.now() - dt.timedelta(days=1),
    )


def locked_tables(queries, table):
    return [
        q["sql"]
        for q in queries
        if "FOR UPDATE" in q["sql"] and table in q["sql"]
    ]


# ── archive / restore ──────────────────────────────────────────────────────


def test_archive_locks_row_audits_and_rejects_repeat(client, env, grant):
    actor = grant(client)
    div, _ = env
    emp = make_employee(div)

    with CaptureQueriesContext(connection) as ctx:
        resp = client.post(f"/api/core/employees/{emp.id}/archive/")
    assert resp.status_code == 200
    # Лок именно строки сотрудника, не «какой-нибудь FOR UPDATE».
    assert locked_tables(ctx.captured_queries, "core_employees")

    emp.refresh_from_db()
    assert emp.employment_status == Employee.EmploymentStatus.ARCHIVED
    assert emp.is_active is False

    row = AuditLog.objects.get(action="EMPLOYEE_ARCHIVED")
    assert row.actor_user_id == actor
    assert row.entity_id == emp.pk

    second = client.post(f"/api/core/employees/{emp.id}/archive/")
    assert second.status_code == 409
    assert second.json()["error_code"] == "EMPLOYEE_ALREADY_ARCHIVED"
    # Конфликт ничего не аудирует: изменения не случилось.
    assert AuditLog.objects.filter(action="EMPLOYEE_ARCHIVED").count() == 1


def test_restore_only_from_archive(client, env, grant):
    grant(client)
    div, _ = env
    emp = make_employee(div)

    premature = client.post(f"/api/core/employees/{emp.id}/restore/")
    assert premature.status_code == 409
    assert premature.json()["error_code"] == "EMPLOYEE_NOT_ARCHIVED"

    client.post(f"/api/core/employees/{emp.id}/archive/")
    restored = client.post(f"/api/core/employees/{emp.id}/restore/")
    assert restored.status_code == 200
    emp.refresh_from_db()
    assert emp.employment_status == Employee.EmploymentStatus.WORKING
    assert emp.is_active is True
    assert AuditLog.objects.filter(action="EMPLOYEE_RESTORED").count() == 1


# ── assign-employee / release ──────────────────────────────────────────────


def test_assign_rejects_occupied_slot(client, env, grant):
    actor = grant(client)
    div, pos = env
    slot = make_slot(div, pos)
    first = make_employee(div)
    second = make_employee(div, iin="900101300801")

    with CaptureQueriesContext(connection) as ctx:
        ok = client.post(
            f"/api/core/staffing-slots/{slot.id}/assign-employee/",
            {"employee_id": str(first.id)},
            format="json",
        )
    assert ok.status_code == 201
    assert locked_tables(ctx.captured_queries, "core_staffing_slots")
    assignment = EmployeeStaffingAssignment.objects.get()
    assert assignment.created_by == actor
    audit = AuditLog.objects.get(action="STAFFING_ASSIGNMENT_CREATED")
    assert audit.entity_id == slot.pk

    conflict = client.post(
        f"/api/core/staffing-slots/{slot.id}/assign-employee/",
        {"employee_id": str(second.id)},
        format="json",
    )
    assert conflict.status_code == 409
    assert conflict.json()["error_code"] == "STAFFING_SLOT_OCCUPIED"
    # Второго открытого назначения не появилось — в этом и была гонка.
    assert EmployeeStaffingAssignment.objects.count() == 1


def test_assign_validates_input(client, env, grant):
    grant(client)
    div, pos = env
    slot = make_slot(div, pos)

    empty = client.post(
        f"/api/core/staffing-slots/{slot.id}/assign-employee/",
        {},
        format="json",
    )
    assert empty.status_code == 400
    assert empty.json()["error_code"] == "VALIDATION_ERROR"

    ghost = client.post(
        f"/api/core/staffing-slots/{slot.id}/assign-employee/",
        {"employee_id": "00000000-0000-0000-0000-000000000000"},
        format="json",
    )
    assert ghost.status_code == 404
    assert ghost.json()["error_code"] == "ENTITY_NOT_FOUND"
    assert EmployeeStaffingAssignment.objects.count() == 0


def test_release_closes_and_audits_only_real_changes(client, env, grant):
    grant(client)
    div, pos = env
    slot = make_slot(div, pos)
    emp = make_employee(div)
    client.post(
        f"/api/core/staffing-slots/{slot.id}/assign-employee/",
        {"employee_id": str(emp.id)},
        format="json",
    )

    released = client.post(f"/api/core/staffing-slots/{slot.id}/release/")
    assert released.status_code == 200
    assignment = EmployeeStaffingAssignment.objects.get()
    assert assignment.ends_at is not None
    assert AuditLog.objects.filter(
        action="STAFFING_ASSIGNMENT_RELEASED"
    ).count() == 1

    # Освободили слот повторно, а после конфликта назначение снова возможно.
    idempotent = client.post(f"/api/core/staffing-slots/{slot.id}/release/")
    assert idempotent.status_code == 200
    # Пустой release ничего не менял — второй строки аудита нет.
    assert AuditLog.objects.filter(
        action="STAFFING_ASSIGNMENT_RELEASED"
    ).count() == 1
    reassign = client.post(
        f"/api/core/staffing-slots/{slot.id}/assign-employee/",
        {"employee_id": str(emp.id)},
        format="json",
    )
    assert reassign.status_code == 201
