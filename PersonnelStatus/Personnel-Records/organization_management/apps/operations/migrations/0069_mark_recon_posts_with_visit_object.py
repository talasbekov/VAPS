"""Ш-2 плана №385 (Plane №408): посты расчёта получают свой объект посещения.

Требование `[РЕК-05]`: импорт постов идёт из паспорта ОБЪЕКТА ПОСЕЩЕНИЯ, и
потребность считается ПО ОБЪЕКТУ (`[РЕК-08]`, «потребность N, назначено 0» в
реестре). Разметка `visitObjectId` в строке расчёта была предусмотрена
контрактом с самого начала, но НЕ ПРОСТАВЛЯЛАСЬ никем: поиск по коду 03.09.2026
нашёл только читателей. Из-за этого `_visit_placement` отвечал «неизвестно» у
любого мероприятия с двумя объектами.

Задним числом разметить можно ТОЛЬКО там, где ответ единственный: у ОМ с одним
объектом посещения все посты — его. У ОМ с несколькими объектами разметка
остаётся пустой: в строке поста объект не записан, и приписать его значило бы
выдумать факт. Такие ОМ размечает человек на экране рекогносцировки (Plane
№409).
"""

from django.db import migrations


def _mark_posts(apps, schema_editor):
    Event = apps.get_model("operations", "OpsSecurityEvent")

    marked_events, marked_posts, ambiguous = 0, 0, 0
    for event in Event.objects.all().prefetch_related("visit_objects"):
        posts = event.recon_sector_posts or []
        if not posts:
            continue
        visits = list(event.visit_objects.all())
        if len(visits) != 1:
            if len(visits) > 1:
                ambiguous += 1
            continue
        visit_id = str(visits[0].pk)
        changed = False
        for post in posts:
            if str(post.get("visitObjectId") or ""):
                continue
            post["visitObjectId"] = visit_id
            marked_posts += 1
            changed = True
        if changed:
            marked_events += 1
            event.recon_sector_posts = posts
            event.save(update_fields=["recon_sector_posts", "updated_at"])

    print(
        f"\n  посты размечены объектом посещения: мероприятий — {marked_events}, "
        f"постов — {marked_posts}; осталось неразмеченными (объектов несколько) "
        f"— {ambiguous}"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0068_visit_object_stage_fields"),
    ]

    operations = [
        migrations.RunPython(_mark_posts, migrations.RunPython.noop),
    ]
