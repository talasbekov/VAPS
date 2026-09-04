"""Чек-лист рекогносцировки одним переключателем (`[РЕК-04]`/`[РЕК-07]`,
Plane №443): `state` NORMAL / REMARK / UNCHECKED; «Замечание» требует
комментария; обязательные пункты в «Не проверено» не дают завершить (🔴
красная проверка карточки); старые `done`/`result` выводятся из состояния
и переносятся миграцией.
"""
import pytest

from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    URL,
    create_event,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db


def _event_with_posts(manager):  # noqa: F811
    event_id = create_event(manager, make_object(with_passport=True)).json()["id"]
    data = manager.post(f"{URL}{event_id}/recon/import-from-passport/").json()
    return event_id, data["reconChecklist"]


def test_new_checklist_has_state_and_old_keys(manager):  # noqa: F811
    _, checklist = _event_with_posts(manager)
    assert checklist and all(i["state"] == "UNCHECKED" and i["required"] is True for i in checklist)
    assert all(i["done"] is False and i["result"] is None for i in checklist)


def test_remark_requires_a_comment_and_normal_does_not(manager):  # noqa: F811
    event_id, checklist = _event_with_posts(manager)
    bad = [{**i, "state": "REMARK", "comment": ""} for i in checklist]
    resp = manager.patch(f"{URL}{event_id}/recon/", {"checklist": bad}, format="json")
    assert resp.status_code == 400 and "checklist.0.comment" in resp.json()["details"]
    good = [{**i, "state": "NORMAL"} for i in checklist]
    resp = manager.patch(f"{URL}{event_id}/recon/", {"checklist": good}, format="json")
    assert resp.status_code == 200, resp.content
    item = resp.json()["reconChecklist"][0]
    assert (item["state"], item["done"], item["result"]) == ("NORMAL", True, "MATCHES")


def test_unchecked_required_item_blocks_completion(manager):  # noqa: F811
    event_id, checklist = _event_with_posts(manager)
    partly = [{**i, "state": "NORMAL"} for i in checklist[:-1]] + [{**checklist[-1], "state": "UNCHECKED"}]
    manager.patch(f"{URL}{event_id}/recon/", {"checklist": partly}, format="json")
    refused = manager.post(f"{URL}{event_id}/recon/complete/")
    assert refused.status_code == 422 and refused.json()["error_code"] == "RECON_CHECKLIST_INCOMPLETE"
    # «Замечание» — проверено: завершать не мешает.
    done = [{**i, "state": "NORMAL"} for i in checklist[:-1]] + [{**checklist[-1], "state": "REMARK", "comment": "трещина"}]
    manager.patch(f"{URL}{event_id}/recon/", {"checklist": done}, format="json")
    ok = manager.post(f"{URL}{event_id}/recon/complete/")
    assert ok.status_code == 200, ok.content


def test_old_keys_are_normalized_into_state(manager):  # noqa: F811
    event_id, checklist = _event_with_posts(manager)
    legacy = [{**i, "done": True, "result": "NEEDS_CHANGES", "comment": "x"} for i in checklist]
    for row in legacy:
        row.pop("state", None)
    resp = manager.patch(f"{URL}{event_id}/recon/", {"checklist": legacy}, format="json")
    assert resp.status_code == 200, resp.content
    assert all(i["state"] == "REMARK" for i in resp.json()["reconChecklist"])
    assert service.normalize_check_item({"done": True})["state"] == "NORMAL"
    assert service.normalize_check_item({"done": False})["state"] == "UNCHECKED"
    # Старый клиент прислал done поверх UNCHECKED — верим done.
    assert service.normalize_check_item({"state": "UNCHECKED", "done": True})["state"] == "NORMAL"
