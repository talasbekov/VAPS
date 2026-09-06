"""«Участие в ОМ» — только по запросу сил, колонка «По разделу ОМ»,
напоминание за час (Plane №427 `[СТА-04]` `[СБС-32]` `[ОЗН-06]`; правило
ручного ввода переписано решением заказчика по №737).

Имя файла осталось прежним и по-прежнему точно: «только из запроса» теперь
означает не «человек не может поставить статус руками», а «мероприятие берётся
только из заявок, разосланных его управлению».
"""
import datetime as dt

import pytest
from django.utils import timezone

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.status_service import (
    create_status,
    update_status,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
    make_employee,
    types,  # noqa: F401
)
from organization_management.apps.operations.tests.test_status_participation import (  # noqa: F401
    participation_catalog,
)
from organization_management.apps.ops.tests.test_ops_acknowledgement_notify import (  # noqa: F401
    event_with_people,
)

pytestmark = pytest.mark.django_db

TODAY = dt.date(2026, 9, 10)


def _status_type(code):
    from organization_management.apps.operations.models import StatusType

    StatusType.objects.get_or_create(
        code=code,
        defaults={"name": code, "priority": 50, "report_column_code": "IN_SERVICE"},
    )


def _department_with_directorate():
    from organization_management.apps.divisions.models import Division

    department = Division.objects.create(
        name="Первый департамент", division_type=Division.DivisionType.DEPARTMENT
    )
    directorate = Division.objects.create(
        name="Управление охраны",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=department,
    )
    return department, directorate


