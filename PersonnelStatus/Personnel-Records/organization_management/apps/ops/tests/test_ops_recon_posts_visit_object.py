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


# ── Снимок потребности и разметка (Plane №414) ──────────────────────────────
#
# `placementNeed`/`placementAssigned` в строке ОБЪЕКТА считаются на чтении, а
# `force_need`/`force_assigned` — СНИМКИ в строке объекта, и из них
# `recompute_event_stage` складывает потребность МЕРОПРИЯТИЯ (`forceNeed`).
# Два ответа на один вопрос расходятся ровно там, где меняется ПРИНАДЛЕЖНОСТЬ
# постов, а сами посты не трогали: неразмеченная строка принадлежит
# ЕДИНСТВЕННОМУ объекту и НИКОМУ — как только объектов стало двое
# (`visit_object_posts`). Добавление и снятие объекта — единственные две
# операции, которые меняют это число, ничего не написав в расчёт.


def _save_unmarked_posts(api, event_id, needs):
    """Сохранить расчёт БЕЗ разметки по объектам — так его ведут, пока объект один."""
    resp = api.patch(
        f"/api/ops/security-events/{event_id}/recon/",
        {
            "checklist": [],
            "sectorPosts": [
                {
                    "sector": f"Сектор {index}",
                    "post": f"Пост {index}",
                    "task": "",
                    "need": need,
                    "shift": "",
                    "requirements": "",
                    "comment": "",
                }
                for index, need in enumerate(needs, start=1)
            ],
        },
        format="json",
    )
    assert resp.status_code == 200, resp.content
    return resp


def test_adding_a_second_object_pins_the_posts_instead_of_orphaning_them(
    manager, event_on_recon
):
    """Второй объект НЕ отбирает у первого посты: разметка закрепляется заранее.

    🔴 ПРОБА ПЕРЕВЁРНУТА ОСОЗНАННО (Plane №490, поверх №414 и №476). Здесь
    стояло «второй объект отбирает у первого неразмеченные посты — снимок
    обязан это увидеть», и снимок ждали нулевым: неразмеченный пост при двух
    объектах не принадлежит никому, значит у первого не остаётся ничего.

    Это верно как ПРАВИЛО, но как ПОВЕДЕНИЕ оно запирало мероприятие
    насмерть. ОМ с одним объектом и неразмеченными постами, отправленный на
    согласование, записывает снимок по ВСЕМ постам. Добавляют второй объект —
    подпись расстановки первого становится пустой, `approval_is_stale`
    навсегда истинна, согласование отбивается `APPROVAL_STALE`, а повторная
    отправка — `PLACEMENT_EMPTY`. Ни согласовать, ни переотправить; а
    мероприятие ждёт согласования ВСЕХ объектов, то есть не уходит с этапа
    никогда. Тем же переключением молча пустеет печатный документ.

    Поэтому `add_visit_object` теперь ЗАКРЕПЛЯЕТ разметку до появления
    второго объекта — тем объектом, которому посты и так принадлежали секунду
    назад по тому же правилу. Факт не выдуман: он просто перестаёт быть
    выводимым, и его записывают.

    Предмет пробы остался прежним — снимок объекта после добавления соседа, —
    изменился ожидаемый ответ. Ничьих постов после этой операции не остаётся
    вовсе, поэтому и «потребность мероприятия из неразмеченных» (№476) здесь
    больше не проверяется: проверять нечего, и соседняя проба на снятии
    объекта эту ветку держит.
    """
    event_id, _ = event_on_recon
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    _save_unmarked_posts(manager, event_id, [4, 8])

    visit.refresh_from_db()
    assert (visit.force_need, visit.force_assigned) == (12, 0), (
        "единственный объект должен был унести весь расчёт — проба вакуумна"
    )

    second = make_object(code="OBJ-SECOND", name="Второй объект")
    added = manager.post(
        f"/api/ops/security-events/{event_id}/visit-objects/",
        {"objectId": str(second.pk)},
        format="json",
    )
    assert added.status_code in (200, 201), added.content

    visit.refresh_from_db()
    assert (visit.force_need, visit.force_assigned) == (12, 0), (
        "первый объект потерял свой расчёт от появления соседа — а расстановку "
        "и согласование ему делать по нему же"
    )

    event = service.recompute_event_stage(service.lock_event(event_id))
    assert event.force_need == 12, "потребность мероприятия не должна меняться"
    # Ничьих постов не осталось: именно поэтому первый объект и не потерял
    # ничего. Второй начинает с нуля — ему расчёт ещё не размечали.
    assert all(
        str(p.get("visitObjectId") or "") != "" for p in event.recon_sector_posts
    ), "остались ничьи посты — запирание вернётся"
    fresh_second = (
        OpsSecurityEventVisitObject.objects.filter(event_id=event_id)
        .exclude(pk=visit.pk)
        .get()
    )
    assert (fresh_second.force_need, fresh_second.force_assigned) == (0, 0)


