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
    # 🔴 ПИН ПЕРЕВЁРНУТ ОСОЗНАННО (Plane №538). Здесь стояло «старый клиент
    # прислал `done` поверх UNCHECKED — верим `done`», и правило закрепляло
    # ровно тот дефект, из-за которого кнопка «Не проверено» не действовала:
    # текущий экран мержит патч на существующий пункт, поэтому вместе с
    # `state: "UNCHECKED"` наверх всегда уезжает унаследованный `done: true`.
    # Под «старого клиента» правило не работало никогда — тот `state` не
    # присылает вовсе и обслужен веткой ниже.
    assert service.normalize_check_item({"state": "UNCHECKED", "done": True})["state"] == "UNCHECKED"
    # Клиент без `state` по-прежнему читается по старым ключам — эта половина
    # правила и была настоящей.
    assert service.normalize_check_item({"done": True, "result": "MATCHES"})["state"] == "NORMAL"


# ── Ревью 93516781..HEAD: правило держит СЕРВЕР (Plane №538, №541) ──────────


def test_unchecking_a_checked_item_actually_unchecks_it(manager):  # noqa: F811
    """🔴 Plane №538: «Не проверено» поверх «Норма» действует.

    Экран мержит патч НА СУЩЕСТВУЮЩИЙ пункт, поэтому вместе с
    `state: "UNCHECKED"` наверх уезжают унаследованные `done: true` и
    `result: "MATCHES"`. Серверная оговорка «явное UNCHECKED поверх done — не
    верим» писалась под старого клиента, а срабатывала на текущем: состояние
    переписывалось обратно в NORMAL. Человек снимал отметку, а она
    возвращалась сама — без ошибки, без следа; счётчик «Проверено K из N» не
    уменьшался, и `complete_recon` переставал держать этап.

    Мутация, которую стережёт проба: вернуть условие
    `state == "UNCHECKED" and derived != "UNCHECKED"` — пункт снова окажется
    в «Норма», и этап закроется.
    """
    event_id, checklist = _event_with_posts(manager)
    checked = [{**i, "state": "NORMAL"} for i in checklist]
    saved = manager.patch(f"{URL}{event_id}/recon/", {"checklist": checked}, format="json")
    assert saved.status_code == 200, saved.content
    stored = saved.json()["reconChecklist"]

    # Ровно то тело, что шлёт экран: патч поверх сохранённого пункта, где
    # старые ключи остались от прежнего состояния.
    unchecked = [{**stored[0], "state": "UNCHECKED"}] + stored[1:]
    resp = manager.patch(f"{URL}{event_id}/recon/", {"checklist": unchecked}, format="json")

    assert resp.status_code == 200, resp.content
    first = resp.json()["reconChecklist"][0]
    assert first["state"] == "UNCHECKED", "«Не проверено» переписано обратно в «Норма»"
    assert first["done"] is False and first["result"] is None
    # И этап снова держится — счётчик не соврал.
    refused = manager.post(f"{URL}{event_id}/recon/complete/")
    assert refused.status_code == 422
    assert refused.json()["error_code"] == "RECON_CHECKLIST_INCOMPLETE"


def test_the_client_cannot_switch_off_the_required_rule(manager):  # noqa: F811
    """🔴 Plane №541: обязательность пункта шаблона приходит из ШАБЛОНА.

    Признак брался прямо из тела (`bool(item.get("required", True))`), а
    завершение этапа отказывает только из-за обязательных пунктов. Значит
    любой клиент, вернувший чек-лист с `required: false`, снимал правило
    `[РЕК-07]` целиком — и злого умысла для этого не нужно, довольно клиента,
    теряющего поле при сериализации. Проверка, которую можно выключить
    снаружи, проверкой не является.

    Мутация: вернуть `bool(item.get("required", True))` — завершение пройдёт.
    """
    event_id, checklist = _event_with_posts(manager)
    disarmed = [{**i, "state": "UNCHECKED", "required": False} for i in checklist]

    saved = manager.patch(f"{URL}{event_id}/recon/", {"checklist": disarmed}, format="json")

    assert saved.status_code == 200, saved.content
    assert all(i["required"] is True for i in saved.json()["reconChecklist"]), (
        "клиент выключил обязательность пунктов шаблона"
    )
    refused = manager.post(f"{URL}{event_id}/recon/complete/")
    assert refused.status_code == 422
    assert refused.json()["error_code"] == "RECON_CHECKLIST_INCOMPLETE"


