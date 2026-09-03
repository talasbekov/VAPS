"""Локация ОМ структурой и лицо на мероприятии с атрибутами (Plane №418).

1. `protected_persons` переезжает на промежуточную модель
   `OpsSecurityEventPerson` БЕЗ пересоздания таблицы: модель объявлена на
   ту же `db_table` и те же колонки, что у авто-связи, поэтому смена
   происходит только в состоянии миграций (`SeparateDatabaseAndState`),
   а строки связи остаются как были. Атрибуты визита добавляются
   обычными ALTER'ами следом.
2. Мероприятие получает `country`/`city`/`address`; строка `location`
   остаётся (её читают реестр, бюллетень, заявки), `address` бэкфиллится
   из неё — у уже заведённых ОМ структура не пуста.
"""
from django.db import migrations, models
import django.db.models.deletion


def backfill_address(apps, schema_editor):
    Event = apps.get_model("operations", "OpsSecurityEvent")
    for event in Event.objects.exclude(location="").only("id", "location"):
        Event.objects.filter(pk=event.pk).update(address=event.location[:255])


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0078_geo_dictionaries_and_person_code"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name="OpsSecurityEventPerson",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("event", models.ForeignKey(db_column="opssecurityevent_id", on_delete=django.db.models.deletion.CASCADE, related_name="person_links", to="operations.opssecurityevent")),
                        ("person", models.ForeignKey(db_column="opsprotectedperson_id", on_delete=django.db.models.deletion.CASCADE, related_name="event_links", to="operations.opsprotectedperson")),
                    ],
                    options={
                        "verbose_name": "Лицо на мероприятии",
                        "verbose_name_plural": "Лица на мероприятии",
                        "db_table": "ops_security_events_protected_persons",
                        "unique_together": {("event", "person")},
                    },
                ),
                migrations.AlterField(
                    model_name="opssecurityevent",
                    name="protected_persons",
                    field=models.ManyToManyField(blank=True, related_name="security_events_as_participant", through="operations.OpsSecurityEventPerson", through_fields=("event", "person"), to="operations.opsprotectedperson"),
                ),
            ],
            database_operations=[],
        ),
        migrations.AddField(model_name="opssecurityeventperson", name="arrival_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="opssecurityeventperson", name="departure_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="opssecurityeventperson", name="flight_arrival", field=models.CharField(blank=True, max_length=100)),
        migrations.AddField(model_name="opssecurityeventperson", name="flight_departure", field=models.CharField(blank=True, max_length=100)),
        migrations.AddField(model_name="opssecurityeventperson", name="is_senior", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="opssecurityeventperson", name="note", field=models.CharField(blank=True, max_length=255)),
        migrations.AddField(
            model_name="opssecurityevent",
            name="country",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="operations.opscountry"),
        ),
        migrations.AddField(
            model_name="opssecurityevent",
            name="city",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="operations.opscity"),
        ),
        migrations.AddField(
            model_name="opssecurityevent",
            name="address",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.RunPython(backfill_address, migrations.RunPython.noop),
    ]
