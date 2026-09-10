"""Сделать ключ service report идемпотентным в пределах одного актора.

Одинаковый клиентский ключ у разных пользователей — независимые запросы;
глобальная уникальность превращала второй запуск в раскрывающий 404.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("operations", "0119_report_generate_head_department_only")]

    operations = [
        migrations.AlterField(
            model_name="opsservicereportjob",
            name="idempotency_key",
            field=models.CharField(max_length=255),
        ),
        migrations.AddConstraint(
            model_name="opsservicereportjob",
            constraint=models.UniqueConstraint(
                fields=("created_by_user_id", "idempotency_key"),
                name="uq_ops_report_job_actor_idempotency",
            ),
        ),
    ]
