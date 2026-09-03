"""Пост расчёта принадлежит объекту посещения (Plane №408, Ш-2 плана №385).

Требование `[РЕК-05]`/`[РЕК-08]`: импорт идёт из паспорта ОБЪЕКТА ПОСЕЩЕНИЯ, а
потребность считается по объекту. Разметка `visitObjectId` в контракте была, но
её никто не проставлял — читатели были, писателей ноль, и потребность объекта у
ОМ с двумя объектами не считалась вовсе.

Пробы стерегут то, что незаметно на глаз:

1. импорт помечает посты объектом — иначе разметки снова не будет ни у кого;
2. при нескольких объектах импорт ОТКАЗЫВАЕТ, а не выбирает первый: приписать
   посты чужому объекту хуже, чем попросить выбрать;
3. один и тот же пост паспорта импортируется ДВАЖДЫ — по разу на объект: это
   два разных поста расчёта, а не дубль;
4. правка расчёта разметку не теряет и чужой объект не принимает;
5. потребность и назначено объекта считаются по разметке.
"""
import pytest

from organization_management.apps.operations.models_event import (
    OpsSecurityEventVisitObject,
)
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.api.serializers import (
    serialize_security_event,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    chief_for,
    give_chief,
    make_employee,
    make_object,
    manager,  # noqa: F401 — фикстура ведущего мероприятие, одна на раздел
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def event_on_recon(manager):
    """ОМ на рекогносцировке с объектом, у которого опубликован паспорт."""
    obj = make_object(with_passport=True)
    created = manager.post(
        "/api/ops/security-events/",
        {
            "title": "Проба разметки постов",
            "objectId": str(obj.pk),
            "businessDate": "2026-08-26",
            "kind": "INTERNAL",
            "chiefEmployeeId": str(chief_for(manager).pk),
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    event_id = created.json()["id"]
    manager.patch(
        f"/api/ops/security-events/{event_id}/bulletin/",
        {"briefDescription": "x", "initialTasks": "—"},
        format="json",
    )
    manager.post(f"/api/ops/security-events/{event_id}/bulletin/complete/")
    return event_id, obj


def posts_of(api, event_id):
    return api.get(f"/api/ops/security-events/{event_id}/").json()[
        "reconSectorPosts"
    ]


def test_import_marks_posts_with_the_single_visit_object(manager, event_on_recon):
    event_id, _ = event_on_recon
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)

    resp = manager.post(
        f"/api/ops/security-events/{event_id}/recon/import-from-passport/"
    )
    assert resp.status_code == 200, resp.content
    posts = posts_of(manager, event_id)
    assert posts, "импорт ничего не принёс — проба вакуумна"
    assert {p["visitObjectId"] for p in posts} == {str(visit.pk)}


def test_import_refuses_to_guess_when_objects_are_many(manager, event_on_recon):
    event_id, _ = event_on_recon
    second = make_object(code="OBJ-SECOND", name="Второй объект", with_passport=True)
    manager.post(
        f"/api/ops/security-events/{event_id}/visit-objects/",
        {"objectId": str(second.pk)},
        format="json",
    )
    give_chief(manager, event_id)

    resp = manager.post(
        f"/api/ops/security-events/{event_id}/recon/import-from-passport/"
    )
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "VISIT_OBJECT_REQUIRED"


def test_same_passport_post_imports_once_per_object(manager, event_on_recon):
    event_id, _ = event_on_recon
    first = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    second_object = make_object(code="OBJ-SECOND", name="Второй объект", with_passport=True)
    added = manager.post(
        f"/api/ops/security-events/{event_id}/visit-objects/",
        {"objectId": str(second_object.pk)},
        format="json",
    )
    give_chief(manager, event_id)
    assert added.status_code in (200, 201), added.content
    second = (
        OpsSecurityEventVisitObject.objects.filter(event_id=event_id)
        .exclude(pk=first.pk)
        .get()
    )

    manager.post(
        f"/api/ops/security-events/{event_id}/recon/import-from-passport/",
        {"visitObjectId": str(first.pk)},
        format="json",
    )
    manager.post(
        f"/api/ops/security-events/{event_id}/recon/import-from-passport/",
        {"visitObjectId": str(second.pk)},
        format="json",
    )

    posts = posts_of(manager, event_id)
    mine = [p for p in posts if p["visitObjectId"] == str(first.pk)]
    theirs = [p for p in posts if p["visitObjectId"] == str(second.pk)]
    assert mine and theirs, "второй объект остался без постов — импорт счёл их дублем"
    assert len(mine) == len(theirs)
    assert len({p["id"] for p in posts}) == len(posts), "идентификаторы постов совпали"


def test_unknown_visit_object_is_refused_on_save(manager, event_on_recon):
    event_id, _ = event_on_recon
    manager.post(
        f"/api/ops/security-events/{event_id}/recon/import-from-passport/"
    )
    posts = posts_of(manager, event_id)
    posts[0]["visitObjectId"] = "999999"

    resp = manager.patch(
        f"/api/ops/security-events/{event_id}/recon/",
        {"checklist": [], "sectorPosts": posts},
        format="json",
    )
    # Ошибки поля раздел отдаёт 400 с `fieldErrors` — своя мерка, не 422.
    assert resp.status_code == 400, resp.content
    body = resp.json()
    assert body["error_code"] == "VALIDATION_ERROR"
    assert "sectorPosts.0.visitObjectId" in body["details"]


def test_saving_recon_keeps_the_marking(manager, event_on_recon):
    event_id, _ = event_on_recon
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    manager.post(
        f"/api/ops/security-events/{event_id}/recon/import-from-passport/"
    )
    posts = posts_of(manager, event_id)

    resp = manager.patch(
        f"/api/ops/security-events/{event_id}/recon/",
        {"checklist": [], "sectorPosts": posts},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    assert {p["visitObjectId"] for p in posts_of(manager, event_id)} == {
        str(visit.pk)
    }


def test_visit_object_need_is_counted_from_the_marking(manager, event_on_recon):
    event_id, _ = event_on_recon
    manager.post(
        f"/api/ops/security-events/{event_id}/recon/import-from-passport/"
    )
    posts = posts_of(manager, event_id)
    posts[0]["need"] = 5
    manager.patch(
        f"/api/ops/security-events/{event_id}/recon/",
        {"checklist": [], "sectorPosts": posts},
        format="json",
    )

    event = service.lock_event(event_id)
    visit_row = serialize_security_event(event)["visitObjects"][0]
    assert visit_row["placementNeed"] == sum(
        int(p["need"]) for p in posts_of(manager, event_id)
    )
    assert visit_row["placementAssigned"] == 0


# ── Разметка задним числом (миграция 0069) ──────────────────────────────────


def test_migration_marks_posts_only_where_the_answer_is_single(manager, event_on_recon):
    """У ОМ с одним объектом посты размечаются, у ОМ с двумя — нет.

    Красная проба к миграции: разметить посты при двух объектах значило бы
    приписать половину чужому объекту, и увидеть это было бы уже нельзя —
    в строке поста источник не записан.
    """
    import importlib

    from django.apps import apps as django_apps

    migration = importlib.import_module(
        "organization_management.apps.operations.migrations."
        "0069_mark_recon_posts_with_visit_object"
    )

    event_id, _ = event_on_recon
    single_visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    manager.post(
        f"/api/ops/security-events/{event_id}/recon/import-from-passport/"
    )
    # Разметку снимаем — изображаем состояние до Plane №408.
    event = service.lock_event(event_id)
    event.recon_sector_posts = [
        {**row, "visitObjectId": None} for row in event.recon_sector_posts
    ]
    event.save(update_fields=["recon_sector_posts", "updated_at"])
    second_object = make_object(code="OBJ-Д", name="Двойной", with_passport=True)

    migration._mark_posts(django_apps, None)

    event = service.lock_event(event_id)
    assert {str(r["visitObjectId"]) for r in event.recon_sector_posts} == {
        str(single_visit.pk)
    }

    # Тот же расчёт, но объектов стало два — разметка не ставится.
    manager.post(
        f"/api/ops/security-events/{event_id}/visit-objects/",
        {"objectId": str(second_object.pk)},
        format="json",
    )
    give_chief(manager, event_id)
    event = service.lock_event(event_id)
    event.recon_sector_posts = [
        {**row, "visitObjectId": None} for row in event.recon_sector_posts
    ]
    event.save(update_fields=["recon_sector_posts", "updated_at"])

    migration._mark_posts(django_apps, None)

    event = service.lock_event(event_id)
    assert {r["visitObjectId"] for r in event.recon_sector_posts} == {None}
