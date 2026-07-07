"""Story 5.9 — аудит сдач: every submissions mutation leaves a trace.

Mirror of test_status_audit (4.4) for the E5 write services. Proves AC-1..6
case by case (AC-7 IS this file's case list — sections are marked per AC):
submit_day emits exactly one DAILY_SUBMISSION_SUBMITTED with the LIGHT payload
(no snapshot-JSONB — Д3), amend_day emits one DAILY_SUBMISSION_AMENDED with a
before/after pair (old = the prior head as it was BEFORE the flip), the 5.4b
retro-edit hook is covered WITHOUT touching it (amend_day is the single emitter;
the operator's real actor + triggered_by ride through, contextvar sentinels
outside HTTP), override_tomorrow_block emits TOMORROW_BLOCK_OVERRIDDEN with the
deterministic uuid5 entity_id (Д1 — the entity has no UUID of its own), rejected
mutations leave NO row (record sits after the savepoint, canon 4.4), request
infra flows from the contextvar, and both flipped AUDIT_MATRIX routes are proven
by HTTP smoke (Д5).

Fixtures are this suite's own copies of the 5.8x ones (conftest is a separate
hygiene task, deliberately not done here).
"""

import itertools
import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings
from django.core.management import call_command
from django.db import IntegrityError
from django.http import HttpResponse
from django.test import RequestFactory
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.core import clock
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.core.middleware import RequestContextMiddleware
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.rbac.models import UserRole
from apps.operations.submissions.amendment_enforcement import (
    _AUTO_AMENDMENT_REASON,
    enforce_amendment_on_retro_edit,
)
from apps.operations.submissions.models import DailySubmission, TomorrowBlockOverride
from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services import (
    amend_day,
    override_tomorrow_block,
    submit_day,
)

pytestmark = pytest.mark.django_db

TZ = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
TODAY = date(2026, 6, 4)
_iin = itertools.count(5900)

# Independent derivation of the override audit namespace (Д1): the test does NOT
# import the service constant — an accidental namespace change breaks the pin.
_OVERRIDE_NS = uuid.uuid5(uuid.NAMESPACE_URL, "vaps:tomorrow-block-override")


@pytest.fixture(autouse=True)
def frozen_clock():
    # Local midnight of TODAY → the {today, today+1} submit window is
    # deterministic and late=False; the late-test nests its own override.
    with clock.override(TODAY):
        yield


@pytest.fixture
def division():
    org = Organization.objects.create(name="Орг", code="ORG-AUD59")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dtp, name="Отдел", code="AUD59-A"
    )


@pytest.fixture
def tree():
    """seed_operations roles + a division — the HTTP-smoke surface (Д5)."""
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ-AUD59")
    dt = DivisionType.objects.get_or_create(
        code="management", defaults={"name": "Управление"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dt, name="root", code="R-AUD59"
    )


@pytest.fixture
def global_op(tree):
    """DIVISION_OPERATOR (global): holds mark_update + correct."""
    UserRole.objects.create(
        user_id="op-global", role_code_id="DIVISION_OPERATOR", scope_division_id=None
    )
    return "op-global"


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


def _roster_submission(division, business_date, roster_emp_ids):
    """A directly-built submission whose roster CONTAINS the employee — the
    5.4b covering() detection surface (bypasses submit_day → no audit noise)."""
    return DailySubmission.objects.create(
        division_id=division.id,
        business_date=business_date,
        version=1,
        is_current=True,
        event=DailySubmission.Event.CHANGED,
        submitted_by="seed",
        submitted_at=datetime(2026, 6, 1, tzinfo=ZoneInfo("UTC")),
        snapshot={
            "schema_version": 1,
            "roster": [
                {"employee_id": str(eid), "full_name": "x", "rank": ""}
                for eid in roster_emp_ids
            ],
            "rows": [],
        },
    )


def _count(action):
    return AuditLog.objects.filter(action=action).count()


def _in_request(factory_request, fn):
    """Run fn() inside the middleware so the request-context contextvar is set."""
    holder = {}

    def get_response(req):
        holder["result"] = fn()
        return HttpResponse("ok")

    RequestContextMiddleware(get_response)(factory_request)
    return holder["result"]


def _aware(day, hour, minute):
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=TZ)


# -- AC-1: submit_day → one DAILY_SUBMISSION_SUBMITTED, light payload ----------


