"""Цепочка «Сбор сил на ОМ» (задача заказчика Plane №73).

Шаг «СС-1»: штаб получает с рекогносцировки ЧИСЛО и делит его между
департаментами. Здесь проверяется именно раскладка — адрес заявки, её сумма
и то, что правка не затирает уже начатую работу департамента.

Сквозной проход стадий лежит в `test_ops_security_events_api`; сюда вынесены
правила, которых он не показывает.
"""
import pytest

from organization_management.apps.divisions.models import Division

from .test_ops_security_events_api import (  # noqa: F401
    create_event,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


def make_department(name="Департамент охраны"):
    return Division.objects.create(
        name=name, division_type=Division.DivisionType.DEPARTMENT
    )


def event_on_demand(manager):  # noqa: F811
    """ОМ, доведённое до «Потребности»: расчёт постов ушёл штабу числом."""
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    # Пост из паспорта просит одного человека — делить такую потребность
    # между департаментами бессмысленно, и проверки суммы прошли бы вакуумно.
    posts = [
        {**post, "need": 4} if index == 0 else post
        for index, post in enumerate(data["reconSectorPosts"])
    ]
    manager.patch(
        f"{base}recon/",
        {
            "checklist": [{**i, "done": True} for i in data["reconChecklist"]],
            "sectorPosts": posts,
        },
        format="json",
    )
    demand = manager.post(f"{base}recon/complete/").json()
    assert demand["stage"] == "DEMAND"
    # Сторож фикстуры: делить нечего, если расчёт постов пуст — тогда все
    # проверки суммы ниже прошли бы «сами собой».
    assert demand["forceDemandTotal"] > 1, "у фикстуры нет потребности — делить нечего"
    return base, demand["forceDemandTotal"]


def test_split_addresses_departments(manager):  # noqa: F811
    """Раскладка адресована: у строки есть департамент, имя и число."""
    base, total = event_on_demand(manager)
    department = make_department()

    data = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(department.pk), "need": 1}]},
        format="json",
    ).json()

    assert len(data["forceAllocation"]) == 1
    row = data["forceAllocation"][0]
    assert row["departmentId"] == str(department.pk)
    assert row["departmentName"] == department.name
    assert (row["need"], row["status"]) == (1, "DRAFT")
    assert data["forceDemandTotal"] == total
    # Сохранённое читается обратно тем же: раскладка живёт в строке ОМ, а не
    # в ответе одной ручки.
    assert manager.get(base).json()["forceAllocation"] == data["forceAllocation"]


def test_split_refuses_more_than_demanded(manager):  # noqa: F811
    """Разложить больше, чем просили, нельзя — это ошибка ввода."""
    base, total = event_on_demand(manager)
    department = make_department()

    resp = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(department.pk), "need": total + 1}]},
        format="json",
    )

    assert resp.status_code == 422
    assert resp.json()["error_code"] == "ALLOCATION_OVER_DEMAND"
    assert str(total) in resp.json()["message"]
    # Недобор — не ошибка: штаб раскладывает в несколько заходов.
    ok = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(department.pk), "need": total - 1}]},
        format="json",
    )
    assert ok.status_code == 200


def test_split_refuses_foreign_and_repeated_addresses(manager):  # noqa: F811
    """Адресат проверяется на сервере: не департамент и повтор — 400."""
    base, _ = event_on_demand(manager)
    department = make_department()
    directorate = Division.objects.create(
        name="Управление №1",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=department,
    )

    foreign = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(directorate.pk), "need": 1}]},
        format="json",
    )
    assert foreign.status_code == 400
    assert "rows.0.departmentId" in foreign.json()["details"]

    repeated = manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {"departmentId": str(department.pk), "need": 1},
                {"departmentId": str(department.pk), "need": 1},
            ]
        },
        format="json",
    )
    assert repeated.status_code == 400
    assert "rows.1.departmentId" in repeated.json()["details"]


def test_split_keeps_started_department_state(manager):  # noqa: F811
    """Правка раскладки не затирает работу департамента и не снимает его.

    Департамент, которому заявка уже ушла, остаётся в раскладке: его
    управления оповещены, а люди, возможно, выделены.
    """
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    base, _ = event_on_demand(manager)
    first = make_department("Департамент охраны")
    second = make_department("Департамент сопровождения")
    manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {"departmentId": str(first.pk), "need": 1},
                {"departmentId": str(second.pk), "need": 1},
            ]
        },
        format="json",
    )
    # Состояние, которое заведут следующие шаги цепочки (СС-2, СС-3), — здесь
    # ставится руками: своей ручки у него пока нет.
    event = OpsSecurityEvent.objects.get(pk=base.rstrip("/").rsplit("/", 1)[-1])
    event.force_allocation = [
        {**row, "status": "NOTIFIED", "members": [{"employeeId": "1"}]}
        if row["departmentId"] == str(first.pk)
        else row
        for row in event.force_allocation
    ]
    event.save(update_fields=["force_allocation"])

    dropped = manager.post(
        f"{base}forces/allocation/",
        {"rows": [{"departmentId": str(second.pk), "need": 2}]},
        format="json",
    )
    assert dropped.status_code == 422
    assert dropped.json()["error_code"] == "ALLOCATION_LOCKED"
    assert first.name in dropped.json()["message"]

    kept = manager.post(
        f"{base}forces/allocation/",
        {
            "rows": [
                {"departmentId": str(first.pk), "need": 2},
                {"departmentId": str(second.pk), "need": 1},
            ]
        },
        format="json",
    ).json()
    started = next(
        row
        for row in kept["forceAllocation"]
        if row["departmentId"] == str(first.pk)
    )
    assert (started["status"], started["need"]) == ("NOTIFIED", 2)
    assert started["members"] == [{"employeeId": "1"}]


def test_split_only_while_forces_are_gathered(manager):  # noqa: F811
    """До рекогносцировки делить нечего — стадия отбивает раскладку."""
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    department = make_department()

    resp = manager.post(
        f"{URL}{event_id}/forces/allocation/",
        {"rows": [{"departmentId": str(department.pk), "need": 1}]},
        format="json",
    )

    assert resp.status_code == 422
    assert resp.json()["error_code"] == "INVALID_STAGE_TRANSITION"
