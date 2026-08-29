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
from organization_management.apps.operations.models_status import OpsEmployeeStatus
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


def test_it_can_stop_before_the_submission(storage, types):  # noqa: F811
    """`--no-submit`: люди и статусы есть, день НЕ сдан (Plane №72).

    Пробы `day-submission` показывают путь «день не сдан → сдаём → сдан», и на
    стенде, где день уже сдан сидом, две из них краснеют: сдавать нечего.
    Раньше это лечилось памятью человека («не звать сид перед смоуком»), теперь
    — флагом.

    Проба держит ОБА конца: статусы на месте (иначе флаг превратил бы сид в
    пустышку) и сдачи нет ни одной.
    """
    seed(no_submit=True)

    assert OpsEmployeeStatus.objects.count() > 0, "статусы не заведены — сид пуст"
    assert OpsDailySubmission.objects.count() == 0
    assert OpsIssuedDocument.objects.count() == 0


def test_no_submit_wins_over_the_release(storage, types):  # noqa: F811
    """`--no-submit` сильнее `--no-release`: выпускать документ по несданному
    дню нечем, и тихая сдача ради выпуска обошла бы флаг."""
    seed(no_submit=True, no_release=False)

    assert OpsDailySubmission.objects.count() == 0
    assert OpsIssuedDocument.objects.count() == 0


def test_a_run_on_the_next_day_does_not_collide_with_yesterday(storage, types):  # noqa: F811
    """Второй день подряд — не IntegrityError (Plane №154).

    Статус сида живёт ДВОЕ суток, а идемпотентность держалась на дате начала:
    вчерашняя строка [вчера, завтра) не считалась «уже засеянной» для
    сегодняшнего запуска, зато пересекалась с ней — и упиралась в исключающее
    ограничение базы. Повтор в ТОТ ЖЕ день при этом проходил, поэтому дефект и
    прожил незамеченным: стенд поднимали и проверяли в один день.
    """
    from datetime import timedelta

    yesterday = MORNING - timedelta(days=1)
    with clock.override(yesterday):
        call_command("seed_expense_chain", no_submit=True)
    before = OpsEmployeeStatus.objects.count()

    # Ровно то, что делает человек, поднимая стенд на следующий день.
    seed(no_submit=True)

    assert OpsEmployeeStatus.objects.count() == before, (
        "сид завёл вторую строку поверх вчерашней — она пересекается с ней "
        "и в проде упёрлась бы в excl_hard_status_overlap"
    )


def test_it_does_not_touch_a_foreign_status_on_those_days(storage, types):  # noqa: F811
    """Чужой статус на те же дни сид НЕ трогает и не падает.

    На живом стенде у человека может стоять настоящий статус: сид обязан его
    обойти, а не заводить поверх и не валиться.
    """
    seed(no_submit=True)
    mine = OpsEmployeeStatus.objects.filter(created_by=seed_expense_chain.ACTOR).first()
    assert mine is not None
    OpsEmployeeStatus.objects.filter(pk=mine.pk).update(
        status_type_code="STUDY", created_by="человек"
    )
    before = OpsEmployeeStatus.objects.count()

    seed(no_submit=True)

    assert OpsEmployeeStatus.objects.count() == before
    assert OpsEmployeeStatus.objects.get(pk=mine.pk).status_type_code == "STUDY"


def test_it_refuses_loudly_without_the_status_dictionary(storage):
    """Пустой справочник — самая частая беда свежего стенда.

    Отказ обязан назвать, чего не хватает и чем это лечится: молча собранная
    цепочка без статусов показала бы расход, в котором все «в строю», и это
    выглядело бы правдой.
    """
    with pytest.raises(CommandError) as exc:
        seed()

    assert "seed_status_types" in str(exc.value)


# ── Переиздание выпуска, у которого пропали байты (Plane №320) ───────────────
#
# Строка выпуска живёт в базе, а файл — на диске, и диск стенда переживает базу
# не всегда: `private_storage` не в репозитории, его сносят при переносе и
# пересборке. База продолжает утверждать, что документ выпущен, а скачивание
# отвечает 500 — правильным ответом на порчу, но на стенде это выглядит
# поломкой сервера, и каждый обход API спотыкается заново.


def test_the_seed_reissues_a_document_whose_bytes_are_gone(storage, types):  # noqa: F811
    from organization_management.apps.operations import document_storage

    seed()
    issued = OpsIssuedDocument.objects.get(status=OpsIssuedDocument.Status.ISSUED)
    path = document_storage.storage_path(issued.attachment)
    assert path.exists(), "сид не написал байт вовсе — проверять нечего"
    old_attachment_id = issued.attachment_id
    path.unlink()

    seed()

    fresh = OpsIssuedDocument.objects.get(status=OpsIssuedDocument.Status.ISSUED)
    assert fresh.attachment_id != old_attachment_id, "документ не переиздан"
    assert document_storage.storage_path(fresh.attachment).exists(), (
        "переизданный документ снова без байт"
    )


def test_a_foreign_broken_document_is_left_alone(storage, types):  # noqa: F811
    """Чужой битый выпуск сид НЕ трогает — он о нём ничего не знает.

    Граница узкая намеренно: сид чинит СВОЮ фикстуру. Документ, выпущенный
    человеком или другой системой, — факт чужой работы, и удалять его ради
    красоты стенда нельзя даже когда он битый.
    """
    from organization_management.apps.operations import document_storage

    seed()
    issued = OpsIssuedDocument.objects.get(status=OpsIssuedDocument.Status.ISSUED)
    document_storage.storage_path(issued.attachment).unlink()
    issued.created_by = "человек:erda"
    issued.save(update_fields=["created_by"])
    kept_id = issued.id

    seed()

    assert OpsIssuedDocument.objects.filter(id=kept_id).exists(), (
        "сид снёс чужой выпуск"
    )
