"""Принадлежность охраняемого объекта: собственный или охраняемый.

БЭКФИЛЛ — GUARDED ДЛЯ ВСЕГО СУЩЕСТВУЮЩЕГО, и это не «лишь бы чем заполнить».
Таблица заведена под именем «Охраняемый объект» (verbose_name миграции 0017),
то есть до этого среза весь реестр и был реестром охраняемых объектов;
собственные в нём не заводили, потому что отличить их было нечем. Обратный
бэкфилл (OWN) объявил бы про каждую строку то, чего никто не утверждал.

ДЕФОЛТ ОДНОРАЗОВЫЙ: preserve_default=False. У остальных choice-полей этой
модели дефолта нет намеренно («забытое поле не должно превращаться в
утверждение об объекте»), и ownership обязан жить по тому же правилу —
дефолт нужен ровно на время заливки колонки поверх существующих строк.

ПОРЯДОК ШАГОВ ЗНАЧИМ: ограничение добавляется ПОСЛЕ поля с дефолтом. Иначе
CheckConstraint проверялся бы на колонке, где старые строки ещё пусты, и
миграция падала бы на непустой базе.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0026_opsfeedbackregistry_opsfeedbackrequest_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="opssecurityobject",
            name="ownership",
            field=models.CharField(
                choices=[("OWN", "Собственный"), ("GUARDED", "Охраняемый")],
                default="GUARDED",
                max_length=10,
            ),
            preserve_default=False,
        ),
        migrations.AddConstraint(
            model_name="opssecurityobject",
            constraint=models.CheckConstraint(
                condition=models.Q(("ownership__in", ("OWN", "GUARDED"))),
                name="chk_ops_security_object_ownership",
            ),
        ),
    ]
