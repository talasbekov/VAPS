"""Срез H: аналитика службы и мероприятий (§22).

Ключевые свойства — контрактные, не украшения:
- все числа считает СЕРВЕР; за каждым показателем стоит выборка, и число —
  её длина (§22.12), поэтому KPI и drill-down не могут разойтись;
- снимок детерминирован входом: тот же state → тот же snapshotId, изменение
  данных → SNAPSHOT_OUTDATED у выборки, а не молчаливая подмена;
- отсутствие ПОЛИТИКИ — отдельное состояние с причиной (UNKNOWN/UNAVAILABLE),
  а не значения по умолчанию и не ноль;
- персональная детализация вырезается на сервере: без права ФИО не приходит
  в ответе вовсе;
- воронка §22.14 строится ТОЛЬКО по журналу переходов, который пишут сами
  операции стадий ОМ.
"""
import datetime as dt
import json
from copy import deepcopy

import pytest
from django.core.management import call_command
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_duty import (
    OpsDutyShift,
)
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventTransition,
    OpsSecurityEventVisitObject,
    OpsPlacementDocumentVersion,
)
from organization_management.apps.operations.models_settings import (
    OpsPolicySectionVersion,
    OpsPolicySetting,
)
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.ops import security_events as event_service
from .test_ops_security_events_api import manager, approver, make_employee  # noqa: F401
from .test_ops_force_campaigns import jwt_manager, _auto_request  # noqa: F401
from .test_ops_approval_stage import event_on_approval, add_approver

pytestmark = pytest.mark.django_db

SNAPSHOT = "/api/ops/service-analytics/"
PRESETS = "/api/ops/service-analytics-presets/"
DRILLDOWN = "/api/ops/service-analytics-drilldown/"
ATTENTION = "/api/ops/service-analytics-attention/"
LOAD = "/api/ops/load-analytics/"
OPERATIONS = "/api/ops/operations-analytics/"


@pytest.fixture
def registries(db):
    """Реестры и настройки — тем же сидом, что и стенд: тест проверяет ровно
    ту конфигурацию, которую получит живой прогон."""
    call_command("seed_operations", verbosity=0)


@pytest.fixture
def viewer_api(registries):
    api, _ = client_for(
        "analytics-viewer", "ANALYTICS_VIEWER", perms=("analytics.view",),
    )
    return api


@pytest.fixture
def analyst_api(registries):
    api, _ = client_for(
        "analytics-analyst", "ANALYTICS_ANALYST",
        perms=("analytics.view", "analytics.drilldown",
               "analytics.personal_detail", "analytics.operations"),
    )
    return api


def _shift(employee_name, days_from_today, state, *, duty_type="DAY_OBJECT",
           employee_id=None, actual_start=None, actual_end=None,
           object_label="Резиденция"):
    business_date = Clock.today_local() + dt.timedelta(days=days_from_today)
    return OpsDutyShift.objects.create(
        business_date=business_date,
        duty_type_code=duty_type,
        target={"targetType": "PROTECTED_OBJECT", "objectId": None,
                "safeLabel": object_label},
        employee_name=employee_name,
        employee_id=employee_id,
        state_code=state,
        acknowledged_at=None,
        actual_start=actual_start,
        actual_end=actual_end,
        passport_binding=None,
        note=None,
        cancellation=None,
        override_reason=None,
    )


@pytest.fixture
def shifts(registries):
    """Смены под все показатели сразу: активная, плановые, завершённая с
    отдыхом, просроченная незакрытая, пересечение дня (жёсткий конфликт) и
    завершённая без фактических штампов (неподтверждённое участие)."""
    now = Clock.now()
    # Активная сегодня, с фактическим началом.
    _shift("Абенов С.", 0, "ACTIVE", actual_start=now)
    # Плановая завтра и ознакомленная послезавтра.
    _shift("Абенов С.", 2, "PLANNED")
    _shift("Беков Т.", 1, "ACKNOWLEDGED")
    # Завершённая вчера с обоими штампами: даёт отдых на сегодня
    # (rest_after_minutes=1440 → 1 сутки).
    _shift(
        "Габбасов Р.", -1, "COMPLETED",
        actual_start=now - dt.timedelta(days=1),
        actual_end=now - dt.timedelta(hours=12),
    )
    # Просроченная незакрытая (3 дня назад, дольше допуска 2 дн.).
    _shift("Дуйсенов К.", -3, "ACTIVE", actual_start=None)
    # Пересечение дня у одного человека — жёсткий конфликт обеих смен.
    _shift("Ерланов Д.", 1, "PLANNED")
    _shift("Ерланов Д.", 1, "PLANNED")
    # Завершённая без штампов — неподтверждённое участие (и тоже вчера).
    _shift("Жумабек С.", -1, "COMPLETED")
    # Отменённая — не входит никуда.
    _shift("Зейнетов А.", 0, "CANCELLED")