def test_submit_emits_exactly_one_submitted_row(division):
    sub = submit_day(division_id=division.id, business_date=TODAY, actor="op-59")
    assert AuditLog.objects.count() == 1
    log = AuditLog.objects.get()
    assert log.action == "DAILY_SUBMISSION_SUBMITTED"
    assert log.entity_type == "daily_submission"
    assert log.entity_id == division.id  # UUID-ось сущности (Ловушка №1)
    assert log.actor_user_id == "op-59"
    assert log.old_value is None
    assert log.reason == ""
    assert log.created_at == Clock.now()
    # Exact light payload (Д3): int-PK rides here, snapshot-JSONB does NOT.
    assert log.new_value == {
        "submission_id": sub.pk,
        "division_id": str(division.id),
        "business_date": "2026-06-04",
        "version": 1,
        "event": "CHANGED",
        "late": False,
        "is_current": True,
        "submitted_at": sub.submitted_at.isoformat(),
    }
    assert "snapshot" not in log.new_value


def test_submit_late_true_rides_in_new_value(division):
    with clock.override(_aware(TODAY, 17, 1)):  # strictly after the control hour
        submit_day(division_id=division.id, business_date=TODAY, actor="op")
    log = AuditLog.objects.get(action="DAILY_SUBMISSION_SUBMITTED")
    assert log.new_value["late"] is True


def test_duplicate_submit_leaves_only_first_row(division):
    submit_day(division_id=division.id, business_date=TODAY, actor="op")
    with pytest.raises(DomainError) as ei:
        submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert ei.value.http_status == 409
    assert _count("DAILY_SUBMISSION_SUBMITTED") == 1  # дубль строки не оставил
    assert AuditLog.objects.count() == 1  # ...и никакого фантома другого action


def test_window_rejected_submit_leaves_no_row(division):
    with pytest.raises(DomainError) as ei:
        submit_day(
            division_id=division.id,
            business_date=TODAY + timedelta(days=5),
            actor="op",
        )
    assert ei.value.http_status == 422
    assert AuditLog.objects.count() == 0


# -- AC-2: amend_day → before/after pair ---------------------------------------


def test_amend_emits_before_after_pair(division):
    sub = submit_day(division_id=division.id, business_date=TODAY, actor="op-1")
    amended = amend_day(
        division_id=division.id,
        business_date=TODAY,
        actor="op-2",
        reason="уточнение расхода",
        sanction="приказ-77",
    )
    log = AuditLog.objects.get(action="DAILY_SUBMISSION_AMENDED")
    assert log.entity_type == "daily_submission"
    assert log.entity_id == division.id
    assert log.actor_user_id == "op-2"
    assert log.reason == "уточнение расхода"  # Д2: reason строки = reason операции
    # before = прежняя head-версия, какой она была ДО flip (is_current=True).
    assert log.old_value == {
        "submission_id": sub.pk,
        "division_id": str(division.id),
        "business_date": "2026-06-04",
        "version": 1,
        "event": "CHANGED",
        "late": False,
        "is_current": True,
        "submitted_at": sub.submitted_at.isoformat(),
    }
    # after = те же поля + amendment-атрибуты (ручной путь → triggered_by=None).
    assert set(log.new_value) == set(log.old_value) | {
        "reason",
        "sanction",
        "triggered_by_status_id",
    }
    assert log.new_value["submission_id"] == amended.pk
    assert log.new_value["version"] == 2
    assert log.new_value["event"] == "AMENDED"
    assert log.new_value["is_current"] is True
    assert log.new_value["reason"] == "уточнение расхода"
    assert log.new_value["sanction"] == "приказ-77"
    assert log.new_value["triggered_by_status_id"] is None
    assert "snapshot" not in log.new_value


