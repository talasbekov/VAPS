"""Связь участника рейтинга с кадровой записью и её бэкфилл (Plane №96).

У `OpsRatedParticipant` идентификатор был свободной строкой `participant_code`
(на стенде — `employee-1`, `employee-2`), и связи с `Employee` не было ВОВСЕ.
Расстановка ищет рейтинг по кадровому id, поэтому совпадений на живом стенде не
бывало никогда: бейдж не появлялся, фильтр «Рейтинг» отбирал пустоту,
требование поста `minRating` не проверялось. На моке идентификаторы совпадали —
мок был зелен, живой стек молчал.

Ссылка ПЛОСКАЯ, без FK, — идиома раздела (`chief_employee_id` у ОМ,
`employee_id` у временных дежурств): каскад кадровой таблицы не должен доставать
до оценок, а оценка пережившего увольнение участника — факт истории, а не мусор.

БЭКФИЛЛ разбирает `participant_code` вида `employee-<pk>` и только его. Всё
остальное остаётся без связи: выдумать её значило бы привязать рейтинг к чужому
человеку — ошибка, которую на экране не увидишь, потому что число покажется.
Кадровая запись проверяется на существование: код может ссылаться на удалённого.

Откат снимает поле целиком, поэтому отдельной обратной операции у данных нет —
их носитель исчезает вместе со столбцом.
"""
from django.db import migrations, models


def link_participants_to_employees(apps, schema_editor):
    OpsRatedParticipant = apps.get_model("operations", "OpsRatedParticipant")
    Employee = apps.get_model("employees", "Employee")

    known = set(Employee.objects.values_list("pk", flat=True))
    updated = []
    for participant in OpsRatedParticipant.objects.filter(
        participant_code__startswith="employee-"
    ).iterator():
        tail = participant.participant_code[len("employee-") :]
        if not tail.isdigit():
            continue
        employee_id = int(tail)
        if employee_id not in known:
            continue
        participant.employee_id = employee_id
        updated.append(participant)
    if updated:
        OpsRatedParticipant.objects.bulk_update(updated, ["employee_id"])


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0047_forces_chain_permissions"),
        # Бэкфилл читает кадровую таблицу — её миграции обязаны быть применены.
        ("employees", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="opsratedparticipant",
            name="employee_id",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name="opsratedparticipant",
            index=models.Index(
                fields=["employee_id"], name="idx_ops_rated_participant_emp"
            ),
        ),
        migrations.RunPython(
            link_participants_to_employees, migrations.RunPython.noop
        ),
    ]
