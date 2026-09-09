"""Only accounts/staff and published passports; never advances an OM or daily state."""
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

assert os.environ.get("PR_DB_NAME") == "personnel_records_1090"
assert connection.settings_dict["NAME"] == "personnel_records_1090"

with transaction.atomic():
    senior_template = Employee.objects.get(user__username="acc_employee_d2")
    participant_template = Employee.objects.get(user__username="acc_employee")
    people = {}
    for key, surname, template, role_code in [
        ("senior", "Приёмка1090Старший", senior_template, "EMPLOYEE_OPS_D2"),
        ("senior2", "Приёмка1090Второй", senior_template, "EMPLOYEE_OPS_D2"),
        ("participant", "Приёмка1090Участник", participant_template, "EMPLOYEE"),
        ("noaccount", "Приёмка1090БезУчётки", participant_template, None),
        ("group", "Приёмка1090Группа", participant_template, "EMPLOYEE"),
        ("group2", "Приёмка1090Досмотр", participant_template, "EMPLOYEE"),
        ("dailyhead", "Приёмка1090Начальник", participant_template, "DIRECTORATE_HEAD"),
    ]:
        employee, _ = Employee.objects.get_or_create(
            personnel_number=f"1090-{key}",
            defaults={"last_name": surname, "first_name": "Проверка", "rank": template.rank},
        )
        unit = template.staff_unit
        StaffUnit.objects.get_or_create(employee=employee, defaults={
            "division": unit.division, "position": unit.position, "index": 1090,
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
