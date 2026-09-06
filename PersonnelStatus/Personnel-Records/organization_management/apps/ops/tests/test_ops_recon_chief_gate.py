"""Без старшего объекта рекогносцировка закрыта (`[РЕК-02]`/`[РЕК-07]`,
Plane №424) и «ключа нет ≠ пусто» для постов (Plane №416).

Правило серверное: импорт постов, сохранение расчёта объекта и «Завершить»
отвечают 422 `VISIT_CHIEF_REQUIRED`, пока у объекта нет старшего.

🔴 ИСКЛЮЧЕНИЕ ДЛЯ НЕРАЗМЕЧЕННЫХ СТРОК СУЖЕНО ДО МЕРОПРИЯТИЙ С НЕСКОЛЬКИМИ
ОБЪЕКТАМИ (Plane №862, решение заказчика 06.09.2026). Здесь стояло «строки без
`visitObjectId` гард не трогает» — без оговорки, и это отключало правило
`[РЕК-02]` для ОДИНОЧНЫХ мероприятий целиком: у них неразмеченными заводятся
ВСЕ посты, разметку проставляет только добавление второго объекта. Заморозка
(№535) тот же случай трактует наоборот, и заказчик закрыл расхождение в пользу
старшего: у ОМ с единственным объектом неразмеченная строка — ЕГО строка. При
нескольких объектах отнести её по-прежнему не к чему, и там исключение живо.

Пины ниже переписаны ОСОЗНАННО под это решение, а не подогнаны под новый
вывод: там, где проба стерегла «неразмеченную строку сохраняем без старшего»,
теперь стоит тот же случай на ОМ С ДВУМЯ объектами — то есть ровно то, ради
чего исключение и заводилось (№408/№416).
"""
import pytest

from organization_management.apps.ops import security_events as service
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


def test_save_refuses_rows_of_chiefless_object(manager, chiefless_on_recon):  # noqa: F811
    """Размеченная строка объекта без старшего не сохраняется (`[РЕК-02]`)."""
    event_id, visit = chiefless_on_recon
    row = {"sector": "Периметр", "post": "Пост 1", "task": "Охрана", "need": 1}
    refused = manager.patch(
        f"{URL}{event_id}/recon/",
        {"checklist": [], "sectorPosts": [{**row, "visitObjectId": str(visit.pk)}]},
        format="json",
    )
    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "VISIT_CHIEF_REQUIRED"


def test_unmarked_row_of_a_single_object_event_also_needs_a_chief(
    manager, chiefless_on_recon  # noqa: F811
):
    """У ОМ с ОДНИМ объектом неразмеченная строка — ЕГО строка (Plane №862).

    🔴 ПИН ПЕРЕПИСАН ОСОЗНАННО, решением заказчика 06.09.2026. Здесь стояло
    обратное утверждение: «строка без `visitObjectId` сохраняется без
    старшего». Оно опиралось на довод №408/№416 «такую строку не к чему
    отнести» — верный при НЕСКОЛЬКИХ объектах и неверный при одном: там
    неразмеченными заводятся все посты, и правило `[РЕК-02]` не работало
    вовсе. Заморозка (№535) уже считала такую строку принадлежащей
    единственному объекту, то есть два правила расходились на одних данных.
    """
    event_id, _visit = chiefless_on_recon
    row = {"sector": "Периметр", "post": "Пост 1", "task": "Охрана", "need": 1}

    refused = manager.patch(
        f"{URL}{event_id}/recon/",
        {"checklist": [], "sectorPosts": [row]},
        format="json",
    )

    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "VISIT_CHIEF_REQUIRED"


def test_unmarked_row_stays_nobodys_when_there_are_two_objects(manager):  # noqa: F811
    """При ДВУХ объектах неразмеченная строка по-прежнему ничья (№408/№416).

    Ровно тот случай, ради которого исключение заводилось: отнести строку не к
    чему, и запирать её старшим было бы неверно. Проба держит вторую половину
    решения №862 — сужение исключения, а не его отмену.
    """
    first = make_object(with_passport=True)
    event_id = create_event(manager, first, chiefEmployeeId=None).json()["id"]
    second = make_object(code="OBJ-862-2", name="Второй объект", with_passport=True)
    added = manager.post(
        f"{URL}{event_id}/visit-objects/", {"objectId": str(second.pk)}, format="json"
    )
    assert added.status_code in (200, 201), added.content

    allowed = manager.patch(
        f"{URL}{event_id}/recon/",
        {
            "checklist": [],
            "sectorPosts": [
                {"sector": "Периметр", "post": "Пост 1", "task": "Охрана", "need": 1}
            ],
        },
        format="json",
    )

    assert allowed.status_code == 200, allowed.content
    assert len(allowed.json()["reconSectorPosts"]) == 1


