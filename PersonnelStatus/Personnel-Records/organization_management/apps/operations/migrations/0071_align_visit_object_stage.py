"""Ш-6 плана №385 (Plane №412): стадии объектов сводятся со стадией их ОМ.

Ш-1 (миграция 0068) отдал объекту стадию мероприятия, но между ним и этим
шагом объекты заводились БЕЗ неё — `create_event` и кнопка «+ Добавить объект»
писали значение по умолчанию («Бюллетень»), потому что читателей у поля тогда
не было. С этого шага читатель есть, и он главный: стадия мероприятия —
наименьшая среди объектов. Оставить как есть значило бы откатить назад каждое
ОМ, у которого объект заведён после Ш-1: карточка позвала бы заполнять
бюллетень, закрытый неделю назад.

РАСХОЖДЕНИЙ ПО СМЫСЛУ В ДАННЫХ ПОКА НЕТ. Объекты начинают расходиться по
стадиям только с Ш-5 (согласование по объекту) и с этого шага, а всё, что
лежит в базе, заведено прежними правилами — там стадия у объектов общая по
определению. Поэтому выравнивание безопасно ровно один раз, здесь; повторить
его позже уже нельзя — оно затрёт настоящее расхождение.

Обратного хода нет: прежние значения были не фактом, а незаполненным полем.
"""

from django.db import migrations


def _align(apps, schema_editor):
    Event = apps.get_model("operations", "OpsSecurityEvent")
    VisitObject = apps.get_model("operations", "OpsSecurityEventVisitObject")

    aligned = 0
    for event in Event.objects.all().prefetch_related("visit_objects"):
        for visit in event.visit_objects.all():
            if visit.stage == event.stage:
                continue
            VisitObject.objects.filter(pk=visit.pk).update(stage=event.stage)
            aligned += 1
    print(f"\n  стадии объектов сведены со стадией ОМ: строк — {aligned}")


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0070_visit_object_document_version"),
    ]

    operations = [migrations.RunPython(_align, migrations.RunPython.noop)]