# ── Пресеты и снимок (§22.4-22.7) ───────────────────────────────────────────


def test_presets_carry_limit_from_settings(viewer_api):
    data = viewer_api.get(PRESETS).json()
    assert [p["presetCode"] for p in data["results"]] == [
        "TODAY", "PREV_BUSINESS_DAY", "CURRENT_WEEK", "CURRENT_MONTH",
    ]
    assert data["maxCustomPeriodDays"] == 92
    assert data["limitPolicyVersion"] == "analytics-limits-v1"
    assert data["defaultPresetCode"] == "TODAY"


def test_snapshot_metrics_counted_from_selections(viewer_api, shifts):
    data = viewer_api.get(SNAPSHOT, {"preset": "CURRENT_WEEK"}).json()
    metrics = {m["metricCode"]: m for m in data["data"]["metrics"]}
    assert metrics["DUTY_ACTIVE"]["value"] == 1
    # PLANNED + ACKNOWLEDGED будущие + две конфликтные плановые.
    assert metrics["DUTY_PLANNED"]["value"] == 4
    # Отдых после ОБЕИХ вчерашних завершённых смен: отдых считается по всему
    # набору, и штампы факта на него не влияют.
    assert metrics["REST_AFTER_DUTY"]["value"] == 2
    assert metrics["CONFLICT_HARD"]["value"] == 2
    assert metrics["CONFLICT_HARD"]["state"] == "WARNING"
    # Вчерашняя запись без штампов ВНЕ будущего окна недели.
    assert metrics["UNCONFIRMED_PARTICIPATION"]["value"] == 0
    # Неделя [сегодня; +6] не содержит прошедших — просрочка нулевая.
    assert metrics["UNFINISHED_PAST_DUTIES"]["value"] == 0
    assert metrics["UNFINISHED_PAST_DUTIES"]["state"] == "NORMAL"
    assert data["period"]["presetCode"] == "CURRENT_WEEK"
    assert data["freshnessState"] == "CURRENT"
    # Право drill-down у смотрящего отсутствует — сервер говорит это прямо.
    assert data["drilldownAllowed"] is False
    assert data["drilldownDeniedReason"] is not None


def test_snapshot_unfinished_counts_only_strict_past(viewer_api, shifts):
    """Просрочка — строго ДО бизнес-даты: сегодняшняя незакрытая смена не
    обвиняется раньше срока."""
    from_date = (Clock.today_local() - dt.timedelta(days=6)).isoformat()
    to_date = Clock.today_local().isoformat()
    data = viewer_api.get(
        SNAPSHOT, {"from": from_date, "to": to_date}
    ).json()
    metrics = {m["metricCode"]: m for m in data["data"]["metrics"]}
    assert metrics["UNFINISHED_PAST_DUTIES"]["value"] == 1
    # Завершённая без штампов и просроченная активная без факта — обе
    # «неподтверждённое участие» прошедшей недели.
    assert metrics["UNCONFIRMED_PARTICIPATION"]["value"] == 2


def test_custom_period_validation(viewer_api, registries):
    bad = viewer_api.get(SNAPSHOT, {"from": "2026-99-01", "to": "2026-01-02"})
    assert bad.status_code == 422
    assert bad.json()["error_code"] == "INVALID_PERIOD"
    too_long = viewer_api.get(
        SNAPSHOT, {"from": "2025-01-01", "to": "2026-01-01"}
    )
    assert too_long.json()["error_code"] == "PERIOD_TOO_LONG"
    unknown = viewer_api.get(SNAPSHOT, {"preset": "LAST_CENTURY"})
    assert unknown.json()["error_code"] == "UNKNOWN_PERIOD_PRESET"
    # Предел произвольного периода не задан политикой — период по датам не
    # принимается вовсе, именованные пресеты продолжают работать.
    OpsPolicySectionVersion.objects.filter(
        section_code="ANALYTICS_LIMITS"
    ).delete()
    refused = viewer_api.get(
        SNAPSHOT, {"from": "2026-01-01", "to": "2026-01-02"}
    )
    assert refused.json()["error_code"] == "PERIOD_LIMIT_UNAVAILABLE"
    assert viewer_api.get(SNAPSHOT, {"preset": "TODAY"}).status_code == 200


