"""Вид уведомления «Сводный запрос сил департаменту» (Plane №922, решение
заказчика 06.09.2026).

Начальник департамента получает ОДНО письмо про все свои управления заявки, а
не одно про первое из них: ключ уведомления — (получатель, вид, деловая дата),
и под общим видом `FORCES_REQUEST` вторая и третья строки схлопывались бы в
первую. Замерено до правки: у начальника с двумя управлениями создавалась одна
строка «Первое управление, выделить 2», про второе он не узнавал.

Словарь видов держит БД (`chk_ops_notif_kind`) — новая редакция ограничения,
как в 0074/0076/0083/0085. Данных миграция не трогает.
"""
from django.db import migrations, models

KINDS = [
    ("SUBMISSION_LAGGING", "Отставание по сдаче"),
    ("EVENT_ACKNOWLEDGEMENT", "Заступление на ОМ"),
    ("FORCES_REQUEST", "Запрос сил управлению"),
    # Порядок здесь ЗНАЧИМ и повторяет `OpsNotification.Kind`: Django сверяет
    # choices как последовательность, и перестановка даёт лишнюю миграцию на
    # ровном месте (проверено `makemigrations --check`).
    ("FORCES_REQUEST_DEPARTMENT", "Сводный запрос сил департаменту"),
    ("PLACEMENT_RETURNED", "Возврат расстановки"),
    ("ACKNOWLEDGEMENT_DUE_SOON", "Не подтвердили заступление — час до начала"),
    ("FORCES_RESPONSE", "Ответ департамента на запрос сил"),
    ("ASSIGNMENT_DECLINED", "Отказ сотрудника заступить"),
]


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0099_backfill_approval_remark_id"),
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
