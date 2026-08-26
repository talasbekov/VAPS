"""Пересчёт состояния паспорта у заведённых объектов (Plane №66).

Состояние (`RED` / `YELLOW` / `GREEN`) до 26.08.2026 никто не ставил:
`create_object` жёстко писал RED, публикация версии поля не трогала. В базе
поэтому лежит смесь: у большинства объектов RED независимо от того, оформлен
паспорт или нет, а у фикстуры стенда — GREEN, дописанный прямо в поле, потому
что иначе пробе было не на что смотреть.

Правило теперь есть (`ops/passport.py::resolve_passport_state`), и его надо
применить к тому, что уже заведено, — иначе реестр останется врать до первой
правки каждого паспорта, а у части объектов не изменится никогда.

ЗАЧЕМ ПОВТОРЯТЬ ПРАВИЛО ЗДЕСЬ, а не звать функцию сервиса: миграция работает с
историческими моделями (`apps.get_model`), у которых нет менеджеров и связей
рабочего кода. Вызов сервиса привязал бы миграцию к сегодняшнему коду, и
переписанное завтра правило изменило бы смысл вчерашней миграции. Копия здесь
заморожена намеренно — она описывает состояние на дату переноса.

Откат — no-op с записью причины: вернуть «как было» нельзя, прежние значения
не хранились нигде, а выдумывать RED всем подряд значило бы сломать данные
второй раз.
"""
from django.db import migrations


def shape(sectors):
    return [
        (
            str(sector.get("name", "")).strip(),
            [str(post.get("name", "")).strip() for post in sector.get("posts", [])],
        )
        for sector in sectors or []
    ]


def forwards(apps, schema_editor):
    OpsSecurityObject = apps.get_model("operations", "OpsSecurityObject")
    counts = {"RED": 0, "YELLOW": 0, "GREEN": 0}
    for security_object in OpsSecurityObject.objects.all().iterator():
        sectors = list(security_object.sectors.all().order_by("position", "id"))
        draft = [
            {
                "name": sector.name,
                "posts": [
                    {"name": post.name}
                    for post in sector.posts.all().order_by("position", "id")
                ],
            }
            for sector in sectors
        ]
        has_posts = any(sector["posts"] for sector in draft)
        latest = (
            security_object.passport_versions.order_by("-version_number")
            .values_list("sectors_snapshot", flat=True)
            .first()
        )
        if not has_posts:
            state = "RED"
        elif latest is None or shape(draft) != shape(latest):
            state = "YELLOW"
        else:
            state = "GREEN"
        counts[state] += 1
        if security_object.passport_state != state:
            security_object.passport_state = state
            security_object.save(update_fields=["passport_state"])
    print(
        "  состояния паспортов пересчитаны: "
        f"RED {counts['RED']}, YELLOW {counts['YELLOW']}, GREEN {counts['GREEN']}"
    )


def backwards(apps, schema_editor):
    print(
        "  откат пересчёта состояний — no-op: прежние значения не хранились "
        "нигде, и выдуманный RED всем подряд сломал бы данные второй раз"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0048_rated_participant_employee"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
