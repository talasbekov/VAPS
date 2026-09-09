from django.db import migrations, models


def copy_recon_state_to_visits(apps, schema_editor):
    Event = apps.get_model("operations", "OpsSecurityEvent")
    Visit = apps.get_model("operations", "OpsSecurityEventVisitObject")
    for event in Event.objects.prefetch_related("visit_objects").iterator(
        chunk_size=500
    ):
        visits = list(event.visit_objects.all())
        for visit in visits:
            visit.recon_checklist = [dict(row) for row in (event.recon_checklist or [])]
            # У одного объекта старое число однозначно его. У
            # нескольких оно неразделимо, поэтому остаётся только в
            # legacy-поле ОМ до пересчёта по постам.
            if len(visits) == 1:
                visit.recon_force_request = event.recon_force_request
            visit.save(update_fields=["recon_checklist", "recon_force_request"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [("operations", "0109_owner_actor_id_only_accounts")]

    operations = [
        migrations.AddField(
            model_name="opssecurityeventvisitobject",
            name="recon_checklist",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="opssecurityeventvisitobject",
            name="recon_force_request",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.RunPython(copy_recon_state_to_visits, noop_reverse),
    ]