def test_removing_the_second_object_refreshes_the_need_snapshot(manager, event_on_recon):
    """Снятие второго объекта возвращает первому неразмеченные посты.

    Обратная сторона той же дыры: объект снова стал единственным, расчёт снова
    его — но снимок остался нулевым, и мероприятие показывало потребность 0
    при непустом расчёте.
    """
    event_id, _ = event_on_recon
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    second = make_object(code="OBJ-SECOND", name="Второй объект")
    added = manager.post(
        f"/api/ops/security-events/{event_id}/visit-objects/",
        {"objectId": str(second.pk)},
        format="json",
    )
    assert added.status_code in (200, 201), added.content
    second_visit = (
        OpsSecurityEventVisitObject.objects.filter(event_id=event_id)
        .exclude(pk=visit.pk)
        .get()
    )
    _save_unmarked_posts(manager, event_id, [3, 7])

    visit.refresh_from_db()
    assert (visit.force_need, visit.force_assigned) == (0, 0), (
        "при двух объектах неразмеченные посты ничьи — проба вакуумна"
    )

    removed = manager.delete(
        f"/api/ops/security-events/{event_id}/visit-objects/{second_visit.pk}/"
    )
    assert removed.status_code in (200, 204), removed.content

    visit.refresh_from_db()
    assert (visit.force_need, visit.force_assigned) == (10, 0), (
        "объект снова единственный — весь расчёт его, а снимок это проспал"
    )


def test_migration_0090_brings_stale_snapshots_back_to_the_calculation(
    manager, event_on_recon
):
    """Строки, разошедшиеся ДО правки, чинит миграция.

    Красная проба к бэкфиллу: объект заводится в обход сервиса (так его
    заводили, пока `add_visit_object` не пересчитывал снимок), поэтому снимок
    первого объекта остаётся от времён, когда он был единственным. Без
    миграции такая строка врала бы вечно — её снимок никто больше не тронет,
    пока кто-нибудь не отредактирует расчёт.
    """
    import importlib

    from django.apps import apps as django_apps

    migration = importlib.import_module(
        "organization_management.apps.operations.migrations."
        "0090_refresh_visit_need_snapshots"
    )

    event_id, _ = event_on_recon
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    _save_unmarked_posts(manager, event_id, [5, 7])
    visit.refresh_from_db()
    assert visit.force_need == 12, "проба вакуумна — снимок не заполнился"

    # В ОБХОД сервиса: снимок остаётся прежним, как у строк до Plane №414.
    second_object = make_object(code="OBJ-СТАРЫЙ", name="Заведён в обход")
    OpsSecurityEventVisitObject.objects.create(
        event_id=event_id,
        security_object=second_object,
        object_name=second_object.name,
        position=visit.position + 1,
        stage=visit.stage,
    )
    visit.refresh_from_db()
    assert visit.force_need == 12, "объект в обход сервиса не должен был чинить снимок"

    migration._refresh_snapshots(django_apps, None)

    visit.refresh_from_db()
    assert (visit.force_need, visit.force_assigned) == (0, 0), (
        "миграция не привела снимок к расчёту"
    )


# ── Потребность МЕРОПРИЯТИЯ при неразмеченном расчёте (Plane №476) ──────────


