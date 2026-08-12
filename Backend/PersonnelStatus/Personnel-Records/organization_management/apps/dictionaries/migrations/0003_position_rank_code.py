"""Код у справочников Position и Rank (срез 154a).

Порядок операций важен: поле добавляется НЕОБЯЗАТЕЛЬНЫМ, затем data-шаг
проставляет коды существующим строкам, и только потом накладываются
уникальность и CHECK. Одной операцией с unique=True миграция упала бы на любой
непустой базе — все существующие строки получили бы пустую строку разом.

Существующим записям код проставляется СУРРОГАТОМ (`POS-<id>` / `RANK-<id>`):
он детерминирован, уникален и честно не притворяется осмысленным
классификатором. Настоящие коды приедут импортом справочников; замена
суррогата на них — обычный UPDATE, потому что внешних ссылок на код пока нет
(связи в старой схеме идут по id).
"""
from django.db import migrations, models


def fill_codes(apps, schema_editor):
    for model_name, prefix in (("Position", "POS"), ("Rank", "RANK")):
        model = apps.get_model("dictionaries", model_name)
        # update() пропустил бы auto_now, но здесь он и не нужен: это
        # техническая доливка поля, а не правка справочника пользователем.
        for row in model.objects.filter(code="").only("id"):
            model.objects.filter(pk=row.pk).update(code=f"{prefix}-{row.pk}")


def drop_codes(apps, schema_editor):
    # Обратный шаг оставляет поле пустым — его тут же снимет AddField.reverse.
    for model_name in ("Position", "Rank"):
        apps.get_model("dictionaries", model_name).objects.update(code="")


class Migration(migrations.Migration):

    dependencies = [
        ("dictionaries", "0002_seed_reference_data"),
    ]

    operations = [
        migrations.AddField(
            model_name="position",
            name="code",
            field=models.CharField(default="", max_length=100, verbose_name="Код"),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="rank",
            name="code",
            field=models.CharField(default="", max_length=100, verbose_name="Код"),
            preserve_default=False,
        ),
        migrations.RunPython(fill_codes, drop_codes),
        migrations.AlterField(
            model_name="position",
            name="code",
            field=models.CharField(max_length=100, unique=True, verbose_name="Код"),
        ),
        migrations.AlterField(
            model_name="rank",
            name="code",
            field=models.CharField(max_length=100, unique=True, verbose_name="Код"),
        ),
        migrations.AddConstraint(
            model_name="position",
            constraint=models.CheckConstraint(
                condition=models.Q(("code", ""), _negated=True),
                name="ck_position_code_not_blank",
            ),
        ),
        migrations.AddConstraint(
            model_name="rank",
            constraint=models.CheckConstraint(
                condition=models.Q(("code", ""), _negated=True),
                name="ck_rank_code_not_blank",
            ),
        ),
    ]
