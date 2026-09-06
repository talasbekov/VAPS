"""Уведомление об отказе сотрудника заступить (Plane №451, `[ПРФ-04]`).

Свой файл, а не дописка в соседний: у рассылки свой модуль
(`assignment_decline_notify.py`), и проба живёт рядом с предметом — так же,
как `test_ops_placement_return_notify` живёт рядом со своим.
"""
import pytest

from organization_management.apps.operations.models_audit import OpsAuditLog
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



def test_the_event_lead_hears_it_too(
    manager, django_user_model, two_objects_on_approval  # noqa: F811
):
    """🔴 ВЕДУЩИЙ МЕРОПРИЯТИЕ — ПОСЛЕДНИЙ РУБЕЖ, И ОН НЕ БЫЛ ПРОВЕРЕН НИЧЕМ
    (найдено ревью, задача №825).

    Прежняя проба звалась «…_the_object_lead_and_the_event_lead», а
    проверяла ТОЛЬКО старшего объекта: мутация «убрать ветку старшего
    мероприятия» проходила зелёной. Между тем именно он и слышит отказ, когда
    у объекта старшего нет вовсе, — то есть ветка несёт весь смысл «узнать
    вовремя».
    """
    base, event_id, first, _second, _ = two_objects_on_approval
    event = service.lock_event(event_id)
    own_posts = {str(p["id"]) for p in service.visit_object_posts(event, first)}
    rows = [a for a in event.placement_assignments if str(a.get("postId")) in own_posts]
    assert rows, "фикстуре нужно назначение на объекте"

    chief = make_employee(last_name="Ведущев")
    chief_user = django_user_model.objects.create_user(username="decline-chief", password="x")
    chief.user = chief_user
    chief.save(update_fields=["user"])
    event.chief_employee_id = chief.pk
    event.chief_name = "Ведущев В."
    event.save(update_fields=["chief_employee_id", "chief_name", "updated_at"])

    who = django_user_model.objects.create_user(username="decline-self-2", password="x")
    my_assignments.decline(event_id, rows[0]["id"], "Болен", actor=who, actor_name="Сам")

    assert (
        OpsNotification.objects.filter(
            recipient=str(chief_user.pk), kind="ASSIGNMENT_DECLINED"
        ).count()
        == 1
    ), "ведущий мероприятие не услышал об отказе"


def test_a_single_object_event_with_unmarked_posts_still_reaches_its_lead(
    manager, django_user_model, two_objects_on_approval  # noqa: F811
):
    """🔴 РЕГРЕСС, НАЙДЕННЫЙ РЕВЮ (задача №825): у ОМ с ОДНИМ объектом и
    неразмеченными постами старший НЕ ПОЛУЧАЛ НИЧЕГО.

    Модуль читал у поста `visitObjectId` и сдавался, когда его нет. Но
    неразмеченный пост — не неизвестный: неизвестен он только при ДВУХ и
    более объектах, а у единственного его посты ВСЕ. Разметки же сегодня нет
    у большинства ОМ — расчёт ведётся на мероприятии целиком, и
    `visitObjectId: None` пишется любой строке, сохранённой без него;
    размечает посты только импорт из паспорта. Фикстура прежней пробы шла
    именно импортом, поэтому дыры не видела.

    Мутация, на которой проба обязана краснеть: вернуть свой разбор разметки
    вместо общего `_visit_of_post`.
    """
    base, event_id, first, second, _ = two_objects_on_approval
    event = service.lock_event(event_id)
    own_posts = {str(p["id"]) for p in service.visit_object_posts(event, first)}
    rows = [a for a in event.placement_assignments if str(a.get("postId")) in own_posts]
    assert rows, "фикстуре нужно назначение на объекте"

    lead = make_employee(last_name="Одинов")
    lead_user = django_user_model.objects.create_user(username="decline-solo", password="x")
    lead.user = lead_user
    lead.save(update_fields=["user"])
    first.chief_employee_id = lead.pk
    first.chief_name = "Одинов О."
    first.save(update_fields=["chief_employee_id", "chief_name", "updated_at"])

    # Приводим ОМ к обычному виду: ОДИН объект, посты без разметки.
    second.delete()
    event = service.lock_event(event_id)
    event.recon_sector_posts = [
        {**post, "visitObjectId": None} for post in (event.recon_sector_posts or [])
    ]
    event.save(update_fields=["recon_sector_posts", "updated_at"])

    who = django_user_model.objects.create_user(username="decline-self-3", password="x")
    my_assignments.decline(event_id, rows[0]["id"], "Болен", actor=who, actor_name="Сам")

    letters = OpsNotification.objects.filter(
        recipient=str(lead_user.pk), kind="ASSIGNMENT_DECLINED"
    )
    assert letters.count() == 1, (
        "у ОМ с одним объектом и неразмеченными постами старший объекта не получил отказа"
    )
    assert letters.get().payload["visitObjectId"] == str(first.pk), (
        "ссылка письма ведёт на мероприятие вместо объекта"
    )


