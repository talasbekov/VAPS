"""Два массовых обновления по ОДНОМУ человеку одновременно.

Детектор пересечений читает уже существующие статусы и решает, можно ли ставить
новый. Читает — значит видит состояние на момент чтения, и в одновременном
исполнении оба оператора видят «пересечений нет», потому что ни один ещё ничего
не записал. Всё, что стоит между этим и двумя пересекающимися статусами у одного
человека, — замок на СТРОКЕ СОТРУДНИКА.

Замок здесь взят правильно, и это видно по контрасту с поправкой дня (срез 122):
там блокировалась ГОЛОВА цепочки версий, которая движется, и взаимного исключения
не получалось. Строка сотрудника не движется — она и есть та единица, за которую
конкурируют, — поэтому здесь достаточно её.

Проверяется исход ДЕЛОВОЙ, а не «оба не упали»: у человека не должно оказаться
двух пересекающихся статусов, и проигравший обязан узнать, почему ему отказали.

ЖЁСТКИЕ И МЯГКИЕ ПЕРЕСЕЧЕНИЯ ПРОВЕРЯЮТСЯ ПО-РАЗНОМУ, и это выяснилось пробой.
У жёстких есть ВТОРОЙ рубеж — ограничение исключения в базе, — и со снятым замком
тесты на них остаются зелёными: дубль ловит база, отказ приходит с тем же кодом.
То есть на жёстком типе замок недоказуем.

А у МЯГКИХ пересечений рубежа в базе нет вовсе: их знает только детектор, и
единственное, что мешает двум операторам поставить их одновременно, — замок.
Поэтому решающая проба здесь на мягком типе; она и краснеет, когда замок снят.
"""
import threading
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.db import connections
from rest_framework.test import APIClient

from organization_management.apps.operations import clock
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
    division,  # noqa: F401 — фикстура pytest
    make_employee,
    seed_role,
    types,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db(transaction=True)

URL = "/api/operations/statuses/bulk/"
PERMS = ["status.manage"]

# VACATION — жёсткий тип: пересечение с ним не обходится ничем, и в базе его
# стережёт ограничение исключения. Мягкий тип дал бы 409 с возможностью обхода,
# то есть исход, зависящий от намерения оператора, — а здесь интересен запрет.
HARD_CODE = "VACATION"


def _bulk_in_thread(user_id, employee_id, code, results, index):
    try:
        api = APIClient()
        api.force_authenticate(get_user_model().objects.get(pk=user_id))
        body = {
            "business_date": TODAY.isoformat(),
            "rows": [
                {
                    "employee_id": employee_id,
                    "status_type_code": code,
                    "date_start": TODAY.isoformat(),
                    "date_end": (TODAY + timedelta(days=3)).isoformat(),
                }
            ],
        }
        with clock.override(TODAY):
            response = api.post(URL, body, format="json")
        results[index] = (response.status_code, _body(response))
    except Exception as error:  # noqa: BLE001 — сохраняем ЛЮБОЙ исход
        results[index] = ("EXC", error)
    finally:
        connections.close_all()


def _body(response):
    try:
        return response.json()
    except Exception:  # noqa: BLE001
        return {}


@pytest.fixture
def collide(monkeypatch):
    """Свести оба потока к замку сотрудника одновременно.

    Барьер оборачивает взятие замка и срабатывает ПЕРЕД ним: иначе первый поток
    заблокировал бы строку и встал на барьере, а второй не смог бы до барьера
    дойти — прогон висел бы до таймаута.
    """
    from organization_management.apps.operations import bulk_status_service

    barrier = threading.Barrier(2, timeout=20)
    original = bulk_status_service._lock_employees

    def synchronised(employee_ids):
        barrier.wait()
        return original(employee_ids)

    monkeypatch.setattr(bulk_status_service, "_lock_employees", synchronised)
    return barrier


@pytest.fixture
def stage(types, division):  # noqa: F811
    employee = make_employee(division)
    seed_role("ORGD", PERMS)
    client_for("bulk-one", "ORGD", PERMS)
    client_for("bulk-two", "ORGD", PERMS)
    users = list(
        get_user_model()
        .objects.filter(username__in=["bulk-one", "bulk-two"])
        .order_by("username")
        .values_list("pk", flat=True)
    )
    return employee, users


