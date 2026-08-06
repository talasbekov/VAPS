"""Выпуск расхода: что фиксируется, в каком порядке и что отказывает.

Выпуск отличается от выгрузки тем, что ФИКСИРУЕТ — байты, дайджест и исходящий
номер. Отсюда предмет проверок: строка выпуска говорит, ЧТО именно она
напечатала (сдача И её версия), номер приходит из общего счётчика, а второй
выпуск того же дня отказывает, а не кладёт в переписку два действующих расхода.

Отдельная нить — согласованность на отказе: несостоявшийся выпуск не оставляет
ни строки, ни номера.
"""
import pytest
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service, clock
from organization_management.apps.operations.document_release import (
    EXPENSE_DOC_TYPE,
    issue_expense_document,
)
from organization_management.apps.operations.day_submission_service import amend_day
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_document import (
    OpsAttachment,
    OpsDocumentSequence,
    OpsIssuedDocument,
)
from organization_management.apps.operations.tests.test_submitted_expense import (
    submit,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    in_slot,
)
from organization_management.apps.operations.tests.test_traffic_light import types  # noqa: F401

pytestmark = pytest.mark.django_db

ACTOR = "7"


@pytest.fixture
def storage(tmp_path):
    with override_settings(OPS_PRIVATE_STORAGE_ROOT=str(tmp_path)):
        yield tmp_path


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


@pytest.fixture
def submitted(types, division):  # noqa: F811
    in_slot(division)
    in_slot(division)
    submit(division)
    return division


def issue(division, business_date=TODAY, actor=ACTOR):
    with clock.override(MORNING):
        return issue_expense_document(
            division_id=division.id, business_date=business_date, actor=actor
        )


# ── Что зафиксировано ────────────────────────────────────────────────────


def test_issuing_a_submitted_day_produces_a_numbered_document(storage, submitted):
    issued = issue(submitted)

    assert issued.status == OpsIssuedDocument.Status.ISSUED
    assert issued.doc_type == EXPENSE_DOC_TYPE
    assert issued.number == 1
    assert issued.business_date == TODAY
    assert issued.division_id == submitted.id


def test_the_issue_records_which_submission_version_it_printed(storage, submitted):
    """Без версии ссылка указывала бы на «сдачу вообще», а поправка меняет её
    содержание — документ перестал бы говорить, ЧТО он напечатал.

    День СНАЧАЛА поправлен, поэтому печатается версия 2. На первой версии проба
    вакуумна: единица неотличима от жёстко вписанной константы, и подмена
    submission.version на 1 осталась бы зелёной.
    """
    with clock.override(MORNING):
        amend_day(
            division_id=submitted.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="ошибка в наряде",
            sanction="замечание",
        )

    issued = issue(submitted)

    from organization_management.apps.operations.selectors import (
        DailySubmissionSelector,
    )

    head = DailySubmissionSelector.latest_for(submitted.id, TODAY)
    assert head.version == 2
    assert issued.submission_version == 2
    assert issued.submission_id == head.pk


def test_the_bytes_are_fixed_and_addressable_by_their_digest(storage, submitted):
    issued = issue(submitted)

    stored = (storage / str(issued.attachment.storage_key)).read_bytes()
    assert stored[:2] == b"PK"  # .docx это zip-контейнер
    assert issued.attachment.size == len(stored)


def test_the_number_of_the_document_belongs_to_the_year_of_the_business_day(
    storage, submitted
):
    """Расход за 31 декабря, выпущенный 1 января, обязан лечь в нумерацию
    декабря — иначе исходящий номер противоречит своей дате.

    Часы СДВИНУТЫ в следующий год: под часами того же года проба вакуумна —
    «год делового дня» и «год выпуска» совпадают, и подмена одного другим не
    видна. Замени business_date.year на показание часов — тест краснеет.
    """
    from datetime import datetime, timezone

    next_year = datetime(TODAY.year + 1, 1, 3, 9, 0, tzinfo=timezone.utc)
    with clock.override(next_year):
        issued = issue_expense_document(
            division_id=submitted.id, business_date=TODAY, actor=ACTOR
        )

    assert issued.year == TODAY.year
    assert OpsDocumentSequence.objects.get(
        doc_type=EXPENSE_DOC_TYPE, year=TODAY.year
    ).last_number == 1
    assert not OpsDocumentSequence.objects.filter(year=TODAY.year + 1).exists()


def test_the_filename_carries_the_day_and_the_outgoing_number(storage, submitted):
    """Две выгрузки одного дня легли бы в одну папку под одним именем, и вторая
    затёрла бы первую."""
    issued = issue(submitted)

    assert TODAY.isoformat() in issued.attachment.original_name
    assert "исх-1" in issued.attachment.original_name


