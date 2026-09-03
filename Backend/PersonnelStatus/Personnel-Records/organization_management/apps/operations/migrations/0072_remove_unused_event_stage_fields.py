"""Ш-7 плана №385 (Plane №413): снятие полей, вытесненных переездом на объект.

Требование `[МД-04]` закрыто Ш-1…Ш-6: у объекта посещения свои этапы,
потребность и документ «Расстановка сил» с версией. Эта миграция снимает
СТОЛБЦЫ, которые оказались лишними, а не «поля этапа мероприятия вообще» —
разбор по каждому:

* `OpsSecurityEvent.approval_route/remarks/snapshot` — с Ш-5 (Plane №411) все
  мутации согласования пишут ИСКЛЮЧИТЕЛЬНО в объект посещения, а завести
  согласование без объекта нельзя вовсе (`pick_visit_object` отбивает
  `VISIT_OBJECT_REQUIRED`). У каждого ОМ есть хотя бы один объект (миграция
  0068), поэтому копия у мероприятия с Ш-5 не пишется НИКЕМ. `approval_status`
  и `approval_comment` мероприятия ОСТАЮТСЯ — это сводные поля (Ш-6, №412),
  вывод по всем объектам, а не копия одного;
* `OpsSecurityEventVisitObject.recon_checklist/recon_sector_posts/
  recon_notes/placement_assignments/journal_entries` — заведены Ш-1 (0068)
  как дубликат одноимённых полей мероприятия, но Ш-2 [РЕК-05/08] выбрал ДРУГОЙ
  путь: ОДИН общий расчёт постов мероприятия, где строка несёт `visitObjectId`
  (Plane №408). Дубликат ни разу не получил писателя — подтверждено грепом
  при взятии этого шага (03.09.2026) — и снимается БЕЗ бэкфилла: переносить
  было нечего.

`event.stage`, `event.force_need`, `readiness_percent`, `recon_checklist`,
`recon_sector_posts`, `placement_assignments`, `journal_entries`,
`closed_at` У МЕРОПРИЯТИЯ НЕ СНИМАЮТСЯ — это ЖИВЫЕ поля: первые три считает
`recompute_event_stage` (Ш-6), остальные — единственный источник расчёта
постов, назначений и журнала, общий на все объекты через разметку.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('operations', '0071_align_visit_object_stage'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='opssecurityevent',
            name='approval_remarks',
        ),
        migrations.RemoveField(
            model_name='opssecurityevent',
            name='approval_route',
        ),
        migrations.RemoveField(
            model_name='opssecurityevent',
            name='approval_snapshot',
        ),
        migrations.RemoveField(
            model_name='opssecurityeventvisitobject',
            name='journal_entries',
        ),
        migrations.RemoveField(
            model_name='opssecurityeventvisitobject',
            name='placement_assignments',
        ),
        migrations.RemoveField(
            model_name='opssecurityeventvisitobject',
            name='recon_checklist',
        ),
        migrations.RemoveField(
            model_name='opssecurityeventvisitobject',
            name='recon_notes',
        ),
        migrations.RemoveField(
            model_name='opssecurityeventvisitobject',
            name='recon_sector_posts',
        ),
    ]
