"""Уведомления о заступлении на ОМ (Plane №243).

Сценарий заказчика: «кнопкой можно отправить уведомления И ИХ РУКОВОДИТЕЛИ
тоже получают уведомления». До этого среза вида уведомления под заступление не
существовало вовсе — в справочнике жил единственный «Отставание по сдаче».
"""
import datetime as dt

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
    UserRole,
)
from organization_management.apps.operations.models_notification import (
    OpsNotification,
)
from organization_management.apps.ops.acknowledgement_notify import (
    KIND,
    SUPERVISE_PERMISSION,
    notify_acknowledgement,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    approver,
    manager,
)
from organization_management.apps.operations.tests.test_strength_report import (
    make_employee,
)
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    two_objects_on_approval,
)

pytestmark = pytest.mark.django_db

DAY = dt.date(2026, 8, 20)


@pytest.fixture
def event_with_people(django_user_model):
    """ОМ на «Ознакомлении» с двумя назначенными и начальником над ними."""
    from organization_management.apps.operations.models_event import (
        OpsSecurityEvent,
    )

    department = Division.objects.create(
        name="Департамент", code="DEP-ACK", division_type=Division.DivisionType.DEPARTMENT
    )
    directorate = Division.objects.create(
        name="Управление",
        code="DIR-ACK",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=department,
    )
    linked = make_employee(directorate, last_name="Связанов")
    unlinked = make_employee(directorate, last_name="Несвязанов")
    account = django_user_model.objects.create_user(username="ack-person", password="x")
    linked.user = account
    linked.save(update_fields=["user"])

    # Руководитель — учётка с областью НАД подразделением сотрудника: прямой
    # ссылки «сотрудник → начальник» в системе нет, и отвечает за человека
    # тот, чья область его накрывает.
    boss = django_user_model.objects.create_user(username="ack-boss", password="x")
    role = Role.objects.create(code="ACK_BOSS", name="Начальник пробы")
    # 🔴 ПРАВО, А НЕ ОДНА ЛИШЬ ОБЛАСТЬ (Plane №880). Рассылка отбирает
    # получателей поимённого списка по `status.manage`; роль без права
    # получателем не считается — и фикстура обязана заводить начальника
    # таким, каков он в жизни, иначе проба стерегла бы несуществующий случай.
    permission, _ = Permission.objects.get_or_create(
        code=SUPERVISE_PERMISSION, defaults={"name": "Распоряжаться личным составом"}
    )
    RolePermission.objects.get_or_create(role_code=role, permission_code=permission)
    UserRole.objects.create(
        user_id=str(boss.pk), role_code=role, scope_division_id=department.pk
    )

    event = OpsSecurityEvent.objects.create(
        code="ОМ-ACK-1",
        title="Проба уведомлений",
        object_name="Объект",
        business_date=DAY,
        stage="ACKNOWLEDGEMENT",
        readiness_percent=0,
        force_need=0,
        conflicts_count=0,
        owner_name="Ведущий",
        recon_checklist=[],
        recon_sector_posts=[],
        # Обязательные без умолчания поля модели — перечислены целиком, чтобы
        # проба падала на своём предмете, а не на NOT NULL.
        demand_rows=[],
        demand_approved=False,
        placement_assignments=[
            {"id": "a-1", "employeeId": str(linked.pk), "postId": "p-1"},
            {"id": "a-2", "employeeId": str(unlinked.pk), "postId": "p-1"},
        ],
        force_requests=[],
        journal_entries=[],
        closure_direction_summaries=[],
        # `approval_route`/`approval_remarks` СНЯТЫ с мероприятия (Plane
        # №413, Ш-7): согласуют объект посещения, здесь их больше нет.
        approval_status="APPROVED",
    )
    return event, account, boss, unlinked


def test_the_assigned_and_their_supervisor_both_get_notified(event_with_people):
    """Уведомление уходит И сотруднику, И тому, кто за него отвечает.

    Красная на мутации: убери рассылку руководителям — начальник останется
    без уведомления, а сценарий требует именно обоих.
    """
    event, account, boss, _unlinked = event_with_people

    report = notify_acknowledgement(event.pk)

    recipients = set(
        OpsNotification.objects.filter(kind=KIND).values_list("recipient", flat=True)
    )
    assert str(account.pk) in recipients
    assert str(boss.pk) in recipients
    assert report["employees"] == 1
    assert report["supervisors"] == 1


def test_a_person_without_an_account_is_named_and_not_swallowed(event_with_people):
    """Кому не дошло — названо ПОИМЁННО.

    Связь «учётка → кадровая запись» заполняется руками, и человек без неё
    уведомления не получит. Молчаливая рассылка выглядела бы успешной, а
    пропажу заметили бы в день мероприятия.
    """
    event, _account, _boss, unlinked = event_with_people

    report = notify_acknowledgement(event.pk)

    assert report["unlinkedEmployeeIds"] == [str(unlinked.pk)]


