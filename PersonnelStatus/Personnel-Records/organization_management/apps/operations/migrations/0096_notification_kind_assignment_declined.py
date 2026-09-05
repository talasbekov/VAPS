"""Вид уведомления «Отказ сотрудника заступить» (Plane №451, `[ПРФ-04]`):
старший объекта, его замещающие и старший мероприятия узнают об отказе сразу,
а не заглянув в карточку. Словарь видов держит БД (`chk_ops_notif_kind`) —
новая редакция ограничения, как в 0074/0076/0083/0085. Данных не трогает.
"""
from django.db import migrations, models

KINDS = [
    ("SUBMISSION_LAGGING", "Отставание по сдаче"),
    ("EVENT_ACKNOWLEDGEMENT", "Заступление на ОМ"),
    ("FORCES_REQUEST", "Запрос сил управлению"),
    ("PLACEMENT_RETURNED", "Возврат расстановки"),
    ("ACKNOWLEDGEMENT_DUE_SOON", "Не подтвердили заступление — час до начала"),
    ("FORCES_RESPONSE", "Ответ департамента на запрос сил"),
    ("ASSIGNMENT_DECLINED", "Отказ сотрудника заступить"),
]


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0095_backfill_approval_remark_status"),
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
