"""Бэкфилл 0046: перевод заведённых ОМ через «Потребность» и «Запрос сил».

Задача заказчика Plane №110 сняла с шага «Расстановка» боксы, которыми человек
вёл стадии `DEMAND` и `FORCES`. Новые мероприятия проводит через них сервер, а
заведённые — эта миграция: без неё они заперты навсегда, двигать их дальше
нечем.

Проба стережёт четыре свойства переноса, потеря которых НЕЗАМЕТНА на глаз:

1. заведённое на обеих снятых стадиях доходит до «Расстановки» — иначе часть
   реестра остаётся запертой, и увидят это только когда кто-то откроет ОМ;
2. утверждённые РУКАМИ строки потребности не затираются — у мероприятия,
   которое человек успел провести, это его решение, и подменять его расчётом
   значит переписать чужую работу;
3. история переходов получает ОБЕ записи — лента обязана показать, что стадии
   были, иначе она соврёт про цепочку, по которой шло мероприятие;
4. мероприятия на прочих стадиях не тронуты — миграция ходит по двум стадиям,
   а не по реестру.

Проба заведена ПОЗЖЕ самой миграции (Plane №141) и это отдельный урок: правку
такого же рода — миграцию 0047 — я закрыл четырьмя пробами сразу, а эту
проверил руками на стенде и на этом остановился. Разница была случайной.
"""
import datetime as dt
import importlib

import pytest

from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventTransition,
)

MIGRATION = importlib.import_module(
    "organization_management.apps.operations.migrations."
    "0046_autopass_demand_and_forces"
)

pytestmark = pytest.mark.django_db

from django.apps import apps as django_apps


def post(sector, name, need):
    return {
        "id": f"post-{sector}-{name}",
        "sector": sector,
        "post": name,
        "task": "Охрана периметра",
        "need": need,
        "requirements": "Допуск",
        "result": None,
        "comment": "",
        "sourceSectorId": None,
        "sourcePostId": None,
        "minRating": None,
    }


def make_event(code, stage, *, posts, demand_rows=None, demand_approved=False):
    return OpsSecurityEvent.objects.create(
        code=code,
        title=f"ОМ {code}",
        object_name="Резиденция",
        business_date=dt.date(2026, 6, 18),
        stage=stage,
        readiness_percent=30,
        force_need=0,
        conflicts_count=0,
        owner_name="Абенов",
        recon_checklist=[],
        recon_sector_posts=posts,
        demand_rows=demand_rows or [],
        demand_approved=demand_approved,
        force_requests=[],
        placement_assignments=[],
        approval_status=OpsSecurityEvent.ApprovalStatus.PENDING,
        journal_entries=[],
        closure_direction_summaries=[],
    )


def stages_of(event):
    return list(
        OpsSecurityEventTransition.objects.filter(event=event)
        .order_by("id")
        .values_list("to_stage", flat=True)
    )


def test_both_locked_stages_reach_placement():
    """Заперты были ОБЕ стадии, и доходят до «Расстановки» тоже обе."""
    demand = make_event("ОМ-Д", "DEMAND", posts=[post("Периметр", "Пост 1", 4)])
    forces = make_event("ОМ-Ф", "FORCES", posts=[post("КПП", "Пост 2", 3)])

    MIGRATION.forwards(django_apps, None)

    demand.refresh_from_db()
    forces.refresh_from_db()
    assert (demand.stage, demand.readiness_percent) == ("PLACEMENT", 60)
    assert (forces.stage, forces.readiness_percent) == ("PLACEMENT", 60)


def test_demand_is_built_from_the_recon_calculation():
    """Потребность собрана из расчёта постов, а не выдумана."""
    event = make_event(
        "ОМ-Р",
        "DEMAND",
        posts=[post("Периметр", "Пост 1", 4), post("КПП", "Пост 2", 3)],
    )

    MIGRATION.forwards(django_apps, None)

    event.refresh_from_db()
    assert event.demand_approved is True
    assert [row["sector"] for row in event.demand_rows] == ["Периметр", "КПП"]
    assert [row["need"] for row in event.demand_rows] == [4, 3]
    assert event.force_need == 7
    assert [r["requestedCount"] for r in event.force_requests] == [7]
    # Группа пустая СОЗНАТЕЛЬНО: её задавал человек в снятом боксе, и
    # подставить вместо него выдуманное название пула значило бы записать в
    # данные утверждение, которого никто не делал.
    assert all(row["group"] == "" for row in event.demand_rows)