def test_second_amend_old_value_carries_amendment_attrs(division):
    # v2→v3: прежняя head — сама amendment → её reason/sanction/triggered_by
    # едут в before-снимок (code-review реш. Bratan — симметрия пары); v1→v2
    # остаётся лёгкой 8-ключевой (девственная v1 их не несёт — пин exact-dict
    # в test_amend_emits_before_after_pair).
    submit_day(division_id=division.id, business_date=TODAY, actor="op-1")
    v2 = amend_day(
        division_id=division.id,
        business_date=TODAY,
        actor="op-2",
        reason="первая правка",
        sanction="приказ-1",
    )
    v3 = amend_day(
        division_id=division.id,
        business_date=TODAY,
        actor="op-3",
        reason="вторая правка",
        sanction="приказ-2",
    )
    log = AuditLog.objects.get(
        action="DAILY_SUBMISSION_AMENDED", new_value__submission_id=v3.pk
    )
    assert log.old_value["submission_id"] == v2.pk
    assert log.old_value["version"] == 2
    assert log.old_value["event"] == "AMENDED"
    assert log.old_value["reason"] == "первая правка"
    assert log.old_value["sanction"] == "приказ-1"
    assert log.old_value["triggered_by_status_id"] is None
    first = AuditLog.objects.get(
        action="DAILY_SUBMISSION_AMENDED", new_value__submission_id=v2.pk
    )
    assert "reason" not in first.old_value  # v1 (CHANGED) — без amendment-полей


def test_amend_version_race_leaves_no_row(division, monkeypatch):
    # Приём test_amendment_service: stale latest_for → version-коллизия →
    # IntegrityError из savepoint пробрасывается ДО record — фантом невозможен.
    v1 = _roster_submission(division, TODAY, [])
    DailySubmission.objects.create(  # v2, committed by a "concurrent" TxA
        division_id=division.id,
        business_date=TODAY,
        version=2,
        is_current=False,
        event=DailySubmission.Event.AMENDED,
        reason="конкурент",
        sanction="приказ-9",
        submitted_by="other",
        submitted_at=datetime(2026, 6, 1, tzinfo=ZoneInfo("UTC")),
        snapshot={"schema_version": 1, "roster": [], "rows": []},
    )
    monkeypatch.setattr(
        DailySubmissionSelector,
        "latest_for",
        lambda division_id, business_date, lock=False: v1,
    )
    with pytest.raises(IntegrityError):
        amend_day(
            division_id=division.id,
            business_date=TODAY,
            actor="op",
            reason="гонка",
            sanction="приказ",
        )
    assert _count("DAILY_SUBMISSION_AMENDED") == 0


# -- AC-3: системный путь 5.4b — без правки хука --------------------------------


def test_retro_edit_hook_audits_each_covered_day(division):
    emp = make_employee(division)
    _roster_submission(division, TODAY, [emp.id])
    _roster_submission(division, TODAY + timedelta(days=1), [emp.id])
    enforce_amendment_on_retro_edit(
        emp.id,
        [(TODAY, TODAY + timedelta(days=2))],  # half-open: накрывает оба дня
        actor="boss-59",
        reason="ретро-приказ",
        triggered_by_status_id=777,
    )
    logs = list(AuditLog.objects.filter(action="DAILY_SUBMISSION_AMENDED"))
    assert len(logs) == 2  # по одной строке на накрытый день
    assert sorted(log.new_value["business_date"] for log in logs) == [
        "2026-06-04",
        "2026-06-05",
    ]
    for log in logs:
        assert log.actor_user_id == "boss-59"  # РЕАЛЬНЫЙ оператор, не SYSTEM
        assert log.new_value["triggered_by_status_id"] == 777
        assert log.new_value["reason"] == _AUTO_AMENDMENT_REASON
        assert log.new_value["sanction"] == "ретро-приказ"
        assert log.reason == _AUTO_AMENDMENT_REASON
        # Вне HTTP contextvar пуст → сентинелы record() (канон 4.3).
        assert log.request_id == ""
        assert log.ip_address == "0.0.0.0"
        assert log.user_agent == ""


# -- AC-5: request-infra из contextvar ------------------------------------------


def test_request_context_propagates_to_submission_audit(division):
    request = RequestFactory().post(
        "/x",
        HTTP_X_REQUEST_ID="trace-59",
        REMOTE_ADDR="10.0.0.9",
        HTTP_USER_AGENT="ua/59",
    )
    _in_request(
        request,
        lambda: submit_day(division_id=division.id, business_date=TODAY, actor="op"),
    )
    log = AuditLog.objects.get(action="DAILY_SUBMISSION_SUBMITTED")
    assert log.request_id == "trace-59"
    assert log.ip_address == "10.0.0.9"
    assert log.user_agent == "ua/59"


# -- AC-4: override_tomorrow_block → TOMORROW_BLOCK_OVERRIDDEN -------------------