def test_a_dismissed_person_gets_no_notification(event_with_people):
    """Уволенному «заступаешь на ОМ» не уходит (Plane №900).

    ЧТО СТЕРЕГУТ ЭТИ ДВЕ ПРОВЕРКИ. Учётка живёт дольше кадровой записи, и без
    фильтра `is_active` уволенный ПОЛУЧАЛ уведомление с кодом, названием,
    датой и именем объекта. Это хуже соседнего случая с чтением смен: там надо
    было зайти и открыть экран, а уведомление приходит само.

    🔴 ВТОРАЯ ПОЛОВИНА — ЧТО УВОЛЕННЫЙ НЕ ПРЕВРАЩАЕТСЯ В «КОМУ НЕ ДОШЛО».
    Список `unlinkedEmployeeIds` отвечает на вопрос «кому надо было, но
    некуда»; уволенный туда не относится — ему не надо. Свалить их в одну
    строку значило бы каждый раз звать разбираться с человеком, которого в
    наряде уже нет.

    КРАСНАЯ ПРОБА: убери ветку `if employee_id in dismissed` — уволенный
    падает в «кому не дошло», и вторая проверка краснеет. Отсечение стоит
    ИМЕННО там, а не только в `_employee_users`: фильтр помощника закрывает
    доставку у всех четырёх рассылок ОМ, но на форму отчёта не влияет.
    """
    event, account, _boss, _unlinked = event_with_people
    from organization_management.apps.employees.models import Employee

    employee = Employee.objects.get(user=account)
    employee.is_active = False
    employee.save(update_fields=["is_active"])

    report = notify_acknowledgement(event.pk)

    recipients = set(
        OpsNotification.objects.filter(kind=KIND).values_list("recipient", flat=True)
    )
    assert str(account.pk) not in recipients, (
        "уволенный получил уведомление о наряде, к которому не имеет отношения"
    )
    assert str(employee.pk) not in report["unlinkedEmployeeIds"], (
        "уволенный попал в «кому не дошло» — это другой вопрос: ему не надо"
    )
    # Но и не потерян молча: отчёт обязан объяснить, почему уведомлений
    # меньше, чем назначенных, — иначе числа не сойдутся с расстановкой.
    assert report["dismissedEmployeeIds"] == [str(employee.pk)], report


def test_the_notification_carries_the_event_it_is_about(event_with_people):
    """В уведомлении назван КОД мероприятия.

    «Одно на день» — ключ модели: заступающий на два ОМ в один день получит
    одно уведомление. Значит оно обязано говорить, о каком именно заступлении
    речь, иначе человек знает только, что «что-то сегодня есть».
    """
    event, account, _boss, _unlinked = event_with_people

    notify_acknowledgement(event.pk)

    row = OpsNotification.objects.get(recipient=str(account.pk), kind=KIND)
    assert row.payload["eventCode"] == "ОМ-ACK-1"
    assert row.payload["businessDate"] == DAY.isoformat()


def test_notifying_outside_the_stage_is_refused_with_a_reason(event_with_people):
    """Рассылка вне этапа «Ознакомление» отбивается названной причиной."""
    from organization_management.apps.operations.exceptions import DomainError

    event, _account, _boss, _unlinked = event_with_people
    event.stage = "PLACEMENT"
    event.save(update_fields=["stage"])

    with pytest.raises(DomainError) as failure:
        notify_acknowledgement(event.pk)

    assert failure.value.code == "ACKNOWLEDGEMENT_STAGE_REQUIRED"


# ── Автоотправка при открытии этапа (Plane №402, `[ОЗН-01]`) ─────────────────


def test_approving_the_placement_notifies_without_a_click(
    manager, approver, django_user_model
):  # noqa: F811
    """Утверждение расстановки САМО рассылает уведомления о заступлении.

    До этого шага рассылка ждала ручную кнопку на этапе «Ознакомление»;
    заступающие узнавали о назначении, только если кто-то не забыл нажать.
    Утверждение уже открывает этап без отдельного клика — рассылка идёт тем же
    движением.

    Красная на мутации: убери `_autonotify_acknowledgement` из
    `_approve_visit` (общее тело ручки и автозавершения, №399) — строка
    уведомления не появится, и ассерт упадёт.
    """
    from .test_ops_approval_stage import add_approver, event_on_approval

    base, employee_id, _post_id = event_on_approval(manager)
    # Заступающий обязан быть СВЯЗАН с учёткой — иначе рассылка честно
    # запишет его в «не дошло», и проверять будет нечего.
    from organization_management.apps.employees.models import Employee

    account = django_user_model.objects.create_user(username="ack-auto", password="x")
    Employee.objects.filter(pk=employee_id).update(user=account)

    route = add_approver(manager, base)
    manager.post(f"{base}approval/send/")
    # До подписи рассылки нет: отправка на согласование — ещё не заступление.
    assert not OpsNotification.objects.filter(kind=KIND).exists()
    approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "APPROVED", "comment": ""},
        format="json",
    )

    # Последняя подпись завершает этап сама (`[СОГ-09]`, Plane №399) —
    # уведомления уходят из того же перехода; читаем состояние после решения.
    approved = manager.get(base)

    assert approved.status_code == 200, approved.data
    assert approved.json()["stage"] == "ACKNOWLEDGEMENT"
    row = OpsNotification.objects.get(recipient=str(account.pk), kind=KIND)
    assert row.payload["eventCode"] == approved.json()["code"]


