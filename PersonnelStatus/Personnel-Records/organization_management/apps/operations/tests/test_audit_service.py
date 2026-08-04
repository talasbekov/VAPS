"""Журнал раздела ОМ: единственная точка записи и запрет правки.

Проверяется сама механика журнала — словарь событий, источник времени,
транзакция вызывающего и append-only на уровне БД. Покрытие мутаций
(какое событие пишет какой сервис) — отдельный срез.
"""
from datetime import date, timedelta

import pytest
from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from organization_management.apps.operations import audit_service, clock
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_status import OpsEmployeeStatus

pytestmark = pytest.mark.django_db

TODAY = date(2026, 8, 4)
ACTOR = "7"


def make_row(**overrides):
    fields = {
        "actor": ACTOR,
        "action": audit_service.STATUS_CREATED,
        "entity_type": audit_service.ENTITY_STATUS,
        "entity_id": 1,
    }
    fields.update(overrides)
    with clock.override(TODAY):
        return audit_service.record(**fields)


# ── Запись ───────────────────────────────────────────────────────────────

def test_record_writes_the_event():
    entry = make_row(
        old_value={"comment": ""},
        new_value={"comment": "уточнение"},
        reason="приказ №5",
    )
    from_db = OpsAuditLog.objects.get(pk=entry.pk)
    assert from_db.actor_user_id == ACTOR
    assert from_db.action == audit_service.STATUS_CREATED
    assert from_db.entity_type == audit_service.ENTITY_STATUS
    assert from_db.entity_id == 1
    assert from_db.old_value == {"comment": ""}
    assert from_db.new_value == {"comment": "уточнение"}
    assert from_db.reason == "приказ №5"


def test_time_comes_from_the_section_clock():
    # Не auto_now_add: событие задним числом (перенос данных, догон) обязано
    # лечь своим временем, а не временем импорта. Подмена часов это и
    # доказывает.
    #
    # Сравнение идёт с ЗАМОРОЖЕННЫМ моментом целиком, а не с .date():
    # локальная полночь в плюсовой зоне это ПРЕДЫДУЩИЙ день по UTC, и ассерт
    # по дате зависел бы от зоны машины (в +05 он краснеет, в UTC зеленеет).
    with clock.override(TODAY):
        frozen = Clock.now()
    entry = make_row()
    assert entry.created_at == frozen
    assert OpsAuditLog.objects.get(pk=entry.pk).created_at == frozen
    # Без подмены часы идут обычным ходом — проба не «заморозила» время
    # навсегда.
    live = audit_service.record(
        actor=ACTOR,
        action=audit_service.STATUS_CREATED,
        entity_type=audit_service.ENTITY_STATUS,
        entity_id=2,
    )
    assert live.created_at != frozen


def test_snapshots_default_to_null_not_empty():
    # У создания нет «до»: пустой словарь означал бы «объект был, и он был
    # пуст» — это другое утверждение.
    entry = make_row()
    from_db = OpsAuditLog.objects.get(pk=entry.pk)
    assert from_db.old_value is None
    assert from_db.new_value is None


# ── Закрытый мир ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("actor", ["", "   ", None])
def test_empty_actor_is_rejected(actor):
    with pytest.raises(ValueError):
        make_row(actor=actor)
    assert not OpsAuditLog.objects.exists()


def test_unknown_action_is_rejected():
    # Опечатка иначе создала бы «новое» событие, которого никто не найдёт
    # фильтром.
    with pytest.raises(ValueError):
        make_row(action="STATUS_CANCELED")  # одна L — опечатка
    assert not OpsAuditLog.objects.exists()


def test_unknown_entity_type_is_rejected():
    with pytest.raises(ValueError):
        make_row(entity_type="status")
    assert not OpsAuditLog.objects.exists()


def test_every_declared_action_is_writable():
    # Словарь и проверка не должны разъезжаться: каждое объявленное событие
    # обязано записываться.
    for index, action in enumerate(sorted(audit_service.ACTIONS)):
        make_row(action=action, entity_id=index)
    assert OpsAuditLog.objects.count() == len(audit_service.ACTIONS)


# ── Транзакция вызывающего ───────────────────────────────────────────────

def test_record_joins_the_caller_transaction():
    # Журнал рассказывает о СЛУЧИВШЕМСЯ: откат мутации уносит и запись о ней.
    # Проверяется, что запись СИНХРОННА и живёт в транзакции вызывающего —
    # отдельное соединение или автокоммит пережили бы откат. (Требовать
    # «record() не открывает свою транзакцию» бессмысленно: вложенный atomic
    # в Django откатывается вместе с внешним, такую мутацию не отличить.)
    with pytest.raises(RuntimeError):
        with transaction.atomic():
            make_row()
            raise RuntimeError("мутация не удалась")
    assert not OpsAuditLog.objects.exists()


# ── Append-only на уровне БД ─────────────────────────────────────────────

def test_db_rejects_update():
    entry = make_row()
    with pytest.raises(Exception) as exc:
        with transaction.atomic():
            OpsAuditLog.objects.filter(pk=entry.pk).update(reason="переписано")
    assert "дополняется только" in str(exc.value)
    assert OpsAuditLog.objects.get(pk=entry.pk).reason == ""


def test_db_rejects_delete():
    entry = make_row()
    with pytest.raises(Exception) as exc:
        with transaction.atomic():
            OpsAuditLog.objects.filter(pk=entry.pk).delete()
    assert "дополняется только" in str(exc.value)
    assert OpsAuditLog.objects.filter(pk=entry.pk).exists()


def test_raw_sql_update_is_rejected_too():
    # Запрет держит БД, а не ORM: правка в обход моделей тоже не проходит.
    entry = make_row()
    with pytest.raises(Exception):
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE ops_audit_logs SET reason = %s WHERE id = %s",
                    ["в обход ORM", entry.pk],
                )
    assert OpsAuditLog.objects.get(pk=entry.pk).reason == ""


# ── Снимки ───────────────────────────────────────────────────────────────

def test_status_snapshot_is_json_safe_and_flat():
    status = OpsEmployeeStatus.objects.create(
        employee_id=1,
        status_type_code="DUTY",
        date_start=TODAY,
        date_end=TODAY + timedelta(days=2),
        source=OpsEmployeeStatus.Source.USER,
        created_by=ACTOR,
        comment="в наряде",
    )
    snapshot = audit_service.status_snapshot(status)
    # Даты строками, ссылок на объекты нет: журнал переживёт и смену схемы, и
    # удаление типа из справочника.
    assert snapshot["date_start"] == str(TODAY)
    assert snapshot["cancelled_at"] is None
    assert snapshot["comment"] == "в наряде"
    assert all(
        isinstance(value, (str, int, type(None))) for value in snapshot.values()
    ), snapshot
    # Снимок реально кладётся в JSON-поле без преобразований.
    entry = make_row(new_value=snapshot)
    assert OpsAuditLog.objects.get(pk=entry.pk).new_value == snapshot


def test_status_snapshot_carries_cancellation_facts():
    status = OpsEmployeeStatus.objects.create(
        employee_id=1,
        status_type_code="DUTY",
        date_start=TODAY,
        date_end=TODAY + timedelta(days=2),
        source=OpsEmployeeStatus.Source.USER,
        created_by=ACTOR,
        cancelled_at=timezone.now(),
        cancelled_by="9",
        cancelled_reason="приказ отменён",
    )
    snapshot = audit_service.status_snapshot(status)
    assert snapshot["cancelled_by"] == "9"
    assert snapshot["cancelled_reason"] == "приказ отменён"
    assert snapshot["cancelled_at"] is not None
