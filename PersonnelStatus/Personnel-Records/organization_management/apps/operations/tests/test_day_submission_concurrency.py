"""Два оператора сдают один день ОДНОВРЕМЕННО.

Последовательно это давно проверено: сдал, сдал ещё раз, получил 409. Но 409 там
ставит ПРЕДПРОВЕРКА сервиса, а она читает состояние до записи — в одновременном
исполнении обе проверки проходят прежде, чем любая вставит строку. То есть
последовательный тест про эту ситуацию не говорит ничего, а ситуация обычная:
день сдают в конце рабочего дня, и двое дежурных жмут кнопку разом.

Здесь и сходятся две вещи, о которых раздел писал по отдельности:

- у сдачи НЕТ замка (в отличие от выпуска документа) — её держит частичная
  уникальность текущей версии, а вложенный savepoint даёт исключению уйти
  наверх, не отравив транзакцию;
- проигравший получает не DomainError, а IntegrityError, и в код отказа его
  превращает CONSTRAINT_ERROR_MAP в обработчике — ВТОРОЙ путь выдачи кода,
  который срез 109 закрыл тестом покрытия и о котором прямо сказал: «срабатывает
  на гонках». Вот эта гонка.

Поэтому проверка идёт ЧЕРЕЗ HTTP: на уровне сервиса проигравший — это голый
IntegrityError, и увидеть код отказа можно только пройдя обработчик.

ГОНКА ЗДЕСЬ ПРИНУДИТЕЛЬНАЯ, и без этого файл был бы обманом. Первый проход просто
запускал два потока — и они успевали разойтись во времени: второй приходил, когда
первый уже вставил строку, и упирался в ПРЕДПРОВЕРКУ, а не в ограничение. Обе
пробы (снять карту ограничений, снять предпроверку) оставались зелёными, потому
что каждый раз срабатывал другой рубеж. Теперь оба потока встречаются на барьере
ВНУТРИ сдачи — уже пройдя предпроверку, но ещё не вставив строку, — и до
ограничения доходят оба.
"""
import threading

import pytest
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
from organization_management.apps.operations.tests.test_traffic_light import types  # noqa: F401

pytestmark = pytest.mark.django_db(transaction=True)

URL = "/api/operations/daily-submissions/"


