"""Права этапа 3 «Согласование» по ролям (`[СОГ-12]`, Plane №401).

Спецификация: «старший объекта — отправить, отозвать, ответить на замечания;
замещающий — ответить на замечания, не отправляет; `acc_dept_head_d2` —
согласовать / вернуть; `acc_dir_head_d2` — то же, если в маршруте; штаб».

До этой задачи отправка, отзыв и ответ на замечание жили под общим
`event.manage`, которого у старшего объекта нет, а подпись — только у
`EVENT_APPROVER`: у начальника второго департамента «Согласовать» отвечала 403.

Пробы стерегут три вещи, каждая красна на своей мутации:

1. роль каталога `HEAD_OPS_UNIT` решает по маршруту — убери у неё
   `assignment.approve` в `seed_operations`, и проба красна;
2. старший объекта БЕЗ `event.manage` отправляет и отзывает, посторонний с тем
   же набором прав — нет; снять ветку старшего в `_object_lead_override` —
   красно;
3. замещающий закрывает замечание, но отправить не может — расширить
   `_OBJECT_DEPUTY_ACTIONS` до отправки, и вторая половина краснеет.
"""
import pytest
from django.core.management import call_command

from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    approver,
    make_employee,
    make_object,
    manager,
)
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    _add_approver,
    two_objects_on_approval,
)

pytestmark = pytest.mark.django_db


def _persona(employee, username, perms=("event.view",)):
    """Учётка с чтением раздела, привязанная к сотруднику. `event.manage`
    у неё нет намеренно — иначе проба проверяла бы право, а не роль в данных."""
    api, user = client_for(username, f"ROLE_{username.upper()}", perms=perms)
    employee.user = user
    employee.save(update_fields=["user"])
    return api


def _sent(manager, base, visit):  # noqa: F811
    _add_approver(manager, base, visit)
    resp = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(visit.pk)}, format="json"
    )
    assert resp.status_code == 200, resp.content
    visit_row = next(
        v for v in resp.json()["visitObjects"] if v["id"] == str(visit.pk)
    )
    return visit_row["approvalRoute"][0]["id"]


# ── Штаб решает по маршруту ─────────────────────────────────────────────────


