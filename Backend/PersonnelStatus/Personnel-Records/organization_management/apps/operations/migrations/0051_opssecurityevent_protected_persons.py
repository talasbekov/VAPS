"""Несколько охраняемых лиц у бюллетеня (Plane №188).

Поле `protected_person` НЕ снимается: оно остаётся главным лицом — тем, что
печатается в колонке «ОЛ» бланка бюллетеня, где место ровно одно. Новая связь
живёт рядом, старое снимается отдельным шагом после переезда читателей.

БЭКФИЛЛ ОБЯЗАТЕЛЕН. Без него у каждого уже заведённого мероприятия список лиц
оказался бы пуст, хотя лицо у него названо: экран показал бы «лицо не
назначено» там, где оно назначено, и первая же правка списка стёрла бы его
совсем. Новая сущность не должна быть пустой у уже заведённого.
"""
from django.db import migrations, models


def fill_from_the_single_person(apps, schema_editor):
    Event = apps.get_model("operations", "OpsSecurityEvent")
    for event in Event.objects.exclude(protected_person__isnull=True).only(
        "id", "protected_person_id"
    ):
        event.protected_persons.add(event.protected_person_id)


def drop_the_list(apps, schema_editor):
    """Обратный шаг: связь просто уходит вместе с полем.

    Отдельная функция нужна, чтобы миграция была ОБРАТИМОЙ — иначе откат
    упирается в «irreversible» ровно тогда, когда откатываться и приходится.
    Данные при этом не теряются: главное лицо всё это время лежит в
    `protected_person`, а лица сверх него в старой схеме и не помещались.
    """
    Event = apps.get_model("operations", "OpsSecurityEvent")
    for event in Event.objects.all().only("id"):
        event.protected_persons.clear()


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0050_opsratingauditentry_chk_ops_rating_audit_event_code"),
    ]

    operations = [
        migrations.AddField(
            model_name="opssecurityevent",
            name="protected_persons",
            field=models.ManyToManyField(
                blank=True,
                related_name="security_events_as_participant",
                to="operations.opsprotectedperson",
            ),
        ),
        migrations.RunPython(fill_from_the_single_person, drop_the_list),
    ]
