"""Изолированная planned-фикстура ОМ для browser-проверки окна статусов.

Команда намеренно не вызывает кадровый сервис: создание кадрового статуса
может отменить реальное запланированное «В строю». Строка ОМ создаётся напрямую
с уникальным маркером в ``created_by`` и ``comment``. В штатном пути purge
требует ещё и точный id; если ответ create оборвался до разбора id, известный
заранее точный маркер остаётся безопасным recovery-ключом. Это тестовая утилита
рядом с другими seed/purge командами стенда, а не пользовательский API.
"""

from __future__ import annotations

import json
import re
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.status_types import StatusType


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
        if OpsEmployeeStatus.objects.filter(created_by=marker).exists():
            raise CommandError("фикстура с этим маркером уже существует; сначала purge")

        row = OpsEmployeeStatus.objects.create(
            employee_id=employee.pk,
            status_type_code=status_type.pk,
            date_start=start_date,
            date_end=end_date,
            source=OpsEmployeeStatus.Source.USER,
            created_by=marker,
            comment=marker,
        )
        return {
            "id": row.pk,
            "employee_id": employee.pk,
            "employee_name": f"{employee.last_name} {employee.first_name}".strip(),
            "status_type": row.status_type_code,
            "status_label": status_type.name,
            "state": str(row.state),
            "start_date": row.date_start.isoformat(),
            "end_date": row.date_end.isoformat(),
            "marker": marker,
        }

    @transaction.atomic
    def _purge(self, options, marker: str) -> dict:
        status_id = options["status_id"]
        owned = OpsEmployeeStatus.objects.select_for_update().filter(
            source=OpsEmployeeStatus.Source.USER,
            created_by=marker,
            comment=marker,
        )
        if status_id is not None:
            owned = owned.filter(pk=status_id)
        deleted_statuses = owned.count()
        if (
            status_id is not None
            and deleted_statuses == 0
            and OpsEmployeeStatus.objects.filter(pk=status_id).exists()
        ):
            raise CommandError(
                f"статус {status_id} существует, но не принадлежит маркеру; удаление запрещено"
            )
        owned.delete()
        remaining_query = OpsEmployeeStatus.objects.filter(
            created_by=marker, comment=marker
        )
        if status_id is not None:
            remaining_query = remaining_query.filter(pk=status_id)
        remaining = remaining_query.count()
        return {
            "deleted_statuses": deleted_statuses,
            "remaining": remaining,
            "status_id": status_id,
            "marker": marker,
        }
