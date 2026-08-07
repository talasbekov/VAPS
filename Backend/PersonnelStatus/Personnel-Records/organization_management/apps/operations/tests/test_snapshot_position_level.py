"""Снимок замораживает уровень должности — и почему без него нельзя.

Канон порядка ведёт по должности, а сданный день обязан быть самодостаточным:
читать живые данные при показе подписанного документа нельзя, иначе перевод
человека на другую должность переставлял бы его в бумаге, подписанной месяц
назад. Значит уровень надо заморозить в момент сдачи — рядом с ФИО и званием,
которые уже заморожены по той же причине.

Отдельная нить — СОВМЕСТИМОСТЬ. Расширение снимка подняло версию схемы, и сдачи,
подписанные до него, обязаны читаться по-прежнему: иначе расширение отобрало бы у
людей личную копию их собственного подписанного дня.
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.operations.personal_export_service import (
    SUPPORTED_SCHEMA_VERSIONS,
    export_submission,
)
from organization_management.apps.operations.snapshot import (
    SCHEMA_VERSION,
    build_division_snapshot,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    in_slot,
)
from organization_management.apps.operations.tests.test_submitted_expense import submit
from organization_management.apps.operations.tests.test_traffic_light import types  # noqa: F401
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

ACTOR = "7"


@pytest.fixture
def division():
    return Division.objects.create(name="Управление")


def at_level(division, level, **overrides):
    """Сотрудник на штатной должности заданного уровня."""
    employee = in_slot(division, **overrides)
    position = Position.objects.create(name=f"Должность-{level}", level=level)
    StaffUnit.objects.filter(employee=employee).update(position=position)
    return employee


def roster_of(division):
    return build_division_snapshot(division.id, TODAY)["roster"]


def level_by_id(roster):
    return {row["employee_id"]: row["position_level"] for row in roster}


# ── Уровень попадает в снимок ────────────────────────────────────────────


def test_the_snapshot_carries_the_position_level(types, division):  # noqa: F811
    senior = at_level(division, 10, last_name="Яковлев")
    junior = at_level(division, 50, last_name="Абрамов")

    levels = level_by_id(roster_of(division))

    assert levels[senior.id] == 10
    assert levels[junior.id] == 50


def test_an_employee_without_a_position_keeps_an_honest_absence(types, division):  # noqa: F811
    """«Должность не нашлась» и «уровень такой-то» — разные факты.

    Подменить первое числом значило бы решить за канон порядка, куда ставить
    такого человека, — и сделать это молча, в селекторе.
    """
    nobody = in_slot(division, last_name="Безрукий")

    assert level_by_id(roster_of(division))[nobody.id] is None


def test_the_level_is_frozen_and_does_not_follow_a_later_transfer(types, division):  # noqa: F811
    """Несущее свойство: перевод человека на другую должность не переставляет
    его в уже подписанном документе.

    Снимок берётся ДО перевода и перечитывается ПОСЛЕ — из сохранённой строки,
    а не пересборкой.
    """
    employee = at_level(division, 10)
    submission = submit(division)
    before = submission.snapshot["roster"][0]["position_level"]

    other = Position.objects.create(name="Другая", level=90)
    StaffUnit.objects.filter(employee=employee).update(position=other)

    submission.refresh_from_db()
    assert before == 10
    assert submission.snapshot["roster"][0]["position_level"] == 10


def test_the_level_costs_no_extra_query(types, division):  # noqa: F811
    """Отдельный запрос за уровнями вернул бы зависимость числа запросов от
    числа людей — ровно ту, от которой раздел уходит везде.

    Три человека, а не один: на одном «запросов столько же» неотличимо от
    «запрос на каждого».
    """
    for index in range(3):
        at_level(division, 10 + index, last_name=f"Сотрудник{index}")

    with CaptureQueriesContext(connection) as captured:
        build_division_snapshot(division.id, TODAY)
    with_three = len(captured.captured_queries)

    at_level(division, 40, last_name="Четвёртый")
    with CaptureQueriesContext(connection) as captured:
        build_division_snapshot(division.id, TODAY)

    assert len(captured.captured_queries) == with_three


# ── Версия схемы ─────────────────────────────────────────────────────────


def test_the_schema_version_was_raised(types, division):  # noqa: F811
    """Раскладка снимка изменилась — версия обязана это сказать. Молчаливое
    расширение лишило бы читателей единственного признака, по которому они
    отличают одну раскладку от другой."""
    in_slot(division)

    assert build_division_snapshot(division.id, TODAY)["schema_version"] == 6
    assert SCHEMA_VERSION == 6


def test_the_reader_still_understands_the_previous_layout():
    """Ради этого версия и заведена.

    Сдачи, подписанные до расширения, лежат в базе со СВОЕЙ раскладкой. Приравняй
    читатель поддерживаемую версию к текущей — каждое расширение снимка отбирало
    бы у людей личную копию их собственного подписанного дня.
    """
    assert 1 in SUPPORTED_SCHEMA_VERSIONS
    assert SCHEMA_VERSION in SUPPORTED_SCHEMA_VERSIONS


def test_a_day_submitted_under_the_old_layout_still_exports(types, division):  # noqa: F811
    """Не «версия в множестве», а СКВОЗНОЙ путь: старый снимок доезжает до
    готового файла.

    Строка приводится к первой раскладке буквально — уровень должности из неё
    убирается, как если бы её собрал прежний код.
    """
    in_slot(division)
    submission = submit(division)
    legacy = {
        "schema_version": 1,
        "roster": [
            {key: value for key, value in row.items() if key != "position_level"}
            for row in submission.snapshot["roster"]
        ],
        "rows": submission.snapshot["rows"],
    }
    OpsDailySubmission.objects.filter(pk=submission.pk).update(snapshot=legacy)
    submission.refresh_from_db()

    with clock.override(MORNING):
        payload, filename = export_submission(submission=submission, actor=ACTOR)

    assert payload[:2] == b"PK"
    assert filename.endswith(".xlsx")
