"""Добор строк участия, отставших после Ш-3 (Plane №274, Ш-5).

Бэкфилл Ш-3 перенёс то, что БЫЛО на момент миграции. Но выделение штабом
(`ops.security_events.add_allocation_member`) продолжало ставить статус,
НЕ заводя строки участия: за сутки так набралось 45 статусов, невидимых
новой таблице. Причина устранена в том же заходе — путь выделения теперь
передаёт `participations`; эта миграция добирает то, что успело отстать
между Ш-3 и Ш-5.

Почему миграцией, а не разовой командой: отставшие строки есть и на стенде,
и у всякого, кто накатил 0062 раньше правки кода. Разовая команда чинила бы
только ту базу, где о ней вспомнили.

Перенос ИДЕМПОТЕНТЕН: строки заводятся только тем статусам, у которых их
нет. Обратный перенос ничего не стирает — отличить добранное от
перенесённого в 0062 нельзя, а снос чужого был бы потерей данных.
"""
from django.db import migrations

_KIND_BY_STATUS = {
    "EVENT_ASSIGNMENT": "PHYSICAL_SQUAD",
    "EVENT_ASSIGNMENT_GROUP": "SCREENING_GROUP",
}


def _backfill_gap(apps, schema_editor):
    Status = apps.get_model("operations", "OpsEmployeeStatus")
    Participation = apps.get_model("operations", "OpsStatusParticipation")
    covered = set(Participation.objects.values_list("status_id", flat=True))
    rows = []
    for status in Status.objects.filter(
        status_type_code__in=_KIND_BY_STATUS,
        source_ref__startswith="security-event:",
    ).only("id", "status_type_code", "source_ref"):
        if status.pk in covered:
            continue
        raw = (status.source_ref or "").split(":", 1)[-1].strip()
        if not raw.isdigit():
            continue
        rows.append(
            Participation(
                status_id=status.pk,
                event_id=int(raw),
                kind_code=_KIND_BY_STATUS[status.status_type_code],
                role_code="",
            )
        )
    Participation.objects.bulk_create(rows, ignore_conflicts=True)


def _noop(apps, schema_editor):
    """Обратно ничего не стираем — см. шапку файла."""


class Migration(migrations.Migration):
    dependencies = [("operations", "0062_status_participation")]
    operations = [migrations.RunPython(_backfill_gap, _noop)]
