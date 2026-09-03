"""Ш-1 плана №385 (Plane №407): у объекта посещения появляются СВОИ этапы.

Требование `[МД-04]` спецификации «Проходка ОМ»: «У объекта свои этапы 1–5 и
свой документ „Расстановка сил“ с версиями». До этой миграции весь ход работы
(чек-лист, посты, потребность, расстановка, согласование, журнал, закрытие) был
полями МЕРОПРИЯТИЯ, и мероприятие с двумя объектами вести было нельзя.

Поля заводятся РЯДОМ с полями мероприятия, а не вместо них: у одноимённых полей
`OpsSecurityEvent` около 160 читателей на сервере и 250 на клиенте, и снос в
один заход оставил бы раздел нерабочим. Читателей переводят шаги Ш-2…Ш-6, поля
мероприятия снимает Ш-7 (Plane №413).

БЭКФИЛЛ РАЗБИРАЕТ ТРИ СЛУЧАЯ, и они разные по смыслу — см. `_carry_stages`.
Число случаев каждого вида печатается: «сколько ОМ разъехалось» — факт, который
понадобится при разборе, а не догадка.
"""

from django.db import migrations, models


# Стадия «этапы ещё не начинались»: у объекта, которому этапы не достались,
# честнее оставить бюллетень, чем повторить стадию чужого расчёта.
_INITIAL_STAGE = "BULLETIN"

# Что именно переезжает: поле мероприятия → поле объекта. Список явный, а не
# «все совпадающие имена»: молчаливое совпадение имён однажды перенесёт не то.
_CARRIED = (
    ("stage", "stage"),
    ("recon_checklist", "recon_checklist"),
    ("recon_sector_posts", "recon_sector_posts"),
    ("force_need", "force_need"),
    ("placement_assignments", "placement_assignments"),
    ("approval_status", "approval_status"),
    ("approval_route", "approval_route"),
    ("approval_remarks", "approval_remarks"),
    ("approval_snapshot", "approval_snapshot"),
    ("journal_entries", "journal_entries"),
    ("closed_at", "closed_at"),
)


def _carry_stages(apps, schema_editor):
    """Переносит ход работы мероприятия в его объект посещения.

    Три случая, и обходиться с ними одинаково нельзя:

    * **объектов нет** — этапы остались бы ничьими, и карточка старого ОМ
      после переезда читателей оказалась бы пустой. Заводится ОДИН объект из
      `security_object` мероприятия (или строка-заглушка, если и его нет), и
      этапы достаются ему;
    * **объект ровно один** — прямая копия;
    * **объектов несколько** — копия в объект с наименьшей `position`,
      остальным пустые этапы. Разнести общий расчёт постов по объектам задним
      числом НЕЛЬЗЯ: в строке поста объект не записан, и любое разнесение было
      бы выдуманным фактом.
    """
    Event = apps.get_model("operations", "OpsSecurityEvent")
    VisitObject = apps.get_model("operations", "OpsSecurityEventVisitObject")

    created, single, first_of_many = 0, 0, 0
    for event in Event.objects.all().prefetch_related("visit_objects"):
        objects = sorted(
            event.visit_objects.all(), key=lambda row: (row.position, row.pk)
        )
        if not objects:
            target = VisitObject(
                event=event,
                security_object=event.security_object,
                # Имя не может быть пустым (`chk_ops_event_visit_object_name`),
                # а выдумывать его нельзя — отсюда честная заглушка.
                object_name=event.object_name or "Объект не указан",
                passport_binding=event.passport_binding,
                protected_person=event.protected_person,
                protected_person_name=event.protected_person_name,
                position=1,
                note="",
            )
            created += 1
        else:
            target = objects[0]
            if len(objects) == 1:
                single += 1
            else:
                first_of_many += 1
        for source_field, target_field in _CARRIED:
            setattr(target, target_field, getattr(event, source_field))
        # Назначено — снимок счёта расстановки: у старых ОМ другого источника
        # нет, а нуль читался бы как «никого не дали».
        target.force_assigned = len(target.placement_assignments or [])
        target.save()

    print(
        f"\n  этапы перенесены в объект посещения: объект заведён — {created}, "
        f"единственный объект — {single}, первый из нескольких — {first_of_many}"
    )


class Migration(migrations.Migration):

    dependencies = [
        ('operations', '0067_om_category_org_drops_orgstructure_view'),
    ]

    operations = [
        migrations.AddField(
            model_name='opssecurityeventvisitobject',
            name='approval_remarks',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='opssecurityeventvisitobject',
            name='approval_route',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='opssecurityeventvisitobject',
            name='approval_snapshot',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='opssecurityeventvisitobject',
            name='approval_status',
            field=models.CharField(choices=[('PENDING', 'Ожидает'), ('APPROVED', 'Согласовано'), ('RETURNED', 'Возвращено')], default='PENDING', max_length=20),
        ),
        migrations.AddField(
            model_name='opssecurityeventvisitobject',
            name='closed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='opssecurityeventvisitobject',
            name='force_assigned',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='opssecurityeventvisitobject',
            name='force_need',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='opssecurityeventvisitobject',
            name='journal_entries',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='opssecurityeventvisitobject',
            name='placement_assignments',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='opssecurityeventvisitobject',
            name='recon_checklist',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='opssecurityeventvisitobject',
            name='recon_notes',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='opssecurityeventvisitobject',
            name='recon_sector_posts',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='opssecurityeventvisitobject',
            name='stage',
            field=models.CharField(choices=[('BULLETIN', 'Бюллетень'), ('RECON', 'Рекогносцировка'), ('DEMAND', 'Потребность'), ('FORCES', 'Запрос сил'), ('PLACEMENT', 'Расстановка'), ('APPROVAL', 'Согласование'), ('ACKNOWLEDGEMENT', 'Ознакомление'), ('CONDUCT', 'Проведение'), ('CLOSED', 'Закрыто')], default='BULLETIN', max_length=20),
        ),
        migrations.AddConstraint(
            model_name='opssecurityeventvisitobject',
            constraint=models.CheckConstraint(condition=models.Q(('stage__in', ('BULLETIN', 'RECON', 'DEMAND', 'FORCES', 'PLACEMENT', 'APPROVAL', 'ACKNOWLEDGEMENT', 'CONDUCT', 'CLOSED'))), name='chk_ops_event_visit_object_stage'),
        ),
        # Перенос значений — ПОСЛЕ добавления полей: до них писать некуда.
        migrations.RunPython(_carry_stages, migrations.RunPython.noop),
    ]
