"""Два выпуска одного дня, идущие ОДНОВРЕМЕННО.

До этого файла защита от двойного выпуска была проверена только
последовательно: первый выпуск, потом второй, отказ 409. Но 409 там ставит
ПРОВЕРКА в сервисе, а она читает состояние до записи — и в одновременном
исполнении оба вызова проходят проверку прежде, чем любой из них что-то запишет.
То есть последовательный тест не отвечает на вопрос «а если по-настоящему
одновременно», и ответ на него держит совсем другой механизм: замок головы сдачи
и частичная уникальность в базе.

Отсюда устройство файла: два НАСТОЯЩИХ соединения (потоки), реальные транзакции
(transaction=True) и проверка не «оба не упали», а «выпуск ровно один, и номер у
него не задвоен».

Гонка здесь НАСТОЯЩАЯ, и это проверено: со снятым замком головы результат
меняется. Заодно проба показала разделение труда — дубль отбивает частичная
уникальность в базе, а замок отвечает за то, чтобы проигравший получил внятный
409, а не поломку базы наружу.

Дороговизна этих тестов осознанная: без них про конкурентность известно только
то, что мы её задумали.
"""
import threading
from datetime import timedelta

import pytest
from django.db import connections
from django.test import override_settings

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.document_release import (
    EXPENSE_DOC_TYPE,
    issue_expense_document,
)
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_document import (
    OpsDocumentSequence,
    OpsIssuedDocument,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    in_slot,
)
from organization_management.apps.operations.tests.test_submitted_expense import submit
from organization_management.apps.operations.tests.test_traffic_light import (  # noqa: F401
    types,
)

pytestmark = pytest.mark.django_db(transaction=True)

ACTOR = "7"


@pytest.fixture
def storage(tmp_path):
    with override_settings(OPS_PRIVATE_STORAGE_ROOT=str(tmp_path)):
        yield tmp_path


def _issue_in_thread(division_id, business_date, results, index):
    """Выпуск в СВОЁМ соединении.

    Соединение потока закрывается явно: оставленное открытым, оно держит
    тестовую БД и заваливает уборку прогона — соседние тесты падали бы по
    причине, не имеющей к ним отношения.
    """
    try:
        with clock.override(MORNING):
            results[index] = issue_expense_document(
                division_id=division_id, business_date=business_date, actor=ACTOR
            )
    except Exception as error:  # noqa: BLE001 — сохраняем ЛЮБОЙ исход
        results[index] = error
    finally:
        connections.close_all()


def race(division, business_date=TODAY, workers=2):
    """Запустить `workers` выпусков одного дня одновременно."""
    results = [None] * workers
    threads = [
        threading.Thread(
            target=_issue_in_thread, args=(division.id, business_date, results, i)
        )
        for i in range(workers)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert all(not thread.is_alive() for thread in threads), (
        "выпуск не завершился за отведённое время — похоже на взаимную блокировку"
    )
    return results


@pytest.fixture
def submitted(types, storage):  # noqa: F811
    division = Division.objects.create(name="Управление")
    in_slot(division)
    submit(division)
    yield division
    OpsIssuedDocument.objects.all().delete()
    OpsDocumentSequence.objects.all().delete()


# ── Одновременный первый выпуск ──────────────────────────────────────────


def test_two_simultaneous_releases_produce_exactly_one_document(submitted):
    """Несущий тест файла.

    Оба вызова читают «день не выпущен» раньше, чем любой из них запишет строку,
    — то есть проверка в сервисе здесь бессильна по построению.

    Кто именно останавливает второй выпуск, установлено пробой: со СНЯТЫМ замком
    головы этот тест остаётся ЗЕЛЁНЫМ — дубль отбивает частичная уникальность в
    базе. Замок отвечает не за «ровно один документ», а за то, КАК проигравший
    об этом узнаёт (см. тест про внятный отказ ниже).
    """
    race(submitted)

    live = OpsIssuedDocument.objects.filter(
        division_id=submitted.id,
        business_date=TODAY,
        status=OpsIssuedDocument.Status.ISSUED,
    )
    assert live.count() == 1


def test_exactly_one_of_the_two_callers_is_told_it_succeeded(submitted):
    """Ответы обязаны разойтись: два «выпущено» на один документ означали бы,
    что один из операторов уверен в номере, которого у него нет."""
    results = race(submitted)

    issued = [row for row in results if isinstance(row, OpsIssuedDocument)]
    refused = [row for row in results if isinstance(row, Exception)]
    assert len(issued) == 1
    assert len(refused) == 1


def test_the_loser_is_refused_as_a_conflict_and_not_as_a_crash(submitted):
    """ВОТ ЧТО ДЕРЖИТ ЗАМОК ГОЛОВЫ, и это выяснилось пробой.

    Дубль не появится и без него — уникальность в базе своё дело сделает, — но
    проигравший получит наружу IntegrityError, то есть 500 сквозь маршрут там,
    где по существу 409. Замок сериализует вызовы, и второй приходит к проверке
    уже ПОСЛЕ записи первого, получая внятный отказ. Проба со снятым замком
    краснит ровно этот тест и никакой другой.
    """
    results = race(submitted)

    (refused,) = [row for row in results if isinstance(row, Exception)]
    assert isinstance(refused, DomainError), f"наружу вышло {type(refused).__name__}"
    assert refused.http_status == 409


# ── Номер ────────────────────────────────────────────────────────────────


def test_the_outgoing_number_is_not_consumed_twice(submitted):
    """Счётчик обязан остаться на единице.

    Возьми проигравший номер и откатись не полностью — в исходящих появилась бы
    дырка; выдай оба номера одному дню — задвоился бы номер.
    """
    race(submitted)

    counter = OpsDocumentSequence.objects.get(
        doc_type=EXPENSE_DOC_TYPE, year=TODAY.year
    )
    assert counter.last_number == 1


def test_the_surviving_document_carries_the_number_the_counter_shows(submitted):
    """Строка и счётчик обязаны согласоваться: разойдись они, следующий выпуск
    выдал бы номер, который уже стоит в чьём-то документе."""
    race(submitted)

    document = OpsIssuedDocument.objects.get()
    counter = OpsDocumentSequence.objects.get(
        doc_type=EXPENSE_DOC_TYPE, year=TODAY.year
    )
    assert document.number == counter.last_number


def test_two_different_days_do_not_block_each_other(types, storage):  # noqa: F811
    """Замок берётся на ГОЛОВУ КОНКРЕТНОГО ДНЯ, а не на подразделение.

    Будь он шире, выпуск вчерашнего дня ждал бы выпуска сегодняшнего — и оба
    номера всё равно бы выдались, но по очереди. Проба показывает, что разные
    дни проходят ОБА, то есть отказ выше — про совпадение дня, а не про замок
    вообще.
    """
    division = Division.objects.create(name="Управление")
    in_slot(division)
    yesterday = TODAY - timedelta(days=1)
    submit(division, business_date=yesterday, at=MORNING - timedelta(days=1))
    submit(division, business_date=TODAY, at=MORNING)

    try:
        results = [None, None]
        threads = [
            threading.Thread(
                target=_issue_in_thread, args=(division.id, day, results, index)
            )
            for index, day in enumerate((yesterday, TODAY))
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        assert all(isinstance(row, OpsIssuedDocument) for row in results), results
        assert sorted(row.number for row in results) == [1, 2]
    finally:
        OpsIssuedDocument.objects.all().delete()
        OpsDocumentSequence.objects.all().delete()
