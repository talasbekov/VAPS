"""Бэкфилл: уникализация id строк расчёта постов рекогносцировки (Plane №30).

Клиент помечал не сохранённые строки счётчиком `recon-local-N`, живущим в
памяти вкладки: после перезагрузки счётчик начинался заново, а сервер писал
присланный id как есть. На стенде у ОМ-2026-137 набралось шесть постов с id
`recon-local-1` — React ругался на одинаковые ключи, а `placement/assign`
попадал в ПЕРВЫЙ совпавший пост, то есть назначение уезжало на чужую строку.

Сервер id теперь выдаёт сам (`update_recon`), но уже сохранённые дубли этим не
лечатся: правка расчёта на карточке произойдёт не у каждого ОМ. Здесь дубли
разводятся разово.

ПОРЯДОК ВАЖЕН: первое вхождение id сохраняет его. Именно в него и попадали все
существующие назначения (поиск шёл по первому совпадению), поэтому расстановка
и ознакомление после миграции указывают ровно туда же, куда указывали до неё.
Новый id получают только последующие вхождения и строки без id — на них
сослаться было нельзя в принципе.

Обратной операции нет: старый id второго дубля неотличим от id первого, и
«вернуть как было» означало бы снова сделать две строки неразличимыми.
"""
from uuid import uuid4

from django.db import migrations


def forwards(apps, schema_editor):
    OpsSecurityEvent = apps.get_model("operations", "OpsSecurityEvent")
    for event in OpsSecurityEvent.objects.exclude(
        recon_sector_posts=[]
    ).iterator():
        rows = event.recon_sector_posts or []
        seen = set()
        changed = False
        fixed = []
        for row in rows:
            row_id = str(row.get("id") or "").strip()
            if not row_id or row_id in seen:
                row_id = f"post-{uuid4().hex[:12]}"
                while row_id in seen:
                    row_id = f"post-{uuid4().hex[:12]}"
                changed = True
            seen.add(row_id)
            fixed.append({**row, "id": row_id})
        if changed:
            event.recon_sector_posts = fixed
            event.save(update_fields=["recon_sector_posts"])


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0040_opssecurityeventvisitobject_chief_employee_id_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
