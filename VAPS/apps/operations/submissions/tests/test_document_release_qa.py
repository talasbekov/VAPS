"""QA-проход 6.5 — судьи выпуска расхода, которых нет НИГДЕ (мутационный принцип).

Dev-сьют (test_document_release, 16) исчерпывает happy/amendment/отказы/
конкурентность. Здесь — оси, на которых правка прод-кода не краснила НИ ОДИН
тест:

- **Кросс-ассерт контракт == derive (AC-5, вторая половина).** Удаление вызова
  ``_assert_matches_derive`` оставляло весь сьют зелёным — «расхождение =
  громкий отказ, не тихий выпуск» не судилось никем. Дрейф билдера имитируется
  monkeypatch-обёрткой (прод-billder frozen — Ловушка №2, его не трогаем).
- **Счётчик общий на (doc_type, year), НЕ пер-division (§82.3).** Все dev-тесты
  живут в одном подразделении — перевод счётчика на пер-division семантику не
  краснил ничего.
- **Год = business_date.year, НЕ wall-clock (Д6, Ловушка №10).** Сегодняшний
  wall-clock год == году D — мутация ``business_date.year`` → ``Clock.now()
  .year`` была невидима; судит зимняя дата 2025-12-31 + year-rollover §82.3
  (счётчики лет независимы, нумерация нового года с 1).
- **Малформный division_id падает громко** (docstring-контракт uuid-коэрции).
- **``reason`` аудит-строк DOCUMENT_* = reason сдачи** — снятие
  ``reason=locked.reason`` с ``record()`` не краснило ничего.
- **JSON-safety details (§36).** UUID в финдингах derive сравнивается в dict
  без конверсии — снятие ``_json_safe_findings`` было невидимым, а конверт
  ошибки 6.10 упадёт на ``json.dumps``.

Мир — свои копии фикстур (канон сьютов: общий conftest не заводим);
хранилище — ``tmp_path`` (канон 6.1); wall-clock не используется —
даты фиксированы, сдачи под ``clock.override``.
"""

import itertools
import json
from dataclasses import replace
from datetime import date

import pytest

from apps.audit.models import AuditLog
from apps.core import clock
from apps.core.exceptions import DomainError
from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    DivisionType,
    Employee,
    Organization,
)
from apps.core.selectors import local_midnight
from apps.documents.models import (
    EXPENSE_DOC_TYPE,
    Attachment,
    DocumentSequence,
    IssuedDocument,
)
from apps.operations.statuses.services.strength_report import REPORT_COLUMNS
from apps.operations.submissions.services import (
    amend_day,
    document_release_service,
    issue_expense_document,
    submit_day,
)

pytestmark = pytest.mark.django_db

D = date(2026, 7, 8)
WINTER = date(2025, 12, 31)
_iin = itertools.count(66_500)


@pytest.fixture
def storage(settings, tmp_path):
    settings.VAPS_PRIVATE_STORAGE_ROOT = tmp_path
    return tmp_path


@pytest.fixture
def division(storage):
    org = Organization.objects.create(name="Орг", code="ORG-RELQA")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dtp, name="Отдел КА", code="RELQA-A"
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


def make_slot(division, slots, valid_from=date(2026, 7, 1)):
    return DivisionHistoricalSlot.objects.create(
        division=division,
        allocated_slots=slots,
        valid_from=local_midnight(valid_from),
    )


def _submit(division, business_date=D):
    with clock.override(business_date):
        return submit_day(
            division_id=division.id, business_date=business_date, actor="op-1"
        )


def _issue(division, business_date=D, actor="issuer-1"):
    return issue_expense_document(
        division_id=division.id, business_date=business_date, actor=actor
    )


# --- AC-5 (вторая половина): кросс-ассерт контракт == derive ------------------


def _bump_totals_staff(data):
    return replace(
        data, totals=replace(data.totals, staff_total=data.totals.staff_total + 1)
    )


def _bump_row_vacancies(data):
    (row,) = data.rows
    return replace(data, rows=[replace(row, vacancies=row.vacancies + 1)])


def _bump_first_column_count(data):
    (row,) = data.rows
    key = REPORT_COLUMNS[0]
    cells = dict(row.cells)
    cells[key] = replace(cells[key], count=cells[key].count + 1)
    return replace(data, rows=[replace(row, cells=cells)])


@pytest.mark.parametrize(
    "tamper",
    [_bump_totals_staff, _bump_row_vacancies, _bump_first_column_count],
    ids=["totals-staff", "row-vacancies", "column-count"],
)
def test_builder_drift_refuses_release_before_number_and_file(
    division, monkeypatch, tamper
):
    """Дрейф билдер↔derive — громкий AssertionError ДО номера, файла и аудита.

    Прод-билдер frozen (Ловушка №2) — дрейф имитирует monkeypatch-обёртка,
    искажающая ОДНО число контракта на каждой из трёх осей кросс-ассерта
    (totals / поле строки / счётчик колонки).
    """
    make_employee(division)
    make_slot(division, 1)
    _submit(division)

    real_build = document_release_service.build_expense_document

    def drifted(*args, **kwargs):
        return tamper(real_build(*args, **kwargs))

    monkeypatch.setattr(document_release_service, "build_expense_document", drifted)

    with pytest.raises(AssertionError, match="контракт == derive"):
        _issue(division)

    assert not IssuedDocument.objects.exists()
    assert not Attachment.objects.exists()
    # Отказ ДО траты номера: счётчик даже не бутстрапнут (ассерт до allocate).
    assert not DocumentSequence.objects.exists()
    assert not AuditLog.objects.filter(action__startswith="DOCUMENT_").exists()


