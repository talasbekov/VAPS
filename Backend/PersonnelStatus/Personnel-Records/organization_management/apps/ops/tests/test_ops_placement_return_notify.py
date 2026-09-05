"""Возврат расстановки: уведомление и обнуление маршрута (`[ВОЗ-03]`, Plane №400).

Спецификация: «При возврате: документ → „Возвращено (версия N)“, маршрут
обнуляется, все подписи сняты; объект возвращается на этап 2 …; уведомление
старшему объекта и замещающим „Расстановка по объекту „…“ возвращена: N
замечаний“». Документ и этап делали №398/№399; здесь — маршрут и рассылка.

Пробы стерегут:

1. старший объекта и замещающий получают уведомление с числом открытых
   замечаний, именем объекта и ссылкой на объект (`visitObjectId`);
2. сотрудник без учётки не валит возврат — попадает в отчёт «не дошло»;
3. маршрут обнуляется: подписи сняты, комментарий вернувшего сохранён;
4. «Срочно» едет в payload, если открытое замечание срочное;
5. без старшего и замещающих возврат проходит молча — уведомлять некого.
"""
import pytest

from organization_management.apps.operations.models_event import (
    OpsSecurityEventVisitObject,
)
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.ops.placement_return_notify import (
    KIND,
    notify_placement_returned,
)
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_security_events_api import (
    chief_for,  # noqa: F401
    approver,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


def _event_sent(manager, *, approvers=("Первый", "Второй")):  # noqa: F811
    obj = make_object(with_passport=True)
    created = manager.post(
        URL,
        {
            "title": "Проба возврата с уведомлением",
            "objectId": str(obj.pk),
            "businessDate": "2026-12-31",
            "kind": "INTERNAL",
            "chiefEmployeeId": str(chief_for(manager).pk),
        },
        format="json",
    )
    assert created.status_code == 201, created.content
    event_id = created.json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    manager.patch(
        f"{base}recon/",
        {
            "checklist": [{**i, "state": "NORMAL"} for i in data["reconChecklist"]],
            "sectorPosts": data["reconSectorPosts"],
        },
        format="json",
    )
    manager.post(f"{base}recon/complete/")
    posts = manager.get(base).json()["reconSectorPosts"]
    for post in posts:
        for _ in range(post["need"]):
            manager.post(
                f"{base}placement/assign/",
                {"postId": post["id"], "employeeId": str(make_employee().pk)},
                format="json",
            )
    manager.post(f"{base}placement/complete/")
    for name in approvers:
        manager.post(
            f"{base}approval/route/",
            {"name": name, "unit": "Департамент охраны", "position": "Зам."},
            format="json",
        )
    manager.post(f"{base}approval/send/")
    visit = OpsSecurityEventVisitObject.objects.get(event_id=event_id)
    return base, event_id, visit


def _link(django_user_model, employee, username):
    from organization_management.apps.employees.models import Employee

    account = django_user_model.objects.create_user(username=username, password="x")
    Employee.objects.filter(pk=employee.pk).update(user=account)
    return account


def test_chief_and_deputy_are_notified_with_the_open_remarks_count(
    manager, approver, django_user_model  # noqa: F811
):
    base, event_id, visit = _event_sent(manager)
    chief = make_employee(last_name="Старшов")
    deputy = make_employee(last_name="Заместов")
    chief_account = _link(django_user_model, chief, "chief-ret")
    deputy_account = _link(django_user_model, deputy, "deputy-ret")
    manager.post(
        f"{base}visit-objects/{visit.pk}/chief/",
        {"employeeId": str(chief.pk)},
        format="json",
    )
    manager.post(
        f"{base}visit-objects/{visit.pk}/deputies/",
        {"employeeId": str(deputy.pk), "canEditPlacement": True},
        format="json",
    )
    route = manager.get(base).json()["visitObjects"][0]["approvalRoute"]

    resp = approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "RETURNED", "comment": "Усилить КПП", "urgent": True},
        format="json",
    )
    assert resp.status_code == 200, resp.content

    rows = OpsNotification.objects.filter(kind=KIND)
    assert {r.recipient for r in rows} == {str(chief_account.pk), str(deputy_account.pk)}
    payload = rows.first().payload
    assert payload["objectName"] == visit.object_name
    assert payload["visitObjectId"] == str(visit.pk)
    assert payload["remarksOpen"] == 1
    assert payload["urgent"] is True
    assert payload["comment"] == "Усилить КПП"
    assert payload["eventCode"] and payload["eventId"] == str(event_id)


def test_an_unlinked_chief_does_not_break_the_return(manager, approver):  # noqa: F811
    base, event_id, visit = _event_sent(manager)
    chief = make_employee(last_name="Безучётный")
    manager.post(
        f"{base}visit-objects/{visit.pk}/chief/",
        {"employeeId": str(chief.pk)},
        format="json",
    )
    route = manager.get(base).json()["visitObjects"][0]["approvalRoute"]

    resp = approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "RETURNED", "comment": "переделать"},
        format="json",
    )

    assert resp.status_code == 200, resp.content
    assert resp.json()["stage"] == "PLACEMENT"
    assert not OpsNotification.objects.filter(kind=KIND).exists()
    event = service.lock_event(event_id)
    visit.refresh_from_db()
    report = notify_placement_returned(
        event, visit, comment="x", remarks_open=1, urgent=False
    )
    assert report["unlinked"] == [visit.chief_name]


