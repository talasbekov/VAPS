"""Расстановка по прототипу (задача заказчика Plane №65).

Шаг «Р-1»: строка назначенного на пост несёт подразделение и статус дня.
Оба факта считаются НА ЧТЕНИИ — здесь проверяется именно это: изменение
статуса или перевод сотрудника видны в карточке ОМ без правки самой строки
назначения.
"""
import datetime as dt

import pytest

from organization_management.apps.operations.clock import Clock

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.staff_unit.models import StaffUnit

from .test_ops_security_events_api import (  # noqa: F401
    create_event,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"
BUSINESS_DATE = "2026-08-10"


def employee_in_division(division, last_name="Абенов"):
    """Сотрудник С подразделением: связь идёт через штатную единицу."""
    employee = make_employee(last_name=last_name)
    StaffUnit.objects.create(
        division=division, employee=employee, index=employee.pk
    )
    return employee


def event_with_assignment(manager, employee):  # noqa: F811
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj, business_date=BUSINESS_DATE).json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    post_id = data["reconSectorPosts"][0]["id"]
    resp = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk)},
        format="json",
    )
    assert resp.status_code == 200, resp.json()
    return base


def test_assignment_carries_division_and_day_status(manager):  # noqa: F811
    """Подразделение и статус дня приезжают вместе с назначением."""
    division = Division.objects.create(
        name="Управление №7", division_type=Division.DivisionType.DIRECTORATE
    )
    employee = employee_in_division(division)
    base = event_with_assignment(manager, employee)

    # Пока статуса нет — «в строю» подписывает клиент, сервер честно молчит.
    fresh = manager.get(base).json()["placementAssignments"][0]
    assert fresh["divisionName"] == "Управление №7"
    assert fresh["statusCode"] is None
    assert fresh["statusLabel"] is None

    StatusType.objects.get_or_create(
        code="VACATION",
        defaults={"name": "Отпуск", "priority": 10, "report_column_code": "VACATION"},
    )
    OpsEmployeeStatus.objects.create(
        employee_id=employee.pk,
        status_type_code="VACATION",
        date_start="2026-08-01",
        date_end="2026-09-01",
    )

    # Строка назначения НЕ переписывалась — статус виден потому, что считается
    # на чтении. Красная проба: сохранить статус в строке при назначении.
    after = manager.get(base).json()["placementAssignments"][0]
    assert after["id"] == fresh["id"]
    assert after["statusCode"] == "VACATION"
    assert after["statusLabel"] == "Отпуск"


def test_status_is_taken_on_the_event_date_not_today(manager):  # noqa: F811
    """Статус спрашивается на ДЕЛОВУЮ дату ОМ, а не на сегодня.

    🔴 Фикстура обязана РАЗВОДИТЬ даты: статус кладётся так, что он накрывает
    сегодняшний день и НЕ накрывает день мероприятия. Пока периоды пересекались,
    подмена даты на `date.today()` проходила зелёной — проба ничего не стерегла.
    """
    division = Division.objects.create(
        name="Управление №8", division_type=Division.DivisionType.DIRECTORATE
    )
    employee = employee_in_division(division, last_name="Сериков")
    base = event_with_assignment(manager, employee)
    StatusType.objects.get_or_create(
        code="SICK_LEAVE",
        defaults={
            "name": "Больничный",
            "priority": 20,
            "report_column_code": "SICK_LEAVE",
        },
    )
    today = Clock.today_local()
    assert today.isoformat() != BUSINESS_DATE, "день ОМ совпал с сегодня — проба вакуумна"
    OpsEmployeeStatus.objects.create(
        employee_id=employee.pk,
        status_type_code="SICK_LEAVE",
        date_start=today - dt.timedelta(days=1),
        date_end=today + dt.timedelta(days=2),
    )

    assert manager.get(base).json()["placementAssignments"][0]["statusCode"] is None


