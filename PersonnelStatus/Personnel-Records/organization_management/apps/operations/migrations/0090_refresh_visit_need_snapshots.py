"""Plane №414: снимки потребности объектов приводятся к расчёту.

`force_need`/`force_assigned` в строке объекта посещения — СНИМКИ: раскрытая
строка реестра показывает их, и считать их запросом на каждую строку значило бы
вернуть N+1 (см. `recompute_visit_needs`). Снимок обновляли правка расчёта и
правка расстановки, но НЕ добавление и не снятие объекта посещения — а именно
они меняют принадлежность постов, ничего не написав в расчёт: неразмеченная
строка принадлежит ЕДИНСТВЕННОМУ объекту и НИКОМУ, как только объектов стало
двое (`visit_object_posts`).

Из-за этого снимок оставался от прежнего разреза, а `recompute_event_stage`
складывал из таких снимков потребность мероприятия — реестр печатал число,
которого в расчёте уже нет. На стенде 04.09.2026 так разошлись пять объектов
из двадцати семи мероприятий.

Сам разрыв закрыт вызовами `recompute_visit_needs` в `add_visit_object` и
`remove_visit_object`; эта миграция чинит строки, разошедшиеся ДО правки —
иначе они остались бы врать навсегда: их снимок никто больше не тронет, пока
кто-нибудь не отредактирует расчёт.

Правило разреза повторено здесь руками, а не позвано из сервиса: миграция
обязана считать по модели своего среза (`apps.get_model`), и импорт живого
сервиса привязал бы её к сегодняшней форме кода.
"""

from django.db import migrations


def _refresh_snapshots(apps, schema_editor):
    Event = apps.get_model("operations", "OpsSecurityEvent")

    fixed = 0
    for event in Event.objects.all().prefetch_related("visit_objects"):
        visits = list(event.visit_objects.all())
        if not visits:
            continue
        posts = event.recon_sector_posts or []
        assignments = event.placement_assignments or []
        single = len(visits) == 1
        for visit in visits:
            # Тот же разрез, что у `visit_object_posts`: у единственного
            # объекта посты ВСЕ, у второго и последующих — только свои.
            scoped = (
                list(posts)
                if single
                else [
                    p
                    for p in posts
                    if str(p.get("visitObjectId") or "") == str(visit.pk)
                ]
            )
            need = sum(int(p.get("need") or 0) for p in scoped)
            post_ids = {str(p.get("id")) for p in scoped}
            assigned = sum(
                1 for a in assignments if str(a.get("postId")) in post_ids
            )
            if visit.force_need == need and visit.force_assigned == assigned:
                continue
            visit.force_need = need
            visit.force_assigned = assigned
            visit.save(update_fields=["force_need", "force_assigned", "updated_at"])
            fixed += 1

    print(f"\n  снимки потребности приведены к расчёту: объектов — {fixed}")


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0089_forces_ledger_verbose_names"),
    ]

    operations = [
        migrations.RunPython(_refresh_snapshots, migrations.RunPython.noop),
    ]
