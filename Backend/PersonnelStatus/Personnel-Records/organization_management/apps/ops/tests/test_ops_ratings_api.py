"""Срез G: оперативный рейтинг (§19, §22.16-22.17).

Ключевые свойства, каждое — контрактное, а не украшение:
- агрегат считает СЕРВЕР: вытесненная исправлением запись исключается,
  период задаёт политика, округление до одного знака здесь (§19.19);
- закрытые данные не покидают сервер: сводка, реестр и журнал проверяются
  ПОЛНЫМ дампом JSON, а не знакомыми именами полей (§19.21);
- исправление не переписывает исходную запись — создаёт замещающую и
  отдельную запись связи (§19.18);
- отказ фиксируется в журнале оценивания СВОЕЙ транзакцией (§19.27);
- повтор с тем же ключом идемпотентности возвращает прежний результат и не
  создаёт второй записи (§19.26).
"""
import datetime as dt
import json

import pytest

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
)
from organization_management.apps.operations.models_rating import (
    OpsEvaluationCorrection,
    OpsEvaluationEvent,
    OpsEvaluationWorkItem,
    OpsEventEvaluation,
    OpsRatedParticipant,
    OpsRatingAuditEntry,
    OpsRatingDynamicsPoint,
    OpsRatingExportJob,
    OpsRatingFeatureFlags,
    OpsRatingGroup,
    OpsRatingNotification,
)
from organization_management.apps.operations.models_settings import (
    OpsPolicySectionVersion,
    OpsPolicySetting,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

RATINGS = "/api/ops/operational-ratings/"
DYNAMICS = "/api/ops/operational-rating-dynamics/"
EMPLOYEE = "/api/ops/operational-rating-employee/"
ANALYTICS = "/api/ops/rating-analytics/"
WORKSPACE = "/api/ops/evaluation-workspace/"
REGISTRY = "/api/ops/evaluation-registry/"
AUDIT = "/api/ops/rating-audit/"
NOTIFICATIONS = "/api/ops/rating-notifications/"
EXPORTS = "/api/ops/rating-exports/"


def submit_path(code):
    return f"/api/ops/evaluation-work-items/{code}/submit/"


def correct_path(code):
    return f"/api/ops/evaluation-work-items/{code}/correct/"


def detail_path(code):
    return f"/api/ops/evaluation-work-items/{code}/detail/"


def _setting(code, value):
    OpsPolicySetting.objects.create(
        setting_code=code, section_code="RATING_POLICY", kind="NUMBER",
        value_type="COUNT", safe_label=code, description="", value=value,
        min_value=1, max_value=365, options=None, editable=True,
        locked_reason=None,
    )


@pytest.fixture
def policy(db):
    _setting("RATING.PERIOD.PARAMETER", 90)
    _setting("RATING.MIN_EVALUATIONS.PARAMETER", 3)
    _setting("RATING.SUPPRESSION_MIN_GROUP.PARAMETER", 3)
    OpsPolicySectionVersion.objects.create(
        section_code="RATING_POLICY", version="OPERATIONAL-RATING-2026.07.1",
    )
    OpsRatingFeatureFlags.objects.create(
        singleton_key=1, operational_ratings=True, rating_conflicts=True,
    )


@pytest.fixture
def viewer_api(db):
    api, _ = client_for(
        "rating-viewer", "RATING_VIEWER",
        perms=("rating.view_aggregate", "analytics.view",
               "rating.view_audit"),
    )
    return api


@pytest.fixture
def evaluator(db):
    api, user = client_for(
        "rating-evaluator", "RATING_EVALUATOR",
        perms=("rating.evaluate", "rating.correct",
               "rating.view_correction_chain", "rating.export"),
    )
    return api, str(user.pk)


@pytest.fixture
def stranger_api(db):
    api, _ = client_for("rating-stranger", "RATING_NONE", perms=("status.view",))
    return api


def _event(code="event-1", security_event_id=None):
    return OpsEvaluationEvent.objects.create(
        event_code=code, event_run_code=f"run-{code}", number=f"ОМ-{code}",
        title="Международный форум", object_label="Конгресс-холл",
        actual_starts_at=Clock.now() - dt.timedelta(days=2),
        actual_ends_at=Clock.now() - dt.timedelta(days=2, hours=-10),
        state_label="Завершено", security_event_id=security_event_id,
    )


def _participant(code, label, group="division-1", employee_id=None):
    return OpsRatedParticipant.objects.create(
        participant_code=code, safe_label=label, group_code=group,
        employee_id=employee_id,
    )


def test_summary_carries_the_personnel_link(viewer_api, policy):
    """Сводка отдаёт КАДРОВУЮ ссылку рядом с кодом участника (Plane №96).

    До этого расстановка искала рейтинг по кадровому id, а сводка отдавала
    только `employeeId` — код участника. Совпадений не бывало никогда, и весь
    рейтинговый функционал подбора был фикцией, видимой только на моке.

    Оба поля проверяются ВМЕСТЕ: подмена `employeeId` кадровым id сломала бы
    три экрана раздела, которые ходят по коду, — правка расстановки не имеет
    права стать их правкой.
    """
    linked = _participant("employee-42", "Абенов С.", employee_id=42)
    orphan = _participant("legacy-7", "Исторический участник")

    rows = {
        row["employeeId"]: row
        for row in viewer_api.get(RATINGS).json()["results"]
    }

    assert rows[linked.participant_code]["personnelId"] == "42"
    assert rows[linked.participant_code]["employeeId"] == "employee-42"
    # Несвязанный участник не притворяется кадровым: `null` значит «не знаем,
    # чей это рейтинг», и подстановка кода участника отдала бы расстановке
    # строку, которая совпадёт с чужим человеком.
    assert rows[orphan.participant_code]["personnelId"] is None
    assert rows[orphan.participant_code]["employeeId"] == "legacy-7"


def _evaluation(code, participant, score, days_ago, *, evaluator_id="someone",
                superseded_by=None, comment=None, method="MANUAL"):
    return OpsEventEvaluation.objects.create(
        evaluation_code=code, event_code="event-1",
        participant_code=participant,
        evaluator_user_id=evaluator_id, score=score, comment=comment,
        evaluation_direction="SENIOR_TO_EMPLOYEE", method=method,
        basis_code="EXECUTION_OF_DUTIES" if method == "MANUAL" else None,
        basis_note=None,
        evaluated_at=Clock.today_local() - dt.timedelta(days=days_ago),
        superseded_by_code=superseded_by,
    )


def _work_item(code, evaluator_id, target, *, event_code="event-1",
               participated=True, status="PENDING", revision=1,
               submitted_code=None):
    event = OpsEvaluationEvent.objects.get(event_code=event_code)
    person = OpsRatedParticipant.objects.get(participant_code=target)
    group = OpsRatingGroup.objects.filter(
        group_code=person.group_code
    ).first()
    return OpsEvaluationWorkItem.objects.create(
        work_item_code=code, event_code=event_code,
        event_run_code=event.event_run_code,
        assignment_code=f"assignment-{code}",
        evaluator_user_id=evaluator_id,
        target_participant_code=target, target_group_code=None,
        target_safe_label=person.safe_label,
        target_safe_unit_label=(
            group.safe_label if group is not None else "—"
        ),
        post_label="Пост 1 — главный вход",
        actual_starts_at=event.actual_starts_at,
        actual_ends_at=event.actual_ends_at,
        participated=participated,
        evaluation_direction="SENIOR_TO_EMPLOYEE",
        initial_score=8, status=status, revision=revision,
        submitted_evaluation_code=submitted_code,
        submitted_at=Clock.now() if submitted_code else None,
    )


@pytest.fixture
def world(policy):
    """Три группы под три исхода §22.17: рассчитанный агрегат, подавление
    малой группы и отсутствие агрегата вовсе."""
    for code, label in [
        ("division-1", "Первое управление"),
        ("division-2", "Второе управление"),
        ("division-3", "Третье управление"),
    ]:
        OpsRatingGroup.objects.create(group_code=code, safe_label=label)
    _event("event-1")
    _participant("employee-1", "Ерланов Д.", "division-1")
    _participant("employee-2", "Абишев Н.", "division-1")
    _participant("employee-3", "Сейтказы М.", "division-1")
    _participant("employee-4", "Нурланов Е.", "division-2")
    _participant("employee-5", "Тлеуов А.", "division-2")
    _participant("employee-6", "Жумабек С.", "division-3")
    # employee-1: 4 учтённых (9,8,7,10 → 8.5) + вытесненная тройка, которая
    # обязана не влиять, + оценка ВНЕ периода.
    _evaluation("evaluation-1", "employee-1", 9, 40)
    _evaluation("evaluation-2", "employee-1", 8, 30)
    _evaluation(
        "evaluation-3", "employee-1", 3, 20, superseded_by="evaluation-4",
        comment="Оценка выставлена по ошибке не тому участнику",
    )
    _evaluation("evaluation-4", "employee-1", 7, 20)
    _evaluation("evaluation-5", "employee-1", 10, 10)
    _evaluation("evaluation-out", "employee-1", 1, 200)
    # employee-2: ровно минимум (6,8,7 → 7.0).
    _evaluation("evaluation-6", "employee-2", 6, 25,
                comment="Задержка на инструктаже")
    _evaluation("evaluation-7", "employee-2", 8, 15)
    _evaluation("evaluation-8", "employee-2", 7, 5,
                comment="Замечание по форме")
    # employee-3: меньше минимума → «Недостаточно данных».
    _evaluation("evaluation-9", "employee-3", 9, 12)
    # Связь замещения — отдельной записью (§19.18): признак «исправлено» у
    # замены считается по ней, а не сравнением значений.
    OpsEvaluationCorrection.objects.create(
        correction_code="correction-world",
        original_evaluation_code="evaluation-3",
        replacement_evaluation_code="evaluation-4",
        reason="Оценка выставлена по ошибке не тому участнику",
        corrected_by="someone", corrected_at=Clock.now(), revision=1,
    )
    # division-2: ТРИ участника с агрегатом — группа READY (порог 3).
    _participant("employee-7", "Оспанов Р.", "division-2")
    for n, days in [(1, 22), (2, 17), (3, 9)]:
        _evaluation(f"evaluation-d2a-{n}", "employee-4", 9, days)
        _evaluation(f"evaluation-d2b-{n}", "employee-5", 6 + n, days + 1)
        _evaluation(f"evaluation-d2c-{n}", "employee-7", 7 + n, days + 2)
    # division-3: одна оценка — агрегата нет ни у кого (NO_AGGREGATE).
    _evaluation("evaluation-10", "employee-6", 8, 8)


@pytest.fixture
def queue(world, evaluator):
    """Задания оценщика + чужое задание тем же мероприятием."""
    _, actor = evaluator
    _work_item("work-item-1", actor, "employee-1")
    _work_item("work-item-2", actor, "employee-2", participated=False)
    _work_item("work-item-3", "999999", "employee-3")
    return actor


# ── Сводка (§19.19) ──────────────────────────────────────────────────────────


def test_summary_excludes_superseded_and_out_of_period(viewer_api, world):
    data = viewer_api.get(RATINGS).json()
    by_id = {row["employeeId"]: row for row in data["results"]}
    top = by_id["employee-1"]
    # (9+8+7+10)/4 = 8.5 — вытесненная тройка и запись вне периода не в счёте.
    assert top["aggregateRating"] == 8.5
    assert top["evaluationsCount"] == 4
    assert top["dataState"] == "READY"
    assert data["policy"]["policyVersion"] == "OPERATIONAL-RATING-2026.07.1"


def test_aggregate_rounds_half_up_like_contract(db):
    """Math.round контракта: точная половинка идёт ВВЕРХ. Банковский round()
    Python дал бы 8.2 — другое число, чем экран видел в мок-режиме."""
    from organization_management.apps.ops import ratings

    assert ratings.round_aggregate(8.25) == 8.3
    assert ratings.round_aggregate(33 / 4) == 8.3


def test_summary_insufficient_shows_count_not_zero(viewer_api, world):
    by_id = {
        row["employeeId"]: row
        for row in viewer_api.get(RATINGS).json()["results"]
    }
    short = by_id["employee-3"]
    assert short["dataState"] == "INSUFFICIENT_DATA"
    assert short["aggregateRating"] is None
    assert short["evaluationsCount"] == 1


def test_summary_order_is_by_label_not_by_value(viewer_api, world):
    labels = [
        row["safeLabel"] for row in viewer_api.get(RATINGS).json()["results"]
    ]
    assert labels == sorted(labels)


def test_summary_policy_undefined_without_settings(viewer_api, db):
    OpsRatingFeatureFlags.objects.create(
        singleton_key=1, operational_ratings=True, rating_conflicts=True,
    )
    _participant("employee-1", "Ерланов Д.")
    data = viewer_api.get(RATINGS).json()
    assert data["policy"] is None
    assert data["results"][0]["dataState"] == "POLICY_UNDEFINED"


def test_summary_feature_disabled_hides_policy(viewer_api, world):
    OpsRatingFeatureFlags.objects.filter(singleton_key=1).update(
        operational_ratings=False
    )
    data = viewer_api.get(RATINGS).json()
    assert data["policy"] is None
    assert all(
        row["dataState"] == "FEATURE_DISABLED" for row in data["results"]
    )


def test_summary_requires_aggregate_permission(stranger_api, world):
    assert stranger_api.get(RATINGS).status_code == 403


def test_summary_json_carries_no_closed_values(viewer_api, world):
    """§19.21 — по ВСЕМУ JSON: ни комментария, ни оценщика, ни ключа score."""
    payload = json.dumps(viewer_api.get(RATINGS).json(), ensure_ascii=False)
    assert "Задержка на инструктаже" not in payload
    assert "someone" not in payload
    assert '"score"' not in payload


# ── Динамика (§19.20) и карточка (§19.17) ───────────────────────────────────


@pytest.fixture
def dynamics_points(world):
    rows = [
        ("2026-03", "2026-03-01", "2026-03-31", "V1", 8.1),
        ("2026-04", "2026-04-01", "2026-04-30", "V1", None),
        ("2026-05", "2026-05-01", "2026-05-31", "V2", 8.6),
    ]
    for period, starts, ends, version, rating in rows:
        OpsRatingDynamicsPoint.objects.create(
            participant_code="employee-1", period=period,
            period_starts_at=dt.date.fromisoformat(starts),
            period_ends_at=dt.date.fromisoformat(ends),
            aggregate_rating=rating,
            evaluations_count=0 if rating is None else 5,
            policy_version=version,
            data_state="INSUFFICIENT_DATA" if rating is None else "READY",
            recorded_at=Clock.now(),
        )


def test_dynamics_orders_points_and_marks_boundaries(
    viewer_api, dynamics_points,
):
    data = viewer_api.get(DYNAMICS, {"employee": "employee-1"}).json()
    assert [point["period"] for point in data["points"]] == [
        "2026-03", "2026-04", "2026-05",
    ]
    # Граница считается по ВСЕМУ ряду, включая точку без агрегата.
    assert data["boundaries"] == [{
        "period": "2026-05",
        "fromPolicyVersion": "V1",
        "toPolicyVersion": "V2",
    }]
    # Текущая методика настроек ни одного периода не закрывала.
    assert data["currentPolicyHasClosedPeriods"] is False


def test_employee_detail_returns_summary_and_404_for_unknown(
    viewer_api, dynamics_points,
):
    data = viewer_api.get(EMPLOYEE, {"employee": "employee-1"}).json()
    assert data["summary"]["aggregateRating"] == 8.5
    assert data["unitSafeLabel"] == "Первое управление"
    assert len(data["points"]) == 3
    missing = viewer_api.get(EMPLOYEE, {"employee": "nobody"})
    assert missing.status_code == 404
    assert missing.json()["error_code"] == "ENTITY_NOT_FOUND"


# ── Аналитика (§22.16-22.17) ────────────────────────────────────────────────


def test_analytics_requires_analytics_permission(world, evaluator):
    api, _ = evaluator
    assert api.get(ANALYTICS).status_code == 403


def test_analytics_suppresses_small_group_and_names_empty_one(
    viewer_api, world,
):
    figures = viewer_api.get(ANALYTICS).json()["figures"]
    groups = {row["groupCode"]: row for row in figures["groups"]}
    # division-1: два агрегата из трёх участников — меньше порога 3.
    assert groups["division-1"]["state"] == "SUPPRESSED"
    assert groups["division-1"]["aggregateRating"] is None
    assert groups["division-1"]["ratedCount"] == 2
    # division-2: три агрегата — READY со средним по группе.
    assert groups["division-2"]["state"] == "READY"
    assert groups["division-2"]["aggregateRating"] == 8.7
    # division-3: ни одного агрегата — это НЕ подавление и не ноль.
    assert groups["division-3"]["state"] == "NO_AGGREGATE"
    assert figures["correctedEvaluations"] == 1
    assert figures["ratedParticipants"] == 5
    assert figures["withoutAggregate"] == 2


def test_analytics_unpublished_without_suppression_threshold(
    viewer_api, world,
):
    OpsPolicySetting.objects.filter(
        setting_code="RATING.SUPPRESSION_MIN_GROUP.PARAMETER"
    ).delete()
    data = viewer_api.get(ANALYTICS).json()
    assert data["figures"] is None
    assert data["unpublishedReason"] == "SUPPRESSION_UNDEFINED"


# ── Рабочее пространство (§19.14) ───────────────────────────────────────────


def test_workspace_scopes_queue_to_actor(queue, evaluator):
    api, _ = evaluator
    data = api.get(WORKSPACE).json()
    codes = [item["id"] for item in data["pending"]]
    # Чужого задания (work-item-3) нет ни в очереди, ни в отправленных.
    assert codes == ["work-item-2", "work-item-1"] or set(codes) == {
        "work-item-1", "work-item-2",
    }
    assert data["queue"] == {"total": 2, "submitted": 0, "remaining": 2}
    # Право на агрегат не выдано — сводки мероприятия нет в ответе.
    assert data["eventProgress"] is None
    payload = json.dumps(data, ensure_ascii=False)
    assert "999999" not in payload


def test_workspace_event_progress_counts_all_evaluators(queue, world):
    api, _ = client_for(
        "rating-super", "RATING_SUPER",
        perms=("rating.evaluate", "rating.view_aggregate"),
    )
    _work_item("work-item-super", str(_user_pk(api)), "employee-4")
    data = api.get(WORKSPACE).json()
    # Сводка считает работу ВСЕХ оценщиков мероприятия.
    assert data["eventProgress"]["counters"]["total"] == 4


def _user_pk(api):
    return api.handler._force_user.pk


# ── Отправка оценки (§19.7-19.10, §19.26) ───────────────────────────────────


def _submit_body(**overrides):
    body = {
        "score": 9,
        "basisCode": "EXECUTION_OF_DUTIES",
        "basisNote": None,
        "comment": None,
        "revision": 1,
        "idempotencyKey": "key-submit-1",
    }
    body.update(overrides)
    return body


def test_submit_creates_evaluation_and_audits(queue, evaluator):
    api, actor = evaluator
    response = api.post(
        submit_path("work-item-1"), _submit_body(), format="json"
    )
    assert response.status_code == 201
    data = response.json()
    assert data["workItem"]["status"] == "SUBMITTED"
    assert data["workItem"]["revision"] == 2
    assert data["submitted"]["score"] == 9
    assert data["queue"]["submitted"] == 1
    item = OpsEvaluationWorkItem.objects.get(work_item_code="work-item-1")
    evaluation = OpsEventEvaluation.objects.get(
        evaluation_code=item.submitted_evaluation_code
    )
    assert evaluation.evaluator_user_id == actor
    assert evaluation.score == 9
    # Журнал: отправка + отдельное событие «значение изменилось от 8».
    codes = list(
        OpsRatingAuditEntry.objects.values_list("event_code", flat=True)
    )
    assert "EVALUATION_SUBMITTED" in codes
    assert "EVALUATION_SCORE_CHANGED_FROM_INITIAL" in codes
    assert OpsRatingNotification.objects.filter(
        recipient_user_id=actor, code="EVALUATION_SUBMITTED"
    ).exists()


def test_submit_idempotent_repeat_returns_same_evaluation(queue, evaluator):
    api, _ = evaluator
    first = api.post(
        submit_path("work-item-1"), _submit_body(), format="json"
    ).json()
    before = OpsEventEvaluation.objects.count()
    repeat = api.post(
        submit_path("work-item-1"), _submit_body(), format="json"
    ).json()
    # Прежний результат, а не «уже отправлено», и без второй записи.
    assert repeat["submitted"]["evaluationId"] == (
        first["submitted"]["evaluationId"]
    )
    assert OpsEventEvaluation.objects.count() == before


def test_submit_revision_mismatch_409_carries_current_values(
    queue, evaluator,
):
    api, _ = evaluator
    response = api.post(
        submit_path("work-item-1"), _submit_body(revision=7), format="json"
    )
    assert response.status_code == 409
    body = response.json()
    assert body["error_code"] == "EVALUATION_REVISION_MISMATCH"
    assert body["details"]["currentRevision"] == 1
    # Отказ записан СВОЕЙ транзакцией.
    assert OpsRatingAuditEntry.objects.filter(
        outcome="REJECTED", reason_code="EVALUATION_REVISION_MISMATCH"
    ).exists()


def test_submit_low_score_without_comment_has_own_audit_event(
    queue, evaluator,
):
    api, _ = evaluator
    response = api.post(
        submit_path("work-item-1"),
        _submit_body(score=4, comment=""),
        format="json",
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "COMMENT_REQUIRED"
    assert OpsRatingAuditEntry.objects.filter(
        event_code="EVALUATION_LOW_SCORE_WITHOUT_COMMENT",
        outcome="REJECTED",
    ).exists()
    # Состояние не изменилось.
    assert OpsEvaluationWorkItem.objects.get(
        work_item_code="work-item-1"
    ).status == "PENDING"


def test_submit_validation_order_scale_before_comment(queue, evaluator):
    api, _ = evaluator
    response = api.post(
        submit_path("work-item-1"),
        _submit_body(score=12, comment=""),
        format="json",
    )
    assert response.json()["error_code"] == "SCORE_OUT_OF_SCALE"


def test_submit_other_basis_requires_note(queue, evaluator):
    api, _ = evaluator
    response = api.post(
        submit_path("work-item-1"),
        _submit_body(basisCode="OTHER", basisNote=" "),
        format="json",
    )
    assert response.json()["error_code"] == "BASIS_NOTE_REQUIRED"


def test_submit_unconfirmed_participation_rejected(queue, evaluator):
    api, _ = evaluator
    response = api.post(
        submit_path("work-item-2"), _submit_body(), format="json"
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "PARTICIPATION_NOT_CONFIRMED"


def test_submit_foreign_item_is_404_not_403(queue, evaluator):
    api, _ = evaluator
    response = api.post(
        submit_path("work-item-3"), _submit_body(), format="json"
    )
    assert response.status_code == 404


def test_submit_locked_when_registry_event_closed(queue, evaluator):
    api, _ = evaluator
    registry_row = OpsSecurityEvent.objects.create(
        code="ОМ-2026-999", title="Закрытое", security_object=None,
        object_name="Объект", passport_binding=None,
        business_date=Clock.today_local(), stage="CLOSED",
        readiness_percent=100, force_need=0, conflicts_count=0,
        owner_name="—", recon_checklist=[], recon_sector_posts=[],
        demand_rows=[], demand_approved=False, force_requests=[],
        placement_assignments=[], approval_status="APPROVED",
        journal_entries=[], closure_direction_summaries=[],
        closed_at=Clock.now(),
    )
    OpsEvaluationEvent.objects.filter(event_code="event-1").update(
        security_event_id=registry_row.pk
    )
    response = api.post(
        submit_path("work-item-1"), _submit_body(), format="json"
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "EVALUATION_ARCHIVE_LOCKED"


# ── Карточка записи и исправление (§19.17-19.18) ────────────────────────────


def test_detail_shows_chain_and_foreign_attempt_is_audited(
    queue, evaluator,
):
    api, _ = evaluator
    api.post(submit_path("work-item-1"), _submit_body(), format="json")
    data = api.get(detail_path("work-item-1")).json()
    assert data["submitted"]["score"] == 9
    assert data["canCorrect"] is True
    assert len(data["chain"]) == 1
    assert data["chain"][0]["current"] is True
    # Чужая запись: наружу 404, в журнале — попытка.
    foreign = api.get(detail_path("work-item-3"))
    assert foreign.status_code == 404
    assert OpsRatingAuditEntry.objects.filter(
        reason_code="FOREIGN_EVALUATION", outcome="REJECTED"
    ).exists()


def _correct_body(**overrides):
    body = {
        "score": 6,
        "basisCode": "TIMELY_ARRIVAL",
        "basisNote": None,
        "comment": "Опоздал на инструктаж, разобрано",
        "reason": "Уточнение по факту разбора",
        "revision": 2,
        "idempotencyKey": "key-correct-1",
    }
    body.update(overrides)
    return body


def test_correct_supersedes_original_and_recomputes_aggregate(
    queue, evaluator, viewer_api,
):
    api, actor = evaluator
    first = api.post(
        submit_path("work-item-1"), _submit_body(), format="json"
    ).json()
    original_code = first["submitted"]["evaluationId"]
    response = api.post(
        correct_path("work-item-1"), _correct_body(), format="json"
    )
    assert response.status_code == 201
    data = response.json()
    replacement_code = data["submitted"]["evaluationId"]
    assert replacement_code != original_code
    # Исходная запись жива и помечена ссылкой; замещающая — действующая.
    original = OpsEventEvaluation.objects.get(evaluation_code=original_code)
    assert original.superseded_by_code == replacement_code
    assert original.score == 9
    assert OpsEvaluationCorrection.objects.filter(
        original_evaluation_code=original_code,
        replacement_evaluation_code=replacement_code,
    ).exists()
    # Цепочка: две записи, действующая — последняя, старое значение видно.
    assert [link["score"] for link in data["chain"]] == [9, 6]
    assert data["chain"][0]["supersededReason"] == "Уточнение по факту разбора"
    # Агрегат пересчитан сервером: у employee-1 теперь (9+8+7+10+6)/5 = 8.0.
    by_id = {
        row["employeeId"]: row
        for row in viewer_api.get(RATINGS).json()["results"]
    }
    assert by_id["employee-1"]["aggregateRating"] == 8.0
    assert by_id["employee-1"]["evaluationsCount"] == 5


def test_correct_requires_reason_and_submitted_state(queue, evaluator):
    api, _ = evaluator
    not_submitted = api.post(
        correct_path("work-item-1"), _correct_body(revision=1), format="json"
    )
    assert not_submitted.json()["error_code"] == "EVALUATION_NOT_SUBMITTED"
    api.post(submit_path("work-item-1"), _submit_body(), format="json")
    no_reason = api.post(
        correct_path("work-item-1"), _correct_body(reason="  "),
        format="json",
    )
    assert no_reason.json()["error_code"] == "CORRECTION_REASON_REQUIRED"
    assert OpsRatingAuditEntry.objects.filter(
        event_code="EVALUATION_CORRECTION_REJECTED",
        reason_code="CORRECTION_REASON_REQUIRED",
    ).exists()


def test_correct_already_corrected_conflict(queue, evaluator):
    api, _ = evaluator
    api.post(submit_path("work-item-1"), _submit_body(), format="json")
    item = OpsEvaluationWorkItem.objects.get(work_item_code="work-item-1")
    # Запись вытеснена мимо задания (ревизия совпадает, а действующая — уже
    # другая): §19.25 требует ОТДЕЛЬНЫЙ конфликт.
    OpsEventEvaluation.objects.filter(
        evaluation_code=item.submitted_evaluation_code
    ).update(superseded_by_code="evaluation-elsewhere")
    response = api.post(
        correct_path("work-item-1"), _correct_body(), format="json"
    )
    assert response.status_code == 409
    assert response.json()["error_code"] == "EVALUATION_ALREADY_CORRECTED"


# ── Реестр (§19.15-19.16) ───────────────────────────────────────────────────


def test_registry_rows_carry_no_closed_values(viewer_api, world):
    response = viewer_api.get(REGISTRY).json()
    payload = json.dumps(response, ensure_ascii=False)
    assert '"score"' not in payload
    assert "Задержка на инструктаже" not in payload
    assert "someone" not in payload
    assert response["columns"] == {"sensitiveDetails": False}
    row = response["results"][0]
    assert row["rowId"].startswith("row-")
    assert row["aggregateState"] in (
        "READY", "INSUFFICIENT_DATA", "POLICY_UNDEFINED", "FEATURE_DISABLED",
    )


def test_registry_corrected_filter_uses_chain(viewer_api, world):
    data = viewer_api.get(REGISTRY, {"corrected": "true"}).json()
    ids = {row["rowId"] for row in data["results"]}
    # Вытесненная запись и её замена — обе «исправленные».
    assert ids == {"row-evaluation-3", "row-evaluation-4"}


def test_registry_paginates_and_filters_by_employee(viewer_api, world):
    data = viewer_api.get(REGISTRY).json()
    assert data["total"] == 20
    assert data["pageCount"] == 2
    assert len(data["results"]) == 10
    scoped = viewer_api.get(REGISTRY, {"employee": "employee-3"}).json()
    assert scoped["total"] == 1
    assert scoped["results"][0]["employeeId"] == "employee-3"


# ── Журнал (§19.27) и уведомления (§19.28) ──────────────────────────────────


def test_audit_requires_own_permission_and_hides_values(
    queue, evaluator, viewer_api,
):
    api, _ = evaluator
    api.post(
        submit_path("work-item-1"),
        _submit_body(score=4, comment="Закрытый комментарий причины"),
        format="json",
    )
    # У оценщика права на журнал нет.
    assert api.get(AUDIT).status_code == 403
    data = viewer_api.get(AUDIT).json()
    assert data["total"] >= 1
    payload = json.dumps(data, ensure_ascii=False)
    assert "Закрытый комментарий причины" not in payload
    assert '"score"' not in payload


def test_notifications_are_scoped_to_recipient(queue, evaluator):
    api, actor = evaluator
    api.post(submit_path("work-item-1"), _submit_body(), format="json")
    OpsRatingNotification.objects.create(
        notification_code="foreign-1", notified_at=Clock.now(),
        recipient_user_id="999999", code="EVALUATION_AVAILABLE",
        deep_link="/ratings/workspace", security_event_code="event-1",
    )
    data = api.get(NOTIFICATIONS).json()
    recipients = {row["recipientUserId"] for row in data["results"]}
    assert recipients == {actor}


# ── Экспорт (§19.29) ────────────────────────────────────────────────────────


def test_export_lifecycle_queued_generating_ready_download(
    world, evaluator,
):
    api, actor = evaluator
    created = api.post(
        EXPORTS,
        {"scope": "AGGREGATE", "format": "CSV",
         "idempotencyKey": "key-export-1"},
        format="json",
    )
    assert created.status_code == 201
    job = created.json()["job"]
    assert job["state"] == "QUEUED"
    assert job["artifactId"] is None
    # Ступень выполняется на чтении: QUEUED → GENERATING → READY.
    first = api.get(EXPORTS).json()["results"][0]
    assert first["state"] == "GENERATING"
    listing = api.get(EXPORTS).json()
    ready = listing["results"][0]
    assert ready["state"] == "READY"
    artifact = listing["artifacts"][0]
    assert "content" not in artifact
    download = api.post(
        f"/api/ops/rating-export-artifacts/{artifact['artifactId']}/download/"
    )
    assert download.status_code == 200
    content = download.json()["content"]
    assert "методика OPERATIONAL-RATING-2026.07.1" in content
    # Отсутствие агрегата — состояние и пустая клетка, не ноль.
    assert "Недостаточно оценок" in content
    assert ";0,0;" not in content and ";0.0;" not in content
    assert OpsRatingAuditEntry.objects.filter(
        event_code="RATING_EXPORT_DOWNLOADED"
    ).exists()
    # Идемпотентный повтор заказа возвращает ту же работу.
    repeat = api.post(
        EXPORTS,
        {"scope": "AGGREGATE", "format": "CSV",
         "idempotencyKey": "key-export-1"},
        format="json",
    ).json()["job"]
    assert repeat["exportJobId"] == job["exportJobId"]
    assert OpsRatingExportJob.objects.count() == 1


def test_export_individual_scope_refused_and_audited(world, evaluator):
    api, _ = evaluator
    response = api.post(
        EXPORTS,
        {"scope": "INDIVIDUAL", "format": "CSV",
         "idempotencyKey": "key-export-2"},
        format="json",
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "SENSITIVE_EXPORT_UNAVAILABLE"
    assert OpsRatingAuditEntry.objects.filter(
        event_code="RATING_EXPORT_REJECTED",
        reason_code="SENSITIVE_EXPORT_UNAVAILABLE",
    ).exists()
    assert OpsRatingExportJob.objects.count() == 0


def test_export_cancel_only_unfinished(world, evaluator):
    api, _ = evaluator
    job = api.post(
        EXPORTS,
        {"scope": "AGGREGATE", "format": "CSV",
         "idempotencyKey": "key-export-3"},
        format="json",
    ).json()["job"]
    cancelled = api.post(
        f"/api/ops/rating-exports/{job['exportJobId']}/cancel/"
    )
    assert cancelled.json()["job"]["state"] == "CANCELLED"
    again = api.post(
        f"/api/ops/rating-exports/{job['exportJobId']}/cancel/"
    )
    assert again.status_code == 422
    assert again.json()["error_code"] == "EXPORT_NOT_CANCELLABLE"


def test_export_foreign_download_is_404(world, evaluator, viewer_api):
    api, _ = evaluator
    api.post(
        EXPORTS,
        {"scope": "AGGREGATE", "format": "CSV",
         "idempotencyKey": "key-export-4"},
        format="json",
    )
    api.get(EXPORTS)
    listing = api.get(EXPORTS).json()
    artifact_id = listing["artifacts"][0]["artifactId"]
    stranger, _ = client_for(
        "rating-exporter-2", "RATING_EXPORTER2", perms=("rating.export",),
    )
    foreign = stranger.post(
        f"/api/ops/rating-export-artifacts/{artifact_id}/download/"
    )
    assert foreign.status_code == 404
