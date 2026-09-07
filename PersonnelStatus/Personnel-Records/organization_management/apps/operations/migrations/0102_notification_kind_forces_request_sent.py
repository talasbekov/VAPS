"""Вид уведомления «Запрос сил департаменту от штаба» (Plane №944, `[СБС-12]`).

Штаб нажал «Отправить запросы» — ответственный за сбор сил в департаменте
получает письмо со ссылкой в карточку заявки. Свой вид, а не
`FORCES_REQUEST_DEPARTMENT`: тот — СВОДКА начальнику департамента по
управлениям (№922), другой адресат и другой текст, а ключ уведомления
включает вид.

Словарь видов держит БД (`chk_ops_notif_kind`) — новая редакция ограничения,
как в 0100. Данных миграция не трогает.
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
    # Порядок повторяет `OpsNotification.Kind` (см. 0100).
    ("FORCES_REQUEST_SENT", "Запрос сил департаменту от штаба"),
]


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0101_forces_command_by_specification"),
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
