"""Вид уведомления «Возврат расстановки» (Plane №400, `[ВОЗ-03]`).

Спецификация: «При возврате: … уведомление старшему объекта и замещающим
„Расстановка по объекту „…“ возвращена: N замечаний“». Словарь видов держит
БД (`chk_ops_notif_kind`): раздел пишет через `get_or_create()`, мимо
`choices`. Новый вид — новая редакция ограничения, как в 0058/0074. Данных
миграция не трогает.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0075_event_force_handover"),
    ]

    operations = [
        # `choices` поля — состояние миграций, а не схема БД: без AlterField
        # `makemigrations` считал бы модель неотражённой.
        migrations.AlterField(
            model_name="opsnotification",
            name="kind",
            field=models.CharField(
                choices=[
                    ("SUBMISSION_LAGGING", "Отставание по сдаче"),
                    ("EVENT_ACKNOWLEDGEMENT", "Заступление на ОМ"),
                    ("FORCES_REQUEST", "Запрос сил управлению"),
                    ("PLACEMENT_RETURNED", "Возврат расстановки"),
                ],
                max_length=50,
            ),
        ),
        migrations.RemoveConstraint(
            model_name="opsnotification",
            name="chk_ops_notif_kind",
        ),
        migrations.AddConstraint(
            model_name="opsnotification",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    (
                        "kind__in",
                        [
                            "SUBMISSION_LAGGING",
                            "EVENT_ACKNOWLEDGEMENT",
                            "FORCES_REQUEST",
                            "PLACEMENT_RETURNED",
                        ],
                    )
                ),
                name="chk_ops_notif_kind",
            ),
        ),
    ]
