"""Бэкфилл 0068: ход работы мероприятия переезжает в объект посещения.

Ш-1 плана №385 (Plane №407), требование `[МД-04]`: «У объекта свои этапы 1–5 и
свой документ „Расстановка сил“ с версиями». Поля заведены рядом с полями
мероприятия, а перенос значений делает миграция — и вот что в этом переносе
незаметно на глаз и потому стережётся пробой:

1. **у ОМ без объектов посещения объект ЗАВОДИТСЯ.** Иначе этапы остаются
   ничьими, и после переезда читателей карточка старого мероприятия окажется
   пустой — а выглядеть это будет как потеря данных, не как недоделка;
2. **у ОМ с одним объектом — прямая копия**, включая стадию и расстановку;
3. **у ОМ с несколькими объектами этапы достаются ПЕРВОМУ** (наименьшая
   `position`), а остальные остаются на «Бюллетене»: разнести общий расчёт
   постов по объектам задним числом нельзя, в строке поста объект не записан.
   Молчаливое размножение расчёта по всем объектам утроило бы потребность;
4. **`force_assigned` считается по расстановке**, а не остаётся нулём: нуль
   читался бы как «никого не дали».
"""
import datetime as dt
import importlib

import pytest
from django.apps import apps as django_apps

from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventVisitObject,
)

MIGRATION = importlib.import_module(
    "organization_management.apps.operations.migrations."
    "0068_visit_object_stage_fields"
)

pytestmark = pytest.mark.django_db


def make_event(code, *, stage="PLACEMENT", posts=None, assignments=None):
    return OpsSecurityEvent.objects.create(
        code=code,
        title=f"ОМ {code}",
        object_name="Резиденция",
        business_date=dt.date(2026, 6, 18),
        stage=stage,
        readiness_percent=60,
        force_need=7,
        conflicts_count=0,
        owner_name="Абенов",
        recon_checklist=[{"id": "c1", "done": True}],
        recon_sector_posts=posts or [{"id": "p1", "sector": "КПП", "need": 7}],
        demand_rows=[],
        demand_approved=True,
        force_requests=[],
        placement_assignments=assignments
        if assignments is not None
        else [{"employeeId": "1", "postId": "p1"}],
        approval_status=OpsSecurityEvent.ApprovalStatus.PENDING,
        journal_entries=[{"id": "j1"}],
        closure_direction_summaries=[],
    )


def add_object(event, name, position):
    return OpsSecurityEventVisitObject.objects.create(
        event=event, object_name=name, position=position
    )


def test_event_without_visit_objects_gets_one_with_the_stages():
    event = make_event("ОМ-БЕЗ")

    MIGRATION._carry_stages(django_apps, None)

    created = list(event.visit_objects.all())
    assert len(created) == 1, "объект не заведён — этапы остались ничьими"
    assert created[0].object_name == "Резиденция"
    assert created[0].stage == "PLACEMENT"
    assert created[0].force_need == 7
    assert created[0].recon_sector_posts == event.recon_sector_posts


def test_event_without_object_name_gets_honest_placeholder():
    """Имя пустым быть не может (ограничение), а выдумывать его нельзя."""
    event = make_event("ОМ-БЕЗЫМЯННЫЙ")
    OpsSecurityEvent.objects.filter(pk=event.pk).update(object_name="")

    MIGRATION._carry_stages(django_apps, None)

    assert event.visit_objects.get().object_name == "Объект не указан"


def test_single_object_receives_a_direct_copy():
    event = make_event("ОМ-ОДИН", stage="APPROVAL")
    target = add_object(event, "Мейрам", 1)

    MIGRATION._carry_stages(django_apps, None)

    target.refresh_from_db()
    assert target.stage == "APPROVAL"
    assert target.recon_checklist == event.recon_checklist
    assert target.journal_entries == event.journal_entries
    assert target.force_assigned == 1, "назначено не посчитано по расстановке"
    assert event.visit_objects.count() == 1, "лишний объект заведён поверх"


def test_of_several_objects_only_the_first_receives_the_stages():
    event = make_event("ОМ-НЕСКОЛЬКО")
    second = add_object(event, "Рахат", 2)
    first = add_object(event, "Мейрам", 1)

    MIGRATION._carry_stages(django_apps, None)

    first.refresh_from_db()
    second.refresh_from_db()
    assert first.stage == "PLACEMENT"
    assert first.force_need == 7
    # 🔴 Второму расчёт НЕ размножается: потребность мероприятия удвоилась бы.
    assert second.stage == "BULLETIN"
    assert second.force_need == 0
    assert second.recon_sector_posts == []
    assert second.placement_assignments == []


def test_assigned_is_zero_when_nobody_is_placed():
    event = make_event("ОМ-ПУСТО", assignments=[])
    target = add_object(event, "Мейрам", 1)

    MIGRATION._carry_stages(django_apps, None)

    target.refresh_from_db()
    assert target.force_assigned == 0
