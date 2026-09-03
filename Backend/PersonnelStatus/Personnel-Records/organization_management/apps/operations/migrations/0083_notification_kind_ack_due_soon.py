"""Вид уведомления «Не подтвердили заступление — час до начала»
(Plane №427, `[ОЗН-06]`).

Свой вид, а не EVENT_ACKNOWLEDGEMENT: ключ модели «одно на день»
(получатель, вид, деловая дата) иначе глотал бы напоминание — руководитель
уже получил уведомление о заступлении на тот же день при открытии этапа.
Словарь видов держит БД (`chk_ops_notif_kind`) — новая редакция
ограничения, как в 0074/0076. Данных миграция не трогает.
"""
from django.db import migrations, models

KINDS = [
    ("SUBMISSION_LAGGING", "Отставание по сдаче"),
    ("EVENT_ACKNOWLEDGEMENT", "Заступление на ОМ"),
    ("FORCES_REQUEST", "Запрос сил управлению"),
    ("PLACEMENT_RETURNED", "Возврат расстановки"),
    ("ACKNOWLEDGEMENT_DUE_SOON", "Не подтвердили заступление — час до начала"),
]


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0082_force_request_ledger"),
    ]

    operations = [
        migrations.AlterField(
            model_name="opsnotification",
            name="kind",
            field=models.CharField(choices=KINDS, max_length=50),
        ),
        migrations.RemoveConstraint(
            model_name="opsnotification",
            name="chk_ops_notif_kind",
        ),
        migrations.AddConstraint(
            model_name="opsnotification",
            constraint=models.CheckConstraint(
                condition=models.Q(("kind__in", [code for code, _ in KINDS])),
                name="chk_ops_notif_kind",
            ),
        ),
    ]
