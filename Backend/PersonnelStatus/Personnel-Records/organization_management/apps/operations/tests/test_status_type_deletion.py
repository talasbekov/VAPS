"""Использованный тип статуса не удаляется — только снимается с обращения.

Код типа лежит в строках статусов и в СНИМКАХ сданных дней строкой, а не
ссылкой: внешнего ключа здесь нет, и удаление строки справочника база не
остановит. А расход, выведенный из снимка, разрешает каждый код по справочнику
и на незнакомом падает — то есть уже подписанный день перестаёт печататься
ВООБЩЕ.

Это хуже, чем «показывает не то»: день не открывается, и починить его задним
числом нечем, кроме как завести тип заново с теми же свойствами, которых уже
никто не помнит. Справочник при этом заведён в админке — удалить строку может
обычным действием обычный администратор.

Правило было записано в самой модели («Деактивация через is_active, не
удалением») и не держалось ничем.
"""
import pytest
from django.db import transaction
from django.db.models.deletion import ProtectedError

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.selectors import StatusTypeSelector
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.strength_report import (
    StatusCatalog,
    expense_from_snapshot,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    ACTOR,
    MORNING,
    TODAY,
    fact,
    in_slot,
)
from organization_management.apps.operations.tests.test_traffic_light import (
    types,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


@pytest.fixture
def used(types, division):  # noqa: F811
    """Тип DUTY, использованный живой строкой статуса."""
    fact(in_slot(division, last_name="Дежурный"), code="DUTY")
    return StatusType.objects.get(code="DUTY")


# ── Запрет ───────────────────────────────────────────────────────────────


def test_a_used_type_cannot_be_deleted(used):
    """Несущий тест.

    Отказ поднимается ВНУТРИ транзакции удаления и помечает её сломанной —
    точка сохранения нужна, чтобы после отказа можно было ещё что-то спросить
    у базы. В бою это и означает откат всего действия целиком.
    """
    with pytest.raises(ProtectedError), transaction.atomic():
        used.delete()

    assert StatusType.objects.filter(code="DUTY").exists()


def test_a_bulk_delete_is_refused_too(used):
    """Админка удаляет ВЫБРАННОЕ пачкой, а не по одному.

    Пачка ходит другим путём (queryset.delete()), и запрет, поставленный
    только на экземпляр, обошёлся бы ровно тем действием, которым справочник и
    правят.
    """
    with pytest.raises(ProtectedError), transaction.atomic():
        StatusType.objects.filter(code="DUTY").delete()

    assert StatusType.objects.filter(code="DUTY").exists()


def test_a_type_used_only_by_a_cancelled_row_is_still_protected(used):
    """Отменённая строка тоже могла попасть в снимок — её отменили ПОЗЖЕ сдачи.

    Смотри запрет только на живые строки, и день, сданный до отмены, потерял бы
    свой код.
    """
    with clock.override(MORNING):
        OpsEmployeeStatus.objects.filter(status_type_code="DUTY").update(
            cancelled_at=clock.Clock.now(), cancelled_by=ACTOR
        )

    with pytest.raises(ProtectedError), transaction.atomic():
        used.delete()


# ── Что запрет НЕ трогает ────────────────────────────────────────────────


def test_an_unused_type_is_still_deletable(types):  # noqa: F811
    """Иначе справочник нельзя было бы почистить от опечатки, заведённой
    минуту назад, — и запрет читался бы как «удалять нельзя вообще»."""
    StatusType.objects.create(
        code="ОПЕЧАТКА", name="Опечатка", priority=500, report_column_code="X"
    )

    StatusType.objects.filter(code="ОПЕЧАТКА").delete()

    assert not StatusType.objects.filter(code="ОПЕЧАТКА").exists()


def test_deactivation_is_the_way_out_and_it_still_works(used, division):
    """Законный способ убрать тип из обихода — is_active=False.

    И он обязан оставлять старые дни разрешимыми: `catalog_rows` намеренно
    отдаёт и неактивные типы. Проверяется не флагом, а тем, ради чего он —
    расход по сданному дню после деактивации по-прежнему считается.
    """
    with clock.override(MORNING):
        submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)
    snapshot = OpsDailySubmission.objects.get(
        division_id=division.id, business_date=TODAY
    ).snapshot

    StatusType.objects.filter(code="DUTY").update(is_active=False)

    catalog = StatusCatalog.from_rows(StatusTypeSelector.catalog_rows())
    numbers = expense_from_snapshot(snapshot, TODAY, catalog)
    assert numbers["columns"]["DUTY"] == 1


# ── Чем это было бы, не будь запрета ─────────────────────────────────────


def test_the_damage_the_guard_prevents_is_real(used, division):
    """Проба самого запрета: показать, ЧТО именно он держит.

    Тип сносится в обход приёмника (raw SQL — сигналов не шлёт), и сданный день
    после этого не выводится вовсе. Без этого теста запрет выглядел бы
    предосторожностью на всякий случай.
    """
    from django.db import connection

    with clock.override(MORNING):
        submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)
    snapshot = OpsDailySubmission.objects.get(
        division_id=division.id, business_date=TODAY
    ).snapshot

    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM ops_status_types WHERE code = %s", ["DUTY"])

    catalog = StatusCatalog.from_rows(StatusTypeSelector.catalog_rows())
    with pytest.raises(ValueError, match="DUTY"):
        expense_from_snapshot(snapshot, TODAY, catalog)
