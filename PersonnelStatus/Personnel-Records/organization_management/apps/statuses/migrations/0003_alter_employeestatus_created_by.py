"""`created_by` становится необязательным для ВАЛИДАЦИИ.

Схему БД миграция не меняет: колонка и так `NULL`-евая, `blank` живёт только на
уровне форм и `full_clean()`. Из-за расхождения между ними системная запись без
автора была невозможна — ветка автосоздания статуса в списке подразделения
роняла ручку 500. Теперь пустой автор означает «завела система»: сигнал при
заведении сотрудника и команда `ensure_employee_statuses`.

Откат безопасен и не теряет данных, но вернёт запрет: статусы с пустым
`created_by` (заведённые системой) перестанут проходить `full_clean()` при
следующем сохранении.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('statuses', '0002_alter_employeestatus_status_type'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name='employeestatus',
            name='created_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_statuses', to=settings.AUTH_USER_MODEL, verbose_name='Создал'),
        ),
    ]
