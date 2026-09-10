"""Accounts/staff, dictionaries, route settings and passports; no business transitions."""
import json
import logging
import os

logging.disable(logging.CRITICAL)
from django.db import connection, transaction
from django.contrib.auth.models import User
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.operations.models import UserRole
from organization_management.apps.operations.models_object import OpsSecurityObject
from organization_management.apps.ops import passport
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models_submission import OpsDivisionNotifyRecipient
from organization_management.apps.operations.models_settings import OpsApprovalRouteStep
from organization_management.apps.dictionaries.models import Position

assert os.environ.get("PR_DB_NAME") == "personnel_records_1090"
assert connection.settings_dict["NAME"] == "personnel_records_1090"

with transaction.atomic():
    senior_template = Employee.objects.get(user__username="acc_employee_d2")
    participant_template = Employee.objects.get(user__username="acc_employee")
    approver_template = Employee.objects.get(user__username="acc_dept_head_d2")
    people = {}
    for key, surname, template, role_code in [
        ("senior", "Приёмка1090Старший", senior_template, "EMPLOYEE_OPS_D2"),
        ("senior2", "Приёмка1090Второй", senior_template, "EMPLOYEE_OPS_D2"),
        ("participant", "Приёмка1090Участник", participant_template, "EMPLOYEE"),
        ("noaccount", "Приёмка1090БезУчётки", participant_template, None),
        ("group", "Приёмка1090Группа", participant_template, "EMPLOYEE"),
        ("group2", "Приёмка1090Досмотр", participant_template, "EMPLOYEE"),
        ("dailyhead", "Приёмка1090Начальник", participant_template, "DIRECTORATE_HEAD"),
        ("approver2", "Приёмка1090Заместитель", approver_template, "EVENT_APPROVER"),
    ]:
        employee, _ = Employee.objects.get_or_create(
            personnel_number=f"1090-{key}",
            defaults={"last_name": surname, "first_name": "Проверка", "rank": template.rank},
        )
        unit = template.staff_unit
        position = unit.position
        if key == "approver2":
            position, _ = Position.objects.get_or_create(
                code="PROBE1090_ORG_DEPUTY", defaults={
                    "name": "Заместитель руководителя организации", "level": 1,
                },
            )
        StaffUnit.objects.get_or_create(employee=employee, defaults={
            "division": unit.division, "position": position, "index": 1090,
        })
        if role_code:
            user, _ = User.objects.get_or_create(username=f"probe1090_{key}", defaults={"first_name": "Проверка", "last_name": surname})
            assert not user.is_superuser and not user.is_staff
            user.set_password(os.environ["ACCESS_MATRIX_PASSWORD"])
            user.save(update_fields=["password"])
            employee.user = user
            employee.save(update_fields=["user"])
            UserRole.objects.get_or_create(user_id=str(user.pk), role_code_id=role_code, scope_division_id=unit.division_id, defaults={"is_active": True})
        people[key] = {"id": str(employee.pk), "name": str(employee), "divisionId": str(unit.division_id)}
    # Controller-approved configuration prerequisite. Never mutate a visit's
    # copied route, signatures or stage; UI select performs recovery itself.
    steps = list(OpsApprovalRouteStep.objects.select_for_update().order_by("position"))
    if not steps:
        for index, role_label, username in [
            (1, "Руководитель второго департамента", "acc_dir_head_d2"),
            (2, "Заместитель руководителя организации", "probe1090_approver2"),
        ]:
            signer = User.objects.get(username=username)
            employee = Employee.objects.get(user=signer)
            OpsApprovalRouteStep.objects.create(
                position=index, role_label=role_label, username=username,
                full_name=" ".join(filter(None, [employee.last_name, employee.first_name, employee.middle_name])),
                unit="Приёмка1090", created_by="probe1090",
            )
        steps = list(OpsApprovalRouteStep.objects.order_by("position"))
    assert len(steps) == 2 and [step.position for step in steps] == [1, 2]
    assert steps[1].role_label == "Заместитель руководителя организации"
    assert len({step.username for step in steps}) == 2
    assert all(User.objects.filter(username=step.username, is_active=True).exists() for step in steps)
    # Controller-approved prerequisite directory entry: only one absent
    # mapping, to our own probe account; never replace another recipient.
    reminder_division = Division.objects.filter(parent_id=631).exclude(pk=632).order_by("pk").first()
    assert reminder_division is not None
    recipient = str(User.objects.get(username="probe1090_dailyhead").pk)
    mapping, _ = OpsDivisionNotifyRecipient.objects.get_or_create(
        division_id=reminder_division.pk, defaults={"recipient": recipient},
    )
    assert mapping.recipient == recipient, "Never overwrite another recipient"
    objects = []
    for number in [1, 2]:
        name = f"Приёмка1090 Объект {number}"
        obj = OpsSecurityObject.objects.filter(name=name).first()
        if obj is None:
            obj = passport.create_object(name=name, object_type="Государственное учреждение", region="г. Астана", address=f"Приёмка1090, {number}")
            passport.update_passport(obj, [{"name": "Периметр", "posts": [
                {"name": f"Пост {number}", "task": "Охрана периметра", "requirements": "Допуск"},
                {"name": f"Досмотр {number}", "task": "Пропускной режим", "requirements": "Допуск"},
            ]}])
            passport.publish_version(obj, effective_from="2026-09-09", note="Prerequisite №1090; Исполнитель: Кодекс Астра 6", actor="probe1090")
        assert obj.passport_versions.exists()
        objects.append({"id": str(obj.pk), "name": obj.name})
print(json.dumps({"people": people, "objects": objects, "reminderDivisionId": reminder_division.pk}, ensure_ascii=False))