def test_employee_without_division_does_not_break_the_row(manager):  # noqa: F811
    """У сотрудника без штатной единицы подразделение пустое, а не ошибка."""
    employee = make_employee(last_name="Безштатный")
    base = event_with_assignment(manager, employee)

    row = manager.get(base).json()["placementAssignments"][0]

    assert row["divisionName"] == ""
    assert row["employeeName"] != ""


# ── Шаг «Р-2»: кандидат показан со статусом дня ─────────────────────────────


def test_personnel_page_tells_status_on_the_asked_date(manager):  # noqa: F811
    """Кадровая ручка отвечает статусом НА СПРОШЕННУЮ дату."""
    division = Division.objects.create(
        name="Управление №9", division_type=Division.DivisionType.DIRECTORATE
    )
    employee = employee_in_division(division, last_name="Оспанов")
    StatusType.objects.get_or_create(
        code="ON_DUTY",
        defaults={
            "name": "На дежурстве",
            "priority": 30,
            "report_column_code": "ON_DUTY",
        },
    )
    OpsEmployeeStatus.objects.create(
        employee_id=employee.pk,
        status_type_code="ON_DUTY",
        date_start="2026-08-10",
        date_end="2026-08-12",
    )
    path = f"/api/ops/personnel/?search=Оспанов&business_date="

    on_duty = manager.get(f"{path}2026-08-10").json()["results"][0]
    free = manager.get(f"{path}2026-08-20").json()["results"][0]

    assert on_duty["statusCode"] == "ON_DUTY"
    assert on_duty["statusLabel"] == "На дежурстве"
    # Вторая половина обязательна: без неё проба доказывала бы лишь, что ручка
    # всегда отдаёт статус, а не что она смотрит на спрошенный день.
    assert free["statusCode"] is None
    assert free["statusLabel"] is None


def test_personnel_page_without_date_answers_null_not_today(manager):  # noqa: F811
    """Без даты статуса нет вовсе — ручка не подставляет «сегодня» сама."""
    division = Division.objects.create(
        name="Управление №10", division_type=Division.DivisionType.DIRECTORATE
    )
    employee = employee_in_division(division, last_name="Токтаров")
    StatusType.objects.get_or_create(
        code="VACATION",
        defaults={"name": "Отпуск", "priority": 10, "report_column_code": "VACATION"},
    )
    today = Clock.today_local()
    OpsEmployeeStatus.objects.create(
        employee_id=employee.pk,
        status_type_code="VACATION",
        date_start=today - dt.timedelta(days=1),
        date_end=today + dt.timedelta(days=2),
    )

    row = manager.get("/api/ops/personnel/?search=Токтаров").json()["results"][0]

    assert row["id"] == str(employee.pk)
    assert row["statusCode"] is None


def test_personnel_page_rejects_garbage_date(manager):  # noqa: F811
    """Мусор вместо даты — 400, а не молчаливый список без статусов."""
    assert manager.get("/api/ops/personnel/?business_date=вчера").status_code == 400


def test_roster_carries_day_status(manager):  # noqa: F811
    """Состав мероприятия несёт статус дня: подбор берёт кандидатов из него."""
    from .test_ops_forces_gathering import event_on_placement_with_roster

    base, employee, _ = event_on_placement_with_roster(manager)

    member = manager.get(base).json()["forceRoster"][0]

    assert member["employeeId"] == str(employee.pk)
    # Человека привлекли на это же мероприятие — статус привлечения и есть его
    # статус дня; null здесь означал бы, что состав про статусы молчит.
    assert member["statusCode"] == "IN_EVENT"  # слияние статусов, Plane №486
    assert member["statusLabel"] != ""


# ── Шаг «Р-4»: старший сектора ──────────────────────────────────────────────


