"""Гонка первичной брони дат e2e (Plane №890)."""
import json
from io import StringIO
from threading import Barrier, Thread

import pytest
from django.core.management import call_command
from django.db import connections

from organization_management.apps.operations.models_event import (
    OpsE2EFixtureDateCursor,
)
from organization_management.apps.ops.fixture_dates import (
    FIXTURE_DATE_START,
    reserve_fixture_business_dates,
)


@pytest.mark.django_db(transaction=True)
def test_two_first_reservations_are_atomic_even_when_create_races(monkeypatch):
    """Два процесса одновременно видят пустой singleton и всё же делят даты.

    Barrier стоит ровно перед INSERT, поэтому одна транзакция гарантированно
    получает IntegrityError; код обязан повторно захватить созданный курсор,
    а не вернуть тот же день или 500.
    """
    barrier = Barrier(2)
    original_create = OpsE2EFixtureDateCursor.objects.create
    dates, errors = [], []

    def synchronized_create(*args, **kwargs):
        barrier.wait(timeout=10)
        return original_create(*args, **kwargs)

    monkeypatch.setattr(OpsE2EFixtureDateCursor.objects, "create", synchronized_create)

    def reserve():
        connections.close_all()
        try:
            dates.append(reserve_fixture_business_dates(1))
        except BaseException as error:  # проверить обе ветви гонки после join
            errors.append(error)
        finally:
            connections.close_all()

    threads = [Thread(target=reserve) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=20)

    assert not any(thread.is_alive() for thread in threads)
    assert errors == []
    assert len(set(dates)) == 2
    cursor = OpsE2EFixtureDateCursor.objects.get(singleton_key=1)
    assert cursor.next_offset == 2


@pytest.mark.django_db
def test_local_reservation_command_returns_the_first_date_as_json():
    """Playwright-подготовка получает диапазон локально, без HTTP-права роли."""
    output = StringIO()

    call_command("reserve_e2e_fixture_dates", "--count", "4352", stdout=output)

    assert json.loads(output.getvalue()) == {
        "businessDate": FIXTURE_DATE_START.isoformat(),
        "count": 4352,
    }
