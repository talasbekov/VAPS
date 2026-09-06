"""Фамилия вместо логина у уже записанных подписей (Plane №484).

`actor_display_name` до правки возвращала username, когда вьюха передавала
`actor=request.user` (а таких вызовов десять). В два ВИДИМЫХ поля из-за этого
записан логин:

* `OpsPlacementDocumentVersion.created_by` — «кем создана версия» в «Истории
  версий» подписываемой «Расстановки сил»;
* `OpsVisitObjectDeputy.assigned_by` — «кто выдал право» замещающему.

Правка кода чинит только новое. У записанного логин остаётся, и в одном поле
рядом оказываются «Ниязов П.» и `admin` — читателю это два разных человека,
а не один.

🔴 ПРЕЦЕДЕНТ ПРОЕКТА — миграция `0030_backfill_event_owner_name`: тот же класс
дефекта в `owner_name` закрывался кодом И бэкфиллом, а не одним кодом. Здесь
сделано так же и по той же причине.

Отличие от `0030` — в опознании. Там в поле лежал ЧИСЛОВОЙ id, и «трогать
только цифры» было точным правилом. Здесь лежит username, и отличить его от
фамилии можно единственным честным способом: значение совпадает с `username`
живой учётки, за которой стоит кадровая запись. Всё остальное — сеяные «—» и
«test», уже проставленные ФИО, подписи удалённых учёток — не трогается:
выдумывать за них имя нечем.

Разбор намеренно повторён здесь, а не позван из `ops.security_events`: сервис
волен измениться, а миграция обязана и через год делать ровно то, что делала
при накатке.
"""
from django.db import migrations


def _label(employee):
    initial = f" {employee.first_name[0]}." if employee.first_name else ""
    return f"{employee.last_name}{initial}"


def _backfill(model, field, apps):
    User = apps.get_model("auth", "User")
    Employee = apps.get_model("employees", "Employee")

    values = {
        str(getattr(row, field) or "").strip()
        for row in model.objects.all()
    }
    values.discard("")
    if not values:
        return
    users = {u.username: u for u in User.objects.filter(username__in=values)}
    if not users:
        return
    by_user = {
        emp.user_id: emp
        for emp in Employee.objects.filter(user_id__in=[u.pk for u in users.values()])
    }
    names = {
        username: _label(by_user[user.pk])
        for username, user in users.items()
        if user.pk in by_user
    }
    if not names:
        return
    changed = []
    for row in model.objects.all():
        name = names.get(str(getattr(row, field) or "").strip())
        if name is None:
            continue
        setattr(row, field, name)
        changed.append(row)
    if changed:
        model.objects.bulk_update(changed, [field])


def backfill_signatures(apps, schema_editor):
    _backfill(
        apps.get_model("operations", "OpsPlacementDocumentVersion"), "created_by", apps
    )
    _backfill(
        apps.get_model("operations", "OpsVisitObjectDeputy"), "assigned_by", apps
    )


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0097_ops_staff_command_role"),
        ("employees", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(backfill_signatures, migrations.RunPython.noop),
    ]
