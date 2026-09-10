"""Сделать ключ service report идемпотентным в пределах одного актора.

Одинаковый клиентский ключ у разных пользователей — независимые запросы;
глобальная уникальность превращала второй запуск в раскрывающий 404.

Migration намеренно необратима: вернуть глобальную уникальность без выбора
«какую из коллизирующих работ сохранить» значит молча удалить или исказить
историю. Такое решение должно быть отдельной миграцией с явной политикой.
"""

from django.db import migrations, models


def _mark_irreversible(apps, schema_editor):
    """Граница обратимости описана в docstring migration."""
    return None


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
        # reverse_code намеренно не задан: Django остановит rollback до
        # возврата схемы к global unique (см. docstring).
        migrations.RunPython(_mark_irreversible),
    ]