def test_complete_refused_without_chief_and_allowed_after(manager, chiefless_on_recon):  # noqa: F811
    event_id, _ = chiefless_on_recon
    # 🔴 ЧЕК-ЛИСТ ЗАПОЛНЯЕТСЯ, А НЕ СТИРАЕТСЯ (Plane №541, доведено ревью
    # №825). Здесь стояло `"checklist": []`, и проба проходила ровно потому,
    # что пустой список снимал `[РЕК-07]` целиком — то есть опиралась на ту
    # самую дыру, которую №541 и закрывает. Предмет пробы — гард старшего, а
    # не чек-лист, поэтому пункты просто отмечаются проверенными.
    card = manager.get(f"{URL}{event_id}/").json()
    checked = [{**item, "state": "NORMAL"} for item in card["reconChecklist"]]
    assert checked, "у мероприятия нет чек-листа — проба стерегла бы не то"
    # 🔴 ЧЕК-ЛИСТ СОХРАНЯЕТСЯ БЕЗ ПОСТОВ (Plane №862). Прежде тот же вызов нёс
    # и новый пост, и после сужения исключения (неразмеченная строка у ОМ с
    # одним объектом — его строка) он стал отбиваться гардом старшего: пункты
    # не сохранялись, а «Завершить» падал уже на неполном чек-листе — то есть
    # проба краснела не тем, что стережёт. Пункты отмечаются отдельным
    # запросом, а посты этому предмету не нужны вовсе.
    saved = manager.patch(
        f"{URL}{event_id}/recon/",
        {"checklist": checked},
        format="json",
    )
    assert saved.status_code == 200, saved.content
    refused = manager.post(f"{URL}{event_id}/recon/complete/")
    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "VISIT_CHIEF_REQUIRED"
    give_chief(manager, event_id)
    # Посты добавляются ПОСЛЕ старшего — теперь это единственный законный
    # порядок для ОМ с одним объектом (Plane №862), и он же проверяет вторую
    # половину правила: со старшим та же правка проходит.
    with_posts = manager.patch(
        f"{URL}{event_id}/recon/",
        {
            "checklist": checked,
            "sectorPosts": [
                {"sector": "Периметр", "post": "Пост 1", "task": "Охрана", "need": 1}
            ],
        },
        format="json",
    )
    assert with_posts.status_code == 200, with_posts.content
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
    checklist = [{**item, "state": "NORMAL"} for item in imported.json()["reconChecklist"]]
    resp = manager.patch(f"{URL}{event_id}/recon/", {"checklist": checklist}, format="json")
    assert resp.status_code == 200, resp.content
    assert [r["id"] for r in resp.json()["reconSectorPosts"]] == [r["id"] for r in before]


# ── Ревью 1efd9fdf: гард держит ИЗМЕНЁННОЕ, а не упомянутое (Plane №634) ────


def _two_objects_one_chiefless(manager):  # noqa: F811
    """ОМ с двумя объектами: у первого старший есть, у второго нет, и у
    ОБОИХ уже сохранены посты."""
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    first = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    assert first.chief_employee_id is not None
    second = OpsSecurityEventVisitObject.objects.create(
        event=first.event,
        security_object=make_object(code="OBJ-REC-2", name="Второй объект"),
        object_name="Второй объект",
        passport_binding=None,
        position=(first.position or 0) + 1,
        stage=first.stage,
    )
    assert second.chief_employee_id is None
    # Посты обоим — напрямую, минуя гард: предмет пробы не заведение расчёта, а
    # то, что с ним делает СЛЕДУЮЩИЙ запрос.
    first.event.recon_sector_posts = [
        {
            "id": "post-1", "sector": "Периметр", "post": "Пост 1",
            "task": "Охрана", "need": 1, "shift": "", "requirements": "",
            "comment": "", "visitObjectId": str(first.pk),
        },
        {
            "id": "post-2", "sector": "Периметр", "post": "Пост 2",
            "task": "Охрана", "need": 1, "shift": "", "requirements": "",
            "comment": "", "visitObjectId": str(second.pk),
        },
    ]
    first.event.save(update_fields=["recon_sector_posts", "updated_at"])
    return event_id, first, second


def test_a_chiefless_neighbour_does_not_block_the_checklist(manager):  # noqa: F811
    """🔴 Plane №634: один объект без старшего не запирает ВСЁ мероприятие.

    Гард смотрел на объекты, НАЗВАННЫЕ в присланных постах, — а посты
    присылаются целиком, и при отметке одного пункта чек-листа список
    подставляется из хранимого (запасной путь №416). Значит объект без
    старшего делал несохраняемой рекогносцировку целиком: и чужие посты, и
    даже галочку в чек-листе, к постам не относящуюся.

    Мутация: вернуть `touched` по присланным строкам — этот PATCH отобьётся
    `VISIT_CHIEF_REQUIRED`.
    """
    event_id, _first, _second = _two_objects_one_chiefless(manager)
    checklist = manager.get(f"{URL}{event_id}/").json()["reconChecklist"]

    resp = manager.patch(
        f"{URL}{event_id}/recon/",
        {"checklist": [{**i, "state": "NORMAL"} for i in checklist]},
        format="json",
    )

    assert resp.status_code == 200, resp.content
    assert all(i["state"] == "NORMAL" for i in resp.json()["reconChecklist"])


