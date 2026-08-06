"""Справочник замораживается вместе с днём (схема снимка 3).

Самодостаточность снимка объявлена смыслом билдера: «расход и светофор по
сданному дню считаются ТОЛЬКО из roster+rows, без повторного обращения к живым
данным». Справочник был последним, чего в ней не хватало — его брали живым, и
правка каталога переписывала уже подписанный день:

    перенос колонки      — человек уезжает в другой столбец;
    counts_in_staff=false — «по списку» меняется, то есть меняется ЗНАМЕНАТЕЛЬ.

Оба тихие: версия, время и подпись остаются прежними, и отличить исправленный
день от исходного нечем. Третье последствие — удаление типа, делавшее день
невыводимым, — закрыто отдельно (срез 134, запрет удаления).

Старые снимки (версий 1 и 2) каталога не несут и читаются живым — им другого
справочника не существует, и отказывать им значило бы потерять сданные дни.
"""
import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.selectors import StatusTypeSelector
from organization_management.apps.operations.snapshot import (
    SCHEMA_VERSION,
    build_division_snapshot,
)
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.strength_report import (
    StatusCatalog,
    catalog_of,
    submitted_expense,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    ACTOR,
    MORNING,
    TODAY,
    fact,
    in_slot,
)
from organization_management.apps.operations.tests.test_traffic_light import (
    types,  # noqa: F401 — фикстура pytest: справочник + выводимое «в строю»
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


@pytest.fixture
def submitted(types, division):  # noqa: F811
    """Сданный день с одним дежурным — то, что потом обязано не шелохнуться."""
    fact(in_slot(division, last_name="Дежурный"), code="DUTY")
    with clock.override(MORNING):
        submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)
    return division


def numbers(division):
    return submitted_expense(division.id, TODAY)


def live_catalog():
    return StatusCatalog.from_rows(StatusTypeSelector.catalog_rows())


# ── Что легло в снимок ───────────────────────────────────────────────────


def test_the_snapshot_carries_the_catalog(types, division):  # noqa: F811
    snapshot = build_division_snapshot(division.id, TODAY)

    assert snapshot["schema_version"] == SCHEMA_VERSION
    codes = {row["code"] for row in snapshot["catalog"]}
    assert {"DUTY", "VACATION", "IN_SERVICE"} <= codes


def test_the_frozen_catalog_is_ordered(types, division):  # noqa: F811
    """По снимкам сравнивают версии сдачи, и «то же самое в другом порядке»
    выглядело бы изменением — как у состава и фактов."""
    catalog = build_division_snapshot(division.id, TODAY)["catalog"]

    assert [row["code"] for row in catalog] == sorted(
        row["code"] for row in catalog
    )


# ── Правка справочника после сдачи ───────────────────────────────────────


def test_moving_a_column_does_not_move_anyone_in_the_signed_day(submitted):
    """Несущий тест: перенос колонки на подписанном дне.

    Проверяется вместе с ЖИВЫМ счётом на те же данные — иначе «ничего не
    изменилось» выполнялось бы и у справочника, которого правка не коснулась.
    """
    before = numbers(submitted)
    assert before.columns["DUTY"] == 1

    StatusType.objects.filter(code="DUTY").update(report_column_code="ПЕРЕЕХАЛО")

    assert numbers(submitted).columns == before.columns
    # А живой справочник действительно другой — правка настоящая.
    assert "ПЕРЕЕХАЛО" in live_catalog().columns_in_order()


def test_taking_a_type_out_of_the_headcount_does_not_change_the_denominator(
    submitted,
):
    """Самое опасное из двух: меняется не столбец, а ЧИСЛО «по списку».

    Именно его сверяют, и подпись стоит под ним.
    """
    before = numbers(submitted)
    assert (before.list_total, before.off_list) == (1, 0)

    StatusType.objects.filter(code="DUTY").update(counts_in_staff=False)

    after = numbers(submitted)
    assert (after.list_total, after.off_list) == (1, 0)


def test_changing_priority_does_not_pick_a_different_winner(types, division):  # noqa: F811
    """Приоритет решает, ЧЕЙ статус победил, когда их несколько.

    ДВА факта у одного человека — обязательное условие: при одном приоритет не
    решает ничего, и первый набор этого теста был вакуумным (проба «читатель
    всегда берёт живой справочник» его не краснила). DUTY(70) против STUDY(80)
    — побеждает DUTY; после правки STUDY стал бы старше.
    """
    employee = in_slot(division, last_name="Двойной")
    fact(employee, code="DUTY")
    fact(employee, code="STUDY")
    with clock.override(MORNING):
        submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)

    before = numbers(division)
    assert before.columns["DUTY"] == 1

    StatusType.objects.filter(code="STUDY").update(priority=1)

    assert numbers(division).columns == before.columns


# ── Старые снимки ────────────────────────────────────────────────────────


def test_a_snapshot_without_a_catalog_is_read_by_the_live_one(submitted):
    """Версии 1 и 2 каталога не несут, и другого справочника для них нет.

    Отказ здесь потерял бы все дни, сданные до этого среза, — а их берут
    именно затем, что они старые.
    """
    row = OpsDailySubmission.objects.get(
        division_id=submitted.id, business_date=TODAY
    )
    row.snapshot = {
        "schema_version": 2,
        "roster": row.snapshot["roster"],
        "rows": row.snapshot["rows"],
    }
    row.save(update_fields=["snapshot"])

    assert numbers(submitted).columns["DUTY"] == 1


def test_an_old_snapshot_does_follow_the_live_catalog(submitted):
    """И честно об этом: у старых дней зависимость от живого справочника
    остаётся, притворяться обратным значило бы врать о них молча."""
    row = OpsDailySubmission.objects.get(
        division_id=submitted.id, business_date=TODAY
    )
    row.snapshot = {
        "schema_version": 2,
        "roster": row.snapshot["roster"],
        "rows": row.snapshot["rows"],
    }
    row.save(update_fields=["snapshot"])

    StatusType.objects.filter(code="DUTY").update(report_column_code="ПЕРЕЕХАЛО")

    assert numbers(submitted).columns["ПЕРЕЕХАЛО"] == 1


# ── Выбор справочника ────────────────────────────────────────────────────


def test_catalog_of_prefers_the_frozen_one(types):  # noqa: F811
    frozen = [
        {"code": "IN_SERVICE", "priority": 999, "report_column_code": "IN_SERVICE",
         "counts_in_staff": True},
        {"code": "DUTY", "priority": 10, "report_column_code": "ЗАМОРОЖЕНО",
         "counts_in_staff": True},
    ]

    chosen = catalog_of({"catalog": frozen}, live_catalog())

    assert chosen.column["DUTY"] == "ЗАМОРОЖЕНО"


def test_an_unusable_frozen_catalog_falls_back_to_the_live_one(types):  # noqa: F811
    """Каталог без колонки для выводимого «в строю» непригоден.

    Такой день нельзя было показать и в момент сдачи — живой справочник тогда
    был тем же самым, — поэтому запасной путь ничего не портит и остаётся
    единственным шансом такой день прочитать.
    """
    unusable = [
        {"code": "DUTY", "priority": 10, "report_column_code": "DUTY",
         "counts_in_staff": True},
    ]

    chosen = catalog_of({"catalog": unusable}, live_catalog())

    assert chosen.column["DUTY"] == "DUTY"
    assert "IN_SERVICE" in chosen.priority
