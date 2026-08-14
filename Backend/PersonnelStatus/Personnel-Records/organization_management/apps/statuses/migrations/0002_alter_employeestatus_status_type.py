# Добавление типа статуса «Конференция» (conference).
#
# Откат безопасен ТОЛЬКО пока значения 'conference' нет в данных: choices
# в PostgreSQL не ограничение, обратная миграция строку не удалит и не
# перепишет — она просто перестанет быть допустимой на уровне Django.
# Перед откатом на проде: перевести такие статусы в 'training' или
# 'other_absence' (в каноническом каталоге ОМ у CONFERENCE та же колонка
# расхода, что у STUDY, — TRAINING).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('statuses', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='employeestatus',
            name='status_type',
            field=models.CharField(choices=[('in_service', 'В строю'), ('vacation', 'Отпуск'), ('leave_by_report', 'Отпуск по рапорту'), ('sick_leave', 'Больничный'), ('business_trip', 'Командировка'), ('training', 'Учёба'), ('competition', 'На соревнованиях'), ('conference', 'Конференция'), ('other_absence', 'Отсутствие по иным причинам'), ('on_duty', 'На дежурстве'), ('after_duty', 'После дежурства'), ('seconded_from', 'Прикомандирован из'), ('seconded_to', 'Откомандирован в')], default='in_service', max_length=20, verbose_name='Тип статуса'),
        ),
    ]
