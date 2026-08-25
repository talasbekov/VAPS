"""Бэкфилл 0041: дубли id строк расчёта постов рекогносцировки (Plane №30).

Сервер теперь выдаёт id сам, но уже сохранённые дубли этим не лечатся —
правка расчёта случится не у каждого ОМ. Проба стережёт два свойства переноса,
которые легко потерять: ПЕРВОЕ вхождение сохраняет свой id (именно в него
попадали все существующие назначения — поиск шёл по первому совпадению, и
смена этого id увела бы расстановку в никуда), а строка без id получает свой.
"""
import datetime as dt
import importlib

import pytest
from django.apps import apps as django_apps

from organization_management.apps.operations.models_event import OpsSecurityEvent

MIGRATION = importlib.import_module(
    "organization_management.apps.operations.migrations."
    "0041_dedupe_recon_post_ids"
)

pytestmark = pytest.mark.django_db


def make_event(code, posts):
    return OpsSecurityEvent.objects.create(
        code=code,
        title="Визит",
        object_name="Резиденция",
        business_date=dt.date(2026, 6, 18),
        stage=OpsSecurityEvent.Stage.RECON,
        readiness_percent=15,
        force_need=0,
        conflicts_count=0,
        owner_name="Шитов",
        recon_checklist=[],
        recon_sector_posts=posts,
        demand_rows=[],
        demand_approved=False,
        force_requests=[],
        placement_assignments=[],
        approval_status=OpsSecurityEvent.ApprovalStatus.PENDING,
        journal_entries=[],
        closure_direction_summaries=[],
    )


def post(row_id, name):
    return {"id": row_id, "sector": "Периметр", "post": name, "need": 1}


def test_backfill_splits_duplicates_and_keeps_first_id():
    dirty = make_event(
        "ОМ-Д-1",
        [
            post("recon-local-1", "Пост 1"),
            post("recon-local-1", "Пост 2"),
            post("recon-local-1", "Пост 3"),
            post("", "Пост без имени"),
        ],
    )
    clean = make_event("ОМ-Д-2", [post("post-abc123", "Пост 1")])

    MIGRATION.forwards(django_apps, None)

    dirty.refresh_from_db()
    ids = [row["id"] for row in dirty.recon_sector_posts]
    assert len(set(ids)) == 4, ids
    # Первое вхождение id не тронуто — на него ссылались назначения.
    assert ids[0] == "recon-local-1"
    assert ids[3] != ""
    assert [row["post"] for row in dirty.recon_sector_posts] == [
        "Пост 1", "Пост 2", "Пост 3", "Пост без имени",
    ]

    # Чистый ОМ миграция не трогает: лишняя запись — лишний повод разойтись.
    clean.refresh_from_db()
    assert [row["id"] for row in clean.recon_sector_posts] == ["post-abc123"]
