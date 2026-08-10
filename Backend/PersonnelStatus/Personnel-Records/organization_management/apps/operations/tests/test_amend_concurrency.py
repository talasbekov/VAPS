"""Две поправки одного дня, поданные ОДНОВРЕМЕННО.

У поправки исход противоположен сдаче, и это несущее различие. Сдача второй быть
не может — день сдают один раз, и проигравший обязан получить отказ. Поправок же
бывает сколько угодно: день правят и правят, каждая пишет свою версию. Значит при
одновременном обращении обе обязаны ПРОЙТИ, выстроившись в очередь, а не одна
отказать.

Держит это замок на голове цепочки версий. Без него обе поправки прочитают одну и
ту же старшую версию, обе попросят следующий номер, и одна упрётся в уникальность
— то есть отказ получит тот, кто ничего неправильного не делал.

БАРЬЕР СТОИТ ПЕРЕД ЗАМКОМ, а не внутри. Поставь его после — первый поток взял бы
замок и встал на барьере, второй не смог бы до барьера дойти, и прогон висел бы
до срабатывания таймаута. Здесь потоки встречаются НА ПОДХОДЕ к замку, и дальше
их разводит он сам — ровно то, что происходит в проде.

ЭТОТ ФАЙЛ НАШЁЛ НАСТОЯЩИЙ ДЕФЕКТ. До него замок брался на ГОЛОВЕ цепочки, и
взаимного исключения не давал: голова движется, и залочивший версию 2 не мешает
залочившему версию 3. Хуже того, номер следующей версии считался от строки,
прочитанной ДО ожидания на замке, — дождавшись очереди, вторая поправка
по-прежнему видела старую голову и просила уже занятый номер. Оператор получал
отказ, ничего неправильного не сделав. Замком стала строка ПЕРВОЙ версии (она не
движется), а голова перечитывается свежим запросом уже под ним.
"""
import threading

import pytest
from django.contrib.auth import get_user_model
from django.db import connections
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service, clock
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
    seed_role,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    in_slot,
)
from organization_management.apps.operations.tests.test_submitted_expense import submit
from organization_management.apps.operations.tests.test_traffic_light import types  # noqa: F401

pytestmark = pytest.mark.django_db(transaction=True)

PERMS = ["daily_report.correct", "daily_report.mark_update"]


def url(submission_id):
    return f"/api/operations/daily-submissions/{submission_id}/amend/"


def _amend_in_thread(user_id, submission_id, reason, results, index):
    try:
        api = APIClient()
        api.force_authenticate(get_user_model().objects.get(pk=user_id))
        with clock.override(MORNING):
            response = api.post(
                url(submission_id),
                {"reason": reason, "sanction": "замечание"},
                format="json",
            )
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
    """Свести оба потока к замку головы ОДНОВРЕМЕННО.

    Барьер оборачивает сам поиск головы: поток ждёт на нём и только потом идёт
    брать замок. Так оба подходят к замку вместе, и дальше их разводит он —
    а не случайность планировщика.
    """
    from organization_management.apps.operations import day_submission_service

    barrier = threading.Barrier(2, timeout=20)
    selector = day_submission_service.DailySubmissionSelector
    original = selector.lock_day

    def synchronised(*args, **kwargs):
        barrier.wait()
        return original(*args, **kwargs)

    monkeypatch.setattr(selector, "lock_day", staticmethod(synchronised))
    return barrier


@pytest.fixture
def submitted(types):  # noqa: F811
    division = Division.objects.create(name="Управление")
    in_slot(division)
    submission = submit(division)
    seed_role("ORGD", PERMS)
    client_for("fix-one", "ORGD", PERMS)
    client_for("fix-two", "ORGD", PERMS)
    users = list(
        get_user_model()
        .objects.filter(username__in=["fix-one", "fix-two"])
        .order_by("username")
        .values_list("pk", flat=True)
    )
    return division, submission, users


def race(submission_id, users):
    results = [None] * len(users)
    threads = [
        threading.Thread(
            target=_amend_in_thread,
            args=(user_id, submission_id, f"поправка {index}", results, index),
        )
        for index, user_id in enumerate(users)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert all(not t.is_alive() for t in threads), (
        "поправка не завершилась — похоже на взаимную блокировку"
    )
    return results


# ── Обе проходят ─────────────────────────────────────────────────────────


def test_both_simultaneous_amendments_succeed(submitted, collide):
    """Несущий тест: поправка — не сдача, второй не обязан отказывать.

    Отказ здесь получил бы тот, кто ничего неправильного не делал.
    """
    _division, submission, users = submitted

    results = race(submission.pk, users)

    # 201, а не 200: поправка СОЗДАЁТ новую версию, а не правит старую, и
    # маршрут отвечает соответственно. Первый проход теста ждал 200 — ошибка
    # ожидания, не кода.
    assert sorted(status for status, _ in results) == [201, 201], results


def test_they_take_consecutive_version_numbers(submitted, collide):
    """Замок выстраивает их в очередь: версии 2 и 3, а не две вторых."""
    division, submission, users = submitted

    race(submission.pk, users)

    versions = sorted(
        OpsDailySubmission.objects.filter(
            division_id=division.id, business_date=TODAY
        ).values_list("version", flat=True)
    )
    assert versions == [1, 2, 3]


def test_exactly_one_version_stays_current(submitted, collide):
    """Две текущие версии одного дня — состояние, из которого раздел не умеет
    читать: и светофор, и расход спрашивают «действующую»."""
    division, submission, users = submitted

    race(submission.pk, users)

    current = OpsDailySubmission.objects.filter(
        division_id=division.id, business_date=TODAY, is_current=True
    )
    assert current.count() == 1
    assert current.get().version == 3


def test_no_caller_sees_a_server_error(submitted, collide):
    _division, submission, users = submitted

    results = race(submission.pk, users)

    assert [s for s, _ in results if s == 500] == []
    assert [s for s, _ in results if s == "EXC"] == []


def test_each_amendment_leaves_its_own_journal_entry(submitted, collide):
    """Обе поправки случились — обе обязаны быть в ленте дня. Пропажа одной
    означала бы, что чья-то правка прошла молча."""
    _division, submission, users = submitted

    race(submission.pk, users)

    assert OpsAuditLog.objects.filter(
        action=audit_service.DAILY_SUBMISSION_AMENDED
    ).count() == 2


def test_both_reasons_survive(submitted, collide):
    """Причина — то, ради чего поправка вообще требует объяснения; потерять её
    у одной из двух значило бы оставить версию без объяснения."""
    _division, submission, users = submitted

    race(submission.pk, users)

    reasons = set(
        OpsDailySubmission.objects.exclude(reason="").values_list("reason", flat=True)
    )
    assert reasons == {"поправка 0", "поправка 1"}


def test_the_chain_of_versions_has_no_gaps(submitted, collide):
    """Номера версий читают как историю дня: дырка в ней выглядит как потерянная
    правка."""
    division, submission, users = submitted

    race(submission.pk, users)

    versions = sorted(
        OpsDailySubmission.objects.filter(
            division_id=division.id, business_date=TODAY
        ).values_list("version", flat=True)
    )
    assert versions == list(range(1, len(versions) + 1))