def test_approving_an_event_nobody_is_linked_to_still_approves(manager, approver):  # noqa: F811
    """Сбой рассылки НЕ откатывает согласование.

    Согласование — то, что действительно произошло; рассылка — его следствие.
    Заступающий без связанной учётки — законный случай (связь заполняется
    руками), и этап обязан открыться, даже если уведомить некого.
    """
    from .test_ops_approval_stage import add_approver, event_on_approval

    base, _employee_id, _post_id = event_on_approval(manager)
    route = add_approver(manager, base)
    manager.post(f"{base}approval/send/")
    approver.post(
        f"{base}approval/route/{route[0]['id']}/decide/",
        {"decision": "APPROVED", "comment": ""},
        format="json",
    )

    # Последняя подпись завершает этап сама (`[СОГ-09]`, Plane №399) —
    # уведомления уходят из того же перехода; читаем состояние после решения.
    approved = manager.get(base)

    assert approved.status_code == 200, approved.data
    assert approved.json()["stage"] == "ACKNOWLEDGEMENT"


# ── Ревью №402: рассылка идёт по ОБЪЕКТУ, а не по мероприятию (Plane №537) ──


def test_the_first_approved_object_notifies_without_waiting_for_the_last(
    manager, approver, django_user_model, two_objects_on_approval  # noqa: F811
):
    """🔴 Plane №537: заступающие на утверждённый объект узнают об этом сразу.

    Стадия мероприятия — НАИМЕНЬШАЯ среди объектов (№412), а рассылка стояла
    под условием `event.stage == "ACKNOWLEDGEMENT"` и вторым таким же гардом
    внутри самой рассылки. Значит пока отстаёт хотя бы один объект, не
    уведомляли НИКОГО: заступающие на объект, утверждённый первым, узнавали о
    назначении, только когда догонит последний, — а заступать им, возможно,
    уже завтра. Требование `[ОЗН-01]` выполнялось на бумаге и не выполнялось
    по объектам. Это четвёртое место одного корня (см. №475, №520, №528).

    Мутация: вернуть условие по `event.stage` (в `_approve_visit` или в самой
    `notify_acknowledgement`) — строки уведомления не появится.
    """
    from organization_management.apps.employees.models import Employee
    from .test_ops_visit_object_approval import _add_approver

    base, event_id, first, second, assigned = two_objects_on_approval
    # Заступающий ПЕРВОГО объекта связан с учёткой: иначе рассылка честно
    # запишет его в «не дошло», и проверять будет нечего.
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    event = OpsSecurityEvent.objects.get(pk=event_id)
    first_post = assigned[str(first.pk)]
    employee_id = next(
        a["employeeId"] for a in event.placement_assignments if a["postId"] == first_post
    )
    account = django_user_model.objects.create_user(username="ack-first-object", password="x")
    Employee.objects.filter(pk=employee_id).update(user=account)

    # Согласуем ТОЛЬКО первый объект: второй остаётся на «Согласовании», и
    # стадия мероприятия остаётся ниже «Ознакомления».
    _add_approver(manager, base, first)
    sent = manager.post(
        f"{base}approval/send/", {"visitObjectId": str(first.pk)}, format="json"
    )
    assert sent.status_code == 200, sent.content
    first.refresh_from_db()
    decided = approver.post(
        f"{base}approval/route/{first.approval_route[0]['id']}/decide/",
        {"decision": "APPROVED", "comment": "", "visitObjectId": str(first.pk)},
        format="json",
    )
    assert decided.status_code == 200, decided.content

    event.refresh_from_db()
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.stage == "ACKNOWLEDGEMENT", "первый объект не открыл «Ознакомление»"
    assert second.stage != "ACKNOWLEDGEMENT", "второй объект догнал — проба вакуумна"
    assert event.stage != "ACKNOWLEDGEMENT", (
        "мероприятие уже на «Ознакомлении» — проба не стережёт разрез по объектам"
    )

    row = OpsNotification.objects.get(recipient=str(account.pk), kind=KIND)
    assert row.payload["eventCode"] == event.code
    # Уведомление называет ОБЪЕКТ, на который человек заступает, а не
    # мероприятие: идти ему туда.
    assert row.payload["objectName"] == first.object_name
    assert row.payload["visitObjectId"] == str(first.pk)
