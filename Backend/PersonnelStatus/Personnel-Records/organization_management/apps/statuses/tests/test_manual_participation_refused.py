"""«Участие в ОМ» кадровой моделью не заводится — НА ВСЕХ ВХОДАХ (Plane №840).

🔴 ЗАЧЕМ ЭТА ПРОБА, ЕСЛИ ЗАПРЕТ УЖЕ БЫЛ. Он был — во вью кадровой ручки
(`staff_unit/views.py`, Plane №757), и там работал. А мимо шли ещё три адреса:
`POST /api/statuses/statuses/`, `POST /api/statuses/statuses/bulk_plan/` и
`PATCH /api/statuses/statuses/<id>/`. Последний достижим МЫШКОЙ: окно
запланированных статусов предлагало тип из общего справочника и сохраняло его
этой ручкой. То есть проверку обходили сменой адреса — ровно то, чего №757 не
хотел («проверка, которую можно обойти другим клиентом, проверкой не
является»), и дефект «привлечён неизвестно куда» жил у пользователя, а не
только у того, кто умеет слать запросы.

КРАСНАЯ ПРОБА: снять вызов `refuse_manual_participation` из
`statuses/api/serializers.py::validate_status_type` — красными станут пробы
создания и правки; снять из `application/services.py::create_status` — красной
станет проба планирования.

🔴 И ОТДЕЛЬНО — ЧТО ЗАПРЕТ НЕ ДОЛЖЕН ЛОМАТЬ. Уже лежащие строки участия
обязаны править́ся и закрываться: `save()` гоняет `full_clean`, и запрет,
поставленный в модель, остановил бы даже закрытие статуса при увольнении
(`signals.py::close_statuses_on_dismissal`). Поэтому запрет — на СМЕНУ типа, и
здесь это проверяется отдельной пробой.
"""
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.exceptions import ValidationError as DrfValidationError

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.statuses.api.serializers import (
    EmployeeStatusSerializer,
)
from organization_management.apps.statuses.application.services import (
    StatusApplicationService,
)
from organization_management.apps.statuses.models import EmployeeStatus

_ST = EmployeeStatus.StatusType

#: Код участия — тот же, что у раздела ОМ. Литерал здесь намеренный: проба
#: стережёт границу между двумя учётами, и брать код из того же места, что
#: код под пробой, значило бы проверять сам себя.
PARTICIPATION = "IN_EVENT"


@pytest.fixture
def catalog(db):
    """Справочник типов — своими строками, а не «как повезёт» (Plane №354).

    Проверка кода идёт по СПРАВОЧНИКУ (`validate_status_type_code`), и без
    заведённых строк отказ пришёл бы «типа нет в справочнике» — то есть проба
    была бы зелёной по неверной причине и перестала бы стеречь свой предмет.
    """
    StatusType.objects.create(
        code=PARTICIPATION, name="Участие в ОМ", priority=50, report_column_code="ABSENT"
    )
    StatusType.objects.create(
        code=_ST.VACATION, name="Отпуск", priority=51, report_column_code="ABSENT"
    )


@pytest.fixture
def author(db):
    return get_user_model().objects.create_user(username="mp-author")


@pytest.fixture
def employee(db):
    return Employee.objects.create(
        personnel_number="mp-1", last_name="Участнов", first_name="Пётр"
    )


def test_creating_participation_through_the_personnel_serializer_is_refused(catalog, employee):
    """`POST /api/statuses/statuses/` — вход, которого №757 не видел."""
    serializer = EmployeeStatusSerializer(
        data={
            "employee": employee.pk,
            "status_type": PARTICIPATION,
            "start_date": str(timezone.localdate()),
        }
    )
    assert not serializer.is_valid()
    assert "status_type" in serializer.errors
    assert "кадровой ручкой не ставится" in str(serializer.errors["status_type"])


def test_switching_an_existing_status_to_participation_is_refused(catalog, employee, author):
    """`PATCH /api/statuses/statuses/<id>/` — тот самый путь окна запланированных.

    Здесь дефект и открывался мышкой: тип менялся на участие у уже
    существующей строки.
    """
    status = EmployeeStatus.objects.create(
        employee=employee,
        status_type=_ST.IN_SERVICE,
        start_date=timezone.localdate() - timedelta(days=1),
        created_by=author,
    )
    serializer = EmployeeStatusSerializer(
        status, data={"status_type": PARTICIPATION}, partial=True
    )
    assert not serializer.is_valid()
    assert "кадровой ручкой не ставится" in str(serializer.errors["status_type"])


def test_planning_participation_is_refused(catalog, employee, author):
    """`bulk_plan` идёт через `plan_status` → `create_status` — тот же вход."""
    with pytest.raises(DrfValidationError) as refused:
        StatusApplicationService().plan_status(
            employee_id=employee.pk,
            status_type=PARTICIPATION,
            start_date=timezone.localdate() + timedelta(days=2),
            end_date=timezone.localdate() + timedelta(days=3),
            user=author,
        )
    assert "кадровой ручкой не ставится" in str(refused.value)


def test_an_ordinary_status_still_passes_every_entry(catalog, employee, author):
    """Починка «закрытием ручки целиком» — не починка.

    Обычный статус обязан заводиться и планироваться, как раньше: без этой
    пробы запрет можно было бы «усилить» до отказа всему подряд, и никто бы не
    заметил.
    """
    serializer = EmployeeStatusSerializer(
        data={
            "employee": employee.pk,
            "status_type": _ST.VACATION,
            "start_date": str(timezone.localdate()),
            # Отпуску дата конца обязательна — правило модели, не наше.
            "end_date": str(timezone.localdate() + timedelta(days=3)),
        }
    )
    assert serializer.is_valid(), serializer.errors

    planned = StatusApplicationService().plan_status(
        employee_id=employee.pk,
        status_type=_ST.VACATION,
        start_date=timezone.localdate() + timedelta(days=2),
        end_date=timezone.localdate() + timedelta(days=3),
        user=author,
    )
    assert planned.pk is not None


def test_an_existing_participation_row_can_still_be_closed(catalog, employee, author):
    """Запрет — на СМЕНУ типа, а не на всякое касание строки.

    Исторические строки участия обязаны закрываться (увольнение зовёт
    `close_statuses_on_dismissal` и пересохраняет их). Запрет в модели сломал
    бы это молча — здесь проверено, что он туда не переехал.
    """
    status = EmployeeStatus.objects.create(
        employee=employee,
        status_type=PARTICIPATION,
        start_date=timezone.localdate() - timedelta(days=2),
        end_date=timezone.localdate() + timedelta(days=2),
        created_by=author,
    )
    serializer = EmployeeStatusSerializer(
        status,
        data={
            "status_type": PARTICIPATION,
            "comment": "закрываем",
            "end_date": str(timezone.localdate() + timedelta(days=2)),
        },
        partial=True,
    )
    assert serializer.is_valid(), serializer.errors

    # И само пересохранение модели (тот путь, которым идёт увольнение).
    status.actual_end_date = timezone.localdate()
    status.save()
    status.refresh_from_db()
    assert status.actual_end_date == timezone.localdate()