def test_editing_posts_of_the_object_that_HAS_a_chief_still_passes(manager):  # noqa: F811
    """Правка расчёта объекта СО СТАРШИМ проходит, хотя сосед без старшего.

    Та же беда с другого конца: гард обязан держать объект, чьи посты правят,
    и не держать соседний.

    Мутация та же — по присланным строкам этот PATCH тоже отобьётся.
    """
    event_id, first, second = _two_objects_one_chiefless(manager)
    posts = manager.get(f"{URL}{event_id}/").json()["reconSectorPosts"]
    changed = [
        {**row, "task": "Охрана и пропуск"} if row["visitObjectId"] == str(first.pk) else row
        for row in posts
    ]

    resp = manager.patch(
        f"{URL}{event_id}/recon/", {"sectorPosts": changed}, format="json"
    )

    assert resp.status_code == 200, resp.content
    mine = next(
        r for r in resp.json()["reconSectorPosts"] if r["visitObjectId"] == str(first.pk)
    )
    assert mine["task"] == "Охрана и пропуск"
    assert second.chief_employee_id is None


def test_editing_posts_of_the_chiefless_object_is_still_refused(manager):  # noqa: F811
    """А вот его СОБСТВЕННЫЙ расчёт по-прежнему закрыт — правило №424 живо.

    Без этой пробы №634 можно было бы «починить», сняв гард вовсе.
    """
    event_id, _first, second = _two_objects_one_chiefless(manager)
    posts = manager.get(f"{URL}{event_id}/").json()["reconSectorPosts"]
    changed = [
        {**row, "task": "Правка чужого"} if row["visitObjectId"] == str(second.pk) else row
        for row in posts
    ]

    refused = manager.patch(
        f"{URL}{event_id}/recon/", {"sectorPosts": changed}, format="json"
    )

    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "VISIT_CHIEF_REQUIRED"


def test_completion_still_demands_a_chief_for_every_object(manager):  # noqa: F811
    """`complete_recon` требует старшего у КАЖДОГО объекта на этапе — правка
    №634 касается только сохранения, а не завершения.

    Это же и есть то, что чинит фронтовая половина band-а (№635): кнопка
    смотрела на показанный объект, сервер — на все.
    """
    event_id, _first, _second = _two_objects_one_chiefless(manager)
    checklist = manager.get(f"{URL}{event_id}/").json()["reconChecklist"]
    manager.patch(
        f"{URL}{event_id}/recon/",
        {"checklist": [{**i, "state": "NORMAL"} for i in checklist]},
        format="json",
    )

    refused = manager.post(f"{URL}{event_id}/recon/complete/")

    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "VISIT_CHIEF_REQUIRED"


def test_the_guard_sees_a_change_in_any_field_of_the_post(
    manager, chiefless_on_recon  # noqa: F811
):
    """🔴 ГАРД СЧИТАЛ ВОСЕМЬ ПОЛЕЙ ИЗ СЕМНАДЦАТИ (Plane №634, найдено ревью
    №825).

    «Тронут» определялось отпечатком по белому списку — `id`, `sector`,
    `post`, `task`, `need`, `shift`, `requirements`, `comment`. Вне списка
    оставались `postType`, `weapon`, `uniform`, `minRating`, `parentPostId` и
    `result`, а первые четыре правятся прямо на экране рекогносцировки. Значит
    правка ТОЛЬКО этих полей у поста объекта без старшего отпечатка не меняла,
    гард не срабатывал — и посты объекта правились без его старшего, против
    правила `[РЕК-02]`/№424 «посты объекта пишет его старший».

    Список был ещё и закрытым, а сервер пропускает незнакомые ключи как есть:
    каждая новая колонка расчёта попадала бы в ту же щель молча.
    """
    event_id, visit = chiefless_on_recon
    row = {
        "id": "post-guard-1",
        "sector": "Периметр",
        "post": "Пост 1",
        "task": "Охрана",
        "need": 1,
        "minRating": None,
        "weapon": "",
    }
    # Заводим пост объекту в обход гарда — предмет пробы следующий запрос.
    event = service.lock_event(event_id)
    event.recon_sector_posts = [{**row, "visitObjectId": str(visit.pk)}]
    event.save(update_fields=["recon_sector_posts", "updated_at"])

    for field, value in (("minRating", 5), ("weapon", "АКС-74У"), ("uniform", "Летняя")):
        refused = manager.patch(
            f"{URL}{event_id}/recon/",
            {
                "checklist": [],
                "sectorPosts": [
                    {**row, field: value, "visitObjectId": str(visit.pk)}
                ],
            },
            format="json",
        )
        assert refused.status_code == 422, (field, refused.content)
        assert refused.json()["error_code"] == "VISIT_CHIEF_REQUIRED", field

    # А сохранение БЕЗ изменений проходит: гард держит правку, а не всякое
    # касание (иначе вернулась бы болезнь №634 — «один объект запирает всё»).
    same = manager.patch(
        f"{URL}{event_id}/recon/",
        {"checklist": [], "sectorPosts": [{**row, "visitObjectId": str(visit.pk)}]},
        format="json",
    )
    assert same.status_code == 200, same.content