def race(employee, users, code=HARD_CODE):
    results = [None] * len(users)
    threads = [
        threading.Thread(
            target=_bulk_in_thread,
            args=(user_id, employee.id, code, results, index),
        )
        for index, user_id in enumerate(users)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert all(not t.is_alive() for t in threads), (
        "пачка не завершилась — похоже на взаимную блокировку"
    )
    return results


def live_statuses(employee):
    return OpsEmployeeStatus.objects.filter(
        employee_id=employee.id, cancelled_at__isnull=True
    )


# ── Пересечения не возникает ─────────────────────────────────────────────


def test_one_person_does_not_end_up_with_two_overlapping_hard_statuses(stage, collide):
    """Несущий тест: детектор пересечений здесь бессилен по построению — оба
    читают «пересечений нет» раньше, чем любой запишет."""
    employee, users = stage

    race(employee, users)

    assert live_statuses(employee).count() == 1


def test_exactly_one_caller_is_told_it_succeeded(stage, collide):
    employee, users = stage

    results = race(employee, users)

    successes = [status for status, _ in results if status in (200, 201)]
    assert len(successes) == 1, results


def test_the_loser_learns_why_it_was_refused(stage, collide):
    """Отказ обязан быть деловым: «у человека уже стоит жёсткий статус», а не
    пятисотый — иначе оператор не поймёт, что делать дальше."""
    employee, users = stage

    results = race(employee, users)

    refusals = [(status, body) for status, body in results if status not in (200, 201)]
    assert len(refusals) == 1, results
    (status, body) = refusals[0]
    assert status == 422
    assert body.get("error_code") == "OVERLAPPING_HARD_STATUS"


def test_no_caller_sees_a_server_error(stage, collide):
    employee, users = stage

    results = race(employee, users)

    assert [s for s, _ in results if s == 500] == []
    assert [s for s, _ in results if s == "EXC"] == []


def test_the_refused_batch_leaves_nothing_behind(stage, collide):
    """Пачка атомарна: отказ не должен оставить половину строк.

    Здесь строка в пачке одна, поэтому проверяется общее число — оно же и есть
    «ничего лишнего не осталось».
    """
    employee, users = stage

    race(employee, users)

    assert OpsEmployeeStatus.objects.count() == 1


# ── Разные люди друг другу не мешают ─────────────────────────────────────


def test_two_different_people_are_updated_side_by_side(types, division, collide):  # noqa: F811
    """Замок берётся на СТРОКЕ СОТРУДНИКА, а не на подразделении.

    Будь он шире, пачка по одному человеку ждала бы пачку по другому — и проба
    выше означала бы «замок вообще всё сериализует», а не «конкурируют за
    одного человека».
    """
    first = make_employee(division)
    second = make_employee(division)
    seed_role("ORGD", PERMS)
    client_for("bulk-a", "ORGD", PERMS)
    client_for("bulk-b", "ORGD", PERMS)
    users = list(
        get_user_model()
        .objects.filter(username__in=["bulk-a", "bulk-b"])
        .order_by("username")
        .values_list("pk", flat=True)
    )

    results = [None, None]
    threads = [
        threading.Thread(
            target=_bulk_in_thread,
            args=(users[index], employee.id, HARD_CODE, results, index),
        )
        for index, employee in enumerate((first, second))
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert [s for s, _ in results if s in (200, 201)] != [], results
    assert len([s for s, _ in results if s in (200, 201)]) == 2, results
    assert OpsEmployeeStatus.objects.count() == 2


# ── Мягкое пересечение: рубеж только один ────────────────────────────────

# DUTY против DUTY — мягкое пересечение: ни один из них не жёсткий. В базе
# такие не запрещены ничем, и весь запрет держится на детекторе, а детектор —
# на замке.
SOFT_CODE = "DUTY"


def test_a_soft_overlap_is_stopped_by_the_lock_alone(stage, collide):
    """РЕШАЮЩАЯ проба файла.

    У мягкого пересечения нет рубежа в базе: сними замок — и оба оператора
    поставят пересекающиеся статусы одному человеку, каждый получив «готово».
    Ни одна проверка после этого не сработает, и обнаружится это на расходе,
    где человек окажется в двух колонках сразу.
    """
    employee, users = stage

    results = race(employee, users, code=SOFT_CODE)

    successes = [status for status, _ in results if status in (200, 201)]
    assert len(successes) == 1, results
    assert live_statuses(employee).count() == 1
