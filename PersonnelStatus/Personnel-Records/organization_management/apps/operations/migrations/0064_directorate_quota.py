"""Квота управления в строках раскладки (Plane №272, Ш-1).

Строка управления (`force_allocation[].directorates[]`) существовала с СС-2 —
её заводит оповещение, — но квоты у неё не было: управление узнавало «нас
позвали» и не узнавало «сколько от нас нужно».

Новое поле не должно быть пустым у уже заведённого, поэтому существующим
строкам проставляется `need: 0`. Ноль здесь — не заглушка, а факт: департамент
их ещё не раскладывал. Отвергнут вариант «поделить квоту департамента поровну
между управлениями» — он выдумал бы решение, которого никто не принимал, и
управления увидели бы у себя числа, названные миграцией.

Обратный перенос поле снимает: без него старый код читал бы строку с ключом,
которого его форма не знает.
"""
from django.db import migrations


def _add_quota(apps, schema_editor):
    Event = apps.get_model("operations", "OpsSecurityEvent")
    touched = []
    for event in Event.objects.exclude(force_allocation=[]).only(
        "id", "force_allocation"
    ):
        rows = event.force_allocation or []
        changed = False
        for row in rows:
            for directorate in row.get("directorates", []) or []:
                if "need" not in directorate:
                    directorate["need"] = 0
                    changed = True
        if changed:
            event.force_allocation = rows
            touched.append(event)
    Event.objects.bulk_update(touched, ["force_allocation"])


def _drop_quota(apps, schema_editor):
    Event = apps.get_model("operations", "OpsSecurityEvent")
    touched = []
    for event in Event.objects.exclude(force_allocation=[]).only(
        "id", "force_allocation"
    ):
        rows = event.force_allocation or []
        changed = False
        for row in rows:
            for directorate in row.get("directorates", []) or []:
                if "need" in directorate:
                    directorate.pop("need")
                    changed = True
        if changed:
            event.force_allocation = rows
            touched.append(event)
    Event.objects.bulk_update(touched, ["force_allocation"])


class Migration(migrations.Migration):
    dependencies = [("operations", "0063_backfill_participation_gap")]
    operations = [migrations.RunPython(_add_quota, _drop_quota)]