def test_an_item_added_by_hand_keeps_its_own_required_flag(manager):  # noqa: F811
    """Дописанный человеком пункт обязательности шаблона НЕ наследует.

    Без этой пробы №541 можно было бы «починить» правилом «обязательны все» —
    и человек, добавивший себе памятку, не смог бы закрыть этап, не отметив
    её. Правило `[РЕК-07]` про пункты ШАБЛОНА, а не про любые строки списка.
    """
    event_id, checklist = _event_with_posts(manager)
    mine = {
        "id": "my-note-1",
        "label": "Своя памятка",
        "state": "UNCHECKED",
        "required": False,
        "comment": "",
    }
    body = [{**i, "state": "NORMAL"} for i in checklist] + [mine]

    saved = manager.patch(f"{URL}{event_id}/recon/", {"checklist": body}, format="json")

    assert saved.status_code == 200, saved.content
    added = next(i for i in saved.json()["reconChecklist"] if i["id"] == "my-note-1")
    assert added["required"] is False
    # Этап закрывается: свой непроверенный пункт завершению не мешает.
    assert manager.post(f"{URL}{event_id}/recon/complete/").status_code == 200


def test_a_checklist_wiped_by_the_client_does_not_unlock_the_stage(manager):  # noqa: F811
    """🔴 ПРАВИЛО ВЫКЛЮЧАЛОСЬ СНАРУЖИ — ПРОПУСКОМ ПУНКТА (Plane №541, найдено
    ревью №825).

    Признак обязательности уже брался из шаблона, но сам ПЕРЕЧЕНЬ приходил
    снаружи: `complete_recon` шёл по `event.recon_checklist`, а его целиком
    заменяет тело `PATCH /recon/`. Значит `{"checklist": []}` снимало
    `[РЕК-07]` полностью — проверять становилось нечего, — и то же давало
    переименование `id` шаблонного пункта. Дыра ровно та, которую карточка и
    называет: правило, которое можно выключить снаружи, правилом не является;
    для этого не нужен злой умысел, довольно клиента, теряющего поле.
    """
    event_id, checklist = _event_with_posts(manager)
    assert checklist, "у мероприятия нет чек-листа — проба стерегла бы не то"

    wiped = manager.patch(f"{URL}{event_id}/recon/", {"checklist": []}, format="json")
    assert wiped.status_code == 200, wiped.content

    refused = manager.post(f"{URL}{event_id}/recon/complete/")
    assert refused.status_code == 422, refused.content
    assert refused.json()["error_code"] == "RECON_CHECKLIST_INCOMPLETE", refused.json()

    # Переименование `id` — тот же обход другим входом.
    renamed = manager.patch(
        f"{URL}{event_id}/recon/",
        {
            "checklist": [
                {**item, "id": f"mine-{index}", "required": False}
                for index, item in enumerate(checklist)
            ]
        },
        format="json",
    )
    assert renamed.status_code == 200, renamed.content
    still_refused = manager.post(f"{URL}{event_id}/recon/complete/")
    assert still_refused.status_code == 422, still_refused.content

    # А честно отмеченный чек-лист этап закрывает — иначе проба стерегла бы
    # «никогда не завершать», а не правило.
    manager.patch(
        f"{URL}{event_id}/recon/",
        {"checklist": [{**i, "state": "NORMAL"} for i in checklist]},
        format="json",
    )
    assert manager.post(f"{URL}{event_id}/recon/complete/").status_code == 200