def test_event_need_survives_unmarked_posts_at_two_objects(manager, event_on_recon):
    """Потребность мероприятия не обнуляется от того, что посты ничьи.

    Разрез `visit_object_posts` отдаёт неразмеченный пост ЕДИНСТВЕННОМУ
    объекту и НИКОМУ, как только объектов стало двое. Для потребности ОБЪЕКТА
    это правильно — приписать чужое значило бы выдумать факт. Но потребность
    МЕРОПРИЯТИЯ складывалась из одних объектных снимков, и у ОМ с двумя
    объектами и неразмеченным расчётом она молча падала в ноль: штаб собирал
    людей по числу, которого нет, без отказа и без записи в журнал.

    Красная проба к `recompute_event_stage`: до правки — 0 вместо 12.
    """
    event_id, _ = event_on_recon
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    second_object = make_object(code="OBJ-SECOND", name="Второй объект")
    added = manager.post(
        f"/api/ops/security-events/{event_id}/visit-objects/",
        {"objectId": str(second_object.pk)},
        format="json",
    )
    assert added.status_code in (200, 201), added.content
    give_chief(manager, event_id)
    _save_unmarked_posts(manager, event_id, [4, 8])

    event = service.lock_event(event_id)
    assert [int(v.force_need or 0) for v in event.visit_objects.all()] == [0, 0], (
        "неразмеченные посты при двух объектах не принадлежат никому — "
        "проба вакуумна, если объектам что-то насчиталось"
    )

    service.recompute_event_stage(event)
    event.refresh_from_db()
    assert event.force_need == 12, (
        "потребность мероприятия обнулилась молча: расчёт на 12 человек цел, "
        "а штабу показывают ноль"
    )
    assert visit.pk is not None


def test_event_need_counts_unmarked_posts_beside_marked_ones(manager, event_on_recon):
    """Размечена ЧАСТЬ постов — мероприятию считаются и они, и остальные.

    Половинчатая разметка не должна прятать людей: пост, не отнесённый к
    объекту, всё равно требует наряда, и мероприятие просит на него людей.
    Двойного счёта при этом нет — у единственного объекта неразмеченные посты
    уже сидят в его снимке, и складывать их второй раз нельзя.
    """
    event_id, _ = event_on_recon
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    second_object = make_object(code="OBJ-SECOND", name="Второй объект")
    manager.post(
        f"/api/ops/security-events/{event_id}/visit-objects/",
        {"objectId": str(second_object.pk)},
        format="json",
    )
    give_chief(manager, event_id)
    resp = manager.patch(
        f"/api/ops/security-events/{event_id}/recon/",
        {
            "checklist": [],
            "sectorPosts": [
                {
                    "sector": "Сектор 1",
                    "post": "Мой пост",
                    "task": "",
                    "need": 5,
                    "shift": "",
                    "requirements": "",
                    "comment": "",
                    "visitObjectId": str(visit.pk),
                },
                {
                    "sector": "Сектор 2",
                    "post": "Ничей пост",
                    "task": "",
                    "need": 7,
                    "shift": "",
                    "requirements": "",
                    "comment": "",
                },
            ],
        },
        format="json",
    )
    assert resp.status_code == 200, resp.content

    event = service.recompute_event_stage(service.lock_event(event_id))
    event.refresh_from_db()
    assert event.force_need == 12, (
        "мероприятие просит только за размеченный пост — ничей потерялся"
    )


# ── Тот же вопрос, но на пути АВТОПРОХОДА (Plane №743) ──────────────────────
#
# 🔴 ОБЕ ПРОБЫ №476 ВЫШЕ ЗОВУТ `recompute_event_stage` НАПРЯМУЮ — и потому
# остались зелёными, когда починка оказалась неполной. По-настоящему первым
# отрабатывает ДРУГОЙ путь: завершение рекогносцировки считает потребность
# само (`_autopass_demand_and_forces`), и его формула осталась прежней.
# Проба идёт ручкой, как ходит человек, а не мимо неё.