def test_hand_approved_demand_is_not_overwritten():
    """Строки, утверждённые РУКАМИ, миграция не трогает.

    Это главная проба файла: затирание чужой работы расчётом выглядит как
    нормально прошедший перенос — стадия сдвинулась, строки на месте, — и
    заметят подмену только когда кто-то сверит числа с тем, что вводил.
    """
    hand = [
        {
            "id": "d-1",
            "sector": "Периметр",
            "task": "Охрана",
            "shift": "Дневная",
            "need": 9,
            "group": "Физическая охрана",
            "requirements": "",
            "comment": "решение штаба",
        }
    ]
    event = make_event(
        "ОМ-Ручной",
        "FORCES",
        posts=[post("Периметр", "Пост 1", 4)],
        demand_rows=hand,
        demand_approved=True,
    )
    event.force_need = 9
    event.save(update_fields=["force_need"])

    MIGRATION.forwards(django_apps, None)

    event.refresh_from_db()
    assert event.stage == "PLACEMENT"
    assert event.demand_rows == hand, "миграция переписала решение человека"
    assert event.force_need == 9


def test_history_shows_that_both_stages_were_passed():
    """Обе записи истории, а не одна: лента не должна врать про цепочку."""
    demand = make_event("ОМ-И1", "DEMAND", posts=[post("Периметр", "Пост 1", 2)])
    forces = make_event("ОМ-И2", "FORCES", posts=[post("КПП", "Пост 2", 2)])

    MIGRATION.forwards(django_apps, None)

    # Со стадии «Потребность» пройдены обе: и «Запрос сил», и «Расстановка».
    assert stages_of(demand) == ["FORCES", "PLACEMENT"]
    # Со стадии «Запрос сил» — только оставшаяся: выдумывать переход, которого
    # не было, значило бы врать в другую сторону.
    assert stages_of(forces) == ["PLACEMENT"]
    assert all(
        row.kind == "FORWARD"
        for row in OpsSecurityEventTransition.objects.all()
    )


def test_events_on_other_stages_are_untouched():
    """Миграция ходит по ДВУМ стадиям, а не по реестру."""
    recon = make_event("ОМ-Рек", "RECON", posts=[post("Периметр", "Пост 1", 2)])
    approval = make_event(
        "ОМ-Сог", "APPROVAL", posts=[post("КПП", "Пост 2", 2)]
    )

    MIGRATION.forwards(django_apps, None)

    recon.refresh_from_db()
    approval.refresh_from_db()
    assert recon.stage == "RECON"
    assert approval.stage == "APPROVAL"
    assert recon.demand_approved is False
    assert stages_of(recon) == [] and stages_of(approval) == []


def test_running_it_twice_changes_nothing_more():
    """Повтор не плодит ни строк истории, ни потребности.

    Идемпотентность здесь не декларация, а следствие отбора: после первого
    прогона на снятых стадиях не остаётся никого. Проба стережёт именно это —
    сменится отбор, и повтор начнёт дублировать историю.
    """
    event = make_event("ОМ-Два", "DEMAND", posts=[post("Периметр", "Пост 1", 5)])

    MIGRATION.forwards(django_apps, None)
    first = stages_of(event)
    rows_after_first = OpsSecurityEvent.objects.get(pk=event.pk).demand_rows
    MIGRATION.forwards(django_apps, None)

    assert stages_of(event) == first
    assert OpsSecurityEvent.objects.get(pk=event.pk).demand_rows == rows_after_first


def test_event_without_posts_does_not_get_an_empty_request():
    """Расчёт пуст — заявки на силы нет вовсе.

    Заявка «запрошено 0» читалась бы штабом как поданная и висела бы в ленте
    сбора пустой строкой; отсутствие заявки — честнее.
    """
    event = make_event("ОМ-Пусто", "DEMAND", posts=[])

    MIGRATION.forwards(django_apps, None)

    event.refresh_from_db()
    assert event.stage == "PLACEMENT"
    assert event.force_need == 0
    assert event.force_requests == []