def two_assignments_in_one_sector(manager):  # noqa: F811
    """ОМ с двумя людьми в ОДНОМ секторе: правило единственности проверять
    нечем, если сектор один человек."""
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj, business_date=BUSINESS_DATE).json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    imported = data["reconSectorPosts"]
    sector = imported[0]["sector"]
    # Второй пост В ТОМ ЖЕ СЕКТОРЕ дописывается расчётом: у паспорта фикстуры
    # сектор из одного поста, и на нём правило «один старший на сектор» было
    # бы неотличимо от «один старший на пост».
    manager.patch(
        f"{base}recon/",
        {
            "checklist": data["reconChecklist"],
            "sectorPosts": [
                *imported,
                {**imported[0], "id": "post-sector-twin", "post": "Пост-двойник"},
            ],
        },
        format="json",
    )
    posts = manager.get(base).json()["reconSectorPosts"]
    same = [p for p in posts if p["sector"] == sector]
    assert len(same) >= 2, "в секторе один пост — двух людей туда не поставить"
    first = employee_in_division(
        Division.objects.create(
            name="Управление №11", division_type=Division.DivisionType.DIRECTORATE
        ),
        last_name="Первый",
    )
    second = make_employee(last_name="Второй")
    ids = []
    for post, employee in zip(same[:2], (first, second)):
        resp = manager.post(
            f"{base}placement/assign/",
            {"postId": post["id"], "employeeId": str(employee.pk)},
            format="json",
        )
        assert resp.status_code == 200, resp.json()
        ids.append(resp.json()["placementAssignments"][-1]["id"])
    return base, ids, sector


def test_post_has_exactly_one_senior(manager):  # noqa: F811
    """Назначение старшим снимает прежнего НА ТОМ ЖЕ ПОСТУ: старший на пост
    ОДИН (`[РАС-03]`, Plane №445)."""
    base, ids, _ = two_assignments_in_one_sector(manager)
    posts = manager.get(base).json()["placementAssignments"]
    post_id = next(a["postId"] for a in posts if a["id"] == ids[0])
    third = make_employee(last_name="Третий")
    # Пост уже занят, а расчёт у него — один человек: с Plane №414 второй на
    # посту это УСИЛЕНИЕ, и сервер спрашивает обоснование. Проба ставит его
    # осознанно (правило «один старший на пост» проверять нечем, если на посту
    # один человек), поэтому идёт сразу с обоснованием, а не подгоняет расчёт.
    resp = manager.post(
        f"{base}placement/assign/",
        {
            "postId": post_id,
            "employeeId": str(third.pk),
            "override": True,
            "override_reason": "Усиление поста: проба ставит второго на пост",
        },
        format="json",
    )
    assert resp.status_code == 200, resp.json()
    third_id = resp.json()["placementAssignments"][-1]["id"]

    first = manager.post(f"{base}placement/{ids[0]}/senior/", {}, format="json")
    assert first.status_code == 200, first.json()
    seniors = {
        a["id"]: a["isSectorSenior"] for a in first.json()["placementAssignments"]
    }
    assert seniors[ids[0]] is True
    assert seniors[third_id] is False

    second = manager.post(f"{base}placement/{third_id}/senior/", {}, format="json")

    seniors = {
        a["id"]: a["isSectorSenior"] for a in second.json()["placementAssignments"]
    }
    assert seniors[ids[0]] is False, "на посту оказалось два старших"
    assert seniors[third_id] is True


def test_sector_keeps_a_senior_per_post(manager):  # noqa: F811
    """Старшие РАЗНЫХ постов одного сектора друг друга не снимают: до №445
    признак был один на сектор, и второй старший сносил первого."""
    base, ids, _ = two_assignments_in_one_sector(manager)
    manager.post(f"{base}placement/{ids[0]}/senior/", {}, format="json")
    second = manager.post(f"{base}placement/{ids[1]}/senior/", {}, format="json")

    seniors = {
        a["id"]: a["isSectorSenior"] for a in second.json()["placementAssignments"]
    }
    assert seniors[ids[0]] is True, "старший соседнего поста снят — правило снова «на сектор»"
    assert seniors[ids[1]] is True


