"""Бэкфилл 0039: день и примечание из патча сводки ГВО → таблица объектов.

Миграцию гоняем не «в вакууме»: её функция берёт модели через
`apps.get_model`, поэтому здесь ей подсовывается ЖИВОЙ реестр приложений —
логика переноса проверяется той же, что пойдёт по базе.

Проба стережёт ровно то, что легко потерять при переносе: совпадение строки по
имени (с чужим регистром и лишними пробелами), заведение строки для объекта,
которого в списке мероприятия не было, и снятие ключа `visits` с патча —
иначе сводка продолжила бы читать старый список.
"""
import datetime as dt
import importlib

import pytest
from django.apps import apps as django_apps

from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventVisitObject,
)
from organization_management.apps.operations.models_gvo import OpsGvoSummaryPatch
from organization_management.apps.operations.models_object import OpsSecurityObject

MIGRATION = importlib.import_module(
    "organization_management.apps.operations.migrations."
    "0039_backfill_visit_days_from_gvo_patch"
)

pytestmark = pytest.mark.django_db


def make_event(code="ОМ-Б-1"):
    return OpsSecurityEvent.objects.create(
        code=code,
        title="Визит",
        object_name="Резиденция",
        business_date=dt.date(2026, 6, 18),
        stage=OpsSecurityEvent.Stage.BULLETIN,
        readiness_percent=0,
        force_need=0,
        conflicts_count=0,
        owner_name="Шитов",
        recon_checklist=[],
        recon_sector_posts=[],
        demand_rows=[],
        demand_approved=False,
        force_requests=[],
        placement_assignments=[],
        approval_status=OpsSecurityEvent.ApprovalStatus.PENDING,
        journal_entries=[],
        closure_direction_summaries=[],
    )


def test_backfill_moves_day_and_note_and_retires_patch_key():
    event = make_event()
    registry = OpsSecurityObject.objects.create(
        code="OBJ-1",
        name="Концертный зал",
        object_type="Культура",
        region="г. Астана",
        address="ул. Кунаева, 1",
        object_state=OpsSecurityObject.ObjectState.ACTIVE,
        passport_state=OpsSecurityObject.PassportState.GREEN,
        ownership=OpsSecurityObject.Ownership.GUARDED,
    )
    row = OpsSecurityEventVisitObject.objects.create(
        event=event, object_name="  резиденция ", position=0
    )
    OpsGvoSummaryPatch.objects.create(
        event=event,
        patch={
            "weapons": "нет",
            "visits": [
                {
                    "day": "18.06.2026",
                    "weekday": "четверг",
                    "items": [
                        {"obj": "Резиденция", "note": "основной объект"},
                        {"obj": "Концертный зал", "note": "уточняется"},
                    ],
                }
            ],
        },
    )

    MIGRATION.forwards(django_apps, None)

    row.refresh_from_db()
    # Имя совпало через регистр и пробелы — новая строка не заводилась.
    assert row.visit_day == dt.date(2026, 6, 18)
    assert row.note == "основной объект"

    added = OpsSecurityEventVisitObject.objects.get(object_name="Концертный зал")
    assert added.event_id == event.pk
    # Ссылка в реестр найдена по имени: строка не сирота.
    assert added.security_object_id == registry.pk
    assert added.position == 1
    # «уточняется» — это ОТСУТСТВИЕ примечания, а не примечание.
    assert added.note == ""

    patch = OpsGvoSummaryPatch.objects.get(event=event)
    assert patch.patch == {"weapons": "нет"}


def test_backfill_deletes_patch_that_held_only_visits():
    event = make_event("ОМ-Б-2")
    OpsSecurityEventVisitObject.objects.create(
        event=event, object_name="Резиденция", position=0
    )
    OpsGvoSummaryPatch.objects.create(
        event=event,
        patch={
            "visits": [
                {"day": "битая дата", "weekday": "", "items": [{"obj": "Резиденция", "note": ""}]}
            ]
        },
    )

    MIGRATION.forwards(django_apps, None)

    # Дата не разобралась — день остаётся пустым («в день мероприятия»), а не
    # придуманным: сводка тогда покажет объект в дате ОМ.
    assert OpsSecurityEventVisitObject.objects.get(event=event).visit_day is None
    assert not OpsGvoSummaryPatch.objects.filter(event=event).exists()


def test_backfill_keeps_events_without_visits_patch_untouched():
    event = make_event("ОМ-Б-3")
    OpsSecurityEventVisitObject.objects.create(
        event=event, object_name="Резиденция", position=0, note="было"
    )
    OpsGvoSummaryPatch.objects.create(event=event, patch={"country": "Китай"})

    MIGRATION.forwards(django_apps, None)

    assert OpsSecurityEventVisitObject.objects.get(event=event).note == "было"
    assert OpsGvoSummaryPatch.objects.get(event=event).patch == {"country": "Китай"}
