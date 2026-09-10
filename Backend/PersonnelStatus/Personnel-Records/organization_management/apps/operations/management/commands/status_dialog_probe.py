"""Изолированная planned-фикстура ОМ для browser-проверки окна статусов.

Команда намеренно не вызывает кадровый сервис: он может отменить реальный
плановый статус сотрудника. Она напрямую создаёт три будущие строки с уникальным
маркером: кадровую, точный OM-дубль и OM-строку с одной другой датой. ``purge``
удаляет всю тройку по заранее известному точному маркеру, даже если вывод
``create`` оборвался до разбора id; каскад удаляет и историю кадровой строки.
Это тестовая утилита рядом с другими seed/purge командами стенда.
"""

from __future__ import annotations

import json
import re
from datetime import date, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.statuses.models import EmployeeStatus


MARKER_PREFIX = "status-dialog-e2e:"
STATUS_TYPE_CODE = "STUDY"
_MARKER = re.compile(r"^status-dialog-e2e:[A-Za-z0-9._:-]{8,160}$")


class Command(BaseCommand):
    help = "Создать или полностью удалить собственную planned-фикстуру окна статусов."

    def add_arguments(self, parser):
        parser.add_argument("action", choices=("create", "purge"))
        parser.add_argument("--marker", required=True)
        parser.add_argument("--status-id", type=int)
        parser.add_argument("--employee-id", type=int)
        parser.add_argument("--start-date")
        parser.add_argument("--end-date")

    def handle(self, *args, **options):
        marker = options["marker"]
        if not _MARKER.fullmatch(marker):
            raise CommandError(
                f"--marker обязан начинаться с {MARKER_PREFIX!r} и содержать "
                "только ASCII-буквы, цифры, точку, двоеточие, дефис или подчёркивание"
            )
        if options["action"] == "create":
            payload = self._create(options, marker)
        else:
            payload = self._purge(options, marker)
        self.stdout.write(json.dumps(payload, ensure_ascii=False, sort_keys=True))

    @transaction.atomic
    def _create(self, options, marker: str) -> dict:
        employee_id = options["employee_id"]
        if employee_id is None:
            raise CommandError("create требует --employee-id")
        try:
            start_date = date.fromisoformat(options["start_date"] or "")
            end_date = date.fromisoformat(options["end_date"] or "")
        except ValueError as error:
            raise CommandError("create требует даты ISO в --start-date/--end-date") from error
        if start_date <= clock.Clock.today_local():
            raise CommandError("фикстура обязана быть будущей")
        if end_date <= start_date:
            raise CommandError("--end-date обязана быть позже --start-date")
        employee = Employee.objects.select_for_update().filter(pk=employee_id).first()
        if employee is None:
            raise CommandError(f"сотрудник {employee_id} не найден")
        status_type = StatusType.objects.filter(pk=STATUS_TYPE_CODE, is_active=True).first()
        if status_type is None:
            raise CommandError(f"активный тип {STATUS_TYPE_CODE} не найден")
        legacy_code = status_type.legacy_code
        if not legacy_code:
            raise CommandError(f"тип {STATUS_TYPE_CODE} не связан с кадровым legacy_code")
        hr_comment = f"{marker}:hr"
        exact_ops_comment = f"{marker}:ops-exact"
        near_ops_comment = f"{marker}:ops-near"
        if (
            OpsEmployeeStatus.objects.filter(created_by=marker).exists()
            or EmployeeStatus.objects.filter(comment=hr_comment).exists()
        ):
            raise CommandError("фикстура с этим маркером уже существует; сначала purge")

        hr = EmployeeStatus.objects.create(
            employee=employee,
            status_type=legacy_code,
            state=EmployeeStatus.StatusState.PLANNED,
            start_date=start_date,
            end_date=end_date,
            comment=hr_comment,
        )
        exact_ops = OpsEmployeeStatus.objects.create(
            employee_id=employee.pk,
            status_type_code=status_type.pk,
            date_start=start_date,
            date_end=end_date,
            source=OpsEmployeeStatus.Source.USER,
            created_by=marker,
            comment=exact_ops_comment,
        )
        near_ops = OpsEmployeeStatus.objects.create(
            employee_id=employee.pk,
            status_type_code=status_type.pk,
            date_start=start_date,
            date_end=end_date + timedelta(days=1),
            source=OpsEmployeeStatus.Source.USER,
            created_by=marker,
            comment=near_ops_comment,
        )
        return {
            "employee_id": employee.pk,
            "employee_name": f"{employee.last_name} {employee.first_name}".strip(),
            "legacy_code": legacy_code,
            "ops_code": status_type.pk,
            "status_label": status_type.name,
            "start_date": start_date.isoformat(),
            "exact_end_date": end_date.isoformat(),
            "near_end_date": near_ops.date_end.isoformat(),
            "hr": {
                "id": hr.pk,
                "comment": hr_comment,
                "state": hr.state,
            },
            "ops_exact": {
                "id": exact_ops.pk,
                "comment": exact_ops_comment,
                "state": str(exact_ops.state),
            },
            "ops_near": {
                "id": near_ops.pk,
                "comment": near_ops_comment,
                "state": str(near_ops.state),
            },
            "marker": marker,
        }

    @transaction.atomic
    def _purge(self, options, marker: str) -> dict:
        status_id = options["status_id"]
        hr_comment = f"{marker}:hr"
        owned = OpsEmployeeStatus.objects.select_for_update().filter(
            source=OpsEmployeeStatus.Source.USER,
            created_by=marker,
        )
        if (
            status_id is not None
            and OpsEmployeeStatus.objects.filter(pk=status_id).exists()
            and not owned.filter(pk=status_id).exists()
        ):
            raise CommandError(
                f"статус {status_id} существует, но не принадлежит маркеру; удаление запрещено"
            )
        # Даже при переданном id удаляется ВСЯ marker-группа: create мог успеть
        # записать несколько строк, а клиент — разобрать только первый id.
        deleted_ops_statuses = owned.count()
        owned.delete()
        hr_owned = EmployeeStatus.objects.select_for_update().filter(comment=hr_comment)
        deleted_hr_statuses = hr_owned.count()
        hr_owned.delete()
        remaining = OpsEmployeeStatus.objects.filter(
            created_by=marker
        ).count() + EmployeeStatus.objects.filter(
            comment=hr_comment
        ).count()
        return {
            "deleted_hr_statuses": deleted_hr_statuses,
            "deleted_ops_statuses": deleted_ops_statuses,
            "remaining": remaining,
            "status_id": status_id,
            "marker": marker,
        }