def test_the_route_is_reset_and_the_return_reason_survives(manager, approver):  # noqa: F811
    """`[ВОЗ-03]`: «маршрут обнуляется, все подписи сняты». Комментарий
    вернувшего остаётся — он объясняет, что чинили (`send_for_approval` его
    же бережёт при повторной отправке)."""
    base, event_id, visit = _event_sent(manager)
    route = manager.get(base).json()["visitObjects"][0]["approvalRoute"]
    approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "APPROVED", "comment": ""},
        format="json",
    )

    data = approver.post(
        f"{base}approval/route/{route[1]['id']}/decide/",
        {"decision": "RETURNED", "comment": "поменять старшего"},
        format="json",
    ).json()

    by_id = {a["id"]: a for a in data["visitObjects"][0]["approvalRoute"]}
    # Подпись первого снята; строка вернувшего остаётся «Возвращено» с
    # причиной — возврат не подпись, а решение, из-за которого всё обнулилось.
    assert by_id[route[0]["id"]]["status"] == "NOT_SENT", "подпись не снята"
    assert by_id[route[0]["id"]]["decidedAt"] is None
    assert by_id[route[0]["id"]]["comment"] == "", "«Без замечаний» первого пережило возврат"
    assert by_id[route[1]["id"]]["status"] == "RETURNED"
    assert by_id[route[1]["id"]]["comment"] == "поменять старшего"


def test_nobody_to_notify_is_not_an_error(manager, approver):  # noqa: F811
    base, event_id, visit = _event_sent(manager)
    # Старшего фикстура даёт по умолчанию (`[РЕК-02]`, №424) — снимаем его
    # после отправки: предмет пробы — возврат, когда уведомлять некого.
    visit.chief_employee_id = None
    visit.chief_name = ""
    visit.save(update_fields=["chief_employee_id", "chief_name"])
    route = manager.get(base).json()["visitObjects"][0]["approvalRoute"]

    resp = approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "RETURNED", "comment": "переделать"},
        format="json",
    )

    assert resp.status_code == 200, resp.content
    assert not OpsNotification.objects.filter(kind=KIND).exists()


def test_returns_of_two_objects_do_not_collapse_into_one(
    manager, approver, django_user_model  # noqa: F811
):
    """🔴 Plane №586: «одно на день» глотало возврат ВТОРОГО объекта.

    Ключ уведомления был «получатель, вид, деловая дата», а старший (или
    замещающий) бывает старшим сразу двух объектов одного ОМ — или двух ОМ на
    одну дату. Второе уведомление молча проглатывалось, а выжившее несло
    payload ПЕРВОГО: ссылка `?visit=` вела человека не к тому объекту, и о
    втором возврате ему не говорили вовсе. То есть он открывал исправный
    объект и не находил замечаний, о которых ему сообщили.

    Мутация, которую стережёт проба: убрать `dedupe_key=str(visit.pk)` —
    второй строки не появится, и `visitObjectId` останется от первого объекта.
    """
    base, event_id, first = _event_sent(manager)
    chief = make_employee(last_name="Двухобъектов")
    account = _link(django_user_model, chief, "chief-two-objects")
    manager.post(
        f"{base}visit-objects/{first.pk}/chief/",
        {"employeeId": str(chief.pk)},
        format="json",
    )
    first.refresh_from_db()

    # Второй объект того же мероприятия с ТЕМ ЖЕ старшим: заводится напрямую —
    # предмет пробы рассылка, а не путь заведения объекта. Объект реестра свой:
    # пара (мероприятие, объект) уникальна ограничением
    # `uniq_ops_event_visit_object`.
    second = OpsSecurityEventVisitObject.objects.create(
        event=first.event,
        security_object=make_object(code="OBJ-RET-2", name="Второй объект"),
        object_name="Второй объект",
        passport_binding=None,
        position=(first.position or 0) + 1,
        stage=first.stage,
        chief_employee_id=chief.pk,
        chief_name="Двухобъектов Д.",
    )
    event = service.lock_event(event_id)

    notify_placement_returned(event, first, comment="Первый", remarks_open=1, urgent=False)
    notify_placement_returned(event, second, comment="Второй", remarks_open=2, urgent=False)

    rows = OpsNotification.objects.filter(recipient=str(account.pk), kind=KIND)
    assert rows.count() == 2, "возврат второго объекта проглочен ключом «одно на день»"
    by_object = {row.payload["visitObjectId"]: row.payload for row in rows}
    assert set(by_object) == {str(first.pk), str(second.pk)}
    assert by_object[str(second.pk)]["objectName"] == "Второй объект"
    assert by_object[str(second.pk)]["remarksOpen"] == 2


