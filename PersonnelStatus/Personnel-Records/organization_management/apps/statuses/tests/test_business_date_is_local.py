"""Кадровая половина системы считает «сегодня» по МЕСТНОЙ дате (Plane №374).

Ловушка: `timezone.now()` отдаёт момент в UTC, и `.date()` от него — это
календарная дата UTC, а не зоны системы (`TIME_ZONE = 'Asia/Almaty'`, UTC+5).
Каждые сутки с полуночи до пяти утра по местному времени эти две даты
РАСХОДЯТСЯ на день, и сервер весь этот промежуток живёт во вчера: статус,
заведённый сегодняшним числом, приходит `planned` вместо `active` — его
нельзя ни продлить, ни завершить досрочно, и ночные задачи открывают и
закрывают статусы не тем днём.

Проба ставит часы ровно в этот промежуток (00:30 по местному = 19:30
предыдущих суток по UTC) и спрашивает то, что видит пользователь. На
`now().date()` она краснеет, на `localdate()` — зелена; это и есть мутация,
ради которой она написана.

Часы подменяются у `django.utils.timezone.now`: обе стороны спора
(`now().date()` и `localdate()`) читают именно её, поэтому подмена не
подсуживает ни одной.
"""
from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from organization_management.apps.employees.models import Employee
from organization_management.apps.statuses.models import EmployeeStatus

_ST = EmployeeStatus.StatusType
_STATE = EmployeeStatus.StatusState

#: 19:30 UTC 01.09.2026 = 00:30 местного 02.09.2026. Момент выбран внутри
#: расхождения: календарные даты UTC и зоны системы здесь разные.
NIGHT_MOMENT = datetime(2026, 9, 1, 19, 30, tzinfo=dt_timezone.utc)


@pytest.fixture
def author(db):
    return get_user_model().objects.create_user(username="business-date-author")


@pytest.fixture
def employee(db):
    return Employee.objects.create(
        personnel_number="bizdate-1", last_name="Ночной", first_name="Никита"
    )


@pytest.mark.django_db
def test_status_started_today_is_active_at_local_midnight(employee, author):
    """Статус на сегодняшнее МЕСТНОЕ число действует, а не «запланирован»."""
    with patch("django.utils.timezone.now", return_value=NIGHT_MOMENT):
        local_today = timezone.localdate()
        # Сама подмена бессмысленна, если даты не разошлись: без этой строки
        # проба зеленела бы в любой час, ничего не проверяя.
        assert local_today != timezone.now().date()

        status = EmployeeStatus.objects.create(
            employee=employee,
            status_type=_ST.IN_SERVICE,
            start_date=local_today,
            created_by=author,
        )

        assert status.state == _STATE.ACTIVE
        assert status.is_active is True


@pytest.mark.django_db
def test_status_that_ended_yesterday_is_completed_at_local_midnight(
    employee, author
):
    """Вчерашний по местному счёту статус закрыт, а не тянется активным."""
    with patch("django.utils.timezone.now", return_value=NIGHT_MOMENT):
        local_today = timezone.localdate()
        status = EmployeeStatus.objects.create(
            employee=employee,
            status_type=_ST.VACATION,
            start_date=local_today - timedelta(days=5),
            end_date=local_today - timedelta(days=1),
            created_by=author,
        )

        assert status.state == _STATE.COMPLETED
        assert status.is_active is False


@pytest.mark.django_db
def test_status_starting_tomorrow_is_still_planned(employee, author):
    """Обратная сторона: завтрашний статус остаётся запланированным.

    Без неё «починка» вида «считать активным всё подряд» прошла бы пробы.
    """
    with patch("django.utils.timezone.now", return_value=NIGHT_MOMENT):
        status = EmployeeStatus.objects.create(
            employee=employee,
            status_type=_ST.IN_SERVICE,
            start_date=timezone.localdate() + timedelta(days=1),
            created_by=author,
        )

        assert status.state == _STATE.PLANNED
