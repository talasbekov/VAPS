"""Story 5.11 — фрактальная сводка: assemble / freshness / rebuild.

Сводка = ТА ЖЕ ``DailySubmission`` родителя (ARCH-DATA-021 «Фрактальность»):
own-срез билдера 5.3a + additive-пины ``sources`` прямых детей. Тесты пинят
три кита: (1) roster сводки строго own-level — хук 5.4b НЕ авто-амендит сводку
по ретро-правке ребёнка; (2) свежесть derived — чтение ``summary_freshness``
не меняет ни байта существующих строк (канон байт-ассертов 5.10:
``json.dumps(sort_keys=True, ensure_ascii=False)``, refetch строго ``by_id``);
(3) пересборка — ЯВНОЕ действие (amendment сводки со свежими пинами), каскад
протухания идёт по уровням и никогда не создаёт версий у других подразделений.

Мир — свои копии хелперов (канон: общий conftest не заводим), образец
``test_traffic_light_tree``; хук-сценарии — образец
``test_snapshot_immutability_properties`` (5.10).
"""

import itertools
import json
import re
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest
from django.conf import settings
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.audit.models import AuditLog
from apps.core import clock
from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services import resolve_pending_clarification
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services import amend_day, submit_day
from apps.operations.submissions.services.summary_service import (
    FRESH,
    STALE,
    assemble_summary,
    rebuild_summary,
    summary_freshness,
)

pytestmark = pytest.mark.django_db

TODAY = date(2026, 7, 9)
ACTOR = "op-summary"
_iin = itertools.count(610_000)
_code = itertools.count(1)


def _day(offset):
    return TODAY + timedelta(days=offset)


def _canon(value):
    """Канон байт-формы 5.10 (Д3): одна форма для всех байт-ассертов."""
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


@pytest.fixture
def org_dt():
    org = Organization.objects.create(name="Орг", code="ORG-SUM")
    dt = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dt