def test_two_returns_of_the_SAME_object_still_give_one_row(
    manager, approver, django_user_model  # noqa: F811
):
    """А вот ОДИН объект дважды за день — по-прежнему одна строка.

    Это принятое решение раздела (см. шапку модуля): второй возврат того же
    объекта человек увидит на самой карточке, а лента не превращается в дубли.
    Проба стережёт мутацию `dedupe_key=None`, которой легко было бы «починить»
    №586: она развела бы объекты и заодно вернула дубли по одному и тому же.
    """
    base, event_id, visit = _event_sent(manager)
    chief = make_employee(last_name="Одинобъектов")
    account = _link(django_user_model, chief, "chief-one-object")
    manager.post(
        f"{base}visit-objects/{visit.pk}/chief/",
        {"employeeId": str(chief.pk)},
        format="json",
    )
    visit.refresh_from_db()
    event = service.lock_event(event_id)

    notify_placement_returned(event, visit, comment="Раз", remarks_open=1, urgent=False)
    notify_placement_returned(event, visit, comment="Два", remarks_open=5, urgent=True)

    rows = OpsNotification.objects.filter(recipient=str(account.pk), kind=KIND)
    assert rows.count() == 1
    # Выживает ПЕРВАЯ полезная нагрузка — так устроен `get_or_create`.
    assert rows.first().payload["remarksOpen"] == 1


def test_a_refused_insert_is_counted_as_undelivered_not_as_notified(
    manager, approver, django_user_model, monkeypatch  # noqa: F811
):
    """🔴 СЧИТАЕТСЯ ДОСТАВЛЕННОЕ, А НЕ ПОПЫТКИ (Plane №809, тот же дефект, что
    №561 закрыла в `forces_notify`).

    `notify_service.notify` по замыслу глотает любое исключение и возвращает
    `None`, а счётчик рос безусловно: при отказе вставки для ВСЕХ получателей
    отчёт всё равно говорил `notified: 2` и пустой список недоставленного.
    Возврат расстановки — событие, ради которого старший объекта бросает
    дела; отчёт, утверждающий доставку, которой не было, уводит разбор
    «почему не починили замечания» по ложному следу.

    Недоставленное — СВОЙ список, отдельно от `unlinked`: «нет учётки» чинит
    кадровик, отказ вставки — тот, кто чинит базу.

    Мутация, на которой проба обязана краснеть: вернуть безусловное
    `notified += 1` — `notified` станет 2, а `undelivered` пустым.
    """
    from organization_management.apps.ops import placement_return_notify

    base, event_id, visit = _event_sent(manager)
    chief = make_employee(last_name="Старшов")
    deputy = make_employee(last_name="Заместов")
    chief_account = _link(django_user_model, chief, "chief-undeliv")
    deputy_account = _link(django_user_model, deputy, "deputy-undeliv")
    manager.post(
        f"{base}visit-objects/{visit.pk}/chief/",
        {"employeeId": str(chief.pk)},
        format="json",
    )
    manager.post(
        f"{base}visit-objects/{visit.pk}/deputies/",
        {"employeeId": str(deputy.pk), "canEditPlacement": True},
        format="json",
    )
    event = service.lock_event(event_id)
    visit.refresh_from_db()
    monkeypatch.setattr(
        placement_return_notify.notify_service, "notify", lambda *a, **kw: None
    )

    report = notify_placement_returned(
        event, visit, comment="Усилить КПП", remarks_open=1, urgent=False
    )

    assert report["notified"] == 0
    assert report["unlinked"] == []
    # Имя И учётка: имя нужно тому, кто пойдёт звонить, учётка — тому, кто
    # пойдёт смотреть, почему запись не легла.
    assert sorted(report["undelivered"]) == sorted(
        [
            f"{visit.chief_name} · {chief_account.pk}",
            f"{deputy.last_name} {deputy.first_name[0]}. · {deputy_account.pk}",
        ]
    )


def test_the_report_always_carries_the_undelivered_key(manager):  # noqa: F811
    """Форма отчёта одна на все выходы (Plane №809).

    Ветка «уведомлять некого» возвращала отчёт БЕЗ ключа `undelivered`, и
    читатель обязан был бы гадать, есть он в этот раз или нет. Проба стережёт
    именно форму: без ключа `report["undelivered"]` бросит `KeyError`.
    """
    base, event_id, visit = _event_sent(manager)
    # У объекта из фикстуры старший уже назначен — снимаем, чтобы попасть
    # ИМЕННО в ветку «уведомлять некого»: замещающих у него и так нет.
    OpsSecurityEventVisitObject.objects.filter(pk=visit.pk).update(
        chief_employee_id=None
    )
    event = service.lock_event(event_id)
    visit.refresh_from_db()
    assert visit.deputies.count() == 0

    report = notify_placement_returned(
        event, visit, comment="", remarks_open=0, urgent=False
    )

    assert report["nobody"] is True
    assert report["notified"] == 0
    assert report["undelivered"] == []
