"""Прикомандирование и возврат, запрошенные ОДНОВРЕМЕННО.

У прикомандирования два места, где одновременность опасна, и они разные по
природе.

ПЕРВОЕ — начало ИДУЩЕГО прикомандирования. Пока одна пара действует, вторая не
имеет смысла, и запрет держит гвард «откомандированный закрыт для правки». Но
гвард ЧИТАЕТ существующие статусы, а при одновременном обращении оба оператора
читают «свободен». Между этим и двумя парами у одного человека стоит только замок
на его строке.

ПОЧЕМУ ИМЕННО ИДУЩЕГО. Первый проход ставил пары на ЗАВТРА — и обе проходили. Но
это не гонка: последовательная проба показала то же самое. Пересечение ещё не
начавшихся статусов раздел считает неблокирующим предупреждением (FR-10 — планы
двигаются, и запрещать их пересечение заранее значило бы мешать планированию), и
прикомандирование живёт по тому же правилу. То есть на будущих парах проверять
нечего: там нет запрета, который мог бы утечь. Гвард применим только к идущему —
на нём и ставится опыт.

ВТОРОЕ — возврат. Факты возврата дополняются ОДНАЖДЫ (кто и когда запросил, кто
подтвердил). Второй писатель приходит со своей копией строки, у которой факты
пусты, и, не перечитай он её под замком, спокойно переписал бы чужие — то есть
подменил бы имя того, кто на самом деле подтвердил возврат.

Здесь проверяется исход обоих, а не «оба не упали».
"""
import threading
from datetime import timedelta

