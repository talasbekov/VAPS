"""«Сколько людей просит МЕРОПРИЯТИЕ» — один ответ на всех (Plane №759).

🔴 ЧТО СТЕРЕЖЁТ ЭТА ПРОБА. На вопрос отвечали ТРИ места, и расходились они
ровно на одном виде строки — посте, чей объект посещения СНЯЛИ с мероприятия.
`event_force_need` отбирала добавку по «`visitObjectId` пуст», а такой пост не
пуст и при этом ничей: `visit_object_posts` его не отдаёт никому, и из числа
он выпадал совсем. `remove_post` же считает по ВСЕМ оставшимся постам и его
учитывает. Потребность падала при переходе стадии и возвращалась при снятии
любого другого поста — само, без действия человека и без строки в журнале.

Это та же болезнь, ради которой заведены №476 и №743: молчаливо меняющееся
число, по которому штаб собирает людей.
"""
import pytest

from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    URL,
    approver,
    make_employee,
    make_object,
    manager,
)
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    two_objects_on_approval,
)
from organization_management.apps.ops.tests.test_ops_visit_object_close import (  # noqa: F401
    actor,
    two_objects_on_conduct,
)

pytestmark = pytest.mark.django_db


def test_a_post_of_a_removed_object_still_counts_for_the_event(
    manager, two_objects_on_conduct  # noqa: F811
):
    """Пост, чей объект сняли, считается МЕРОПРИЯТИЮ, а не пропадает.

    🔴 Мутация, которую это стережёт: вернуть отбор «`visitObjectId` пуст».
    Тогда число мероприятия теряет `need` такого поста — и возвращает его при
    следующем снятии любого другого поста.
    """
    _, event_id, first, _second = two_objects_on_conduct
    event = service.lock_event(event_id)
    posts = service.visit_object_posts(event, first)
    assert posts, "фикстура обязана дать первому объекту хоть один пост"
    orphaned_need = sum(int(p.get("need") or 0) for p in posts)
    assert orphaned_need > 0, "у поста должна быть ненулевая потребность"

    # ТРЕТИЙ объект нужен, чтобы после снятия первого живых осталось ДВА:
    # при одном объекте формула не берёт добавку вовсе — неразмеченные посты
    # и так сидят в его снимке, и предмета пробы не существует.
    from organization_management.apps.operations.models_event import (
        OpsSecurityEventVisitObject,
    )

    third_object = make_object(code="OBJ-NEED-3", name="Третий объект")
    OpsSecurityEventVisitObject.objects.create(
        event_id=event_id,
        security_object=third_object,
        object_name=third_object.name,
        passport_binding=None,
        position=2,
    )

    # Объект СНИМАЕТСЯ, посты остаются — ровно то состояние из карточки.
    first_id = str(first.pk)
    first.delete()
    event = service.lock_event(event_id)
    assert any(
        str(p.get("visitObjectId") or "") == first_id
        for p in (event.recon_sector_posts or [])
    ), "посты снятого объекта обязаны остаться со своей разметкой"

    survivors = list(event.visit_objects.all())
    assert len(survivors) >= 2, (
        "у мероприятия должно остаться минимум два живых объекта: при одном "
        "неразмеченные посты и так попадают в его снимок, и предмет пробы "
        "исчезает"
    )
    expected = sum(int(v.force_need or 0) for v in survivors) + orphaned_need

    # 🔴 ЧИСЛО СВЕРЯЕТСЯ ТОЧНО, а не «не меньше»: слабое сравнение проходило
    # бы и со снятой починкой — потребность выживших объектов сама по себе
    # больше осиротевшей (проверено мутацией: с отбором «пуст» проба зеленела).
    assert service.event_force_need(event) == expected, (
        "посты снятого объекта выпали из потребности мероприятия"
    )


def test_a_post_marked_for_a_live_object_is_not_counted_twice(
    manager, two_objects_on_conduct  # noqa: F811
):
    """Двойного счёта нет: живой объект уже принёс свои посты снимком.

    Без этой пробы починка «считать всё, что не совпало с живым объектом»
    легко превращается в «считать всё подряд», и число мероприятия удваивается
    на каждом размеченном посте.
    """
    _, event_id, _first, _second = two_objects_on_conduct
    event = service.lock_event(event_id)
    visits = list(event.visit_objects.all())
    assert len(visits) >= 2, "предмет пробы — ОМ с несколькими объектами"

    total = service.event_force_need(event, visits)
    by_visits = sum(int(v.force_need or 0) for v in visits)

    assert total == by_visits, (
        "у ОМ, где все посты размечены на живые объекты, потребность равна "
        f"сумме снимков: {total} против {by_visits}"
    )
