"""Без старшего объекта рекогносцировка закрыта (`[РЕК-02]`/`[РЕК-07]`,
Plane №424) и «ключа нет ≠ пусто» для постов (Plane №416).

Правило серверное: импорт постов, сохранение расчёта объекта и «Завершить»
отвечают 422 `VISIT_CHIEF_REQUIRED`, пока у объекта нет старшего. Строки без
`visitObjectId` (заведённые до разметки №408) гард не трогает — иначе их
нельзя было бы отнести к объекту.
"""
import pytest

from organization_management.apps.operations.models_event import (
    OpsSecurityEventVisitObject,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    URL,
    create_event,
    give_chief,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def chiefless_on_recon(manager):  # noqa: F811
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj, chiefEmployeeId=None).json()["id"]
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    assert visit.chief_employee_id is None
    return event_id, visit


def test_import_refused_without_chief(manager, chiefless_on_recon):  # noqa: F811
    event_id, _ = chiefless_on_recon
    resp = manager.post(f"{URL}{event_id}/recon/import-from-passport/")
    assert resp.status_code == 422, resp.content
    assert resp.json()["error_code"] == "VISIT_CHIEF_REQUIRED"
    assert "старшего объекта" in resp.json()["message"]


def test_save_refuses_rows_of_chiefless_object_but_keeps_unassigned(
    manager, chiefless_on_recon  # noqa: F811
):
    event_id, visit = chiefless_on_recon
    row = {"sector": "Периметр", "post": "Пост 1", "task": "Охрана", "need": 1}
    refused = manager.patch(
        f"{URL}{event_id}/recon/",
        {"checklist": [], "sectorPosts": [{**row, "visitObjectId": str(visit.pk)}]},
        format="json",
    )
    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "VISIT_CHIEF_REQUIRED"
    allowed = manager.patch(
        f"{URL}{event_id}/recon/",
        {"checklist": [], "sectorPosts": [row]},
        format="json",
    )
    assert allowed.status_code == 200, allowed.content
    assert len(allowed.json()["reconSectorPosts"]) == 1


def test_complete_refused_without_chief_and_allowed_after(manager, chiefless_on_recon):  # noqa: F811
    event_id, _ = chiefless_on_recon
    manager.patch(
        f"{URL}{event_id}/recon/",
        {
            "checklist": [],
            "sectorPosts": [{"sector": "Периметр", "post": "Пост 1", "task": "Охрана", "need": 1}],
        },
        format="json",
    )
    refused = manager.post(f"{URL}{event_id}/recon/complete/")
    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "VISIT_CHIEF_REQUIRED"
    give_chief(manager, event_id)
    done = manager.post(f"{URL}{event_id}/recon/complete/")
    assert done.status_code == 200, done.content
    assert done.json()["stage"] != "RECON"


def test_patch_without_sector_posts_keeps_posts(manager):  # noqa: F811
    """№416: отметка чек-листа отдельным вызовом не стирает расчёт."""
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    imported = manager.post(f"{URL}{event_id}/recon/import-from-passport/")
    assert imported.status_code == 200, imported.content
    before = imported.json()["reconSectorPosts"]
    assert before, "импорт ничего не принёс — проба вакуумна"
    checklist = [{**item, "done": True} for item in imported.json()["reconChecklist"]]
    resp = manager.patch(f"{URL}{event_id}/recon/", {"checklist": checklist}, format="json")
    assert resp.status_code == 200, resp.content
    assert [r["id"] for r in resp.json()["reconSectorPosts"]] == [r["id"] for r in before]