def _submit_in_thread(user_id, division_id, results, index):
    """Сдача в СВОЁМ соединении.

    Соединение потока закрывается явно: оставленное открытым, оно держит
    тестовую БД и заваливает уборку прогона.
    """
    try:
        api = APIClient()
        from django.contrib.auth import get_user_model

        api.force_authenticate(get_user_model().objects.get(pk=user_id))
        with clock.override(MORNING):
            response = api.post(
                URL,
                {"division_id": division_id, "business_date": TODAY.isoformat()},
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
    """Свести оба потока в одну точку ВНУТРИ сдачи.

    Барьер ставится на сборку снимка — она идёт ПОСЛЕ предпроверки и ДО вставки
    строки. Оба потока проходят предпроверку («день не сдан» — правда для обоих),
    встречаются здесь и только потом пытаются записаться. Ровно это и происходит
    в проде, когда двое жмут кнопку разом; без барьера воспроизвести момент
    нечем, и тест проверял бы последовательный путь под видом гонки.
    """
    from organization_management.apps.operations import day_submission_service

    barrier = threading.Barrier(2, timeout=20)
    original = day_submission_service.build_division_snapshot

    def synchronised(*args, **kwargs):
        barrier.wait()
        return original(*args, **kwargs)

    monkeypatch.setattr(
        day_submission_service, "build_division_snapshot", synchronised
    )
    return barrier


def race(division, user_ids):
    results = [None] * len(user_ids)
    threads = [
        threading.Thread(
            target=_submit_in_thread, args=(user_id, division.id, results, index)
        )
        for index, user_id in enumerate(user_ids)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert all(not t.is_alive() for t in threads), (
        "сдача не завершилась за отведённое время — похоже на взаимную блокировку"
    )
    return results


@pytest.fixture
def stage(types):  # noqa: F811
    division = Division.objects.create(name="Управление")
    in_slot(division)
    seed_role("ORGD", ["daily_report.mark_update"])
    first, _ = client_for("duty-one", "ORGD", ["daily_report.mark_update"])
    second, _ = client_for("duty-two", "ORGD", ["daily_report.mark_update"])
    from django.contrib.auth import get_user_model

    users = get_user_model().objects.filter(
        username__in=["duty-one", "duty-two"]
    ).order_by("username")
    # Уборки руками НЕТ намеренно: под transaction=True таблицы вычищает сам
    # прогон (TRUNCATE), а ручной DELETE по журналу невозможен в принципе — он
    # дополняется только, и запрет держит триггер базы. Первый проход файла на
    # этом и споткнулся: уборка падала, хотя сами тесты проходили.
    return division, [user.pk for user in users]


# ── Ровно одна сдача ─────────────────────────────────────────────────────


def test_two_simultaneous_submissions_create_exactly_one_row(stage, collide):
    """Несущий тест: предпроверка сервиса здесь бессильна по построению —
    обе читают «не сдано» раньше, чем любая вставит строку."""
    division, users = stage

    race(division, users)

    assert OpsDailySubmission.objects.filter(
        division_id=division.id, business_date=TODAY
    ).count() == 1


def test_exactly_one_caller_is_told_it_succeeded(stage, collide):
    """Два «сдано» на один день означали бы, что один из дежурных уверен в
    сдаче, которой нет."""
    division, users = stage

    results = race(division, users)

    codes = sorted(status for status, _ in results)
    assert codes == [201, 409], results


def test_the_loser_gets_the_business_code_and_not_a_crash(stage, collide):
    """Здесь и проверяется ВТОРОЙ путь выдачи кода.

    Проигравшему прилетает IntegrityError из базы, и превращает его в
    DAY_ALREADY_SUBMITTED карта ограничений в обработчике. Не сработай она —
    оператор увидел бы 500 там, где по существу «день уже сдан».

    ПРОБА ОБЯЗАНА СНИМАТЬ ОБЕ строки карты. Гонку ловят два разных ограничения
    («одна текущая версия» и «номер версии уникален»), оба заведены на этот код,
    и снятие одного оставляет второе — тест остаётся зелёным, хотя путь проверен
    не был. Дублирование здесь осознанное: клиенту оба означают одно и то же, и
    различать их в ответе нечем.
    """
    division, users = stage

    results = race(division, users)

    (loser,) = [body for status, body in results if status == 409]
    assert loser["error_code"] == "DAY_ALREADY_SUBMITTED"


def test_no_caller_sees_a_server_error(stage, collide):
    """Пятисотый здесь — не «некрасиво», а потеря объяснения: оператор не
    узнает, что день уже сдан, и будет жать кнопку снова."""
    division, users = stage

    results = race(division, users)

    assert [status for status, _ in results if status == 500] == []
    assert [status for status, _ in results if status == "EXC"] == []


# ── След в журнале ───────────────────────────────────────────────────────


def test_only_the_winner_leaves_a_journal_entry(stage, collide):
    """Проигравшая сдача откатывается целиком — вместе со своей записью.

    Журнал рассказывает о СЛУЧИВШЕМСЯ: строка о сдаче, которой нет, заставила бы
    разбирающегося искать её в таблице.
    """
    division, users = stage

    race(division, users)

    assert OpsAuditLog.objects.filter(
        action=audit_service.DAILY_SUBMISSION_SUBMITTED
    ).count() == 1


def test_the_surviving_submission_is_the_first_version_and_current(stage, collide):
    """Проигравший не оставляет за собой ни версии 2, ни снятого признака
    текущей: он не дошёл до записи вовсе."""
    division, users = stage

    race(division, users)

    submission = OpsDailySubmission.objects.get()
    assert submission.version == 1
    assert submission.is_current is True


def test_the_snapshot_of_the_surviving_submission_is_intact(stage, collide):
    """Гонка не должна оставить сдачу с полупустым снимком: снимок и строка
    коммитятся вместе."""
    division, users = stage

    race(division, users)

    snapshot = OpsDailySubmission.objects.get().snapshot
    assert snapshot["roster"] != []
    assert "schema_version" in snapshot


# ── Разные дни не мешают друг другу ──────────────────────────────────────


def test_two_divisions_submit_the_same_day_side_by_side(types):  # noqa: F811
    """Ограничение — на ПАРУ (подразделение, день), а не на день.

    Будь оно шире, соседнее управление не смогло бы сдать свой день, пока
    сдаётся это, — и проба выше означала бы совсем другое.
    """
    first = Division.objects.create(name="Управление 1")
    second = Division.objects.create(name="Управление 2")
    in_slot(first)
    in_slot(second)
    seed_role("ORGD", ["daily_report.mark_update"])
    client_for("duty-a", "ORGD", ["daily_report.mark_update"])
    client_for("duty-b", "ORGD", ["daily_report.mark_update"])
    from django.contrib.auth import get_user_model

    users = list(
        get_user_model()
        .objects.filter(username__in=["duty-a", "duty-b"])
        .order_by("username")
        .values_list("pk", flat=True)
    )

    results = [None, None]
    threads = [
        threading.Thread(
            target=_submit_in_thread,
            args=(users[index], division.id, results, index),
        )
        for index, division in enumerate((first, second))
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert sorted(status for status, _ in results) == [201, 201], results
    assert OpsDailySubmission.objects.count() == 2