def test_snapshot_requires_permission(registries):
    api, _ = client_for("analytics-none", "ANALYTICS_NONE",
                        perms=("status.view",))
    assert api.get(SNAPSHOT, {"preset": "TODAY"}).status_code == 403


# ── Drill-down (§22.12) ─────────────────────────────────────────────────────


def _drill(api, snapshot_id, metric="CONFLICT_HARD", **extra):
    params = {
        "snapshot_id": snapshot_id,
        "metric_code": metric,
        "preset": "CURRENT_WEEK",
    }
    params.update(extra)
    return api.get(DRILLDOWN, params)


def test_drilldown_requires_own_permission(viewer_api, shifts):
    snapshot_id = viewer_api.get(
        SNAPSHOT, {"preset": "CURRENT_WEEK"}
    ).json()["snapshotId"]
    denied = _drill(viewer_api, snapshot_id)
    assert denied.status_code == 403


def test_drilldown_same_snapshot_and_personal_detail(analyst_api, shifts):
    snapshot_id = analyst_api.get(
        SNAPSHOT, {"preset": "CURRENT_WEEK"}
    ).json()["snapshotId"]
    rows = _drill(analyst_api, snapshot_id).json()
    assert rows["snapshotId"] == snapshot_id
    assert rows["data"]["totalCount"] == 2
    assert {r["employeeLabel"] for r in rows["data"]["rows"]} == {
        "Ерланов Д.",
    }
    # Изменились данные — снимок другой, выборка по старому отвергается.
    _shift("Новиков Н.", 3, "PLANNED")
    outdated = _drill(analyst_api, snapshot_id)
    assert outdated.status_code == 422
    assert outdated.json()["error_code"] == "SNAPSHOT_OUTDATED"


def test_drilldown_suppresses_personal_detail_without_right(shifts):
    api, _ = client_for(
        "analytics-drill-only", "ANALYTICS_DRILL",
        perms=("analytics.view", "analytics.drilldown"),
    )
    snapshot_id = api.get(
        SNAPSHOT, {"preset": "CURRENT_WEEK"}
    ).json()["snapshotId"]
    data = _drill(api, snapshot_id).json()["data"]
    assert data["personalDetailSuppressed"] is True
    payload = json.dumps(data, ensure_ascii=False)
    # ФИО не приходит в ответе ВООБЩЕ, а не скрывается вёрсткой.
    assert "Ерланов" not in payload
    assert all(r["employeeLabel"] is None for r in data["rows"])


def test_drilldown_unknown_metric(analyst_api, shifts):
    snapshot_id = analyst_api.get(
        SNAPSHOT, {"preset": "CURRENT_WEEK"}
    ).json()["snapshotId"]
    unknown = _drill(analyst_api, snapshot_id, metric="NO_SUCH")
    assert unknown.json()["error_code"] == "UNKNOWN_METRIC"


# ── «Требует внимания» (§22.11) ─────────────────────────────────────────────


def test_attention_detects_conflicts_and_renders_policy(
    viewer_api, shifts,
):
    data = viewer_api.get(ATTENTION, {"preset": "CURRENT_WEEK"}).json()
    assert data["data"]["detectionState"] == "COMPLETE"
    assert data["policyVersion"] == "attention-policy-v1"
    items = {item["categoryCode"]: item for item in data["data"]["items"]}
    # Доля конфликтных: 2 из 6 смен недели (знаменатель — ВСЕ смены периода,
    # включая отменённую, как в мок-контракте) = 33% ≥ warningFrom 18.
    share = items["CONFLICT_SHARE"]
    assert share["severity"] == "WARNING"
    assert "33%" in share["safeDescription"]
    assert share["count"] == 2
    assert share["safeTitle"] == "Обнаружено превышение серверного порога"
    # Ближайшие заступления без отметки: 3 плановых в горизонте 3 дн.
    assert items["ACKNOWLEDGEMENT_MISSING"]["count"] == 3
    # Порядок задаёт сервер: severity, затем код.
    severities = [item["severity"] for item in data["data"]["items"]]
    assert severities == sorted(
        severities, key=lambda s: {"CRITICAL": 0, "WARNING": 1, "INFO": 2}[s]
    )


