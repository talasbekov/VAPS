"""Оценки на этапе 5 (`[МД-08]`/`[ЗАК-02]`/`[ЗАК-05]`, Plane №433).

Пробы стерегут: задания заводятся входом объекта в «Проведение»; сводка
объекта считает «Оценено K из N» по его назначениям; клик ставит, повторный
снимает (прежняя строка помечается superseded); «Всем 10» не трогает
поставленное вручную; закрытый объект и чужая стадия отбиваются; оценка этапа
попадает в средний балл тем же `included_evaluations`, что и оценка из
модуля рейтинга.
"""
import pytest

from organization_management.apps.operations.models_rating import (
    OpsEvaluationWorkItem,
    OpsEventEvaluation,
)
from organization_management.apps.ops import conduct_evaluations, ratings
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_visit_object_close import (  # noqa: F401
    actor,
    two_objects_on_conduct,
)
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    two_objects_on_approval,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    URL,
    approver,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db


def _url(event_id, visit):
    return f"{URL}{event_id}/visit-objects/{visit.pk}/evaluations/"


def test_entering_conduct_opens_work_items(two_objects_on_conduct):  # noqa: F811
    _, event_id, _, _ = two_objects_on_conduct
    event = service.lock_event(event_id)
    assert event.stage == "CONDUCT"
    assert OpsEvaluationWorkItem.objects.filter(
        event_code=f"security-event-{event.pk}"
    ).count() == len(event.placement_assignments)


def test_summary_counts_only_this_objects_assignments(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, second = two_objects_on_conduct
    a = manager.get(_url(event_id, first)).json()
    b = manager.get(_url(event_id, second)).json()
    assert a["total"] >= 1 and b["total"] >= 1
    event = service.lock_event(event_id)
    assert a["total"] + b["total"] == len(event.placement_assignments)
    assert a["evaluated"] == 0 and b["evaluated"] == 0
    row = a["rows"][0]
    assert set(row) >= {"assignmentId", "post", "sector", "employeeName", "score", "comment", "replaced"}


def test_click_sets_and_second_click_withdraws(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, _ = two_objects_on_conduct
    row = manager.get(_url(event_id, first)).json()["rows"][0]
    resp = manager.post(
        _url(event_id, first),
        {"assignmentId": row["assignmentId"], "score": 7, "comment": "норма"},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    assert resp.json()["evaluated"] == 1
    mine = next(r for r in resp.json()["rows"] if r["assignmentId"] == row["assignmentId"])
    assert mine["score"] == 7 and mine["comment"] == "норма"
    # Перестановка: прежняя строка помечена, действующая одна.
    resp = manager.post(
        _url(event_id, first),
        {"assignmentId": row["assignmentId"], "score": 9},
        format="json",
    )
    assert resp.status_code == 200
    live = OpsEventEvaluation.objects.filter(
        event_code=f"security-event-{event_id}", superseded_by_code__isnull=True
    )
    assert live.count() == 1 and live.get().score == 9
    assert OpsEventEvaluation.objects.filter(event_code=f"security-event-{event_id}").count() == 2
    # Повторный клик — снять.
    resp = manager.post(
        _url(event_id, first),
        {"assignmentId": row["assignmentId"], "score": None},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.json()["evaluated"] == 0
    assert not live.exists()


def test_all_ten_skips_manual_scores(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, _ = two_objects_on_conduct
    summary = manager.get(_url(event_id, first)).json()
    rows = [r for r in summary["rows"] if not r["replaced"]]
    manager.post(
        _url(event_id, first),
        {"assignmentId": rows[0]["assignmentId"], "score": 6},
        format="json",
    )
    resp = manager.post(_url(event_id, first) + "all/", {}, format="json")
    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert body["evaluated"] == body["total"]
    scores = {r["assignmentId"]: r["score"] for r in body["rows"] if not r["replaced"]}
    assert scores[rows[0]["assignmentId"]] == 6
    assert all(v == 10 for k, v in scores.items() if k != rows[0]["assignmentId"])


def test_scale_and_stage_are_guarded(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, _ = two_objects_on_conduct
    row = manager.get(_url(event_id, first)).json()["rows"][0]
    out = manager.post(
        _url(event_id, first), {"assignmentId": row["assignmentId"], "score": 11}, format="json"
    )
    assert out.status_code == 422 and out.json()["error_code"] == "SCORE_OUT_OF_SCALE"
    unknown = manager.post(
        _url(event_id, first), {"assignmentId": "nope", "score": 5}, format="json"
    )
    assert unknown.status_code == 404
    # Закрытый объект — изменения невозможны.
    manager.post(f"{URL}{event_id}/visit-objects/{first.pk}/close/", {}, format="json")
    closed = manager.post(
        _url(event_id, first), {"assignmentId": row["assignmentId"], "score": 5}, format="json"
    )
    assert closed.status_code == 422
    assert closed.json()["error_code"] == "VISIT_OBJECT_ALREADY_CLOSED"


def test_stage_score_feeds_the_average(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, _ = two_objects_on_conduct
    row = manager.get(_url(event_id, first)).json()["rows"][0]
    manager.post(
        _url(event_id, first), {"assignmentId": row["assignmentId"], "score": 4}, format="json"
    )
    code = ratings._participant_code_for(int(row["employeeId"]))
    evaluations = list(OpsEventEvaluation.objects.filter(participant_code=code))
    from organization_management.apps.operations.clock import Clock
    today = Clock.today_local()
    included = ratings.included_evaluations(evaluations, code, today, today)
    assert [e.score for e in included] == [4]
    assert included[0].method == conduct_evaluations.STAGE_METHOD
