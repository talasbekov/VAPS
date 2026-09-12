"""Вид уведомления «Свод департамента отправлен дежурному» (Plane №1222,
`[ДОП-20-09]`, решение заказчика 12.09.2026): ответственный отправил свод —
все оперативные дежурные и получатель по умолчанию узнают об этом лентой, а не
открыв экран. Словарь видов держит БД (`chk_ops_notif_kind`) — новая редакция
ограничения, как в 0096/0102. Данных не трогает.
"""
from django.db import migrations, models

KINDS = [
    ("SUBMISSION_LAGGING", "Отставание по сдаче"),
    ("EVENT_ACKNOWLEDGEMENT", "Заступление на ОМ"),
    ("FORCES_REQUEST", "Запрос сил управлению"),
    ("FORCES_REQUEST_DEPARTMENT", "Сводный запрос сил департаменту"),
    ("PLACEMENT_RETURNED", "Возврат расстановки"),
    ("ACKNOWLEDGEMENT_DUE_SOON", "Не подтвердили заступление — час до начала"),
    ("FORCES_RESPONSE", "Ответ департамента на запрос сил"),
    ("ASSIGNMENT_DECLINED", "Отказ сотрудника заступить"),
    ("FORCES_REQUEST_SENT", "Запрос сил департаменту от штаба"),
    ("SUMMARY_SENT", "Свод департамента отправлен дежурному"),
]


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0124_personnel_mirror"),
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