def test_attention_without_policy_is_unavailable_not_empty(
    viewer_api, shifts,
):
    OpsPolicySectionVersion.objects.filter(
        section_code="ATTENTION_POLICY"
    ).delete()
    data = viewer_api.get(ATTENTION, {"preset": "CURRENT_WEEK"}).json()
    assert data["data"]["detectionState"] == "UNAVAILABLE"
    assert data["data"]["items"] == []
    assert data["completenessState"] == "INCOMPLETE"
    assert "не загружена" in data["data"]["detectionUnavailableReason"]


# ── Нагрузка (§22.9) ────────────────────────────────────────────────────────


@pytest.fixture
def linked_world(registries):
    division = Division.objects.create(name="Первое управление")
    employees = []
    for index, name in enumerate(["Иванов", "Петров"], start=1):
        employee = Employee.objects.create(
            first_name="Демо", last_name=name,
            personnel_number=f"L{index:05d}", iin=f"77{index:010d}",
            hire_date=dt.date(2020, 1, 1),
        )
        StaffUnit.objects.create(
            division=division, employee=employee, index=index
        )
        employees.append(employee)
    return division, employees


def test_load_sums_plan_and_fact_separately(linked_world):
    api, _ = client_for(
        "analytics-load", "ANALYTICS_LOAD",
        perms=("analytics.view", "analytics.personal_detail"),
    )
    division, (first, second) = linked_world
    now = Clock.now()
    # Иванов: 4 суточные смены окна = 5760 плановых минут → OVERLOADED;
    # факт только у одной завершённой (12 часов = 720 мин).
    for days in (-1, -2, -3, -4):
        _shift(
            "Иванов Д.", days,
            "COMPLETED" if days == -1 else "PLANNED",
            employee_id=str(first.pk),
            actual_start=now - dt.timedelta(days=1) if days == -1 else None,
            actual_end=(
                now - dt.timedelta(hours=12) if days == -1 else None
            ),
        )
    # Петров: две смены = 2880 → WARNING.
    _shift("Петров К.", -1, "PLANNED", employee_id=str(second.pk))
    _shift("Петров К.", -2, "PLANNED", employee_id=str(second.pk))
    # Смена без связи — видна счётчиком, а не теряется.
    _shift("Безсвязи Н.", -1, "PLANNED")

    view = api.get(LOAD).json()["view"]
    by_name = {row["safeLabel"]: row for row in view["employees"]}
    overloaded = by_name["Иванов Д."]
    assert overloaded["plannedMinutes"] == 5760
    assert overloaded["actualMinutes"] == 720
    assert overloaded["loadState"] == "OVERLOADED"
    assert by_name["Петров К."]["loadState"] == "WARNING"
    assert view["unlinkedShiftsCount"] == 1
    unit = view["units"][0]
    assert unit["safeLabel"] == "Первое управление"
    assert unit["plannedMinutes"] == 5760 + 2880
    assert view["policy"]["policyVersion"] == "load-policy-v1"


def test_load_without_policy_is_unknown_not_zero(linked_world):
    api, _ = client_for(
        "analytics-load-2", "ANALYTICS_LOAD2",
        perms=("analytics.view", "analytics.personal_detail"),
    )
    _, (first, _) = linked_world
    _shift("Иванов Д.", -1, "PLANNED", employee_id=str(first.pk))
    OpsPolicySectionVersion.objects.filter(
        section_code="LOAD_POLICY"
    ).delete()
    view = api.get(LOAD).json()["view"]
    row = view["employees"][0]
    assert row["loadState"] == "UNKNOWN"
    assert row["plannedMinutes"] is None
    assert row["safeReasonCodes"] == ["POLICY_UNDEFINED"]


# ── Аналитика ОМ (§22.13-22.15) и воронка (§22.14) ─────────────────────────