def make_division(org_dt, parent=None):
    org, dt = org_dt
    c = f"SUM-{next(_code)}"
    return Division.objects.create(
        organization=org, type_code=dt, name=c, code=c, parent=parent
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


@pytest.fixture
def status_types(db):
    """Сид типов для хук-сценариев resolve (образец 5.10); get_or_create —
    идемпотентен."""
    for code, name, priority, column in [
        ("STUDY", "Учёба", 32, "TRAINING"),
        ("PENDING_CLARIFICATION", "Уточняется", 990, "PENDING"),
    ]:
        StatusType.objects.get_or_create(
            code=code,
            defaults={
                "name": name,
                "is_hard_block": False,
                "priority": priority,
                "report_column_code": column,
            },
        )


def _submit(division, business_date=TODAY):
    with clock.override(business_date):
        return submit_day(
            division_id=division.id, business_date=business_date, actor=ACTOR
        )


def _assemble(division, business_date=TODAY, actor=ACTOR):
    with clock.override(business_date):
        return assemble_summary(
            division_id=division.id, business_date=business_date, actor=actor
        )


def _rebuild(
    division,
    business_date=TODAY,
    *,
    reason="уточнение снизу",
    sanction="указание руководства",
    on=None,
):
    # ``on`` — день вызова (Clock): окно НЕ применяется, прошлые даты легальны.
    with clock.override(on or business_date):
        return rebuild_summary(
            division_id=division.id,
            business_date=business_date,
            actor=ACTOR,
            reason=reason,
            sanction=sanction,
        )


def _versions(division, business_date=TODAY):
    return DailySubmission.objects.filter(
        division_id=division.id, business_date=business_date
    ).count()


def _family(org_dt, children=2):
    """Родитель со own-штабом + ``children`` детей со штатом и сдачей."""
    parent = make_division(org_dt)
    own = make_employee(parent)
    kids = []
    for _ in range(children):
        child = make_division(org_dt, parent=parent)
        make_employee(child)
        kids.append((child, _submit(child)))
    return parent, own, kids


# --- AC-1: сборка сводки ------------------------------------------------------


def test_assemble_happy_path_sources_own_level_and_audit(org_dt):
    parent, own, kids = _family(org_dt)
    make_status(own, "DUTY", _day(-3), _day(3))  # own rows непусты

    summary = _assemble(parent)

    assert summary.version == 1
    assert summary.is_current is True
    assert summary.event == DailySubmission.Event.CHANGED  # первая сводка
    assert summary.late is False
    assert summary.snapshot["schema_version"] == 1

    # Пины: ВСЕ прямые дети с current-сдачей, отсортированы, JSON-safe типы.
    expected = sorted(
        (
            {"division_id": str(child.id), "submission_id": sub.pk, "version": 1}
            for child, sub in kids
        ),
        key=lambda pin: pin["division_id"],
    )
    assert summary.snapshot["sources"] == expected
    pin = summary.snapshot["sources"][0]
    assert isinstance(pin["division_id"], str)
    assert isinstance(pin["submission_id"], int)
    assert isinstance(pin["version"], int)

    # Ловушка №1: roster/rows строго own-level — сотрудники детей НЕ входят.
    assert [r["employee_id"] for r in summary.snapshot["roster"]] == [str(own.id)]
    assert {r["employee_id"] for r in summary.snapshot["rows"]} == {str(own.id)}

    # Аудит Д7: sources-компакт (без submission_id), снапшот в payload не едет.
    row = AuditLog.objects.get(action="DAILY_SUMMARY_ASSEMBLED")
    assert row.entity_id == parent.id
    assert row.old_value is None
    assert row.new_value["sources"] == [
        {"division_id": p["division_id"], "version": p["version"]} for p in expected
    ]
    assert "snapshot" not in row.new_value
    assert row.new_value["version"] == 1
    assert row.new_value["event"] == "CHANGED"


def test_assemble_exempt_children_and_empty_submitted_pinned(org_dt):
    parent = make_division(org_dt)
    make_employee(parent)
    staffed = make_division(org_dt, parent=parent)
    make_employee(staffed)
    _submit(staffed)
    silent_empty = make_division(org_dt, parent=parent)  # пусто и не сдал → exempt
    submitted_empty = make_division(org_dt, parent=parent)
    _submit(submitted_empty)  # пустой день валиден (5.3b) → пинится

    summary = _assemble(parent)

    pinned = [pin["division_id"] for pin in summary.snapshot["sources"]]
    assert str(silent_empty.id) not in pinned
    assert set(pinned) == {str(staffed.id), str(submitted_empty.id)}
    assert pinned == sorted(pinned)


# --- AC-2: полнота детей (required-гейт) --------------------------------------


def test_assemble_laggard_blocks_with_detail_and_no_row(org_dt):
    parent = make_division(org_dt)
    make_employee(parent)
    lagging = make_division(org_dt, parent=parent)
    make_employee(lagging)  # штат есть, сдачи нет → laggard

    with pytest.raises(DomainError) as err:
        _assemble(parent)

    assert err.value.code == "SUMMARY_CHILDREN_NOT_SUBMITTED"
    assert err.value.http_status == 422
    assert err.value.detail == {"laggards": [str(lagging.id)]}
    assert _versions(parent) == 0  # строка НЕ создана


def test_assemble_intermediate_child_required_via_subtree_roster(org_dt):
    """Ребёнок-промежуток сам пуст, но внук со штатом → required через
    subtree-ростер; сдав пустой own-день, перестаёт блокировать и пинится."""
    parent = make_division(org_dt)
    mid = make_division(org_dt, parent=parent)  # own-ростер пуст
    grandchild = make_division(org_dt, parent=mid)
    make_employee(grandchild)

    with pytest.raises(DomainError) as err:
        _assemble(parent)
    assert err.value.code == "SUMMARY_CHILDREN_NOT_SUBMITTED"
    assert err.value.detail == {"laggards": [str(mid.id)]}

    _submit(mid)  # пустой own-день валиден
    summary = _assemble(parent)
    # Пинится только ПРЯМОЙ ребёнок — внук не пин (фрактальность по уровням).
    assert [p["division_id"] for p in summary.snapshot["sources"]] == [str(mid.id)]


# --- AC-1: отказы сборки (зеркало порядка submit_day) -------------------------


def test_assemble_rejects_empty_actor(org_dt):
    parent, _, _ = _family(org_dt, children=1)
    for actor in ("", "   "):
        with pytest.raises(DomainError) as err:
            _assemble(parent, actor=actor)
        assert err.value.code == "VALIDATION_ERROR"
        assert err.value.http_status == 400


def test_assemble_unknown_division_404(db):
    with clock.override(TODAY), pytest.raises(DomainError) as err:
        assemble_summary(division_id=uuid.uuid4(), business_date=TODAY, actor=ACTOR)
    assert err.value.code == "ENTITY_NOT_FOUND"
    assert err.value.http_status == 404


def test_assemble_out_of_window_422(org_dt):
    parent, _, _ = _family(org_dt, children=1)
    with clock.override(TODAY), pytest.raises(DomainError) as err:
        assemble_summary(division_id=parent.id, business_date=_day(-1), actor=ACTOR)
    assert err.value.code == "BUSINESS_DATE_OUT_OF_WINDOW"
    assert err.value.http_status == 422


def test_assemble_duplicate_409(org_dt):
    parent, _, _ = _family(org_dt, children=1)
    _assemble(parent)
    with pytest.raises(DomainError) as err:
        _assemble(parent)
    assert err.value.code == "DAY_ALREADY_SUBMITTED"
    assert err.value.http_status == 409


def test_assemble_leaf_division_400(org_dt):
    leaf = make_division(org_dt)  # нет детей в children_map (Д10)
    make_employee(leaf)
    with pytest.raises(DomainError) as err:
        _assemble(leaf)
    assert err.value.code == "VALIDATION_ERROR"
    assert err.value.http_status == 400


# --- AC-3: derived-свежесть ---------------------------------------------------


def test_freshness_fresh_after_assemble_then_superseded_bytes_untouched(org_dt):
    parent, _, kids = _family(org_dt, children=2)
    child, _ = kids[0]
    summary = _assemble(parent)
    base_bytes = _canon(DailySubmissionSelector.by_id(summary.pk).snapshot)

    fresh = summary_freshness(parent.id, TODAY)
    assert fresh.status == FRESH
    assert fresh.superseded == [] and fresh.missing == [] and fresh.unpinned == []

    with clock.override(TODAY):
        amend_day(
            division_id=child.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="ретро-правка",
            sanction="указание",
        )

    stale = summary_freshness(parent.id, TODAY)
    assert stale.status == STALE
    assert stale.superseded == [
        {
            "division_id": str(child.id),
            "pinned_version": 1,
            "current_version": 2,
        }
    ]
    assert stale.missing == [] and stale.unpinned == []

    # Свежесть НИЧЕГО не пишет: строка сводки байт-в-байт прежняя (by_id —
    # Ловушка №5: current_for после чужих флипов не годится для байт-ассертов).
    refetched = DailySubmissionSelector.by_id(summary.pk)
    assert refetched.is_current is True
    assert _canon(refetched.snapshot) == base_bytes


def test_freshness_missing_when_pinned_child_has_no_current(org_dt):
    parent, _, kids = _family(org_dt, children=1)
    child, child_sub = kids[0]
    _assemble(parent)

    # Сим отзыва §82.1 («ноль текущих») ORM-сбросом: missing-ось лишь ЧИТАЕТ
    # этот класс, сам отзыв — вне скоупа 5.11.
    DailySubmission.objects.filter(pk=child_sub.pk).update(is_current=False)

    freshness = summary_freshness(parent.id, TODAY)
    assert freshness.status == STALE
    assert freshness.missing == [{"division_id": str(child.id), "pinned_version": 1}]
    assert freshness.superseded == [] and freshness.unpinned == []


def test_freshness_unpinned_when_new_required_child_appears(org_dt):
    parent, _, _ = _family(org_dt, children=1)
    _assemble(parent)

    newcomer = make_division(org_dt, parent=parent)
    make_employee(newcomer)
    _submit(newcomer)

    freshness = summary_freshness(parent.id, TODAY)
    assert freshness.status == STALE
    assert freshness.unpinned == [str(newcomer.id)]
    assert freshness.superseded == [] and freshness.missing == []


def test_freshness_none_without_summary(org_dt):
    parent, _, _ = _family(org_dt, children=1)
    # Нет действующей сводки вовсе.
    assert summary_freshness(parent.id, TODAY) is None
    # Current без ключа sources (обычная own-сдача) — тоже None.
    _submit(parent)
    assert summary_freshness(parent.id, TODAY) is None


def test_freshness_query_budget_invariant_to_children(org_dt):
    parent1, _, _ = _family(org_dt, children=1)
    _assemble(parent1)
    with CaptureQueriesContext(connection) as ctx1:
        summary_freshness(parent1.id, TODAY)
    n1 = len(ctx1)

    parent4, _, _ = _family(org_dt, children=4)
    _assemble(parent4)
    with CaptureQueriesContext(connection) as ctx4:
        summary_freshness(parent4.id, TODAY)
    n4 = len(ctx4)

    assert n1 == n4, f"N+1: {n1} queries for 1 child vs {n4} for 4"
    # 4 канала AC-3 (current_for + children_map + roster_on + current_for_many);
    # roster_on внутри — 2 SELECT'а (WORKING + history) → 5 строк в капчуре.
    assert n4 <= 5, f"unexpected query fan-out: {n4}"


# --- AC-4: пересборка «взамен» -------------------------------------------------


def test_rebuild_fresh_pins_v1_preserved_freshness_fresh_and_audit(org_dt):
    parent, _, kids = _family(org_dt, children=2)
    child, _ = kids[0]
    summary = _assemble(parent)
    v1_bytes = _canon(DailySubmissionSelector.by_id(summary.pk).snapshot)

    with clock.override(TODAY):
        amend_day(
            division_id=child.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="ретро-правка",
            sanction="указание",
        )
    assert summary_freshness(parent.id, TODAY).status == STALE

    # Окно НЕ применяется: пересборка задним числом (Clock на TODAY+3) легальна.
    rebuilt = _rebuild(
        parent, on=_day(3), reason="  уточнение снизу  ", sanction="  приказ №1  "
    )

    assert rebuilt.version == 2
    assert rebuilt.event == DailySubmission.Event.AMENDED
    assert rebuilt.late is False
    assert rebuilt.is_current is True
    assert rebuilt.reason == "уточнение снизу"  # persist trimmed
    assert rebuilt.sanction == "приказ №1"
    # Свежие пины: вытеснивший amendment ребёнка запинен как v2.
    pins = {p["division_id"]: p["version"] for p in rebuilt.snapshot["sources"]}
    assert pins[str(child.id)] == 2
    assert summary_freshness(parent.id, TODAY).status == FRESH

    # Прежняя версия сохранена: is_current=False, snapshot байт-в-байт,
    # пины в ней — СТАРЫЕ (v1 ребёнка).
    v1 = DailySubmissionSelector.by_id(summary.pk)
    assert v1.is_current is False
    assert _canon(v1.snapshot) == v1_bytes
    assert {p["division_id"]: p["version"] for p in v1.snapshot["sources"]}[
        str(child.id)
    ] == 1

    # Аудит Д7: before = head v1, after = v2 + sources-компакт + reason/sanction.
    row = AuditLog.objects.get(action="DAILY_SUMMARY_REBUILT")
    assert row.entity_id == parent.id
    assert row.old_value["submission_id"] == summary.pk
    assert row.old_value["version"] == 1
    assert row.new_value["version"] == 2
    assert row.new_value["reason"] == "уточнение снизу"
    assert row.new_value["sanction"] == "приказ №1"
    assert row.new_value["sources"] == [
        {"division_id": p["division_id"], "version": p["version"]}
        for p in rebuilt.snapshot["sources"]
    ]
    assert "snapshot" not in row.new_value


def test_rebuild_rejects_blank_reason_or_sanction_before_insert(org_dt):
    parent, _, _ = _family(org_dt, children=1)
    _assemble(parent)
    for kwargs in (
        {"reason": "", "sanction": "приказ"},
        {"reason": "   ", "sanction": "приказ"},
        {"reason": "причина", "sanction": ""},
        {"reason": "причина", "sanction": "   "},
    ):
        with pytest.raises(DomainError) as err:
            _rebuild(parent, **kwargs)
        assert err.value.code == "VALIDATION_ERROR"
        assert err.value.http_status == 400
    assert _versions(parent) == 1  # вставки не было


def test_rebuild_without_any_version_422(org_dt):
    parent, _, _ = _family(org_dt, children=1)
    with pytest.raises(DomainError) as err:
        _rebuild(parent)
    assert err.value.code == "NO_SUBMISSION_TO_AMEND"
    assert err.value.http_status == 422


def test_rebuild_head_without_sources_400(org_dt):
    parent, _, _ = _family(org_dt, children=1)
    _submit(parent)  # обычная own-сдача родителя — head без sources (Д10)
    with pytest.raises(DomainError) as err:
        _rebuild(parent)
    assert err.value.code == "VALIDATION_ERROR"
    assert err.value.http_status == 400
    assert _versions(parent) == 1


def test_rebuild_laggard_422_no_flip_head_stays_current(org_dt):
    parent, _, kids = _family(org_dt, children=1)
    child, child_sub = kids[0]
    summary = _assemble(parent)

    # Ребёнок «отозвал» сдачу (§82.1-класс) → required без current → laggard.
    DailySubmission.objects.filter(pk=child_sub.pk).update(is_current=False)

    with pytest.raises(DomainError) as err:
        _rebuild(parent)
    assert err.value.code == "SUMMARY_CHILDREN_NOT_SUBMITTED"
    assert err.value.detail == {"laggards": [str(child.id)]}
    # Строка НЕ создана, flip НЕ произошёл — head остался current.
    assert _versions(parent) == 1
    assert DailySubmissionSelector.by_id(summary.pk).is_current is True


# --- AC-5: фрактальный каскад БЕЗ автоматики ----------------------------------


def test_three_level_cascade_stales_level_by_level_no_auto_rebuild(org_dt):
    root = make_division(org_dt)
    make_employee(root)
    mid = make_division(org_dt, parent=root)
    make_employee(mid)
    leaf = make_division(org_dt, parent=mid)
    make_employee(leaf)

    _submit(leaf)
    mid_summary = _assemble(mid)
    root_summary = _assemble(root)
    # Фрактальность: пин root указывает на СВОДКУ mid — пин не различает
    # лист/сводку (та же сущность).
    assert root_summary.snapshot["sources"] == [
        {"division_id": str(mid.id), "submission_id": mid_summary.pk, "version": 1}
    ]

    # leaf пересдаёт v2 → протухает ТОЛЬКО mid (не транзитивно).
    with clock.override(TODAY):
        amend_day(
            division_id=leaf.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="ретро",
            sanction="указание",
        )
    assert summary_freshness(mid.id, TODAY).status == STALE
    assert summary_freshness(root.id, TODAY).status == FRESH
    assert _versions(root) == 1  # никакого авто-rebuild

    # mid пересобирается ЯВНО → протухает root; у root версий не прибавилось.
    _rebuild(mid)
    assert _versions(mid) == 2
    root_freshness = summary_freshness(root.id, TODAY)
    assert root_freshness.status == STALE
    assert root_freshness.superseded == [
        {"division_id": str(mid.id), "pinned_version": 1, "current_version": 2}
    ]
    assert _versions(root) == 1

    # root пересобирается явно → FRESH. Операции не трогают другие уровни.
    _rebuild(root)
    assert summary_freshness(root.id, TODAY).status == FRESH
    assert _versions(root) == 2
    assert _versions(mid) == 2
    assert _versions(leaf) == 2


# --- AC-6: взаимодействие с хуком 5.4b ----------------------------------------


def test_hook_child_retro_edit_stales_summary_no_parent_version(org_dt, status_types):
    """(а) Ретро-правка сотрудника РЕБЁНКА: авто-amendment у ребёнка, у
    родителя-сводки НОВОЙ версии НЕТ (roster own-level — covering не находит),
    свежесть → STALE."""
    with clock.override(TODAY):
        parent = make_division(org_dt)
        make_employee(parent)
        child = make_division(org_dt, parent=parent)
        child_emp = make_employee(child)
        pending = make_status(child_emp, "PENDING_CLARIFICATION", _day(-1), _day(2))
        submit_day(division_id=child.id, business_date=TODAY, actor=ACTOR)
        summary = assemble_summary(
            division_id=parent.id, business_date=TODAY, actor=ACTOR
        )
        base_bytes = _canon(DailySubmissionSelector.by_id(summary.pk).snapshot)

        resolve_pending_clarification(
            pending,
            resolved_type_code="STUDY",
            date_start=_day(-1),
            date_end=_day(2),
            actor=ACTOR,
            reason="уточнено",
        )

        child_head = DailySubmissionSelector.latest_for(child.id, TODAY)
        assert child_head.version == 2  # невакуумность: хук у ребёнка сработал
        assert child_head.event == DailySubmission.Event.AMENDED
        assert _versions(parent) == 1  # сводка НЕ авто-амендится (Ловушка №1)

        freshness = summary_freshness(parent.id, TODAY)
        assert freshness.status == STALE
        assert freshness.superseded == [
            {
                "division_id": str(child.id),
                "pinned_version": 1,
                "current_version": 2,
            }
        ]
        assert _canon(DailySubmissionSelector.by_id(summary.pk).snapshot) == base_bytes


def test_hook_own_retro_edit_amends_summary_sources_verbatim(org_dt, status_types):
    """(б) Ретро-правка OWN-сотрудника родителя: хук амендит сводку через
    amend_day (v2 AMENDED), sources перенесены VERBATIM (Task 1), own-часть
    переснята свежей (невакуумно: rows реально изменились)."""
    with clock.override(TODAY):
        parent = make_division(org_dt)
        own_emp = make_employee(parent)
        pending = make_status(own_emp, "PENDING_CLARIFICATION", _day(-1), _day(2))
        child = make_division(org_dt, parent=parent)
        make_employee(child)
        submit_day(division_id=child.id, business_date=TODAY, actor=ACTOR)
        summary = assemble_summary(
            division_id=parent.id, business_date=TODAY, actor=ACTOR
        )
        v1 = DailySubmissionSelector.by_id(summary.pk)
        v1_sources = _canon(v1.snapshot["sources"])
        v1_rows = _canon(v1.snapshot["rows"])
        assert v1.snapshot["sources"]  # sanity: пины непусты — перенос не вакуумен

        resolve_pending_clarification(
            pending,
            resolved_type_code="STUDY",
            date_start=_day(-1),
            date_end=_day(2),
            actor=ACTOR,
            reason="уточнено",
        )

        v2 = DailySubmissionSelector.latest_for(parent.id, TODAY)
        assert v2.version == 2
        assert v2.event == DailySubmission.Event.AMENDED
        # Пины байт-равны прежним: авто-amendment чинит own-строки, консолидация
        # обновляется ТОЛЬКО явной пересборкой (Ловушка №2 закрыта Task 1).
        assert _canon(v2.snapshot["sources"]) == v1_sources
        # Own-часть реально переснята (PENDING → STUDY), не копия v1.
        assert _canon(v2.snapshot["rows"]) != v1_rows
        # У ребёнка версий не прибавилось.
        assert _versions(child) == 1


# --- Д6: event сводки против вчерашней ----------------------------------------


def test_summary_event_confirmed_no_changes_against_yesterday(org_dt):
    parent = make_division(org_dt)
    make_employee(parent)
    child = make_division(org_dt, parent=parent)
    make_employee(child)

    yesterday = _day(-1)
    _submit(child, yesterday)
    _assemble(parent, yesterday)

    _submit(child, TODAY)
    summary = _assemble(parent, TODAY)
    # Мир неизменен: own roster/rows совпали, пины (division_id, version)
    # совпали — submission_id ребёнка другой, но Д6 его не сравнивает.
    assert summary.event == DailySubmission.Event.CONFIRMED_NO_CHANGES


# --- AC-7: closed-world реестры ------------------------------------------------


def test_summary_children_code_in_registry():
    path = Path(settings.BASE_DIR).parent.parent / "docs/registries/error-codes.yaml"
    text = path.read_text(encoding="utf-8")
    block = re.search(
        r"^  SUMMARY_CHILDREN_NOT_SUBMITTED:\n((?:    .*\n)+)", text, re.M
    )
    assert block, "SUMMARY_CHILDREN_NOT_SUBMITTED missing from error-codes.yaml"
    assert "http_status: 422" in block.group(1)


def test_summary_audit_actions_in_registry():
    path = Path(settings.BASE_DIR).parent.parent / "docs/registries/audit-events.yaml"
    text = path.read_text(encoding="utf-8")
    for action in ("DAILY_SUMMARY_ASSEMBLED", "DAILY_SUMMARY_REBUILT"):
        block = re.search(rf"^  {action}:\n((?:    .*\n)+)", text, re.M)
        assert block, f"{action} missing from audit-events.yaml"
        assert "entity_type: daily_submission" in block.group(1)
