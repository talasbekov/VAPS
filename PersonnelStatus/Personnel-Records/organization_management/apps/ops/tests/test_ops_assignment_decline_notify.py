"""Уведомление об отказе сотрудника заступить (Plane №451, `[ПРФ-04]`).

Свой файл, а не дописка в соседний: у рассылки свой модуль
(`assignment_decline_notify.py`), и проба живёт рядом с предметом — так же,
как `test_ops_placement_return_notify` живёт рядом со своим.
"""
import pytest

from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.ops import my_assignments
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    two_objects_on_approval,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    give_chief,  # noqa: F401
    approver,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

def test_a_decline_reaches_the_object_lead_and_the_event_lead(
    manager, django_user_model, two_objects_on_approval  # noqa: F811
):
    """🔴 ОБ ОТКАЗЕ УЗНАЮТ СРАЗУ, А НЕ ЗАГЛЯНУВ В КАРТОЧКУ (Plane №451).

    Сотрудник отвечает «Не могу заступить» в своём профиле. До этого шага
    отказ был виден ТОЛЬКО тому, кто сам откроет этап «Ознакомление», — и
    замену искали в день мероприятия.

    Проба проверяет и адресатов, и ключ дедупликации: отказ — СОБЫТИЕ, и два
    отказа РАЗНЫХ людей в один день обязаны дойти оба. Под ключом «одно на
    день» второй проглотился бы без следа — ровно беда, разобранная в №677.
    """
    base, event_id, first, _second, _ = two_objects_on_approval
    event = service.lock_event(event_id)
    own_posts = {str(p["id"]) for p in service.visit_object_posts(event, first)}
    rows = [
        a for a in event.placement_assignments if str(a.get("postId")) in own_posts
    ]
    if len(rows) < 2:
        # Второй человек на тот же пост — усиление сверх расчёта, поэтому с
        # обоснованием. Правка проходит: документ ещё черновик, и заморозка
        # ключится на него (Plane №533).
        extra = manager.post(
            f"{base}placement/assign/",
            {
                "postId": rows[0]["postId"],
                "employeeId": str(make_employee(last_name="Второв").pk),
                "override": True,
                "override_reason": "проба: второй отказ в тот же день",
            },
            format="json",
        )
        assert extra.status_code == 200, extra.content
        event = service.lock_event(event_id)
        rows = [
            a for a in event.placement_assignments if str(a.get("postId")) in own_posts
        ]
    assert len(rows) >= 2, "фикстуре нужны два назначения на объекте"

    # Старший объекта — с учёткой: без связи «сотрудник → учётка» письмо
    # некому доставить, и проба проверяла бы отчёт «не дошло».
    lead = make_employee(last_name="Старшов")
    lead_user = django_user_model.objects.create_user(username="decline-lead", password="x")
    lead.user = lead_user
    lead.save(update_fields=["user"])
    first.chief_employee_id = lead.pk
    first.chief_name = "Старшов С."
    first.save(update_fields=["chief_employee_id", "chief_name", "updated_at"])

    # Актор обязателен: журнал мутаций не принимает пустого (и это правильно
    # — отказ вписывает человек, и его имя часть факта).
    who = django_user_model.objects.create_user(username="decline-self", password="x")
    report = my_assignments.decline(
        event_id, rows[0]["id"], "Болен", actor=who, actor_name="Сам"
    )
    assert report is not None

    letters = OpsNotification.objects.filter(
        recipient=str(lead_user.pk), kind="ASSIGNMENT_DECLINED"
    )
    assert letters.count() == 1, "старший объекта не получил отказа"
    payload = letters.get().payload
    assert payload["reason"] == "Болен"
    assert payload["assignmentId"] == str(rows[0]["id"])
    assert payload["visitObjectId"] == str(first.pk), (
        "без объекта ссылка приведёт старшего не к тому месту"
    )

    # Второй отказ ДРУГОГО человека в тот же день — второе письмо, а не
    # проглоченный дубль.
    my_assignments.decline(
        event_id, rows[1]["id"], "Наряд", actor=who, actor_name="Сам"
    )
    assert (
        OpsNotification.objects.filter(
            recipient=str(lead_user.pk), kind="ASSIGNMENT_DECLINED"
        ).count()
        == 2
    ), "второй отказ проглочен ключом «одно на день»"

    # А повтор по ТОМУ ЖЕ назначению — тот же факт, второго письма нет.
    my_assignments.decline(
        event_id, rows[0]["id"], "Всё ещё болен", actor=who, actor_name="Сам"
    )
    assert (
        OpsNotification.objects.filter(
            recipient=str(lead_user.pk), kind="ASSIGNMENT_DECLINED"
        ).count()
        == 2
    ), "повтор по одному назначению завёл дубль"