# --- §82.3: счётчик — канал (doc_type, year), не пер-division -----------------


def test_number_counter_is_shared_across_divisions(storage):
    org = Organization.objects.create(name="Орг", code="ORG-RELQA2")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    alpha = Division.objects.create(
        organization=org, type_code=dtp, name="Отдел КА-1", code="RELQA2-A"
    )
    beta = Division.objects.create(
        organization=org, type_code=dtp, name="Отдел КА-2", code="RELQA2-B"
    )
    for division in (alpha, beta):
        make_employee(division)
        make_slot(division, 1)
        _submit(division)

    first = _issue(alpha, actor="issuer-a")
    second = _issue(beta, actor="issuer-b")

    # Номера сквозные по (тип, год) — второе подразделение продолжает счёт.
    assert (first.number, second.number) == (1, 2)
    counter = DocumentSequence.objects.get()  # ЕДИНСТВЕННАЯ строка счётчика
    assert (counter.doc_type, counter.year, counter.last_number) == (
        EXPENSE_DOC_TYPE,
        2026,
        2,
    )
    # Одна дата, разные подразделения — оба выпуска действуют (partial-unique
    # скоуплен division_id) и не связаны supersede-цепью.
    assert first.status == second.status == IssuedDocument.Status.ISSUED
    assert first.supersedes is None and second.supersedes is None
    # Файл-канал: каждому выпуску свой Attachment; actor доехал до created_by;
    # имя несёт номер ИЗ СЧЁТЧИКА; ATTACHMENT_UPLOADED — по одному на файл.
    assert first.attachment.pk != second.attachment.pk
    assert first.attachment.created_by == "issuer-a"
    assert second.attachment.created_by == "issuer-b"
    assert second.attachment.original_name == "расход_2026-07-08_исх-2.docx"
    assert AuditLog.objects.filter(action="ATTACHMENT_UPLOADED").count() == 2


# --- Д6/Ловушка №10: год документа = год business_date, не wall-clock ---------


def test_year_and_counter_follow_business_date_not_wall_clock(division):
    """Зимняя сдача 2025-12-31: year=2025 при wall-clock 2026 + rollover §82.3."""
    make_employee(division)
    make_slot(division, 1, valid_from=date(2025, 12, 1))
    _submit(division, business_date=WINTER)

    winter = _issue(division, business_date=WINTER)

    assert (winter.year, winter.number) == (2025, 1)
    assert winter.attachment.original_name == "расход_2025-12-31_исх-1.docx"

    _submit(division)
    summer = _issue(division)

    # Year-rollover: счётчик 2026 стартует заново с 1, счётчик 2025 не тронут.
    assert (summer.year, summer.number) == (2026, 1)
    by_year = {
        row.year: row.last_number
        for row in DocumentSequence.objects.filter(doc_type=EXPENSE_DOC_TYPE)
    }
    assert by_year == {2025: 1, 2026: 1}
    # Разные дни — оба выпуска действуют; зимний не вытеснен летним.
    winter.refresh_from_db()
    assert winter.status == IssuedDocument.Status.ISSUED
    assert summer.status == IssuedDocument.Status.ISSUED
    assert summer.supersedes is None


# --- Контракт uuid-коэрции: малформный id падает громко -----------------------


def test_malformed_division_id_fails_loudly_and_creates_nothing(division):
    make_employee(division)
    make_slot(division, 1)
    _submit(division)

    with pytest.raises(ValueError):
        issue_expense_document(
            division_id="каша-не-uuid", business_date=D, actor="issuer-1"
        )

    assert not IssuedDocument.objects.exists()
    assert not DocumentSequence.objects.exists()
    assert not AuditLog.objects.filter(action__startswith="DOCUMENT_").exists()


# --- Аудит: reason строк DOCUMENT_* = reason выпускаемой сдачи ----------------


def test_audit_rows_carry_submission_reason(division):
    make_employee(division)
    make_slot(division, 1)
    _submit(division)
    _issue(division)

    assert AuditLog.objects.get(action="DOCUMENT_ISSUED").reason == ""

    amend_day(
        division_id=division.id,
        business_date=D,
        actor="op-2",
        reason="ретро-правка статуса",
        sanction="приказ №77",
    )
    second = _issue(division, actor="issuer-2")

    superseded = AuditLog.objects.get(action="DOCUMENT_SUPERSEDED")
    assert superseded.reason == "ретро-правка статуса"
    latest = (
        AuditLog.objects.filter(action="DOCUMENT_ISSUED").order_by("created_at").last()
    )
    assert latest.entity_id == second.id
    assert latest.reason == "ретро-правка статуса"


# --- §36: details отказа сходимости — JSON-safe (UUID → str) -------------------


def test_convergence_details_are_json_safe(division):
    make_employee(division)
    make_employee(division)
    make_slot(division, 1)  # Штат 1 < Список 2 → violation staff_lt_list
    _submit(division)

    with pytest.raises(DomainError) as excinfo:
        _issue(division)

    error = excinfo.value
    assert error.code == "REPORT_NOT_CONVERGENT"
    # Конверт §36 сериализует details as-is — UUID уронил бы json.dumps (6.10).
    encoded = json.dumps(error.detail, ensure_ascii=False)
    assert str(division.id) in encoded
    assert error.detail["violations"][0]["division_id"] == str(division.id)