def _event_with_request(department, directorate, *, notified=True, code="ОМ-737-1"):
    """ОМ с заявкой департаменту и строкой управления (оповещённой или нет).

    Заявка кладётся в `force_allocation` напрямую, а не собирается ручками
    штаба: проба стережёт ПРАВИЛО ручного статуса, и вести её через четыре
    чужих запроса значило бы красить её падениями чужих экранов.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    event = OpsSecurityEvent.objects.create(
        code=code,
        title="Визит делегации",
        object_name="Резиденция",
        business_date=TODAY,
        stage="FORCES",
        readiness_percent=0,
        force_need=1,
        conflicts_count=0,
        owner_name="Ведущий",
        # Обязательные без умолчания поля модели — перечислены целиком, чтобы
        # проба падала на своём предмете, а не на NOT NULL.
        recon_checklist=[],
        recon_sector_posts=[],
        demand_rows=[],
        demand_approved=False,
        placement_assignments=[],
        force_requests=[],
        journal_entries=[],
        closure_direction_summaries=[],
        approval_status="PENDING",
    )
    event.force_allocation = [
        {
            "id": f"alloc-{event.pk}",
            "departmentId": str(department.pk),
            "departmentName": department.name,
            "need": 1,
            "status": "NOTIFIED" if notified else "DRAFT",
            "directorates": [
                {
                    "divisionId": str(directorate.pk),
                    "name": directorate.name,
                    "need": 1,
                    "notifiedAt": "2026-09-01T08:00:00+05:00" if notified else None,
                }
            ],
        }
    ]
    event.save(update_fields=["force_allocation"])
    return event


def test_manual_participation_without_an_event_is_refused(types):  # noqa: F811
    """Статус участия без мероприятия — «привлечён неизвестно куда» (№737).

    Заказчик снял ЗАПРЕТ ручного ввода, а не причину, по которой он появился:
    расход посчитает такого человека занятым, не сказав, куда он отдан.
    """
    _status_type("IN_EVENT")
    employee = make_employee()
    with pytest.raises(DomainError) as refused:
        create_status(
            employee_id=employee.id, status_type_code="IN_EVENT",
            date_start=TODAY, date_end=TODAY + dt.timedelta(days=1), actor="test",
        )
    assert refused.value.code == "PARTICIPATION_EVENT_REQUIRED"
    # Системный путь (чекбоксы запроса / выделение штабом) — как и раньше,
    # без проверок: мероприятие и даты там берутся из самой заявки.
    status = create_status(
        employee_id=employee.id, status_type_code="IN_EVENT",
        date_start=TODAY, date_end=TODAY + dt.timedelta(days=1), actor="system",
        participations=[], system_participations=True,
    )
    assert status.pk is not None


def test_manual_participation_refuses_event_without_a_request(types, participation_catalog):  # noqa: F811
    """Мероприятие, о котором управление не просили, — отказ (№737).

    Контрольная пара: ОДНО И ТО ЖЕ ОМ проходит с разосланной заявкой и
    отбивается без неё. Без второй половины проба не отличила бы «проверяем
    заявку» от «проверяем, что ОМ вообще существует».
    """
    _status_type("IN_EVENT")
    department, directorate = _department_with_directorate()
    employee = make_employee()
    silent = _event_with_request(
        department, directorate, notified=False, code="ОМ-737-2"
    )
    scope = {directorate.pk}

    with pytest.raises(DomainError) as refused:
        create_status(
            employee_id=employee.id, status_type_code="IN_EVENT",
            date_start=TODAY, date_end=TODAY + dt.timedelta(days=1), actor="head",
            participations=[{"event_id": silent.pk, "kind_code": "PHYSICAL_SQUAD"}],
            participation_scope_division_ids=scope,
        )
    assert refused.value.code == "PARTICIPATION_EVENT_NOT_REQUESTED"

    silent.force_allocation[0]["directorates"][0]["notifiedAt"] = (
        "2026-09-01T08:00:00+05:00"
    )
    silent.save(update_fields=["force_allocation"])
    status = create_status(
        employee_id=employee.id, status_type_code="IN_EVENT",
        date_start=TODAY, date_end=TODAY + dt.timedelta(days=1), actor="head",
        participations=[{"event_id": silent.pk, "kind_code": "PHYSICAL_SQUAD"}],
        participation_scope_division_ids=scope,
    )
    assert status.participations.count() == 1


def test_request_of_a_foreign_directorate_does_not_open_the_event(types, participation_catalog):  # noqa: F811
    """Заявка ЧУЖОМУ управлению своим мероприятие не делает (№737)."""
    _status_type("IN_EVENT")
    department, directorate = _department_with_directorate()
    from organization_management.apps.divisions.models import Division

    foreign = Division.objects.create(
        name="Управление связи",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=department,
    )
    employee = make_employee()
    event = _event_with_request(department, foreign, code="ОМ-737-3")

    with pytest.raises(DomainError) as refused:
        create_status(
            employee_id=employee.id, status_type_code="IN_EVENT",
            date_start=TODAY, date_end=TODAY + dt.timedelta(days=1), actor="head",
            participations=[{"event_id": event.pk, "kind_code": "PHYSICAL_SQUAD"}],
            participation_scope_division_ids={directorate.pk},
        )
    assert refused.value.code == "PARTICIPATION_EVENT_NOT_REQUESTED"


def test_api_lets_the_head_set_participation_from_a_request(types, participation_catalog):  # noqa: F811
    """Ручка: начальник управления ставит «Участие в ОМ» своему человеку (№737).

    Это и есть жалоба заказчика целиком: до правки тот же вызов отвечал 422
    `PARTICIPATION_MANUAL_FORBIDDEN` кому угодно, включая начальника
    управления с `status.manage`.
    """
    from organization_management.apps.staff_unit.models import StaffUnit

    _status_type("IN_EVENT")
    department, directorate = _department_with_directorate()
    employee = make_employee()
    StaffUnit.objects.create(division=directorate, employee=employee, index=71)
    event = _event_with_request(department, directorate, code="ОМ-737-4")
    api, _ = client_for(
        "head", "HEAD_DIRECTORATE_LINE",
        perms=("status.manage",), scope_division_id=str(directorate.pk),
    )

    resp = api.post(
        "/api/operations/statuses/",
        {
            "employee_id": employee.id,
            "status_type_code": "IN_EVENT",
            "date_start": TODAY.isoformat(),
            "date_end": (TODAY + dt.timedelta(days=1)).isoformat(),
            "participations": [
                {"event_id": event.pk, "kind_code": "PHYSICAL_SQUAD"}
            ],
        },
        format="json",
    )

    assert resp.status_code == 201, resp.data
    assert resp.json()["participations"][0]["event_code"] == event.code
    # Без мероприятия та же ручка отказывает — правило стоит на СЕРВЕРЕ, а не
    # только в окне.
    bare = api.post(
        "/api/operations/statuses/",
        {"employee_id": employee.id, "status_type_code": "IN_EVENT",
         "date_start": (TODAY + dt.timedelta(days=5)).isoformat(),
         "date_end": (TODAY + dt.timedelta(days=6)).isoformat()},
        format="json",
    )
    assert bare.status_code == 422, bare.data
    assert bare.json()["error_code"] == "PARTICIPATION_EVENT_REQUIRED"


def test_participations_cannot_be_repointed_by_a_second_call(types, participation_catalog):  # noqa: F811
    """Правка участий проверяется тем же правилом, что и создание (№737).

    Иначе правило обходится в два вызова: завести строку на запрошенное ОМ,
    затем переписать её на любое другое — или стереть участия совсем.
    """
    _status_type("IN_EVENT")
    department, directorate = _department_with_directorate()
    employee = make_employee()
    asked = _event_with_request(department, directorate, code="ОМ-737-5")
    stranger = _event_with_request(
        department, directorate, notified=False, code="ОМ-737-6"
    )
    scope = {directorate.pk}
    status = create_status(
        employee_id=employee.id, status_type_code="IN_EVENT",
        date_start=TODAY, date_end=TODAY + dt.timedelta(days=1), actor="head",
        participations=[{"event_id": asked.pk, "kind_code": "PHYSICAL_SQUAD"}],
        participation_scope_division_ids=scope,
    )

    with pytest.raises(DomainError) as repointed:
        update_status(
            status, actor="head",
            participations=[{"event_id": stranger.pk, "kind_code": "PHYSICAL_SQUAD"}],
            participation_scope_division_ids=scope,
        )
    assert repointed.value.code == "PARTICIPATION_EVENT_NOT_REQUESTED"

    with pytest.raises(DomainError) as emptied:
        update_status(
            status, actor="head", participations=[],
            participation_scope_division_ids=scope,
        )
    assert emptied.value.code == "PARTICIPATION_EVENT_REQUIRED"


def test_bulk_path_cannot_set_participation_either(types):  # noqa: F811
    """Пачка — второй ручной путь, и правило на нём то же (Plane №663).

    Гард жил только в `create_status`, а `bulk_create_statuses` строит строки
    сам: запрет снимался одним переключением на массовую ручку, тем же правом
    `status.manage`. Участий массовый путь не принимает вовсе — значит статус
    участия им не поставить никак.
    """
    from organization_management.apps.operations.bulk_status_service import (
        bulk_create_statuses,
    )
    from organization_management.apps.operations.selectors import DivisionTreeSelector
    from organization_management.apps.staff_unit.models import StaffUnit

    _status_type("IN_EVENT")
    _department, directorate = _department_with_directorate()
    employee = make_employee()
    StaffUnit.objects.create(division=directorate, employee=employee, index=63)
    allowed = set(DivisionTreeSelector.all_ids())

    def _bulk(code):
        return bulk_create_statuses(
            [
                {
                    "employee_id": employee.id,
                    "status_type_code": code,
                    "date_start": TODAY,
                    "date_end": TODAY + dt.timedelta(days=1),
                }
            ],
            actor="head",
            business_date=TODAY,
            allowed_division_ids=allowed,
        )

    with pytest.raises(DomainError) as refused:
        _bulk("IN_EVENT")
    assert refused.value.code == "PARTICIPATION_EVENT_REQUIRED"
    # Отказ ПОСТРОЧНЫЙ: код строки виден в detail.rows, а не только в конверте.
    assert refused.value.detail["rows"][0]["code"] == "PARTICIPATION_EVENT_REQUIRED"
    # Обычный статус той же пачкой проходит — гард не запирает массовый путь
    # целиком, иначе проба зеленела бы от любой поломки bulk.
    assert len(_bulk("DUTY")) == 1


def test_placeholder_cannot_be_resolved_into_participation(types):  # noqa: F811
    """Разрешение заглушки — третий ручной путь (Plane №664).

    Он пишет строку с ПРИСЛАННЫМ кодом и участий не принимает: без гарда
    правило обходилось в два вызова — завести «уточняется», затем разрешить
    его в «Участие в ОМ» без единого мероприятия.
    """
    from organization_management.apps.operations.models import StatusType
    from organization_management.apps.operations.status_service import (
        resolve_placeholder,
    )

    _status_type("IN_EVENT")
    StatusType.objects.update_or_create(
        code="UNCLEAR",
        defaults={
            "name": "Уточняется",
            "priority": 40,
            "report_column_code": "IN_SERVICE",
            "is_placeholder": True,
        },
    )
    employee = make_employee()
    placeholder = create_status(
        employee_id=employee.id, status_type_code="UNCLEAR",
        date_start=TODAY, date_end=TODAY + dt.timedelta(days=1), actor="head",
    )

    with pytest.raises(DomainError) as refused:
        resolve_placeholder(
            placeholder,
            resolved_type_code="IN_EVENT",
            date_start=TODAY,
            date_end=TODAY + dt.timedelta(days=1),
            actor="head",
            reason="выяснилось",
        )
    assert refused.value.code == "PARTICIPATION_EVENT_REQUIRED"
    # Заглушка осталась живой: отказ ничего не закрыл на полпути.
    placeholder.refresh_from_db()
    assert placeholder.cancelled_at is None
    # Обычным статусом заглушка разрешается — гард не запер саму операцию.
    resolved = resolve_placeholder(
        placeholder,
        resolved_type_code="DUTY",
        date_start=TODAY,
        date_end=TODAY + dt.timedelta(days=1),
        actor="head",
        reason="выяснилось",
    )
    assert resolved.status_type_code == "DUTY"


def test_section_column_carries_object_post_and_acknowledgement(types, event_with_people):  # noqa: F811
    _status_type("EVENT_ASSIGNMENT")
    event, _account, _boss, unlinked = event_with_people
    from organization_management.apps.operations.models_event import OpsSecurityEventVisitObject

    visit = OpsSecurityEventVisitObject.objects.create(
        event=event, object_name="Резиденция", position=1, stage="ACKNOWLEDGEMENT"
    )
    event.recon_sector_posts = [
        {"id": "p-1", "sector": "Периметр", "post": "Пост 1", "visitObjectId": str(visit.pk)}
    ]
    event.placement_assignments = [
        {**row, "acknowledgedAt": "2026-09-01T10:00:00+05:00" if row["id"] == "a-2" else None}
        for row in event.placement_assignments
    ]
    event.save(update_fields=["recon_sector_posts", "placement_assignments"])
    status = create_status(
        employee_id=unlinked.id, status_type_code="EVENT_ASSIGNMENT",
        date_start=event.business_date, date_end=event.business_date + dt.timedelta(days=1), actor="system",
        participations=[{"event_id": event.pk, "kind_code": "PHYSICAL_SQUAD"}],
        system_participations=True,
    )
    api, _ = client_for("viewer", "VIEWER", perms=("status.view",))
    # `employee_id`, а не `employee` (Plane №855). Здесь стояло неверное имя,
    # и проба проходила лишь потому, что ручка молча игнорировала отбор и
    # отдавала ВЕСЬ список: своя строка находилась в нём перебором ниже.
    # То есть отбор не проверялся вовсе. Теперь лишнее имя отбивается 400,
    # и эта строка — половина починки, а не подгон под новый вывод.
    resp = api.get(f"/api/operations/statuses/?employee_id={unlinked.id}")
    assert resp.status_code == 200, resp.data
    row = next(r for r in resp.json()["results"] if r["id"] == status.pk)
    part = row["participations"][0]
    assert part["event_code"] == event.code
    assert part["visit_object_name"] == "Резиденция"
    assert part["post_label"] == "Периметр · Пост 1"
    assert part["acknowledged_at"] == "2026-09-01T10:00:00+05:00"


def test_supervisors_are_reminded_one_hour_before_start(event_with_people):  # noqa: F811
    from organization_management.apps.ops.acknowledgement_reminders import (
        remind_supervisors_before_start,
    )

    event, _account, boss, _unlinked = event_with_people
    start = timezone.make_aware(dt.datetime.combine(event.business_date, dt.time(8, 0)))
    before = OpsNotification.objects.filter(recipient=str(boss.pk)).count()
    # За два часа — рано.
    early = remind_supervisors_before_start(start - dt.timedelta(hours=2))
    assert early["events"] == 0
    # За 40 минут — в окне: руководитель получает список неподтвердивших.
    report = remind_supervisors_before_start(start - dt.timedelta(minutes=40))
    assert report["events"] == 1 and report["unconfirmed"] == 2
    row = OpsNotification.objects.filter(recipient=str(boss.pk)).latest("id")
    assert OpsNotification.objects.filter(recipient=str(boss.pk)).count() == before + 1
    assert row.payload["oneHourBefore"] is True
    assert len(row.payload["unconfirmed"]) == 2
    # Повтор в то же окно — идемпотентно («одно на день»).
    remind_supervisors_before_start(start - dt.timedelta(minutes=20))
    assert OpsNotification.objects.filter(recipient=str(boss.pk)).count() == before + 1
