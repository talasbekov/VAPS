"""Сид цепочки расхода: собирается ли она ШТАТНЫМ путём и переживает ли повтор.

Ценность сида — не в строках, а в том, что после него на стенде РАБОТАЕТ экран.
Поэтому проверяется не «строки появились», а что цепочка собрана теми же
сервисами, что и в проде: у сдачи есть снимок, у выпуска — номер из счётчика.
Сид, кладущий строки напрямую, показал бы состояние, которого система сама
породить не может, — и стенд лгал бы ровно в ту сторону, в какую его смотрят.

Второе свойство — повтор. Стенд поднимают не один раз, и второй запуск не должен
ни падать, ни плодить второе «Управление» рядом с первым.
"""
import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.management.commands import (
    seed_expense_chain,
)
from organization_management.apps.operations.models_document import OpsIssuedDocument
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
)
from organization_management.apps.operations.tests.test_traffic_light import types  # noqa: F401

pytestmark = pytest.mark.django_db


@pytest.fixture
def storage(tmp_path):
    with override_settings(OPS_PRIVATE_STORAGE_ROOT=str(tmp_path)):
        yield tmp_path


def seed(**options):
    with clock.override(MORNING):
        call_command("seed_expense_chain", **options)


def division():
    return Division.objects.get(name=seed_expense_chain.DIVISION_NAME)


# ── Цепочка собирается ───────────────────────────────────────────────────


def test_the_chain_reaches_an_issued_document(storage, types):  # noqa: F811
    seed()

    issued = OpsIssuedDocument.objects.get()
    assert issued.status == OpsIssuedDocument.Status.ISSUED
    assert issued.number == 1


def test_the_submission_carries_a_real_snapshot(storage, types):  # noqa: F811
    """Признак того, что день сдан СЕРВИСОМ, а не вставлен строкой: снимок
    есть, и в нём столько людей, сколько завели."""
    seed()

    submission = OpsDailySubmission.objects.get()
    assert submission.snapshot["schema_version"] >= 2
    assert len(submission.snapshot["roster"]) == len(seed_expense_chain.PEOPLE)


def test_someone_is_left_in_service_on_purpose(storage, types):  # noqa: F811
    """«В строю» — выводимое состояние, и стенд без него показывал бы расход, в
    котором каждая клетка заполнена, то есть не показывал бы главного."""
    seed()

    snapshot = OpsDailySubmission.objects.get().snapshot
    with_facts = {row["employee_id"] for row in snapshot["rows"]}
    everyone = {row["employee_id"] for row in snapshot["roster"]}

    assert everyone - with_facts != set()


def test_the_document_has_bytes_behind_it(storage, types):  # noqa: F811
    """Номер без файла — половина выпуска: экран показал бы документ, который
    нечего скачать."""
    seed()

    issued = OpsIssuedDocument.objects.get()
    assert (storage / str(issued.attachment.storage_key)).exists()


def test_the_day_is_todays(storage, types):  # noqa: F811
    seed()

    assert OpsDailySubmission.objects.get().business_date == TODAY


# ── Повтор ───────────────────────────────────────────────────────────────


def test_running_it_twice_does_not_duplicate_the_division(storage, types):  # noqa: F811
    seed()
    seed()

    assert Division.objects.filter(name=seed_expense_chain.DIVISION_NAME).count() == 1


def test_running_it_twice_does_not_submit_the_day_again(storage, types):  # noqa: F811
    """Повторная сдача того же дня — конфликт по правилам раздела; сид обязан
    его не устраивать, а не ловить."""
    seed()
    seed()

    assert OpsDailySubmission.objects.count() == 1


def test_running_it_twice_does_not_issue_a_second_document(storage, types):  # noqa: F811
    """На стенде действует то же правило, что в проде: у дня один действующий
    документ."""
    seed()
    seed()

    assert OpsIssuedDocument.objects.count() == 1


def test_running_it_twice_does_not_duplicate_people(storage, types):  # noqa: F811
    seed()
    seed()

    roster = OpsDailySubmission.objects.get().snapshot["roster"]
    assert len(roster) == len(seed_expense_chain.PEOPLE)


# ── Границы ──────────────────────────────────────────────────────────────


def test_it_can_stop_before_the_release(storage, types):  # noqa: F811
    """Экран сданного дня показывают и без выпуска — незачем требовать номер
    ради того, чтобы посмотреть светофор."""
    seed(no_release=True)

    assert OpsDailySubmission.objects.count() == 1
    assert OpsIssuedDocument.objects.count() == 0


def test_it_refuses_loudly_without_the_status_dictionary(storage):
    """Пустой справочник — самая частая беда свежего стенда.

    Отказ обязан назвать, чего не хватает и чем это лечится: молча собранная
    цепочка без статусов показала бы расход, в котором все «в строю», и это
    выглядело бы правдой.
    """
    with pytest.raises(CommandError) as exc:
        seed()

    assert "seed_status_types" in str(exc.value)
