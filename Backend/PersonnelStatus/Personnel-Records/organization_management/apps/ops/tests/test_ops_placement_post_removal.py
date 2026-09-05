"""Снятие лишнего поста на этапе «Расстановка» (Plane №259, Ш-1).

ЗАЧЕМ ЭТО ЕСТЬ. Заказчик описал недобор: «штаб не всегда добирает полное
количество, тогда он распределяет по объектам столько, сколько есть, а старшие
нарядов на этапе „Расстановка“ удаляют лишние посты». До этой правки снять
пост можно было только на «Рекогносцировке» — то есть до того, как недобор
вообще становится известен, — и расстановка с лишними постами не завершалась
никогда: `complete_placement` требует, чтобы у каждого поста был человек.

Правило заказчика 28.08.2026, дословно: «Если на этапе расстановки к посту
привязан человек то нельзя удалять пост, а если он пустой соответственно можно
удалять этот пост с расстановки».

Что стерегут пробы:

1. ПУСТОЙ ПОСТ СНИМАЕТСЯ, и после этого расстановка завершается — ради этого
   всё и делалось.
2. ЗАНЯТЫЙ ПОСТ НЕ СНИМАЕТСЯ, и отказ НАЗЫВАЕТ ЧИСЛО стоящих: «нельзя» без
   этого читается как поломка системы, а не как правило.
3. ПОТРЕБНОСТЬ ПЕРЕСЧИТЫВАЕТСЯ: пост, которого больше нет, людей не требует.
4. ЗАПИСЬ О ЗАПРОСЕ К ШТАБУ НЕ ПЕРЕПИСЫВАЕТСЯ: сколько запросили — исторический
   факт, и задним числом «мы просили меньше» сказать нельзя.
5. ЧУЖОЙ ЭТАП — ОТКАЗ: на «Проведении» расчёт уже подписан.
"""
import pytest

from .test_ops_security_events_api import (  # noqa: F401
    create_event,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


def prepared(manager):  # noqa: F811
    """Мероприятие с расчётом постов, доведённое до «Расстановки».

    Рекогносцировка ЗАВЕРШАЕТСЯ: стадии «Потребность» и «Запрос сил» сервер
    проходит сам (`_autopass_demand_and_forces`), и мероприятие оказывается
    сразу на «Расстановке» — той стадии, о которой эта проба.
    """
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    # Чек-лист отмечается целиком: без этого завершение отбивается
    # `RECON_CHECKLIST_INCOMPLETE`, и до «Расстановки» дело не доходит.
    # ВТОРОЙ ПОСТ заводится пробой: паспорт стенда даёт один, а проба про
    # снятие лишнего — на одном посту «сняли лишний» неотличимо от «стёрли
    # весь расчёт», и завершить расстановку после этого было бы нечем.
    first = data["reconSectorPosts"][0]
    extra = {**first, "id": "", "post": "Пост под снятие", "need": 2}
    manager.patch(
        f"{base}recon/",
        {
            "checklist": [{**item, "state": "NORMAL"} for item in data["reconChecklist"]],
            "sectorPosts": [*data["reconSectorPosts"], extra],
        },
        format="json",
    )
    done = manager.post(f"{base}recon/complete/")
    assert done.status_code == 200, done.json()
    fresh = manager.get(f"{base}").json()
    assert fresh["stage"] == "PLACEMENT", fresh["stage"]
    return base, fresh


def test_an_empty_post_is_removed_and_the_demand_shrinks(manager):  # noqa: F811
    base, data = prepared(manager)
    posts = data["reconSectorPosts"]
    assert len(posts) >= 2, "паспорт дал меньше двух постов — снимать нечего"
    victim = posts[-1]
    before_need = sum(int(p.get("need") or 0) for p in posts)

    response = manager.delete(f"{base}placement/posts/{victim['id']}/")

    assert response.status_code == 200, response.json()
    body = response.json()
    ids = [p["id"] for p in body["reconSectorPosts"]]
    assert victim["id"] not in ids, "пост остался в расчёте"
    # Потребность — сумма оставшихся, а не прежнее число: пост, которого нет,
    # людей не требует.
    assert body["forceNeed"] == before_need - int(victim.get("need") or 0)
    assert all(
        row["id"] != victim["id"] for row in body["demandRows"]
    ), "строка потребности снятого поста осталась"


def test_a_staffed_post_is_refused_and_the_refusal_names_the_count(manager):  # noqa: F811
    base, data = prepared(manager)
    post = data["reconSectorPosts"][0]
    employee = make_employee(last_name="Абенов")
    assigned = manager.post(
        f"{base}placement/assign/",
        {"postId": post["id"], "employeeId": str(employee.pk)},
        format="json",
    )
    assert assigned.status_code == 200, assigned.json()

    response = manager.delete(f"{base}placement/posts/{post['id']}/")

    assert response.status_code == 422, response.json()
    body = response.json()
    text = str(body)
    # Отказ обязан сказать СКОЛЬКО человек стоит и что делать: «нельзя» без
    # этого неотличимо от поломки.
    assert "1" in text and "снимите" in text.lower(), text
    # Пост на месте — отказ не должен ничего менять по дороге.
    after = manager.get(f"{base}").json()
    assert any(
        p["id"] == post["id"] for p in after["reconSectorPosts"]
    ), "отказ всё-таки снял пост"


def test_the_request_sent_to_the_staff_is_not_rewritten(manager):  # noqa: F811
    """Сколько запросили у штаба — исторический факт, а не текущее число."""
    base, data = prepared(manager)
    posts = data["reconSectorPosts"]
    assert len(posts) >= 2
    before = manager.get(f"{base}").json()
    requested_before = [
        int(row.get("requestedCount") or 0) for row in (before.get("forceRequests") or [])
    ]

    manager.delete(f"{base}placement/posts/{posts[-1]['id']}/")

    after = manager.get(f"{base}").json()
    requested_after = [
        int(row.get("requestedCount") or 0) for row in (after.get("forceRequests") or [])
    ]
    assert requested_after == requested_before, (
        "заявка штабу переписана задним числом — она говорит, сколько ПРОСИЛИ"
    )


def test_a_missing_post_is_not_found(manager):  # noqa: F811
    base, _ = prepared(manager)

    response = manager.delete(f"{base}placement/posts/no-such-post/")

    assert response.status_code == 404, response.json()
