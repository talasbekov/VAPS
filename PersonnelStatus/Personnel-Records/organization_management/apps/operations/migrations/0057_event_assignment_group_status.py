"""Участие в ОМ делится на боевую группу и физический наряд (Plane №243).

СЦЕНАРИЙ ЗАКАЗЧИКА, дословно: «в ежедневно составленном расходе есть статусы
как Участие на ОМ (ВНУТРИ ОНА ДЕЛИТСЯ НА ГРУППЫ И ФИЗИЧЕСКИ НАРЯД)».

Было ОДНО значение — `EVENT_ASSIGNMENT` — и различить, чем именно занят
человек, было нечем. Заводится второе, `EVENT_ASSIGNMENT_GROUP`, а прежнее
уточняет подпись: «(наряд)».

КОЛОНКА РАСХОДА У ОБОИХ ОДНА — `IN_SERVICE`. Человек на мероприятии из строя
не выбывает (решение Plane №169), и своя колонка вынула бы его оттуда, сломав
инвариант «Σ колонок == Список». Разницу показывает справочный счётчик
расхода (`strength_report.EVENT_INVOLVEMENT_KINDS`), который живёт РЯДОМ с
колонками.

Приоритет 81 — сразу за нарядом (80): при двух фактах на день побеждает более
ранний по приоритету, и группа не должна перебивать наряд.

Миграция, а не только сид: `seed_status_types` гоняют на чистой базе, а
справочник живёт и на заполненных стендах.
"""
from django.db import migrations

CODE = "EVENT_ASSIGNMENT_GROUP"
NAME = "Привлечён на мероприятие (боевая группа)"
SQUAD_CODE = "EVENT_ASSIGNMENT"
SQUAD_NAME = "Привлечён на мероприятие (наряд)"
SQUAD_NAME_BEFORE = "Привлечён на мероприятие"


def forwards(apps, schema_editor):
    StatusType = apps.get_model("operations", "StatusType")
    squad = StatusType.objects.filter(code=SQUAD_CODE).first()
    if squad is None:
        # Справочника нет вовсе — его заведёт сид со своей раскладкой.
        return
    StatusType.objects.get_or_create(
        code=CODE,
        defaults={
            "name": NAME,
            "priority": 81,
            "report_column_code": squad.report_column_code,
            "counts_in_staff": squad.counts_in_staff,
            "is_ku_owned": squad.is_ku_owned,
            "is_hard_block": squad.is_hard_block,
            "restricts_editing": squad.restricts_editing,
            "is_placeholder": squad.is_placeholder,
        },
    )
    # Подпись прежнего кода уточняется: пока вид был один, «Привлечён на
    # мероприятие» читалось однозначно; рядом со вторым — уже нет.
    if squad.name == SQUAD_NAME_BEFORE:
        squad.name = SQUAD_NAME
        squad.save(update_fields=["name"])


def backwards(apps, schema_editor):
    StatusType = apps.get_model("operations", "StatusType")
    StatusType.objects.filter(code=CODE).delete()
    StatusType.objects.filter(code=SQUAD_CODE, name=SQUAD_NAME).update(
        name=SQUAD_NAME_BEFORE
    )


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0056_division_operator_status_manage"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