def test_override_emits_row_with_deterministic_entity_id():
    rec = override_tomorrow_block(TODAY, actor="  boss  ", reason="  форс-мажор  ")
    assert AuditLog.objects.count() == 1
    log = AuditLog.objects.get()
    assert log.action == "TOMORROW_BLOCK_OVERRIDDEN"
    assert log.entity_type == "tomorrow_block_override"
    # Д1: детерминированный uuid5 по дате — независимый расчёт в тесте.
    assert log.entity_id == uuid.uuid5(_OVERRIDE_NS, str(TODAY))
    assert log.actor_user_id == "boss"
    assert log.old_value is None
    assert log.new_value == {
        "override_id": rec.pk,
        "business_date": "2026-06-04",
        "overridden_by": "boss",
        "reason": "форс-мажор",
    }
    assert log.reason == "форс-мажор"
    # Вне HTTP contextvar пуст → сентинелы record() (канон 4.3) — паритет
    # покрытия с двумя другими эмиттерами (code-review п3).
    assert log.request_id == ""
    assert log.ip_address == "0.0.0.0"
    assert log.user_agent == ""


def test_override_entity_id_differs_across_dates():
    override_tomorrow_block(TODAY, actor="boss", reason="день 1")
    override_tomorrow_block(TODAY + timedelta(days=1), actor="boss", reason="день 2")
    ids = {
        log.entity_id
        for log in AuditLog.objects.filter(action="TOMORROW_BLOCK_OVERRIDDEN")
    }
    assert len(ids) == 2  # разные даты → разные entity_id (группировка по дате)


def test_override_duplicate_leaves_single_row():
    override_tomorrow_block(TODAY, actor="boss", reason="первый")
    with pytest.raises(ValueError):
        override_tomorrow_block(TODAY, actor="boss2", reason="второй")
    assert _count("TOMORROW_BLOCK_OVERRIDDEN") == 1  # дубль строки не оставил


@pytest.mark.parametrize(
    "actor,reason", [("boss", "   "), ("   ", "форс-мажор"), ("boss", ""), ("", "x")]
)
def test_override_blank_input_leaves_no_row(actor, reason):
    with pytest.raises(ValueError):
        override_tomorrow_block(TODAY, actor=actor, reason=reason)
    assert AuditLog.objects.count() == 0


@pytest.mark.parametrize(
    "bad_date",
    [
        None,
        "2026-06-04",
        datetime(2026, 6, 4, tzinfo=ZoneInfo("UTC")),  # datetime IS-A date
    ],
)
def test_override_non_date_business_date_leaves_no_row(bad_date):
    # Тип-гвард (code-review п2): не-plain-date молча дал бы ДРУГОЙ uuid5
    # entity_id и не-ISO payload — ось даты обязана быть канонической.
    with pytest.raises(ValueError):
        override_tomorrow_block(bad_date, actor="boss", reason="форс-мажор")
    assert AuditLog.objects.count() == 0
    assert TomorrowBlockOverride.objects.count() == 0


# -- AC-6 (Д5): HTTP-smoke — флипнутые _Audited-роуты доказаны сквозь роут -------


def test_http_smoke_submit_emits_audited_row(tree, global_op):
    client = APIClient()
    client.credentials(HTTP_X_USER_ID=global_op, HTTP_X_REQUEST_ID="smoke-59-a")
    resp = client.post(
        reverse("ops-daily-submission-list"),
        {"division_id": str(tree.id), "business_date": str(TODAY)},
        format="json",
    )
    assert resp.status_code == 201
    log = AuditLog.objects.get(action="DAILY_SUBMISSION_SUBMITTED")
    assert log.request_id == "smoke-59-a"  # заголовок доехал сквозь HTTP-слой
    assert log.actor_user_id == global_op


def test_http_smoke_amend_emits_audited_row(tree, global_op):
    sub = submit_day(division_id=tree.id, business_date=TODAY, actor="op-seed")
    client = APIClient()
    client.credentials(HTTP_X_USER_ID=global_op, HTTP_X_REQUEST_ID="smoke-59-b")
    resp = client.post(
        reverse("ops-daily-submission-amend", kwargs={"pk": str(sub.pk)}),
        {"reason": "уточнение состава", "sanction": "замечание"},
        format="json",
    )
    assert resp.status_code == 201
    log = AuditLog.objects.get(action="DAILY_SUBMISSION_AMENDED")
    assert log.request_id == "smoke-59-b"
    assert log.actor_user_id == global_op
    assert log.new_value["version"] == 2
