"""Блокировка завтрашнего дня: кто отстающий и когда замок снимается.

Проверяется не только «что блокирует», но и «что НЕ блокирует»: пустая
настройка, чужое подразделение, сдача за другой день и вытесненная поправкой
версия. Отдельно — порядок отстающих (он числовой, а не строковый) и
неизменность числа запросов от размера списка: блокировку спрашивают на
каждом формировании расхода.
"""
from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.models_submission import (
    OpsSubmissionControlSettings,
)
from organization_management.apps.operations.tomorrow_block import (
    TomorrowBlock,
    tomorrow_block,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    submitted,
)
from organization_management.apps.operations.tests.test_status_service import seed_types

pytestmark = pytest.mark.django_db

ACTOR = "7"


@pytest.fixture
def types():
    seed_types()


def make_division(name="Управление"):
    return Division.objects.create(name=name)


def set_required(division_ids):
    row = OpsSubmissionControlSettings.objects.get(singleton_key=1)
    row.required_division_ids = list(division_ids)
    row.save(update_fields=["required_division_ids"])


def submit(division, business_date=TODAY):
    with clock.override(MORNING):
        return submit_day(
            division_id=division.id, business_date=business_date, actor=ACTOR
        )


# ── Кто блокирует ────────────────────────────────────────────────────────


def test_required_division_without_a_submission_blocks(types):
    a = make_division("A")
    b = make_division("Б")
    set_required([a.id, b.id])
    submit(a)  # сдал только A

    result = tomorrow_block(TODAY)

    assert isinstance(result, TomorrowBlock)
    assert result.blocked is True
    assert result.laggards == [b.id]


def test_all_required_submitted_is_not_blocked(types):
    a = make_division("A")
    b = make_division("Б")
    set_required([a.id, b.id])
    submit(a)
    submit(b)

    result = tomorrow_block(TODAY)

    assert result.blocked is False
    assert result.laggards == []


def test_empty_config_is_not_a_block():
    """Незаполненная настройка — «никто не обязан», а не «все отстают».

    Обязанность сдавать заводит администратор; выведи раздел блокировку из
    пустого списка — и завтрашний день оказался бы закрыт с первой миграции,
    ещё до того как кому-то что-то поручили.
    """
    set_required([])

    result = tomorrow_block(TODAY)

    assert result.blocked is False
    assert result.laggards == []


def test_empty_config_does_not_ask_the_database_about_submissions():
    """Пустая настройка не стоит запроса о сдачах.

    Владелец правила — ORM: на `division_id__in=[]` он в базу не ходит.
    Ранний выход в выводе был бы вторым владельцем того же правила (проба со
    снятым выходом осталась зелёной вместе с этим счётчиком), поэтому его
    там нет, а стоимость сторожит этот тест — он же покраснеет у того, кто
    заменит пакетное чтение обходом списка.
    """
    set_required([])

    with CaptureQueriesContext(connection) as queries:
        tomorrow_block(TODAY)

    assert len(queries) == 1, [q["sql"] for q in queries]
    assert "ops_daily_submissions" not in queries[0]["sql"]


def test_division_outside_the_required_list_never_blocks(types):
    required = make_division("Обязанное")
    make_division("Постороннее")  # не сдавало и не обязано
    set_required([required.id])
    submit(required)

    result = tomorrow_block(TODAY)

    assert result.blocked is False
    assert result.laggards == []


# ── Что НЕ считается сдачей ──────────────────────────────────────────────


def test_submission_for_another_day_does_not_unlock(types):
    """Замок посуточный: вчерашняя сдача не отпирает сегодняшний вывод."""
    division = make_division()
    set_required([division.id])
    submitted(division, TODAY - timedelta(days=1))

    result = tomorrow_block(TODAY)

    assert result.blocked is True
    assert result.laggards == [division.id]


def test_superseded_version_does_not_unlock(types):
    """Снятая с текущих версия обязана вернуть подразделение в отстающие.

    Иначе вытесненное поправкой заявление продолжало бы отпирать завтра —
    раздел считал бы сданным день, действующей сдачи за который у него нет.
    """
    division = make_division()
    set_required([division.id])
    submitted(division, TODAY, is_current=False)

    result = tomorrow_block(TODAY)

    assert result.blocked is True
    assert result.laggards == [division.id]


def test_a_division_with_an_empty_roster_still_has_to_submit(types):
    """Обязанное = обязанное, даже без единого человека в списке.

    Осознанное расхождение со светофором, который на пустом списке
    нейтрален: пустой день сдаётся ровно так же, и отсутствие людей не
    отменяет заявления о дне.
    """
    empty = make_division()
    set_required([empty.id])

    blocked_before = tomorrow_block(TODAY)
    submit(empty)  # пустая сдача — законная сдача
    after = tomorrow_block(TODAY)

    assert blocked_before.blocked is True
    assert blocked_before.laggards == [empty.id]
    assert after.blocked is False
    assert after.laggards == []


def test_a_required_id_without_a_division_blocks_forever():
    """Id несуществующего подразделения блокирует — и это видно.

    Раздел НЕ вычёркивает такой id молча: вычеркнув, он снял бы замок с
    управления, которое, например, ещё не заведено в дереве, и отстающий
    исчез бы из виду. Замок снимает правка настройки — там же, где ошибку и
    допустили (CHECK среза 37 ловит только NULL и неположительные).
    """
    set_required([10_000_000])

    result = tomorrow_block(TODAY)

    assert result.blocked is True
    assert result.laggards == [10_000_000]


# ── Порядок и стоимость ──────────────────────────────────────────────────


def test_laggards_are_ordered_by_id_numerically():
    """Числовой порядок, а не строковый (расхождение с источником-UUID).

    str-сортировка поставила бы 10 перед 9, и порядок списка нельзя было бы
    объяснить ничем, кроме детали реализации.
    """
    set_required([100, 9, 20, 10])

    assert tomorrow_block(TODAY).laggards == [9, 10, 20, 100]


def test_query_count_does_not_grow_with_the_required_list(types):
    one = make_division()
    set_required([one.id])
    with CaptureQueriesContext(connection) as small:
        tomorrow_block(TODAY)

    set_required([one.id] + [make_division().id for _ in range(5)])
    with CaptureQueriesContext(connection) as big:
        tomorrow_block(TODAY)

    assert len(small) == len(big), (
        f"запрос на подразделение: {len(small)} против {len(big)}"
    )
    assert len(big) <= 3, f"лишние запросы: {len(big)}"
