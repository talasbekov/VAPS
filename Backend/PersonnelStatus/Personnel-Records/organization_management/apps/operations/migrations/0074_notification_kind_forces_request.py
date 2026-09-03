"""Вид уведомления «Запрос сил управлению» (Plane №392, `[СБС-22]`).

Словарь видов держит БД (`chk_ops_notif_kind`): раздел пишет через
`get_or_create()`, мимо `choices`. Новый вид — новая редакция ограничения,
как в 0058. Данных миграция не трогает.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0073_placement_document_versions"),
    ]

    operations = [
        # `choices` поля — состояние миграций, а не схема БД (в Postgres это
        # ничего не меняет): без AlterField `makemigrations` считал бы модель
        # неотражённой и заводил бы 0075 из ничего.
        migrations.AlterField(
            model_name="opsnotification",
            name="kind",
            field=models.CharField(
                choices=[
                    ("SUBMISSION_LAGGING", "Отставание по сдаче"),
                    ("EVENT_ACKNOWLEDGEMENT", "Заступление на ОМ"),
                    ("FORCES_REQUEST", "Запрос сил управлению"),
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
                        ["SUBMISSION_LAGGING", "EVENT_ACKNOWLEDGEMENT", "FORCES_REQUEST"],
                    )
                ),
                name="chk_ops_notif_kind",
            ),
        ),
    ]
