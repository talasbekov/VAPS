"""Закрытие объекта и автозакрытие мероприятия (`[ЗАК-05]`/`[ЗАК-12]`, Plane №404).

Спецификация: «Кнопка „Закрыть объект“… После закрытия изменения невозможны»
и «Мероприятие закрывается автоматически, когда закрыты все его объекты; в
реестре „Закрыто · 100%“». До этого шага закрыть можно было только
мероприятие целиком — одной кнопкой с итогами направлений, и у ОМ с двумя
объектами старший первого не мог закрыть своё, не дожидаясь второго.

Пробы стерегут:

1. закрытие одного из двух объектов НЕ закрывает мероприятие;
2. закрытие последнего — закрывает: стадия, готовность 100, штамп, переход в
   журнале, оценивание открыто, аудит — те же следствия, что у ручного;
3. вне «Проведения» закрыть объект нельзя; дважды — нельзя;
4. комментарий по объекту сохраняется и отдаётся контрактом;
5. ручное закрытие мероприятия целиком по-прежнему закрывает все объекты.
"""
import pytest

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_event import (
    OpsSecurityEventTransition,
    OpsSecurityEventVisitObject,
)
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    two_objects_on_approval,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    approver,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


@pytest.fixture
def actor(db):
    from django.contrib.auth import get_user_model

    return get_user_model().objects.create_user(username="closer", password="x")


@pytest.fixture
def two_objects_on_conduct(manager, actor, two_objects_on_approval):  # noqa: F811
    """Оба объекта доведены до «Проведения» обходом админа — предмет проб
    здесь закрытие, а не согласование и ознакомление."""
    base, event_id, first, second, _ = two_objects_on_approval
    service.override_stage(event_id, stage="CONDUCT", actor=actor)
    first.refresh_from_db()
    second.refresh_from_db()
    return base, event_id, first, second


def _visits(event_id):
    return list(
        OpsSecurityEventVisitObject.objects.filter(event_id=event_id).order_by(
            "position", "pk"
        )
    )


def test_closing_one_of_two_objects_keeps_the_event_open(manager, two_objects_on_conduct):  # noqa: F811
    base, event_id, first, second = two_objects_on_conduct

    resp = manager.post(
        f"{base}visit-objects/{first.pk}/close/",
        {"comment": "Без происшествий."},
        format="json",
    )

    assert resp.status_code == 200, resp.content
    data = resp.json()
    assert data["stage"] == "CONDUCT", "мероприятие закрылось по одному объекту"
    rows = {row["id"]: row for row in data["visitObjects"]}
    assert rows[str(first.pk)]["stage"] == "CLOSED"
    assert rows[str(first.pk)]["closedAt"] is not None
    assert rows[str(first.pk)]["closingComment"] == "Без происшествий."
    assert rows[str(second.pk)]["stage"] == "CONDUCT"
    event = service.lock_event(event_id)
    assert event.closed_at is None


def test_closing_the_last_object_closes_the_event_with_the_same_consequences(
    manager, two_objects_on_conduct  # noqa: F811
):
    base, event_id, first, second = two_objects_on_conduct
    manager.post(f"{base}visit-objects/{first.pk}/close/", {}, format="json")

    resp = manager.post(f"{base}visit-objects/{second.pk}/close/", {}, format="json")

    assert resp.status_code == 200, resp.content
    data = resp.json()
    assert (data["stage"], data["readinessPercent"]) == ("CLOSED", 100)
    assert data["closedAt"] is not None
    assert {row["stage"] for row in data["visitObjects"]} == {"CLOSED"}
    assert OpsSecurityEventTransition.objects.filter(
        event_id=event_id, to_stage="CLOSED"
    ).exists(), "переход в «Закрыто» не записан"
    assert OpsAuditLog.objects.filter(
        action=audit_service.SECURITY_EVENT_CLOSED, entity_id=event_id
    ).exists(), "аудит закрытия мероприятия не записан"
    assert OpsAuditLog.objects.filter(
        action=audit_service.VISIT_OBJECT_CLOSED, entity_id=event_id
    ).count() == 2


def test_closing_outside_conduct_is_refused(manager, two_objects_on_approval):  # noqa: F811
    base, event_id, first, _, _ = two_objects_on_approval

    resp = manager.post(f"{base}visit-objects/{first.pk}/close/", {}, format="json")

    assert resp.status_code == 422, resp.content
    assert resp.json()["error_code"] == "INVALID_STAGE_TRANSITION"


def test_closing_twice_is_refused(manager, two_objects_on_conduct):  # noqa: F811
    base, event_id, first, _ = two_objects_on_conduct
    manager.post(f"{base}visit-objects/{first.pk}/close/", {}, format="json")

    resp = manager.post(f"{base}visit-objects/{first.pk}/close/", {}, format="json")

    assert resp.status_code == 422, resp.content
    assert resp.json()["error_code"] == "VISIT_OBJECT_ALREADY_CLOSED"


def test_manual_close_still_closes_every_object(manager, actor, two_objects_on_conduct):  # noqa: F811
    base, event_id, first, second = two_objects_on_conduct
    event = service.lock_event(event_id)
    summaries = [
        {"direction": sector, "summary": "Без происшествий."}
        for sector in {p.get("sector") for p in event.recon_sector_posts}
    ]

    service.close_event(event_id, direction_summaries=summaries, actor=actor)

    assert {v.stage for v in _visits(event_id)} == {"CLOSED"}
    assert service.lock_event(event_id).stage == "CLOSED"
