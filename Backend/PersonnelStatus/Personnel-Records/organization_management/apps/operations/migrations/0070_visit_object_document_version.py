"""Ш-5 плана №385 (Plane №411): у документа объекта появляется номер версии.

Требование `[МД-04]`: «У объекта свои этапы 1–5 и свой документ „Расстановка
сил“ **с версиями**». Номер растёт отправкой расстановки на согласование:
версия — это состав, под которым подписываются согласующие.

БЭКФИЛЛ ЧИТАЕТ СНИМОК, А НЕ СЧИТАЕТ ОТПРАВКИ. Сколько раз расстановку
отправляли до этой миграции, система не записывала — этого факта в базе нет и
восстановить его нечем. Но есть след ОДНОЙ отправки: непустой
`approval_snapshot` означает «состав уходил согласующим». Таким объектам
ставится версия 1 — заниженная, зато не выдуманная; остальным 0 («документ не
формировался»). Точный счёт прошлых кругов согласования пришёл бы только с
историей версий, а её ведёт №398.
"""

from django.db import migrations, models


def _mark_sent_placements(apps, schema_editor):
    VisitObject = apps.get_model("operations", "OpsSecurityEventVisitObject")
    sent = VisitObject.objects.exclude(approval_snapshot="").update(
        document_version=1
    )
    # Причина возврата достаётся ТОМУ ЖЕ объекту, которому Ш-1 отдал маршрут и
    # замечания (первый по `position`): разлучать решение и замечания, которые
    # его объясняют, нельзя — карточка объекта показывает их рядом.
    Event = apps.get_model("operations", "OpsSecurityEvent")
    carried = 0
    for event in Event.objects.exclude(approval_comment="").prefetch_related(
        "visit_objects"
    ):
        target = min(
            event.visit_objects.all(),
            key=lambda row: (row.position, row.pk),
            default=None,
        )
        if target is None:
            continue
        target.approval_comment = event.approval_comment
        target.save(update_fields=["approval_comment"])
        carried += 1
    print(
        f"\n  версия документа проставлена: объектов с отправленной "
        f"расстановкой — {sent}; причина возврата перенесена у {carried} ОМ"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0069_mark_recon_posts_with_visit_object"),
    ]

    operations = [
        migrations.AddField(
            model_name="opssecurityeventvisitobject",
            name="approval_comment",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="opssecurityeventvisitobject",
            name="document_version",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.RunPython(_mark_sent_placements, migrations.RunPython.noop),
    ]
