"""Вид уведомления «Ответ департамента на запрос сил» (Plane №426, `[СБС-12]`):
штаб получает уведомление при каждом изменении «Выделяют» департаментом.
Словарь видов держит БД (`chk_ops_notif_kind`) — новая редакция ограничения,
как в 0074/0076/0083. Данных миграция не трогает.
"""
from django.db import migrations, models

KINDS = [
    ("SUBMISSION_LAGGING", "Отставание по сдаче"),
    ("EVENT_ACKNOWLEDGEMENT", "Заступление на ОМ"),
    ("FORCES_REQUEST", "Запрос сил управлению"),
    ("PLACEMENT_RETURNED", "Возврат расстановки"),
    ("ACKNOWLEDGEMENT_DUE_SOON", "Не подтвердили заступление — час до начала"),
    ("FORCES_RESPONSE", "Ответ департамента на запрос сил"),
]


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0084_approval_policy_section"),
    ]

    operations = [
        migrations.AlterField(
            model_name="opsnotification",
            name="kind",
            field=models.CharField(choices=KINDS, max_length=50),
        ),
        migrations.RemoveConstraint(model_name="opsnotification", name="chk_ops_notif_kind"),
        migrations.AddConstraint(
            model_name="opsnotification",
            constraint=models.CheckConstraint(
                condition=models.Q(("kind__in", [code for code, _ in KINDS])),
                name="chk_ops_notif_kind",
            ),
        ),
    ]
