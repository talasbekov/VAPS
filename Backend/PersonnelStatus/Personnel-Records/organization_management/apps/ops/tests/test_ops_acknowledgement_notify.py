"""Уведомления о заступлении на ОМ (Plane №243).

Сценарий заказчика: «кнопкой можно отправить уведомления И ИХ РУКОВОДИТЕЛИ
тоже получают уведомления». До этого среза вида уведомления под заступление не
существовало вовсе — в справочнике жил единственный «Отставание по сдаче».
"""
import datetime as dt

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import Role, UserRole
from organization_management.apps.operations.models_notification import (
    OpsNotification,
)
from organization_management.apps.ops.acknowledgement_notify import (
    KIND,
    notify_acknowledgement,
)
from organization_management.apps.operations.tests.test_strength_report import (
    make_employee,
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
        approval_route=[],
        approval_remarks=[],
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