def test_two_divisions_draw_numbers_from_one_shared_run(storage, types, division):  # noqa: F811
    """Нумерация исходящих сквозная, а не своя у каждого подразделения."""
    other = Division.objects.create(name="Управление 2")
    in_slot(division)
    in_slot(other)
    submit(division)
    submit(other)

    assert issue(division).number == 1
    assert issue(other).number == 2


# ── Журнал ───────────────────────────────────────────────────────────────


def test_the_issue_is_recorded_in_the_journal_against_itself(storage, submitted):
    issued = issue(submitted)

    entry = OpsAuditLog.objects.get(
        action=audit_service.DOCUMENT_ISSUED,
        entity_type=audit_service.ENTITY_ISSUED_DOCUMENT,
    )
    assert entry.entity_id == issued.pk
    assert entry.new_value["number"] == issued.number
    assert entry.new_value["sha256"] == issued.attachment.sha256


def test_writing_the_bytes_gets_its_own_journal_entry(storage, submitted):
    """Записать файл и выпустить документ — разные решения, и в журнале это
    видно двумя строками с разными сущностями."""
    issue(submitted)

    assert OpsAuditLog.objects.filter(
        action=audit_service.ATTACHMENT_UPLOADED
    ).count() == 1
    assert OpsAuditLog.objects.filter(
        action=audit_service.DOCUMENT_ISSUED
    ).count() == 1


# ── Отказы ───────────────────────────────────────────────────────────────


def test_an_unsubmitted_day_cannot_be_issued(storage, types, division):  # noqa: F811
    in_slot(division)

    with pytest.raises(DomainError) as exc:
        issue(division)

    assert exc.value.code == "DAY_NOT_SUBMITTED"
    assert exc.value.http_status == 404


def test_issuing_the_same_day_twice_is_refused(storage, submitted):
    """Замена документа — отдельное решение со своей причиной. Молча выпустить
    второй значило бы оставить в переписке два действующих расхода."""
    first = issue(submitted)

    with pytest.raises(DomainError) as exc:
        issue(submitted)

    assert exc.value.code == "DOCUMENT_ALREADY_ISSUED"
    assert exc.value.http_status == 409
    assert exc.value.detail["number"] == first.number


def test_a_refused_second_issue_consumes_neither_a_number_nor_a_row(
    storage, submitted
):
    """Несостоявшийся выпуск не оставляет следа НИГДЕ.

    Держится это не порядком проверок, а транзакцией: даже аллоцируй сервис
    номер раньше отказа, откат вернул бы и его — проба с перестановкой остаётся
    зелёной, и это не дыра теста, а свойство конструкции. Проверяется поэтому
    именно РЕЗУЛЬТАТ: счётчик на единице, вложение одно, выпуск один.
    """
    issue(submitted)

    with pytest.raises(DomainError):
        issue(submitted)

    assert OpsIssuedDocument.objects.count() == 1
    assert OpsDocumentSequence.objects.get(
        doc_type=EXPENSE_DOC_TYPE, year=TODAY.year
    ).last_number == 1
    assert OpsAttachment.objects.count() == 1


def test_an_empty_actor_is_refused(storage, submitted):
    with pytest.raises(DomainError):
        issue(submitted, actor="   ")


def test_a_day_amended_after_the_refusal_still_holds_the_first_document(
    storage, submitted
):
    """Поправка сдачи сама по себе выпуск не отзывает: пока замена не выпущена
    явно, действует прежний документ."""
    first = issue(submitted)
    with clock.override(MORNING):
        amend_day(
            division_id=submitted.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="ошибка в наряде",
            sanction="замечание",
        )

    first.refresh_from_db()
    assert first.status == OpsIssuedDocument.Status.ISSUED


# ── Порядок замков ───────────────────────────────────────────────────────


def test_the_submission_head_is_locked_before_anything_else_is_read(
    storage, submitted
):
    """Голова сдачи ПЕРВОЙ, счётчик номеров ВТОРЫМ — единый порядок против
    клинча, и тот же замок берёт поправка дня.

    Ассерт по ИМЕНАМ ТАБЛИЦ: «где-то в прогоне есть FOR UPDATE» было бы
    вакуумно, а порядок между двумя замками — ровно то, что защищает.
    """
    with CaptureQueriesContext(connection) as captured:
        issue(submitted)

    locked = [
        q["sql"].lower()
        for q in captured.captured_queries
        if "for update" in q["sql"].lower()
    ]
    submissions = next(
        i for i, sql in enumerate(locked) if "ops_daily_submissions" in sql
    )
    sequences = next(
        i for i, sql in enumerate(locked) if "ops_document_sequences" in sql
    )
    assert submissions < sequences