def test_sector_senior_can_be_cleared(manager):  # noqa: F811
    """Старшего можно снять, не назначая другого."""
    base, ids, _ = two_assignments_in_one_sector(manager)
    manager.post(f"{base}placement/{ids[0]}/senior/", {}, format="json")

    cleared = manager.post(
        f"{base}placement/{ids[0]}/senior/", {"senior": False}, format="json"
    )

    seniors = [
        a["isSectorSenior"] for a in cleared.json()["placementAssignments"]
    ]
    assert seniors == [False, False]


def test_sector_senior_is_written_to_the_audit_log(manager):  # noqa: F811
    """Именное назначение оставляет след: прежний старший стоит рядом с новым."""
    from organization_management.apps.operations.models_audit import OpsAuditLog

    base, ids, sector = two_assignments_in_one_sector(manager)
    # Подмена — на ТОМ ЖЕ ПОСТУ (`[РАС-03]`, Plane №445): старший соседнего
    # поста прежнего не снимает, и следа подмены не оставил бы.
    post_id = next(
        a["postId"]
        for a in manager.get(base).json()["placementAssignments"]
        if a["id"] == ids[0]
    )
    third = make_employee(last_name="Третий")
    # Второй на том же посту — усиление сверх расчёта (Plane №414): с
    # обоснованием, как и в пробе про единственность старшего.
    third_id = manager.post(
        f"{base}placement/assign/",
        {
            "postId": post_id,
            "employeeId": str(third.pk),
            "override": True,
            "override_reason": "Усиление поста: проба ставит второго на пост",
        },
        format="json",
    ).json()["placementAssignments"][-1]["id"]
    manager.post(f"{base}placement/{ids[0]}/senior/", {}, format="json")
    manager.post(f"{base}placement/{third_id}/senior/", {}, format="json")

    rows = list(
        OpsAuditLog.objects.filter(action="PLACEMENT_SECTOR_SENIOR_SET").order_by("id")
    )

    assert len(rows) == 2
    assert rows[0].old_value is None, "первый старший подменил кого-то"
    assert rows[1].old_value["employeeName"] == "Первый С."
    assert rows[1].new_value["sector"] == sector


def test_audit_log_names_the_post_not_only_the_sector(manager):  # noqa: F811
    """Две записи о РАЗНЫХ постах одного сектора различимы (Plane №706).

    Старший назначается ПОСТУ (`[РАС-03]`, Plane №445), а запись журнала несла
    один `sector`: у сектора с двумя постами обе записи говорили о секторе одно
    и то же, и разбирательство «кого и куда поставили» упиралось в две строки,
    по которым пост не назвать.
    """
    from organization_management.apps.operations.models_audit import OpsAuditLog

    base, ids, sector = two_assignments_in_one_sector(manager)
    posts = {
        a["id"]: a["postId"]
        for a in manager.get(base).json()["placementAssignments"]
    }
    assert posts[ids[0]] != posts[ids[1]], "оба назначения на одном посту — различать нечего"

    manager.post(f"{base}placement/{ids[0]}/senior/", {}, format="json")
    manager.post(f"{base}placement/{ids[1]}/senior/", {}, format="json")

    rows = list(
        OpsAuditLog.objects.filter(action="PLACEMENT_SECTOR_SENIOR_SET").order_by("id")
    )
    assert len(rows) == 2
    # Сектор у обеих записей ОДИН — именно поэтому одного сектора мало.
    assert rows[0].new_value["sector"] == sector
    assert rows[1].new_value["sector"] == sector
    assert rows[0].new_value["postId"] == posts[ids[0]]
    assert rows[1].new_value["postId"] == posts[ids[1]]
    # Подпись поста читает человек: по одному id пост в журнале не узнать, а по
    # одной подписи не найти, если её переименовали, — поэтому пишутся обе.
    assert rows[0].new_value["post"] != rows[1].new_value["post"]
    assert rows[0].new_value["post"] != ""


def test_unknown_assignment_is_not_found(manager):  # noqa: F811
    """Незнакомое назначение — 404, а не тихое ничего."""
    base, _, _ = two_assignments_in_one_sector(manager)

    assert manager.post(f"{base}placement/нет-такого/senior/", {}, format="json").status_code == 404
