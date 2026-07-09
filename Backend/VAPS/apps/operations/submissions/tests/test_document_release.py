"""Tests for issue_expense_document — выпуск расхода (Story 6.5).

Happy/amendment-пути идут от РЕАЛЬНОГО ``submit_day``/``amend_day`` (снапшот
руками не лепим — урок ревью 5.4b); ФИКСТУРА-ПРЕРЕКВИЗИТ: ORM-путь берёт
``staff_map`` из ``allocated_slots_on``, поэтому happy-тесты ОБЯЗАНЫ сеять
``DivisionHistoricalSlot`` (иначе derive даёт warning ``no_staffing_record``
и release-гвард честно откажет 422 — это НЕ ослаблять).

Сравнение «байты == generate(build(снапшот))» — по СОДЕРЖИМОМУ zip-членов
(имя → байты): python-docx пишет wall-clock mtime в zip-метаданные, поэтому
полные байты двух генераций расходятся на границе секунды; payload документа
детерминирован. Целостность самих байт держит sha256-сверка с диском.

Хранилище — ``tmp_path`` через ``settings``-фикстуру (канон 6.1).
Конкурентный тест — marker ``concurrency`` (бежит в test-full, скелет 6.2);
он пишет audit-строки → его teardown-flush даёт 1 ожидаемый ERROR
(audit_logs append-only × TRUNCATE) — это НЕ провал, критерий: passed.
"""

import hashlib
import itertools
import threading
import uuid
import zipfile
from datetime import date
from io import BytesIO

import pytest
from django.db import connection

from apps.audit.models import AuditLog
from apps.core import clock
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    DivisionType,
    Employee,
    Organization,
)
from apps.core.selectors import local_midnight
from apps.documents.generators import generate_expense_docx
from apps.documents.models import (
    EXPENSE_DOC_TYPE,
    Attachment,
    DocumentSequence,
    IssuedDocument,
)
from apps.documents.services import storage_path
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.expense_document import build_expense_document
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.services import (
    amend_day,
    issue_expense_document,
    submit_day,
)

pytestmark = pytest.mark.django_db

D = date(2026, 7, 8)
_iin = itertools.count(650)


@pytest.fixture
def storage(settings, tmp_path):
    settings.VAPS_PRIVATE_STORAGE_ROOT = tmp_path
    return tmp_path


@pytest.fixture
def division(storage):
    org = Organization.objects.create(name="Орг", code="ORG-REL")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dtp, name="Отдел Р", code="REL-A"
    )


def make_employee(division):
    n = next(_iin)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )


def make_status(emp, code, date_start, date_end):
    return EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code=code,
        date_start=date_start,
        date_end=date_end,
        source="USER",
    )


def make_slot(division, slots):
    return DivisionHistoricalSlot.objects.create(
        division=division,
        allocated_slots=slots,
        valid_from=local_midnight(date(2026, 7, 1)),
    )


def _submit(division):
    with clock.override(D):
        return submit_day(division_id=division.id, business_date=D, actor="op-1")


def _amend(division, reason="ретро-правка статуса", sanction="приказ №77"):
    return amend_day(
        division_id=division.id,
        business_date=D,
        actor="op-2",
        reason=reason,
        sanction=sanction,
    )


def _issue(division, actor="issuer-1"):
    return issue_expense_document(division_id=division.id, business_date=D, actor=actor)