def test_the_second_department_head_decides_with_the_catalog_role(
    manager, two_objects_on_approval  # noqa: F811
):
    base, _event_id, first, _second, _ = two_objects_on_approval
    approver_id = _sent(manager, base, first)
    call_command("seed_operations")
    head, _ = client_for("d2-head", "HEAD_OPS_UNIT")

    resp = head.post(
        f"{base}approval/route/{approver_id}/decide/",
        {"decision": "APPROVED", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    row = next(v for v in resp.json()["visitObjects"] if v["id"] == str(first.pk))
    assert row["approvalRoute"][0]["status"] == "APPROVED"


def test_the_second_department_head_returns_with_urgency(
    manager, two_objects_on_approval  # noqa: F811
):
    base, _event_id, first, _second, _ = two_objects_on_approval
    approver_id = _sent(manager, base, first)
    call_command("seed_operations")
    head, _ = client_for("d2-head", "HEAD_OPS_UNIT")

    resp = head.post(
        f"{base}approval/route/{approver_id}/decide/",
        {
            "decision": "RETURNED",
            "comment": "Пост без старшего",
            "urgent": True,
            "visitObjectId": str(first.pk),
        },
        format="json",
    )
    assert resp.status_code == 200, resp.content
    row = next(v for v in resp.json()["visitObjects"] if v["id"] == str(first.pk))
    assert row["approvalRemarks"][0]["urgent"] is True


# ── Старший объекта — по данным, без права ──────────────────────────────────


def test_the_object_chief_sends_and_withdraws_without_event_manage(
    manager, two_objects_on_approval  # noqa: F811
):
    base, _event_id, first, _second, _ = two_objects_on_approval
    chief_employee = make_employee(last_name="Старшов")
    resp = manager.post(
        f"{base}visit-objects/{first.pk}/chief/",
        {"employeeId": str(chief_employee.pk)},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    _add_approver(manager, base, first)
    chief = _persona(chief_employee, "ev-chief")

    sent = chief.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert sent.status_code == 200, sent.content
    withdrawn = chief.post(
        f"{base}approval/withdraw/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert withdrawn.status_code == 200, withdrawn.content

    # Маршрут — настройка процесса, она остаётся у ведущего мероприятие.
    added = chief.post(
        f"{base}approval/route/",
        {"name": "Кто-то", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert added.status_code == 403, added.content


def test_a_stranger_with_the_same_permissions_cannot_send(
    manager, two_objects_on_approval  # noqa: F811
):
    base, _event_id, first, _second, _ = two_objects_on_approval
    chief_employee = make_employee(last_name="Старшов")
    manager.post(
        f"{base}visit-objects/{first.pk}/chief/",
        {"employeeId": str(chief_employee.pk)},
        format="json",
    )
    _add_approver(manager, base, first)
    stranger = _persona(make_employee(last_name="Чужов"), "ev-stranger")

    resp = stranger.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert resp.status_code == 403, resp.content


def test_the_chief_of_one_object_does_not_lead_the_other(
    manager, two_objects_on_approval  # noqa: F811
):
    """Старший ПЕРВОГО объекта — не старший второго: адрес операции решает."""
    base, _event_id, first, second, _ = two_objects_on_approval
    chief_employee = make_employee(last_name="Старшов")
    manager.post(
        f"{base}visit-objects/{first.pk}/chief/",
        {"employeeId": str(chief_employee.pk)},
        format="json",
    )
    _add_approver(manager, base, second)
    chief = _persona(chief_employee, "ev-chief")

    resp = chief.post(
        f"{base}approval/send/", {"visitObjectId": str(second.pk)}, format="json"
    )
    assert resp.status_code == 403, resp.content


# ── Замещающий: только замечания ────────────────────────────────────────────


def test_the_deputy_answers_a_remark_but_does_not_send(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """Замещающий, ВЕДУЩИЙ объект, отвечает на замечание, но не отправляет.

    🔴 ФЛАГ В ФИКСТУРЕ ПЕРЕВЁРНУТ ОСОЗНАННО (Plane №572). Здесь стояло
    `canEditPlacement: False` — то есть проба закрепляла, что на замечания
    согласования отвечает НАБЛЮДАТЕЛЬ. Флаг заведён ровно затем, чтобы
    отличать замещающего, который ведёт объект, от внесённого «в список»; и
    соседний обход расстановки по нему фильтрует. Ответ на замечание — работа
    с документом объекта, а не чтение, и наблюдателю она не принадлежит.

    Проба ниже (`…_an_observer_deputy_cannot_touch_remarks`) держит вторую
    половину правила: без неё мутация «пускать любого замещающего» осталась бы
    зелёной.
    """
    base, _event_id, first, _second, _ = two_objects_on_approval
    deputy_employee = make_employee(last_name="Замов")
    resp = manager.post(
        f"{base}visit-objects/{first.pk}/deputies/",
        {"employeeId": str(deputy_employee.pk), "canEditPlacement": True},
        format="json",
    )
    assert resp.status_code == 201, resp.content
    approver_id = _sent(manager, base, first)
    returned = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {
            "decision": "RETURNED",
            "comment": "Смените старшего поста",
            "visitObjectId": str(first.pk),
        },
        format="json",
    )
    assert returned.status_code == 200, returned.content
    row = next(
        v for v in returned.json()["visitObjects"] if v["id"] == str(first.pk)
    )
    remark_id = row["approvalRemarks"][0]["id"]
    deputy = _persona(deputy_employee, "ev-deputy")

    resolved = deputy.post(
        f"{base}approval/remarks/{remark_id}/resolve/",
        {
            "decision": "DISAGREED",
            "response": "Старший поста назначен приказом",
            "visitObjectId": str(first.pk),
        },
        format="json",
    )
    assert resolved.status_code == 200, resolved.content
    row = next(
        v for v in resolved.json()["visitObjects"] if v["id"] == str(first.pk)
    )
    assert row["approvalRemarks"][0]["status"] == "DISAGREED"

    sent = deputy.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert sent.status_code == 403, sent.content


def test_an_observer_deputy_cannot_touch_remarks(
    manager, approver, two_objects_on_approval  # noqa: F811
):
    """🔴 ЗАМЕЩАЮЩИЙ-НАБЛЮДАТЕЛЬ НЕ ЗАКРЫВАЕТ ЗАМЕЧАНИЯ (Plane №572).

    `_object_lead_override` отдавал ответ на замечание ЛЮБОЙ строке
    замещающих, не глядя на `can_edit_placement`. Официально назначенный
    наблюдатель — тот, кого внесли «в список», чтобы он видел объект, —
    распоряжался чужим документом без права `event.manage`. Клиент повторял ту
    же дыру, и пробы на неё не было.
    """
    base, _event_id, first, _second, _ = two_objects_on_approval
    watcher = make_employee(last_name="Наблюдов")
    added = manager.post(
        f"{base}visit-objects/{first.pk}/deputies/",
        {"employeeId": str(watcher.pk), "canEditPlacement": False},
        format="json",
    )
    assert added.status_code == 201, added.content
    approver_id = _sent(manager, base, first)
    returned = approver.post(
        f"{base}approval/route/{approver_id}/decide/",
        {
            "decision": "RETURNED",
            "comment": "Смените старшего поста",
            "visitObjectId": str(first.pk),
        },
        format="json",
    )
    assert returned.status_code == 200, returned.content
    row = next(
        v for v in returned.json()["visitObjects"] if v["id"] == str(first.pk)
    )
    remark_id = row["approvalRemarks"][0]["id"]

    refused = _persona(watcher, "ev-watcher").post(
        f"{base}approval/remarks/{remark_id}/resolve/",
        {
            "decision": "RESOLVED",
            "response": "как будто устранено",
            "visitObjectId": str(first.pk),
        },
        format="json",
    )

    assert refused.status_code == 403, refused.content
    first.refresh_from_db()
    assert first.approval_remarks[0]["status"] == "OPEN", (
        "наблюдатель закрыл чужое замечание"
    )


# ── Ревью a8d0e3ac: обход по роли в данных ИМЕНУЕТСЯ (Plane №576) ──────────


def test_the_object_chief_sending_leaves_a_named_trace_in_the_audit(
    manager, two_objects_on_approval  # noqa: F811
):
    """🔴 Plane №576: действие в обход общего права названо в журнале мутаций.

    Вьюха запоминала признак `_acting_as_object_lead` и НЕ ЧИТАЛА его нигде:
    требование её же докстринга («действие в обход общего права обязано быть
    названным») не выполнялось, и отправка на согласование, сделанная старшим
    объекта, в журнале была неотличима от отправки правообладателем. Соседний
    обход расстановки замещающим свой след пишет — асимметрия и была дырой.

    Мутация: перестать передавать `object_lead` в `send_for_approval` (или
    вернуть `_object_lead_actor`, всегда отдающий `None`) — записи не будет.
    """
    from organization_management.apps.operations import audit_service
    from organization_management.apps.operations.models_audit import OpsAuditLog

    base, event_id, first, _second, _ = two_objects_on_approval
    chief_employee = make_employee(last_name="Именованов")
    manager.post(
        f"{base}visit-objects/{first.pk}/chief/",
        {"employeeId": str(chief_employee.pk)},
        format="json",
    )
    _add_approver(manager, base, first)
    chief = _persona(chief_employee, "ev-chief-audit")

    sent = chief.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )

    assert sent.status_code == 200, sent.content
    rows = list(
        OpsAuditLog.objects.filter(
            action=audit_service.SECURITY_EVENT_APPROVAL_BY_OBJECT_LEAD,
            entity_id=event_id,
        )
    )
    assert len(rows) == 1, "обход по роли в данных не попал в журнал мутаций"
    payload = rows[0].new_value
    assert payload["action"] == "approval_send"
    assert payload["leadId"] == str(chief_employee.pk)
    assert payload["visitObjectId"] == str(first.pk)
    assert payload["objectName"] == first.object_name


def test_the_owner_of_the_permission_leaves_no_object_lead_trace(
    manager, two_objects_on_approval  # noqa: F811
):
    """А правообладатель такой записи НЕ оставляет.

    Без этой пробы №576 можно было бы «починить», записывая обход всегда, — и
    журнал перестал бы отличать роль в данных от права, ради чего запись и
    заводится.
    """
    from organization_management.apps.operations import audit_service
    from organization_management.apps.operations.models_audit import OpsAuditLog

    base, event_id, first, _second, _ = two_objects_on_approval
    # Старший объекта — ПОСТОРОННИЙ сотрудник без учётки: иначе отправляющий
    # оказался бы и правообладателем, и старшим сразу, и проба не отличала бы
    # одно от другого.
    manager.post(
        f"{base}visit-objects/{first.pk}/chief/",
        {"employeeId": str(make_employee(last_name="Чужов").pk)},
        format="json",
    )
    _add_approver(manager, base, first)

    sent = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )

    assert sent.status_code == 200, sent.content
    assert not OpsAuditLog.objects.filter(
        action=audit_service.SECURITY_EVENT_APPROVAL_BY_OBJECT_LEAD,
        entity_id=event_id,
    ).exists()


def test_the_permission_holder_who_is_also_the_object_chief_leaves_no_trace(
    manager, two_objects_on_approval  # noqa: F811
):
    """🔴 СЛУЧАЙ ПЕРЕСЕЧЕНИЯ, КОТОРЫЙ НЕ ПРОВЕРЯЛСЯ НИЧЕМ (дописано по ревью,
    задача №825).

    Соседняя отрицательная проба делает старшего объекта ПОСТОРОННИМ — её
    собственный комментарий это признаёт: «иначе отправляющий оказался бы и
    правообладателем, и старшим сразу». Но именно этот случай и был сломан:
    `permission_override` зовётся ДО `require_permission`, поэтому ведущий ОМ,
    который заодно старший объекта, уходил в ветку обхода, и в журнал ложилась
    запись «Согласование ведёт старший объекта» о человеке, действовавшем ПО
    ПРАВУ. Требование карточки прямо обратное.

    Мутация: убрать `_acts_by_permission` из `_object_lead_override` — запись
    появится, и проба покраснеет.
    """
    from organization_management.apps.operations import audit_service
    from organization_management.apps.operations.models_audit import OpsAuditLog

    base, event_id, first, _second, _ = two_objects_on_approval
    # Старший объекта — САМ отправляющий, у которого есть и право `event.manage`.
    me = manager.get("/api/operations/my-employee/").json()["employee"]
    manager.post(
        f"{base}visit-objects/{first.pk}/chief/",
        {"employeeId": str(me["id"])},
        format="json",
    )
    _add_approver(manager, base, first)

    sent = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert sent.status_code == 200, sent.content
    assert not OpsAuditLog.objects.filter(
        action=audit_service.SECURITY_EVENT_APPROVAL_BY_OBJECT_LEAD,
        entity_id=event_id,
    ).exists(), (
        "журнал назвал старшим объекта человека, действовавшего по праву: "
        "запись отвечает на вопрос «по роли, а не по праву», и пересечение "
        "делает её ложной"
    )


# ── Ревью 9dcdcf1f/c9691422: обход этапа не шире своего обоснования (№613) ──


def _on_acknowledgement(manager, two_objects):  # noqa: F811
    """Оба объекта доведены до «Ознакомления» обходом админа."""
    from organization_management.apps.ops import security_events as service

    base, event_id, first, second, assigned = two_objects
    service.override_stage(event_id, stage="ACKNOWLEDGEMENT", actor="system:test")
    first.refresh_from_db()
    second.refresh_from_db()
    return base, event_id, first, second, assigned


def test_the_chief_of_one_object_does_not_replace_on_the_other(
    manager, two_objects_on_approval  # noqa: F811
):
    """🔴 Plane №613: старший объекта А не заменяет назначения объекта Б.

    Обход этапа возвращал «да» любому из старших ЛЮБОГО объекта, не сверяя,
    чей пост правят: `may_manage_stage` — это объединение старшего мероприятия
    и старших ВСЕХ объектов. Соседний обход согласования такую сверку делает
    (`_object_lead_override`), и асимметрия была дырой.

    Мутация: убрать проверку `_replaces_own_post` — замена на чужом посту
    пройдёт.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    base, event_id, first, second, assigned = _on_acknowledgement(
        manager, two_objects_on_approval
    )
    chief_employee = make_employee(last_name="Своев")
    manager.post(
        f"{base}visit-objects/{first.pk}/chief/",
        {"employeeId": str(chief_employee.pk)},
        format="json",
    )
    chief = _persona(chief_employee, "ev-chief-replace")
    event = OpsSecurityEvent.objects.get(pk=event_id)
    of_post = {a["postId"]: a["id"] for a in event.placement_assignments}
    mine = of_post[assigned[str(first.pk)]]
    theirs = of_post[assigned[str(second.pk)]]

    refused = chief.post(
        f"{base}conduct/replace/",
        {
            "assignmentId": theirs,
            "incomingEmployeeId": str(make_employee(last_name="Заменов").pk),
            "reasonCode": "SICK",
        },
        format="json",
    )
    assert refused.status_code == 403, refused.content

    allowed = chief.post(
        f"{base}conduct/replace/",
        {
            "assignmentId": mine,
            "incomingEmployeeId": str(make_employee(last_name="Своезаменов").pk),
            "reasonCode": "SICK",
        },
        format="json",
    )
    assert allowed.status_code == 200, allowed.content


def test_the_object_chief_does_not_finish_the_whole_event_stage(
    manager, two_objects_on_approval  # noqa: F811
):
    """🔴 Plane №613: завершение этапа ВСЕГО ОМ остаётся у ведущего.

    `acknowledgement_stage.complete` переводит на «Проведение» мероприятие
    целиком, со всеми его объектами. Обход отдавал это старшему ЛЮБОГО из них
    — то есть старший одного объекта закрывал работу по чужим.

    Мутация: убрать `_EVENT_LEAD_ONLY_ACTIONS` — завершение старшим объекта
    пройдёт.
    """
    base, _event_id, first, _second, _ = _on_acknowledgement(
        manager, two_objects_on_approval
    )
    chief_employee = make_employee(last_name="Завершов")
    manager.post(
        f"{base}visit-objects/{first.pk}/chief/",
        {"employeeId": str(chief_employee.pk)},
        format="json",
    )
    chief = _persona(chief_employee, "ev-chief-complete")

    refused = chief.post(
        f"{base}acknowledgement/complete/",
        {"force": True, "comment": "Проба"},
        format="json",
    )

    assert refused.status_code == 403, refused.content
    # А напоминания старшему объекта по-прежнему доступны: `[ОЗН-09]` даёт ему
    # работу по этапу, и правка её не отбирает.
    reminded = chief.post(f"{base}acknowledgement/remind-all/")
    assert reminded.status_code == 200, reminded.content


def test_the_event_chief_still_finishes_the_stage(
    manager, two_objects_on_approval  # noqa: F811
):
    """Старший МЕРОПРИЯТИЯ завершает этап без `event.manage` — как и обещает
    `[ОЗН-09]`.

    Без этой пробы №613 можно было бы «починить», отобрав завершение у всех
    без кода права, и требование спецификации перестало бы выполняться.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    base, event_id, _first, _second, _ = _on_acknowledgement(
        manager, two_objects_on_approval
    )
    chief_employee = make_employee(last_name="Ведущев")
    event = OpsSecurityEvent.objects.get(pk=event_id)
    event.chief_employee_id = chief_employee.pk
    event.save(update_fields=["chief_employee_id", "updated_at"])
    chief = _persona(chief_employee, "ev-lead-complete")

    done = chief.post(
        f"{base}acknowledgement/complete/",
        {"force": True, "comment": "Проба: подтвердили не все."},
        format="json",
    )

    assert done.status_code == 200, done.content


def test_the_object_deputy_leads_the_stage_but_does_not_finish_it(
    manager, two_objects_on_approval  # noqa: F811
):
    """🔴 Plane №453: замещающий объекта ведёт «Ознакомление», кроме завершения.

    Спецификация `[ОЗН-09]` даёт замещающему ту же работу по этапу, что и
    старшему, КРОМЕ «Завершить»: он видит отказ сотрудника заступить и обязан
    успеть заменить его или напомнить, а не ждать старшего, которого может не
    быть на месте. Правило же знало только старших, и замещающий на этапе был
    зрителем: видел отказ и не мог сделать ничего.

    Мутация: вернуть `may_manage_stage` без ветки замещающего — напоминание и
    замена отобьются 403.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    base, event_id, first, _second, assigned = _on_acknowledgement(
        manager, two_objects_on_approval
    )
    deputy_employee = make_employee(last_name="Замещаев")
    added = manager.post(
        f"{base}visit-objects/{first.pk}/deputies/",
        {"employeeId": str(deputy_employee.pk), "canEditPlacement": True},
        format="json",
    )
    assert added.status_code in (200, 201), added.content
    deputy = _persona(deputy_employee, "ev-deputy-stage")

    # Напоминание — его работа.
    reminded = deputy.post(f"{base}acknowledgement/remind-all/")
    assert reminded.status_code == 200, reminded.content

    # Замена на посту СВОЕГО объекта — тоже.
    event = OpsSecurityEvent.objects.get(pk=event_id)
    of_post = {a["postId"]: a["id"] for a in event.placement_assignments}
    replaced = deputy.post(
        f"{base}conduct/replace/",
        {
            "assignmentId": of_post[assigned[str(first.pk)]],
            "incomingEmployeeId": str(make_employee(last_name="Пришедшев").pk),
            "reasonCode": "SICK",
        },
        format="json",
    )
    assert replaced.status_code == 200, replaced.content

    # А завершение этапа — нет: оно переводит ВСЁ мероприятие (Plane №613).
    refused = deputy.post(
        f"{base}acknowledgement/complete/",
        {"force": True, "comment": "Проба"},
        format="json",
    )
    assert refused.status_code == 403, refused.content


def test_the_deputy_of_one_object_does_not_replace_on_the_other(
    manager, two_objects_on_approval  # noqa: F811
):
    """🔴 ЗАМЕЩАЮЩИЙ ОБЪЕКТА А НЕ ТРОГАЕТ ОБЪЕКТ Б (дописано по ревью, задача
    №825).

    Ветка замещающего в `_replaces_own_post` проверялась только положительно —
    заменой на СВОЁМ объекте. У соседнего правила (старший объекта) отрицание
    есть: `test_the_chief_of_one_object_does_not_replace_on_the_other`. Без
    зеркальной пробы «упрощение» правила до «любой замещающий мероприятия»
    прошло бы весь набор, открыв сквозную дыру между объектами.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    base, event_id, first, second, assigned = _on_acknowledgement(
        manager, two_objects_on_approval
    )
    deputy_employee = make_employee(last_name="Чужев")
    added = manager.post(
        f"{base}visit-objects/{first.pk}/deputies/",
        {"employeeId": str(deputy_employee.pk), "canEditPlacement": True},
        format="json",
    )
    assert added.status_code in (200, 201), added.content
    deputy = _persona(deputy_employee, "ev-deputy-cross")

    event = OpsSecurityEvent.objects.get(pk=event_id)
    of_post = {a["postId"]: a["id"] for a in event.placement_assignments}
    refused = deputy.post(
        f"{base}conduct/replace/",
        {
            # Пост ЧУЖОГО объекта — того, где этот человек никто.
            "assignmentId": of_post[assigned[str(second.pk)]],
            "incomingEmployeeId": str(make_employee(last_name="Подставнов").pk),
            "reasonCode": "SICK",
        },
        format="json",
    )
    assert refused.status_code == 403, (
        "замещающий одного объекта заменил человека на ЧУЖОМ объекте: "
        f"{refused.content}"
    )


def test_an_observer_deputy_does_not_lead_the_stage(
    manager, two_objects_on_approval  # noqa: F811
):
    """Замещающий-НАБЛЮДАТЕЛЬ (без правки расстановки) этап не ведёт.

    Флаг `can_edit_placement` заведён ровно затем, чтобы отличать того, кто
    ВЕДЁТ объект, от внесённого «в список» (Plane №572). Без этой пробы №453
    можно было бы «починить» любым замещающим, и наблюдатель получил бы замену
    людей на постах.
    """
    base, _event_id, first, _second, _ = _on_acknowledgement(
        manager, two_objects_on_approval
    )
    watcher_employee = make_employee(last_name="Наблюдаев")
    manager.post(
        f"{base}visit-objects/{first.pk}/deputies/",
        {"employeeId": str(watcher_employee.pk), "canEditPlacement": False},
        format="json",
    )
    watcher = _persona(watcher_employee, "ev-deputy-watch")

    refused = watcher.post(f"{base}acknowledgement/remind-all/")

    assert refused.status_code == 403, refused.content
