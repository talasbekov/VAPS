"""`owner_actor_id` — только идентификатор учётки (Plane №949, ревью №825 по
№947, 08.09.2026).

Бэкфилл 0104 брал создателя из журнала аудита и клал в поле ЛЮБУЮ метку
актора самой ранней записи — включая системные («stand-seed» у ОМ, заведённых
сидом). Для права «создатель правит сводку» это безвредно (учётки с таким
именем нет), но поле «идентификатор учётки» лгало о типе, и следующий
читатель сравнил бы его с чем-нибудь ещё. Сервис с этого дня пишет только
цифры (`_creator_account_id`); здесь чистится осадок. Обратный ход — ничего:
восстанавливать системную метку незачем, а настоящих учёток правка не
касается.
"""
from django.db import migrations


def _blank_system_actors(apps, schema_editor):
    OpsSecurityEvent = apps.get_model("operations", "OpsSecurityEvent")
    for event in OpsSecurityEvent.objects.exclude(owner_actor_id=""):
        if not str(event.owner_actor_id).strip().isdigit():
            event.owner_actor_id = ""
            event.save(update_fields=["owner_actor_id"])


class Migration(migrations.Migration):
    dependencies = [("operations", "0108_ops_staff_separate_actor")]

    operations = [migrations.RunPython(_blank_system_actors, migrations.RunPython.noop)]