@pytest.fixture
def ops_world(registries):
    """Живое мероприятие через сервис: журнал переходов пишут сами операции
    стадий, а не фикстура."""
    from organization_management.apps.operations.models_object import (
        OpsSecurityObject,
    )

    obj = OpsSecurityObject.objects.create(
        name="Резиденция", code="OBJ-A", object_type="Госучреждение",
        region="г. Астана", address="пр. Мәңгілік Ел, 8",
        object_state=OpsSecurityObject.ObjectState.ACTIVE,
        passport_state=OpsSecurityObject.PassportState.GREEN,
        ownership=OpsSecurityObject.Ownership.GUARDED,
    )
    event = event_service.create_event(
        title="Международный форум", object_id=str(obj.pk),
        business_date=Clock.today_local().isoformat(), kind="INTERNAL",
        actor="test",
    )
    event.recon_sector_posts = [
        {"id": "post-1", "sector": "A", "post": "Пост 1", "need": 2,
         "sourceSectorId": "sector-1"},
        {"id": "post-2", "sector": "A", "post": "Пост 2", "need": 1,
         "sourceSectorId": "sector-1"},
        {"id": "post-3", "sector": "B", "post": "Пост 3", "need": 1,
         "sourceSectorId": None},
    ]
    event.placement_assignments = [
        {"postId": "post-1", "acknowledgedAt": "2026-08-01T10:00:00+05:00"},
        {"postId": "post-1", "acknowledgedAt": None},
        {"postId": "post-3", "acknowledgedAt": None},
    ]
    event.demand_rows = [{"need": 3, "group": "G1"}]
    event.demand_approved = True
    event.journal_entries = [{"type": "INCIDENT"}, {"type": "NOTE"}]
    event.save()
    return event


def test_operations_requires_own_permission(viewer_api, ops_world):
    # Право аналитики службы НЕ открывает аналитику ОМ (§22.26).
    assert viewer_api.get(OPERATIONS).status_code == 403


def test_operations_levels_and_event_card(analyst_api, ops_world):
    top = analyst_api.get(OPERATIONS).json()["data"]
    assert top["level"] == "ALL"
    assert [row["safeLabel"] for row in top["rows"]] == ["Резиденция"]
    cells = {c["code"]: c["value"] for c in top["rows"][0]["cells"]}
    assert cells["EVENTS"] == 1
    assert cells["DEMAND_NEED"] == 3
    assert cells["ASSIGNED"] == 3
    assert cells["ACKNOWLEDGED"] == 1
    assert cells["INCIDENTS"] == 1
    buckets = {
        b["stateCode"]: b["count"] for b in top["lifecycleDistribution"]
    }
    # ОМ С ОБЪЕКТОМ заводится сразу на рекогносцировке (Plane «Реестр ОМ-5»):
    # стадии «Бюллетень» у него не бывает вовсе, и распределение это видит.
    assert buckets["RECON"] == 1

    event_level = analyst_api.get(
        OPERATIONS, {"level": "EVENT", "event_id": str(ops_world.pk)}
    ).json()["data"]
    # Сектор A с привязкой к паспорту и сектор B без неё — РАЗНЫЕ направления.
    labels = [row["safeLabel"] for row in event_level["rows"]]
    assert labels == [
        "Сектор A",
        "Сектор B (расчёт ОМ, без связи с паспортом)",
    ]
    facts = {f["code"]: f for f in event_level["eventCard"]["facts"]}
    assert facts["ACTUAL"]["displayValue"] == "нет данных"
    assert facts["ACTUAL"]["unavailableReason"] is not None
    assert facts["DEMAND"]["displayValue"] == "3"

    missing = analyst_api.get(
        OPERATIONS, {"level": "EVENT", "event_id": "999999"}
    )
    assert missing.json()["error_code"] == "UNKNOWN_LEVEL_TARGET"