def _zip_members(raw):
    """Имя → байты каждого zip-члена: содержимое .docx без zip-метаданных."""
    with zipfile.ZipFile(BytesIO(raw)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def _document_audit_rows():
    return AuditLog.objects.filter(action__startswith="DOCUMENT_")


def _raises_domain(code, http_status, division=None, **kwargs):
    kwargs.setdefault("division_id", division.id if division else uuid.uuid4())
    kwargs.setdefault("business_date", D)
    kwargs.setdefault("actor", "issuer-1")
    with pytest.raises(DomainError) as excinfo:
        issue_expense_document(**kwargs)
    assert excinfo.value.code == code
    assert excinfo.value.http_status == http_status
    return excinfo.value


def _tampered_submission(division, snapshot):
    """Прямая строка сдачи с рукописным снапшотом — ТОЛЬКО для schema-гварда
    (guard бьёт до derive, содержимое roster/rows не читается)."""
    return DailySubmission.objects.create(
        division_id=division.id,
        business_date=D,
        version=1,
        is_current=True,
        event=DailySubmission.Event.CHANGED,
        submitted_by="op-1",
        submitted_at=Clock.now(),
        snapshot=snapshot,
    )


# --- AC-1: happy path -------------------------------------------------------


def test_happy_path_issues_first_number_with_fixed_bytes(division):
    emp = make_employee(division)
    make_employee(division)  # без факта → В строю
    make_status(emp, "VACATION", date(2026, 7, 1), date(2026, 7, 15))
    make_slot(division, 3)
    sub = _submit(division)

    issued = _issue(division)

    assert issued.status == IssuedDocument.Status.ISSUED
    assert (issued.doc_type, issued.number, issued.year) == (EXPENSE_DOC_TYPE, 1, 2026)
    assert issued.business_date == D
    assert issued.division_id == division.id
    assert (issued.submission_id, issued.submission_version) == (sub.pk, 1)
    assert issued.supersedes is None
    assert issued.reason == ""
    assert issued.created_by == "issuer-1"

    # Байты зафиксированы: sha256/size от create_attachment == факту на диске.
    raw = storage_path(issued.attachment).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == issued.attachment.sha256
    assert len(raw) == issued.attachment.size
    assert issued.attachment.original_name == "расход_2026-07-08_исх-1.docx"

    # …и равны generate_expense_docx(build_expense_document(снапшот)) —
    # содержимое zip-членов, метаданные zip несут mtime (см. док-стринг).
    rebuilt = generate_expense_docx(
        build_expense_document(
            sub.snapshot,
            D,
            staff_map={division.id: 3},
            division_names={division.id: division.name},
            division_id=division.id,
        )
    )
    assert _zip_members(raw) == _zip_members(rebuilt)

    # Аудит DOCUMENT_ISSUED: entity_id = UUID выпуска, лёгкий payload.
    row = AuditLog.objects.get(action="DOCUMENT_ISSUED")
    assert row.entity_id == issued.id
    assert row.actor_user_id == "issuer-1"
    assert row.new_value["number"] == 1
    assert row.new_value["year"] == 2026
    assert row.new_value["sha256"] == issued.attachment.sha256
    assert row.new_value["submission_version"] == 1
    assert row.new_value["supersedes_number"] is None
    assert "snapshot" not in row.new_value


def test_str_division_id_is_coerced(division):
    make_employee(division)
    make_slot(division, 1)
    _submit(division)
    issued = issue_expense_document(
        division_id=str(division.id), business_date=D, actor="issuer-1"
    )
    assert issued.division_id == division.id
    assert issued.number == 1


def test_no_submission_for_date_409(division):
    _raises_domain("REPORT_NOT_READY_FOR_DATE", 409, division)
    assert not IssuedDocument.objects.exists()
    assert not Attachment.objects.exists()
    assert not DocumentSequence.objects.exists()
    assert not _document_audit_rows().exists()


def test_empty_actor_400(division):
    _raises_domain("VALIDATION_ERROR", 400, division, actor="   ")
    assert not IssuedDocument.objects.exists()


# --- AC-2: amendment → «взамен исх. №» --------------------------------------


def test_amendment_cycle_supersedes_and_keeps_old_bytes(division):
    emp = make_employee(division)
    make_slot(division, 2)
    _submit(division)
    first = _issue(division)
    first_sha = first.attachment.sha256
    first_raw = storage_path(first.attachment).read_bytes()

    make_status(emp, "SICK_LEAVE", date(2026, 7, 8), date(2026, 7, 12))
    amended = _amend(division, reason="ретро-правка статуса")
    second = _issue(division, actor="issuer-2")

    assert second.number == 2
    assert second.supersedes_id == first.id
    assert (second.submission_id, second.submission_version) == (amended.pk, 2)
    assert second.reason == "ретро-правка статуса"
    assert second.status == IssuedDocument.Status.ISSUED

    first.refresh_from_db()
    assert first.status == IssuedDocument.Status.SUPERSEDED
    # Байты/строка старого выпуска НЕ тронуты: повторное чтение — тот же sha256.
    assert first.attachment.sha256 == first_sha
    reread = storage_path(first.attachment).read_bytes()
    assert reread == first_raw
    assert hashlib.sha256(reread).hexdigest() == first_sha

    superseded = AuditLog.objects.get(action="DOCUMENT_SUPERSEDED")
    assert superseded.entity_id == first.id
    assert superseded.old_value["status"] == "ISSUED"
    assert superseded.new_value["status"] == "SUPERSEDED"
    assert superseded.new_value["superseded_by_number"] == 2
    issued_rows = AuditLog.objects.filter(action="DOCUMENT_ISSUED").order_by(
        "created_at"
    )
    assert issued_rows.count() == 2
    assert issued_rows.last().new_value["supersedes_number"] == 1
    assert issued_rows.last().new_value["submission_version"] == 2


def test_double_amendment_single_supersede_hop(division):
    make_employee(division)
    make_slot(division, 1)
    _submit(division)
    first = _issue(division)
    _amend(division, reason="правка №1")
    _amend(division, reason="правка №2")

    second = _issue(division)

    # Цепь выпусков короче цепи версий (Д7): один хоп №2 → №1.
    assert second.supersedes_id == first.id
    assert second.submission_version == 3
    assert second.reason == "правка №2"
    assert IssuedDocument.objects.count() == 2


def test_first_issue_of_amended_day_has_reason_without_supersedes(division):
    make_employee(division)
    make_slot(division, 1)
    _submit(division)
    _amend(division, reason="правка до выпуска")

    issued = _issue(division)

    assert issued.supersedes is None
    assert issued.reason == "правка до выпуска"
    assert issued.submission_version == 2


# --- AC-3: повтор той же версии = отказ --------------------------------------


def test_same_version_reissue_409_and_counter_gap_free(division):
    make_employee(division)
    make_slot(division, 1)
    _submit(division)
    _issue(division)

    error = _raises_domain("DOCUMENT_ALREADY_ISSUED", 409, division)
    assert error.detail["number"] == 1

    assert IssuedDocument.objects.count() == 1
    assert Attachment.objects.count() == 1
    # Откат вернул аллоцированный номер — дырки нет (gap-free).
    counter = DocumentSequence.objects.get(doc_type=EXPENSE_DOC_TYPE, year=2026)
    assert counter.last_number == 1
    assert AuditLog.objects.filter(action="DOCUMENT_ISSUED").count() == 1
    assert not AuditLog.objects.filter(action="DOCUMENT_SUPERSEDED").exists()


# --- AC-4: schema guard ------------------------------------------------------


@pytest.mark.parametrize(
    "snapshot",
    [
        {"schema_version": 2, "roster": [], "rows": []},  # неподдерживаемая
        {"roster": [], "rows": []},  # ключ отсутствует
        {"schema_version": True, "roster": [], "rows": []},  # bool-дыра (не int)
        {"schema_version": "1", "roster": [], "rows": []},  # str, не int
    ],
)
def test_snapshot_schema_guard_rejects_before_number_spent(division, snapshot):
    _tampered_submission(division, snapshot)
    make_slot(division, 1)

    _raises_domain("SNAPSHOT_SCHEMA_UNSUPPORTED", 422, division)

    assert not IssuedDocument.objects.exists()
    assert not Attachment.objects.exists()
    # Отказ ДО генерации и ДО траты номера: счётчик даже не бутстрапнут.
    assert not DocumentSequence.objects.exists()
    assert not _document_audit_rows().exists()


# --- AC-5: release-ассерт формул ---------------------------------------------


def test_staff_lt_list_violation_refuses_release(division):
    make_employee(division)
    make_employee(division)
    make_slot(division, 1)  # Штат 1 < Список 2 → violation staff_lt_list
    _submit(division)

    error = _raises_domain("REPORT_NOT_CONVERGENT", 422, division)

    reasons = [finding["reason"] for finding in error.detail["violations"]]
    assert reasons == ["staff_lt_list"]
    assert error.detail["violations"][0]["staff_total"] == 1
    assert error.detail["violations"][0]["list_total"] == 2
    assert not IssuedDocument.objects.exists()
    assert not Attachment.objects.exists()
    assert not DocumentSequence.objects.exists()
    assert not _document_audit_rows().exists()


def test_missing_staffing_record_refuses_release(division):
    make_employee(division)
    _submit(division)  # слот НЕ посеян → warning no_staffing_record

    error = _raises_domain("REPORT_NOT_CONVERGENT", 422, division)

    reasons = [finding["reason"] for finding in error.detail["warnings"]]
    assert reasons == ["no_staffing_record"]
    assert not IssuedDocument.objects.exists()
    assert not DocumentSequence.objects.exists()
    assert not _document_audit_rows().exists()


def test_warning_without_violation_alone_refuses_release(division):
    # Единственный член списка — ПРИКОМАНДИРОВАННЫЙ (ATTACHED вне Списка):
    # list_total=0, поэтому staff_lt_list НЕ возникает даже без штата —
    # остаётся ТОЛЬКО warning no_staffing_record. Судит НЕСУЩЕСТЬ ветки
    # `or report.warnings` гварда (AC-5): мягкий финдинг БЕЗ violation всё
    # равно отказывает выпуск, а не выпускает молча. Без этого теста мутант
    # `if report.violations:` (снятие warnings-клаузы) переживал весь сьют —
    # co-present violation в test_missing_staffing_record его маскировал.
    emp = make_employee(division)
    make_status(emp, "ATTACHED", date(2026, 7, 1), date(2026, 7, 15))
    _submit(division)  # слот НЕ посеян → warning без violation

    error = _raises_domain("REPORT_NOT_CONVERGENT", 422, division)

    # Ключевой ассерт: violations пуст — отказ породила ИМЕННО warning-ветка.
    assert error.detail["violations"] == []
    reasons = [finding["reason"] for finding in error.detail["warnings"]]
    assert reasons == ["no_staffing_record"]
    assert not IssuedDocument.objects.exists()
    assert not Attachment.objects.exists()
    assert not DocumentSequence.objects.exists()
    assert not _document_audit_rows().exists()


# --- Д9: DOCUMENT_GENERATED не эмитится --------------------------------------


def test_document_generated_is_not_emitted(division):
    make_employee(division)
    make_slot(division, 1)
    _submit(division)
    _issue(division)

    # Семя DOCUMENT_GENERATED остаётся async-пути 6.6 — синхронный выпуск
    # наблюдаемого состояния «собраны, не выпущены» не имеет (Д9).
    assert not AuditLog.objects.filter(action="DOCUMENT_GENERATED").exists()
    assert AuditLog.objects.filter(action="DOCUMENT_ISSUED").count() == 1


# --- Конкурентность (test-full) ----------------------------------------------

WAIT = 10  # seconds; generous upper bound so a dead thread fails fast, not hangs


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_concurrent_issue_exactly_one_wins_no_number_gap(settings, tmp_path):
    # Два конкурентных выпуска одного дня сериализуются на submission-локе
    # (Ловушка №4): ровно один ISSUED, второй 409 DOCUMENT_ALREADY_ISSUED,
    # номера без дырок (откат проигравшего вернул счётчик).
    settings.VAPS_PRIVATE_STORAGE_ROOT = tmp_path
    org = Organization.objects.create(name="Орг", code="ORG-REL65")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    division = Division.objects.create(
        organization=org, type_code=dtp, name="Отдел К", code="REL65-A"
    )
    try:
        make_employee(division)
        make_slot(division, 1)
        _submit(division)

        barrier = threading.Barrier(2)
        results = {}

        def worker(name):
            try:
                barrier.wait(timeout=WAIT)
                row = issue_expense_document(
                    division_id=division.id, business_date=D, actor=f"op-{name}"
                )
                results[name] = ("ok", row.number)
            except DomainError as exc:
                results[name] = ("domain", exc.code)
            except Exception as exc:  # noqa: BLE001 — record, don't lose the cause
                results[name] = ("error", f"{type(exc).__name__}: {exc}")
            finally:
                connection.close()

        threads = [threading.Thread(target=worker, args=(n,)) for n in ("A", "B")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=WAIT * 3)
            assert not thread.is_alive(), "thread hung past the deadline"

        outcomes = sorted(kind for kind, _ in results.values())
        assert outcomes == ["domain", "ok"], f"unexpected outcomes: {results}"
        loser = next(v for v in results.values() if v[0] == "domain")
        assert loser[1] == "DOCUMENT_ALREADY_ISSUED"

        issued = IssuedDocument.objects.get()  # ровно одна строка
        assert issued.status == IssuedDocument.Status.ISSUED
        assert issued.number == 1
        counter = DocumentSequence.objects.get(doc_type=EXPENSE_DOC_TYPE, year=2026)
        assert counter.last_number == 1  # откат проигравшего — без дырки
    finally:
        IssuedDocument.objects.all().delete()
        Attachment.objects.all().delete()
        DocumentSequence.objects.all().delete()
        DailySubmission.objects.filter(division_id=division.id).delete()
        EmployeeStatus.objects.all().delete()
        Employee.objects.filter(division=division).delete()
        DivisionHistoricalSlot.objects.filter(division=division).delete()
        Division.objects.filter(id=division.id).delete()
        Organization.objects.filter(code="ORG-REL65").delete()
