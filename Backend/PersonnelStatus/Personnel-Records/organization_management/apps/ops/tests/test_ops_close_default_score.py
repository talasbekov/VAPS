"""Закрытие объекта без ручных оценок ставит неоценённым 7 (`[ОМ-РШ-16]`,
решение заказчика 12.09.2026 по итогам проходки №1142: «можно закрывать, но
автоматом ставится всем средняя оценка — это семь»).

Пробы стерегут: у неоценённого назначения после закрытия объекта есть
действующая оценка 7 методом SYSTEM_DEFAULT; ручная оценка не перезаписана
и остаётся MANUAL; заменённые (строки журнала без назначения) оценки не
получают; в аудите закрытия перечислены те, кому оценка поставлена
автоматически.
"""
import pytest

from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_rating import OpsEventEvaluation
from organization_management.apps.ops import conduct_evaluations, ratings
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_conduct_evaluations import (
    _second_person_on_the_same_post,
)
from organization_management.apps.ops.tests.test_ops_visit_object_close import (  # noqa: F401
    actor,
    two_objects_on_conduct,
)
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    two_objects_on_approval,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    URL,
    _deputy_persona,
    approver,
    client_for,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db


def _evaluations_url(event_id, visit):
    return f"{URL}{event_id}/visit-objects/{visit.pk}/evaluations/"


def _current(event_id, employee_id):
    code = ratings._participant_code_for(int(employee_id))
    return list(
        OpsEventEvaluation.objects.filter(
            event_code=f"security-event-{event_id}",
            participant_code=code,
            superseded_by_code__isnull=True,
            withdrawn_at__isnull=True,
        )
    )


def test_closing_scores_the_unscored_with_seven_and_keeps_manual(manager, two_objects_on_conduct):  # noqa: F811
    base, event_id, first, _ = two_objects_on_conduct
    # Второй человек на посту: при одной строке ветка «неоценённых» пуста, и
    # проба проходила бы и без правки (проверено мутацией).
    _second_person_on_the_same_post(event_id, first)
    summary = manager.get(_evaluations_url(event_id, first)).json()
    rows = [r for r in summary["rows"] if not r["replaced"]]
    assert len(rows) >= 2, "нужны оценённый и неоценённый — стеречь нечего"
    manual = rows[0]
    manager.post(
        _evaluations_url(event_id, first),
        {"assignmentId": manual["assignmentId"], "score": 9},
        format="json",
    )

    resp = manager.post(f"{base}visit-objects/{first.pk}/close/", {}, format="json")

    assert resp.status_code == 200, resp.content
    after = conduct_evaluations.visit_evaluations(service.lock_event(event_id), first)
    assert after["evaluated"] == after["total"], after
    scores = {r["assignmentId"]: r["score"] for r in after["rows"] if not r["replaced"]}
    assert scores[manual["assignmentId"]] == 9
    assert all(v == conduct_evaluations.DEFAULT_CLOSE_SCORE for k, v in scores.items() if k != manual["assignmentId"])
    manual_rows = _current(event_id, manual["employeeId"])
    assert [r.method for r in manual_rows] == ["MANUAL"]
    for row in rows[1:]:
        current = _current(event_id, row["employeeId"])
        assert [r.score for r in current] == [conduct_evaluations.DEFAULT_CLOSE_SCORE]
        assert [r.method for r in current] == ["SYSTEM_DEFAULT"]
    closed = OpsAuditLog.objects.filter(action="VISIT_OBJECT_CLOSED").order_by("-pk").first()
    assert closed is not None
    defaulted = closed.new_value.get("defaultScored")
    assert sorted(defaulted) == sorted(r["assignmentId"] for r in rows[1:])


def test_closing_a_fully_scored_object_adds_nothing(manager, two_objects_on_conduct):  # noqa: F811
    base, event_id, first, _ = two_objects_on_conduct
    _second_person_on_the_same_post(event_id, first)
    manager.post(_evaluations_url(event_id, first) + "all/", {"score": 8}, format="json")
    before = OpsEventEvaluation.objects.count()

    resp = manager.post(f"{base}visit-objects/{first.pk}/close/", {}, format="json")

    assert resp.status_code == 200, resp.content
    assert OpsEventEvaluation.objects.count() == before
    closed = OpsAuditLog.objects.filter(action="VISIT_OBJECT_CLOSED").order_by("-pk").first()
    assert closed.new_value.get("defaultScored") == []
