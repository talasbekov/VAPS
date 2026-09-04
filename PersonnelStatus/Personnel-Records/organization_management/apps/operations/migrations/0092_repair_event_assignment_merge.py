"""Починка слияния №486: 0091 молча ничего не делала (Plane №752).

ЧТО БЫЛО НЕ ТАК. `0091.forwards` рано выходит, если типа `IN_EVENT` нет, — а
не создаёт его ни одна миграция: он появляется только из `seed_status_types`,
который гоняется ПОСЛЕ `migrate`. На всякой базе, кроме правленого вручную
стенда, слияние не выполнялось вовсе, оба снятых типа оставались активными, а
миграция записывалась применённой — вернуться к ней уже нечем.

ПОЧЕМУ НОВАЯ МИГРАЦИЯ, А НЕ ПРАВКА 0091. Там, где 0091 уже применена, правка
её тела не выполнится никогда: Django судит по имени в `django_migrations`.
Починка обязана быть отдельной строкой истории — иначе она чинит только те
базы, которых ещё нет.

ИДЕМПОТЕНТНА. На стенде, где слияние уже прошло руками, строк на снятых кодах
не осталось: миграция заведёт (или найдёт) целевой тип, ничего не переведёт и
погасит уже погашенное. Логика живёт в `status_merge` — обычном модуле, а не
внутри `RunPython`: пока она была заперта в миграции, проверить её было нечем,
оттого дефект и дожил до ревью.
"""
from django.db import migrations

from organization_management.apps.operations.status_merge import (
    merge_legacy_participation_types,
)


def forwards(apps, schema_editor):
    merge_legacy_participation_types(
        apps.get_model("operations", "StatusType"),
        apps.get_model("operations", "OpsEmployeeStatus"),
        apps.get_model("operations", "OpsStatusParticipation"),
    )


def backwards(apps, schema_editor):
    """Обратного хода нет — он есть у 0091.

    Разводить строки обратно по видам умеет `0091.backwards`, и вторая такая
    же реализация означала бы две правды об одном откате. Здесь — пусто:
    откатывать нечего, слияние отменяет предыдущая миграция.
    """


class Migration(migrations.Migration):
    dependencies = [("operations", "0091_merge_event_assignment_into_in_event")]
    operations = [migrations.RunPython(forwards, backwards)]