import pytest
from django.db import connections

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
)
from organization_management.apps.operations.secondment_service import (
    confirm_return,
    initiate_secondment,
    request_return,
)
from organization_management.apps.operations.tests.test_secondment_service import (
    TODAY,
    employee_in,
    home,  # noqa: F401 — фикстура pytest
    host,  # noqa: F401 — фикстура pytest
    types,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db(transaction=True)


def _run(target, count=2):
    results = [None] * count
    threads = [
        threading.Thread(target=target, args=(results, index))
        for index in range(count)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert all(not t.is_alive() for t in threads), "гонка не завершилась"
    return results


# ── Начало: двух пар быть не может ───────────────────────────────────────


@pytest.fixture
def collide_on_employee(monkeypatch):
    """Свести потоки к замку сотрудника одновременно.

    Барьер срабатывает ПЕРЕД взятием замка: поставь его после — первый поток
    заблокировал бы строку и встал, второй до барьера не дошёл бы, и прогон
    висел бы до таймаута.
    """
    from organization_management.apps.operations import secondment_service

    barrier = threading.Barrier(2, timeout=20)
    original = secondment_service._lock_employee

    def synchronised(employee_id):
        barrier.wait()
        return original(employee_id)

    monkeypatch.setattr(secondment_service, "_lock_employee", synchronised)
    return barrier


def test_one_person_cannot_be_seconded_twice_at_once(
    types, home, host, collide_on_employee  # noqa: F811
):
    """Несущий тест начала: гвард «уже откомандирован» здесь бессилен по
    построению — оба читают «свободен» раньше, чем любой запишет."""
    employee = employee_in(home)
    other_host = Division.objects.create(name="Третье управление")

    def attempt(results, index):
        try:
            with clock.override(TODAY):
                results[index] = initiate_secondment(
                    employee.id,
                    to_division_id=(host if index == 0 else other_host).id,
                    date_start=TODAY,
                    date_end=TODAY + timedelta(days=5),
                    actor=f"op-{index}",
                )
        except Exception as error:  # noqa: BLE001 — сохраняем ЛЮБОЙ исход
            results[index] = error
        finally:
            connections.close_all()

    _run(attempt)

    assert Secondment.objects.filter(employee_id=employee.id).count() == 1


def test_exactly_one_initiation_succeeds_and_the_other_is_refused(
    types, home, host, collide_on_employee  # noqa: F811
):
    """Проигравший обязан получить внятный отказ, а не поломку базы."""
    employee = employee_in(home)
    other_host = Division.objects.create(name="Третье управление")

    def attempt(results, index):
        try:
            with clock.override(TODAY):
                results[index] = initiate_secondment(
                    employee.id,
                    to_division_id=(host if index == 0 else other_host).id,
                    date_start=TODAY,
                    date_end=TODAY + timedelta(days=5),
                    actor=f"op-{index}",
                )
        except Exception as error:  # noqa: BLE001
            results[index] = error
        finally:
            connections.close_all()

    results = _run(attempt)

    created = [r for r in results if isinstance(r, Secondment)]
    refused = [r for r in results if isinstance(r, Exception)]
    assert len(created) == 1
    assert len(refused) == 1
    assert isinstance(refused[0], DomainError), f"наружу вышло {refused[0]!r}"


def test_the_person_ends_up_with_one_pair_of_legs(
    types, home, host, collide_on_employee  # noqa: F811
):
    """Пара — это ДВЕ ноги (откомандирован и придан). Две пары дали бы четыре
    ноги, и человек оказался бы приданным сразу двум подразделениям."""
    employee = employee_in(home)
    other_host = Division.objects.create(name="Третье управление")

    def attempt(results, index):
        try:
            with clock.override(TODAY):
                results[index] = initiate_secondment(
                    employee.id,
                    to_division_id=(host if index == 0 else other_host).id,
                    date_start=TODAY,
                    date_end=TODAY + timedelta(days=5),
                    actor=f"op-{index}",
                )
        except Exception as error:  # noqa: BLE001
            results[index] = error
        finally:
            connections.close_all()

    _run(attempt)

    legs = OpsEmployeeStatus.objects.filter(
        employee_id=employee.id,
        status_type_code__in=("DETACHED", "ATTACHED"),
        cancelled_at__isnull=True,
    )
    assert legs.count() == 2


# ── Возврат: факты дополняются однажды ───────────────────────────────────


@pytest.fixture
def seconded(types, home, host):  # noqa: F811
    employee = employee_in(home)
    with clock.override(TODAY):
        return initiate_secondment(
            employee.id,
            to_division_id=host.id,
            date_start=TODAY + timedelta(days=1),
            date_end=TODAY + timedelta(days=5),
            actor="starter",
        )


def test_only_one_of_two_simultaneous_return_requests_is_recorded(seconded):
    """Второй писатель приходит со СВОЕЙ копией, у которой факты пусты.

    Не перечитай он строку под замком — записал бы своё имя поверх чужого, и
    журнал возврата назвал бы не того человека.
    """

    def attempt(results, index):
        try:
            with clock.override(TODAY):
                stale = Secondment.objects.get(pk=seconded.pk)
                results[index] = request_return(stale, actor=f"op-{index}")
        except Exception as error:  # noqa: BLE001
            results[index] = error
        finally:
            connections.close_all()

    results = _run(attempt)

    seconded.refresh_from_db()
    succeeded = [r for r in results if isinstance(r, Secondment)]
    assert len(succeeded) == 1, results
    assert seconded.return_requested_by == f"op-{results.index(succeeded[0])}"


def test_a_confirmed_return_is_not_confirmed_twice(seconded):
    """Подтверждение терминально: второе означало бы, что возврат случился
    дважды, и в журнале появилось бы два разных подтвердивших."""
    with clock.override(TODAY):
        request_return(Secondment.objects.get(pk=seconded.pk), actor="asker")

    def attempt(results, index):
        try:
            with clock.override(TODAY):
                stale = Secondment.objects.get(pk=seconded.pk)
                results[index] = confirm_return(stale, actor=f"op-{index}")
        except Exception as error:  # noqa: BLE001
            results[index] = error
        finally:
            connections.close_all()

    results = _run(attempt)

    seconded.refresh_from_db()
    succeeded = [r for r in results if isinstance(r, Secondment)]
    assert len(succeeded) == 1, results
    assert seconded.return_confirmed_by is not None
