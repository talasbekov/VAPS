"""Фотография охраняемого лица (Plane №951, задача заказчика 07.09.2026).

Заказчик: «Как добавить фото ОЛ? … со справочника ОЛ нужно подтягивать ОЛ и
здесь же должна быть кнопка добавить ОЛ». Карточка лица в сводных данных ГВО
рисовала заглушку «Фото ОЛ», а класть снимок было некуда: у
`OpsProtectedPerson` поля не было вовсе. Поле необязательное — у лиц,
заведённых раньше, снимка нет, и это честное состояние, а не пропуск.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0105_head_ops_unit_gvo_manage"),
    ]

    operations = [
        migrations.AddField(
            model_name="opsprotectedperson",
            name="photo",
            field=models.ImageField(
                blank=True, null=True, upload_to="protected-persons/photos/"
            ),
        ),
    ]