@pytest.fixture
def signed_stale_auto_event(manager, approver):  # noqa: F811
    """A real approved v1 document; only its old auto-request JSON is stale."""
    base, employee_id, _ = event_on_approval(manager)
    route = add_approver(manager, base, name="Первый согласующий")
    route = add_approver(manager, base, name="Второй согласующий")
    sent = manager.post(f"{base}approval/send/")
    assert sent.status_code == 200, sent.json()
    for row in route:
        response = approver.post(f"{base}approval/route/{row['id']}/decide/", {
            "decision": "APPROVED", "comment": "Согласовано",
        }, format="json")
        assert response.status_code == 200, response.json()
    event = OpsSecurityEvent.objects.get(pk=base.rstrip("/").split("/")[-1])
    visit = event.visit_objects.get()
    assert event.stage == visit.stage == "ACKNOWLEDGEMENT"
    assert visit.approval_status == "APPROVED"
    assert visit.document_version == 1
    assert len(visit.approval_route) == 2
    assert all(row["status"] == "APPROVED" for row in visit.approval_route)
    assert all(row["signature"]["versionNumber"] == 1 for row in visit.approval_route)
    assert len({row["signature"]["versionHash"] for row in visit.approval_route}) == 1
    roster = [{"employeeId": employee_id, "name": "Назначенный сотрудник"}]
    for index in range(9):
        person = make_employee(last_name="Резерв", first_name=str(index))
        roster.append({"employeeId": str(person.pk), "name": str(person)})
    # Simulate the already-stored historical drift, without replaying handover
    # or changing the approved placement/document snapshot.
    OpsSecurityEvent.objects.filter(pk=event.pk).update(
        force_requests=[_auto_request(10)], force_roster=roster,
        force_handover={"at": "2026-08-10T08:00:00Z", "by": "prior-writer", "campaignId": "historical"},
    )
    event.refresh_from_db()
    return event


def _stored_read_facts():
    from organization_management.apps.operations.models_audit import OpsAuditLog
    from organization_management.apps.operations.models_forces import (
        OpsForceRequest, OpsDepartmentRequest, OpsUnitRequest,
        OpsForceRequestMember, OpsForceCampaignAssignment, OpsForceCampaignHandover,
    )
    models = [OpsSecurityEvent, OpsSecurityEventVisitObject, OpsPlacementDocumentVersion,
              OpsSecurityEventTransition, OpsAuditLog, OpsForceRequest, OpsDepartmentRequest,
              OpsUnitRequest, OpsForceRequestMember, OpsForceCampaignAssignment, OpsForceCampaignHandover]
    return {model._meta.label: list(model.objects.order_by("pk").values()) for model in models}


def _assert_no_write_sql(captured):
    assert not [row["sql"] for row in captured if row["sql"].lstrip().upper().startswith(("INSERT ", "UPDATE ", "DELETE "))]


def test_signed_stale_auto_request_detail_and_registry_project_current_roster_without_writes(signed_stale_auto_event, jwt_manager):
    from organization_management.apps.ops.api.serializers import serialize_security_event
    event = signed_stale_auto_event
    raw = deepcopy(event.force_requests)
    identity = event.force_requests
    stored = _stored_read_facts()
    with CaptureQueriesContext(connection) as queries:
        direct = serialize_security_event(event)
        responses = [jwt_manager.get(f"/api/ops/security-events/{event.pk}/"),
                     jwt_manager.get("/api/ops/security-events/", {"page_size": 50}),
                     jwt_manager.get(f"/api/ops/security-events/{event.pk}/")]
    _assert_no_write_sql(queries)
    assert event.force_requests is identity
    assert event.force_requests == raw
    assert _stored_read_facts() == stored, "GET cannot backfill JSON, append ledger/audit, or alter signed versions"
    expected = [{**_auto_request(10), "allocatedCount": 10, "status": "ALLOCATED"}]
    assert direct["forceRequests"] == expected
    for response in responses:
        assert response.status_code == 200, response.json()
        payload = response.json()
        body = next(row for row in payload["results"] if row["id"] == str(event.pk)) if "results" in payload else payload
        assert body["forceRequests"] == expected
        assert len(body["forceRoster"]) == 10
        assert body["stage"] == "ACKNOWLEDGEMENT"
        assert body["approvalStale"] is False
        assert body["visitObjects"][0]["documentVersion"] == 1
    assert event.force_requests == raw