def _complete_recon_with(api, event_id, visit, marked_need, unmarked_need):
    """Завершить рекогносцировку у ОМ с ДВУМЯ объектами и частичной разметкой.

    Один пост отнесён к объекту, второй ничей — при двух объектах он не
    принадлежит никому, и ровно на нём формулы расходятся.
    """
    saved = api.patch(
        f"/api/ops/security-events/{event_id}/recon/",
        {
            # Чек-лист отмечается, а не стирается (Plane №541, доведено ревью
            # №825): пустой список снимал `[РЕК-07]` целиком, и помощник
            # опирался на эту дыру, чтобы закрыть этап.
            "checklist": [
                {**item, "state": "NORMAL"}
                for item in api.get(
                    f"/api/ops/security-events/{event_id}/"
                ).json()["reconChecklist"]
            ],
            "sectorPosts": [
                {
                    "sector": "Сектор 1",
                    "post": "Мой пост",
                    "task": "",
                    "need": marked_need,
                    "shift": "",
                    "requirements": "",
                    "comment": "",
                    "visitObjectId": str(visit.pk),
                },
                {
                    "sector": "Сектор 2",
                    "post": "Ничей пост",
                    "task": "",
                    "need": unmarked_need,
                    "shift": "",
                    "requirements": "",
                    "comment": "",
                },
            ],
        },
        format="json",
    )
    assert saved.status_code == 200, saved.content
    done = api.post(f"/api/ops/security-events/{event_id}/recon/complete/")
    assert done.status_code == 200, done.content
    return done


@pytest.fixture
def event_with_two_objects(manager, event_on_recon):
    """ОМ на рекогносцировке, у которого объектов посещения два."""
    event_id, _ = event_on_recon
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    second_object = make_object(code="OBJ-SECOND", name="Второй объект")
    added = manager.post(
        f"/api/ops/security-events/{event_id}/visit-objects/",
        {"objectId": str(second_object.pk)},
        format="json",
    )
    assert added.status_code in (200, 201), added.content
    give_chief(manager, event_id)
    return event_id, visit


def test_autopass_counts_unmarked_posts_at_partial_marking(
    manager, event_with_two_objects
):
    """Автопроход просит людей на ВЕСЬ расчёт, а не на размеченную его часть.

    Красная проба к `_autopass_demand_and_forces`: до правки — 5 вместо 12.
    Запасная ветка через `or` спасала только ПОЛНОСТЬЮ неразмеченный случай
    (`0 or 12` → 12); при частичной разметке она коротила на истинной частичной
    сумме, и неразмеченный пост выпадал — ровно тот дефект, ради которого
    заведена №476, на пути, который отрабатывает ПЕРВЫМ.
    """
    event_id, visit = event_with_two_objects

    _complete_recon_with(manager, event_id, visit, marked_need=5, unmarked_need=7)

    event = service.lock_event(event_id)
    assert event.force_need == 12, (
        "автопроход потерял неразмеченный пост: штабу уходит 5 вместо 12"
    )


def test_autopass_agrees_with_the_recompute_that_follows_it(
    manager, event_with_two_objects
):
    """Два ответа на «сколько людей просим» обязаны совпасть.

    Дефект был виден не отказом, а ПРЫЖКОМ ЧИСЛА: колонка реестра
    «Потребность» показывала 5 от завершения рекогносцировки до первого
    перехода стадии, а затем сама менялась на 12 — без записи в журнал и без
    действия человека. Проба держит именно совпадение, а не оба числа порознь:
    разойтись они не имеют права ни на каком значении.
    """
    event_id, visit = event_with_two_objects

    _complete_recon_with(manager, event_id, visit, marked_need=5, unmarked_need=7)

    after_autopass = service.lock_event(event_id).force_need
    event = service.recompute_event_stage(service.lock_event(event_id))
    event.refresh_from_db()

    assert after_autopass == event.force_need, (
        "потребность прыгнула при первом же переходе стадии: "
        f"{after_autopass} → {event.force_need}"
    )


def test_the_auto_force_request_asks_for_the_whole_calculation(
    manager, event_with_two_objects
):
    """Число в автозаявке — то же, что в потребности, и оно не устаревает.

    `requestedCount` пишется ОДИН раз и больше не пересобирается, а
    `_sync_auto_force_request` читает его как цель: с заниженной пятёркой
    заявка переходила в «Выделено» после пяти человек, тогда как потребность
    и строки расчёта говорили, что нужно двенадцать. То же заниженное число
    уезжало в реестр сбора сил (`forces_ledger`) и в аналитику.
    """
    event_id, visit = event_with_two_objects

    _complete_recon_with(manager, event_id, visit, marked_need=5, unmarked_need=7)

    event = service.lock_event(event_id)
    assert [row["requestedCount"] for row in event.force_requests] == [12], (
        "автозаявка просит меньше, чем потребность мероприятия"
    )
    assert event.recon_force_request == 12, (
        "число, ушедшее штабу при завершении осмотра, разошлось с потребностью"
    )
