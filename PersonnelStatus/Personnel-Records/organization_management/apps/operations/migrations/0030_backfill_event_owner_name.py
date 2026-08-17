"""Подпись ответственного вместо id учётки у уже заведённых ОМ.

`create_event` до этой правки писал в `owner_name` результат
`resolve_actor_id` — идентификатор учётной записи, и в карточке стояло
«Ответственный за ОМ: 1». Правка кода чинит только новые мероприятия;
у заведённых id остаётся в поле, а его читают и карточка, и значения
фильтра реестра.

Разбор намеренно повторён здесь, а не позван из `ops.security_events`:
сервис волен измениться, а миграция обязана и через год делать ровно то,
что делала при накатке.

Строки, где подпись не число (сеяные «—», «Тест», уже проставленные ФИО) и
где учётки с таким id больше нет, не трогаются: выдумывать за них имя
нечем.
"""
from django.db import migrations


def _label(user, employee):
    if employee is not None:
        initial = f" {employee.first_name[0]}." if employee.first_name else ""
        return f"{employee.last_name}{initial}"
    return user.username


def backfill_owner_name(apps, schema_editor):
    Event = apps.get_model("operations", "OpsSecurityEvent")
    User = apps.get_model("auth", "User")
    Employee = apps.get_model("employees", "Employee")

    numeric = [e for e in Event.objects.all() if str(e.owner_name).isdigit()]
    if not numeric:
        return
    users = {
        str(u.pk): u
        for u in User.objects.filter(pk__in={int(e.owner_name) for e in numeric})
    }
    employees = {
        str(emp.user_id): emp
        for emp in Employee.objects.filter(user_id__in=[u.pk for u in users.values()])
    }
    changed = []
    for event in numeric:
        user = users.get(str(event.owner_name))
        if user is None:
            continue
        event.owner_name = _label(user, employees.get(str(user.pk)))
        changed.append(event)
    if changed:
        Event.objects.bulk_update(changed, ["owner_name"])


class Migration(migrations.Migration):

    dependencies = [
        ("operations", "0029_opssecurityevent_business_date_end"),
        ("employees", "0001_initial"),
    ]

    operations = [
        # Обратной операции нет намеренно: восстановить id по подписи нельзя,
        # да и незачем — идентификатор актора всё это время лежит в аудите.
        migrations.RunPython(backfill_owner_name, migrations.RunPython.noop),
    ]