def test_operations_projects_the_same_stale_signed_auto_request_without_mutation_or_writes(analyst_api, signed_stale_auto_event):
    from organization_management.apps.ops import analytics
    event = signed_stale_auto_event
    api = APIClient()
    user = get_user_model().objects.get(username="analytics-analyst")
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
    raw = deepcopy(event.force_requests)
    identity = event.force_requests
    stored = _stored_read_facts()
    with CaptureQueriesContext(connection) as pure_queries:
        projected = analytics._project_event(event)
    assert len(pure_queries) == 0
    assert event.force_requests is identity
    assert event.force_requests == raw
    with CaptureQueriesContext(connection) as queries:
        responses = [api.get(OPERATIONS, {"level": "EVENT", "event_id": str(event.pk)}) for _ in range(2)]
    _assert_no_write_sql(queries)
    assert _stored_read_facts() == stored
    assert projected.requested_total == projected.allocated_total == 10
    for response in responses:
        assert response.status_code == 200, response.json()
        facts = {fact["code"]: fact for fact in response.json()["data"]["eventCard"]["facts"]}
        assert facts["REQUESTED"]["displayValue"] == "10"
        assert facts["ALLOCATED"]["displayValue"] == "10"
    assert event.force_requests == raw


@pytest.mark.parametrize("requests", [
    [{**_auto_request(20), "group": "Ручная группа", "allocatedCount": 3}],
    [{**_auto_request(20), "group": event_service.AUTO_FORCE_REQUEST_GROUP + " ", "allocatedCount": 3}],
    [_auto_request(20), {**_auto_request(6), "id": "second", "allocatedCount": 4}],
    [_auto_request(20), {**_auto_request(6), "id": "manual", "group": "Ручная группа", "allocatedCount": 4}],
])
def test_operations_keeps_manual_multiple_and_nonexact_request_counts(analyst_api, ops_world, requests):
    api = APIClient()
    user = get_user_model().objects.get(username="analytics-analyst")
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
    OpsSecurityEvent.objects.filter(pk=ops_world.pk).update(force_requests=deepcopy(requests), force_roster=[{}] * 10)
    response = api.get(OPERATIONS, {"level": "EVENT", "event_id": str(ops_world.pk)})
    assert response.status_code == 200, response.json()
    facts = {fact["code"]: fact for fact in response.json()["data"]["eventCard"]["facts"]}
    assert facts["REQUESTED"]["displayValue"] == str(sum(row["requestedCount"] for row in requests))
    assert facts["ALLOCATED"]["displayValue"] == str(sum(row["allocatedCount"] for row in requests))
    ops_world.refresh_from_db()
    assert ops_world.force_requests == requests


def test_funnel_built_from_transition_journal(analyst_api, ops_world):
    """Журнал пишут операции стадий: заведение ОМ с объектом даёт вход в
    RECON, возврат с согласования — переход RETURN, и воронка их различает."""
    # Достроим путь до согласования и вернём на доработку.
    OpsSecurityEventTransition.objects.create(
        event=ops_world, from_stage="RECON", to_stage="APPROVAL",
        kind="FORWARD", occurred_at=Clock.now(),
    )
    OpsSecurityEvent.objects.filter(pk=ops_world.pk).update(stage="APPROVAL")
    # Этап ОБЪЕКТА двигаем тоже (Plane №475): возврат — операция над объектом,
    # и сторожит её теперь стадия объекта, а не мероприятия. Раньше хватало
    # строки выше, потому что гвард спрашивал ОМ; проба от этого не о том — ей
    # нужен факт возврата в журнале, а не то, чем он охраняется.
    OpsSecurityEventVisitObject.objects.filter(event=ops_world).update(
        stage="APPROVAL"
    )
    event_service.return_placement(ops_world.pk, comment="Доработать")
    data = analyst_api.get(OPERATIONS).json()["data"]
    funnel = data["funnel"]
    stages = {s["stateCode"]: s["values"] for s in funnel["stages"]}
    assert stages["RECON"]["REACHED"] == 1
    assert stages["PLACEMENT"]["TRANSITIONS"] == 1
    assert stages["PLACEMENT"]["RETURNS"] == 1
    # Незакрытый интервал (ОМ стоит на PLACEMENT) в среднее не попадает.
    assert stages["PLACEMENT"]["AVERAGE_HOURS"] is None
    assert funnel["transitionCount"] == 3


def test_create_event_records_entry_transition(ops_world):
    # Вход в цепочку у ОМ с объектом — сразу RECON, а не BULLETIN.
    row = OpsSecurityEventTransition.objects.filter(
        event=ops_world, to_stage="RECON"
    ).get()
    assert row.from_stage is None
    assert row.kind == "FORWARD"