def test_a_dismissed_object_lead_is_counted_apart_from_the_unlinked(
    manager, django_user_model, two_objects_on_approval  # noqa: F811
):
    """Уволенный старший объекта — СВОЯ графа отчёта (Plane №900).

    Об отказе заступить узнаёт старший объекта. Уволенный старший — не адресат
    (он этим нарядом больше не занимается) и не «тот, у кого нет учётки»:
    вторая графа зовёт кадровика чинить связь, а чинить тут нечего. Третья
    графа отвечает на настоящий вопрос — почему уведомлений меньше, чем
    названных в объекте людей.

    КРАСНАЯ ПРОБА: убери ветку `if employee_id in dismissed` — строка уедет в
    `unlinked`, и обе проверки ниже покраснеют.
    """
    base, event_id, first, _second, _ = two_objects_on_approval
    event = service.lock_event(event_id)
    own_posts = {str(p["id"]) for p in service.visit_object_posts(event, first)}
    rows = [a for a in event.placement_assignments if str(a.get("postId")) in own_posts]

    lead = make_employee(last_name="Уволенов")
    lead_user = django_user_model.objects.create_user(
        username="decline-dismissed", password="x"
    )
    lead.user = lead_user
    lead.is_active = False
    lead.save(update_fields=["user", "is_active"])
    first.chief_employee_id = lead.pk
    first.chief_name = "Уволенов У."
    first.save(update_fields=["chief_employee_id", "chief_name", "updated_at"])

    who = django_user_model.objects.create_user(username="decline-self-5", password="x")
    my_assignments.decline(event_id, rows[0]["id"], "Болен", actor=who, actor_name="Сам")

    record = (
        OpsAuditLog.objects.filter(action="ASSIGNMENT_DECLINED", entity_id=str(event_id))
        .order_by("-id")
        .first()
    )
    assert record is not None, "отказ не оставил записи в журнале"
    assert "Уволенов У." in record.new_value.get("dismissed", []), record.new_value
    assert "Уволенов У." not in record.new_value.get("unlinked", []), (
        "уволенный назван «без учётки» — кадровик пойдёт чинить несуществующее"
    )
    assert not OpsNotification.objects.filter(
        recipient=str(lead_user.pk)
    ).exists(), "уволенный получил уведомление об отказе по чужому наряду"


def test_the_delivery_report_reaches_the_journal(
    manager, django_user_model, two_objects_on_approval, monkeypatch  # noqa: F811
):
    """🔴 ОТЧЁТ РАССЫЛКИ ЧИТАЕТСЯ, А НЕ ВЫБРАСЫВАЕТСЯ (найдено ревью, №825).

    Модуль честно считает доставленное и называет поимённо тех, кому не
    дошло, — а вызов отбрасывал отчёт целиком: разбор «старший не узнал об
    отказе» упирался в пустоту. Та же дыра закрыта у соседней рассылки в
    №814.

    Мутация: убрать поля отчёта из записи журнала — проба краснеет.
    """
    from organization_management.apps.ops import assignment_decline_notify

    base, event_id, first, _second, _ = two_objects_on_approval
    event = service.lock_event(event_id)
    own_posts = {str(p["id"]) for p in service.visit_object_posts(event, first)}
    rows = [a for a in event.placement_assignments if str(a.get("postId")) in own_posts]

    lead = make_employee(last_name="Недошлов")
    lead_user = django_user_model.objects.create_user(username="decline-lost", password="x")
    lead.user = lead_user
    lead.save(update_fields=["user"])
    first.chief_employee_id = lead.pk
    first.chief_name = "Недошлов Н."
    first.save(update_fields=["chief_employee_id", "chief_name", "updated_at"])

    # Вставка уведомления отказала всем: `notify` по замыслу глотает беду и
    # возвращает `None`.
    monkeypatch.setattr(
        assignment_decline_notify.notify_service, "notify", lambda *a, **k: None
    )

    who = django_user_model.objects.create_user(username="decline-self-4", password="x")
    my_assignments.decline(event_id, rows[0]["id"], "Болен", actor=who, actor_name="Сам")

    record = (
        OpsAuditLog.objects.filter(action="ASSIGNMENT_DECLINED", entity_id=str(event_id))
        .order_by("-id")
        .first()
    )
    assert record is not None, "отказ не оставил записи в журнале"
    assert record.new_value.get("notified") == 0, (
        "журнал утверждает доставку, которой не было"
    )
    assert record.new_value.get("undelivered"), (
        "недоставленное не названо поимённо — чинить это некому"
    )
