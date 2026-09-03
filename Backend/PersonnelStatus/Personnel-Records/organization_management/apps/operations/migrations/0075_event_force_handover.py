"""Передача собранных на расстановку (Plane №390, `[СБС-13]`).

Поле `force_handover` у мероприятия: момент, комментарий и недобор по
объектам. `{}` у всех существующих — ничего не передавалось. Данных
миграция не трогает.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0074_notification_kind_forces_request"),
    ]

    operations = [
        migrations.AddField(
            model_name="opssecurityevent",
            name="force_handover",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
