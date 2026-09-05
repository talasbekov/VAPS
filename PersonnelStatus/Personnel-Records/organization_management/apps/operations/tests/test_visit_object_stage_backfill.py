"""Бэкфилл этапов в объект посещения — миграция 0068 (Plane №529).

🔴 ЗАЧЕМ ПРОБА, ЕСЛИ МИГРАЦИЯ И ТАК ОТРАБАТЫВАЕТ НА КАЖДОЙ БАЗЕ. Она
отрабатывает — и именно поэтому её падение заметили бы сразу. Не заметили бы
другого: НЕВЕРНОГО РАЗНЕСЕНИЯ. `_carry_stages` решает, какому объекту достанется
ход работы мероприятия, и ошибка здесь не роняет ничего — она тихо кладёт этапы
не туда, а увидят это через неделю на карточке, которая «почему-то пустая».

🔴 ПОЧЕМУ НЕ ЧЕРЕЗ НАСТОЯЩУЮ МИГРАЦИЮ. Прежняя проба
(`test_ops_visit_object_stage_backfill.py`) гоняла `_carry_stages` через ЖИВОЙ
реестр приложений и сломалась, как только №413 снял перенесённые колонки с
`OpsSecurityEvent`; её удалили целиком вместо починки. Правильный путь —
ИСТОРИЧЕСКИЙ реестр, но добывается он `MigrationExecutor`, то есть прогоном схемы
назад и вперёд по общей тестовой базе. В этом дереве её делят несколько сессий
(замок `scripts/pytest-lock.sh` заведён ровно поэтому), и миграция схемы внутри
пробы уронила бы чужой прогон.

Поэтому подаётся ПОДСТАВНОЙ реестр: два простых класса с нужными полями. Проба
проверяет РЕШЕНИЕ миграции — кому достаются этапы и что именно копируется, — а
не работу ORM. Это её честная граница, и она названа вслух.
"""
from importlib import import_module

import pytest

migration = import_module(
    "organization_management.apps.operations.migrations.0068_visit_object_stage_fields"
)


class FakeVisit:
    def __init__(self, **fields):
        self.saved = 0
        self.position = fields.pop("position", 1)
        self.pk = fields.pop("pk", 1)
        for name, value in fields.items():
            setattr(self, name, value)

    def save(self):
        self.saved += 1


class FakeRelated:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class FakeEvent:
    def __init__(self, visits, **fields):
        self.visit_objects = FakeRelated(visits)
        self.security_object = fields.pop("security_object", None)
        self.object_name = fields.pop("object_name", "")
        self.passport_binding = fields.pop("passport_binding", None)
        self.protected_person = fields.pop("protected_person", None)
        self.protected_person_name = fields.pop("protected_person_name", "")
        for source, _ in migration._CARRIED:
            setattr(self, source, fields.get(source, _SAMPLE[source]))


#: Значения, по которым видно, что скопировано ИМЕННО это поле, а не соседнее.
_SAMPLE = {
    "stage": "APPROVAL",
    "readiness_percent": 70,
    "recon_checklist": [{"id": "c1", "done": True}],
    "recon_sector_posts": [{"id": "p1", "need": 2}],
    "force_need": 7,
    "placement_assignments": [{"id": "a1"}, {"id": "a2"}, {"id": "a3"}],
    "approval_status": "RETURNED",
    "approval_route": [{"id": "r1", "status": "RETURNED"}],
    "approval_remarks": [{"id": "m1", "status": "OPEN"}],
    "approval_snapshot": "снимок расстановки",
    "journal_entries": [{"id": "j1"}],
    "closed_at": None,
}


class FakeApps:
    def __init__(self, events):
        self.events = events
        self.created = []

    def get_model(self, app_label, model_name):
        assert app_label == "operations"
        if model_name == "OpsSecurityEvent":
            outer = self

            class Manager:
                def all(self_inner):
                    return self_inner

                def prefetch_related(self_inner, *args):
                    return list(outer.events)

            class Event:
                objects = Manager()

            return Event
        assert model_name == "OpsSecurityEventVisitObject"
        outer = self

        def factory(**fields):
            row = FakeVisit(**fields)
            outer.created.append(row)
            return row

        return factory


def _run(events):
    apps = FakeApps(events)
    migration._carry_stages(apps, None)
    return apps


def test_the_only_object_receives_the_whole_progress():
    """Объект ровно один — прямая копия ВСЕХ перечисленных полей.

    Мутация, на которой проба обязана краснеть: убрать любую пару из
    `_CARRIED` — соответствующее поле не доедет.
    """
    visit = FakeVisit(pk=10, position=1)
    _run([FakeEvent([visit])])

    for source, target in migration._CARRIED:
        assert getattr(visit, target) == _SAMPLE[source], f"поле {target} не перенесено"
    # «Назначено» — снимок счёта расстановки: у старых ОМ другого источника нет,
    # а ноль читался бы как «никого не дали».
    assert visit.force_assigned == 3
    assert visit.saved == 1


def test_of_several_objects_the_progress_goes_to_the_first_by_position():
    """Объектов несколько — этапы достаются ПЕРВОМУ по `position`.

    Разнести общий расчёт постов по объектам задним числом нельзя: в строке
    поста объект не записан, и любое разнесение было бы выдуманным фактом.
    Поэтому остальные объекты остаются пустыми — и это решение, а не потеря.

    Мутация, на которой проба обязана краснеть: взять `objects[-1]` или не
    сортировать по `position`.
    """
    first = FakeVisit(pk=99, position=1)
    second = FakeVisit(pk=1, position=2)
    # Порядок в списке НАМЕРЕННО обратный позиции, а pk у первого больше:
    # без сортировки проба прошла бы на любом из двух неверных правил.
    _run([FakeEvent([second, first])])

    assert first.stage == "APPROVAL", "этапы ушли не первому по позиции"
    assert not hasattr(second, "stage"), "второму объекту достались чужие этапы"
    assert first.saved == 1 and second.saved == 0


def test_an_event_without_objects_gets_one_and_keeps_its_progress():
    """Объектов нет — заводится один, и этапы достаются ему.

    Иначе этапы остались бы ничьими, и карточка старого ОМ после переезда
    читателей оказалась бы пустой.
    """
    apps = _run([FakeEvent([], object_name="Резиденция")])

    assert len(apps.created) == 1, "объект посещения не заведён"
    created = apps.created[0]
    assert created.object_name == "Резиденция"
    assert created.stage == "APPROVAL"
    assert created.position == 1
    assert created.saved == 1


def test_a_nameless_event_gets_an_honest_placeholder():
    """Имя пустым быть не может (`chk_ops_event_visit_object_name`), а выдумать
    его нельзя — отсюда честная заглушка, а не догадка."""
    apps = _run([FakeEvent([], object_name="")])

    assert apps.created[0].object_name == "Объект не указан"


# 🔴 ПЯТАЯ ПРОБА БЫЛА НАПИСАНА И СНЯТА — ЗАПИСЬ О ТОМ, ЧЕГО ПРОВЕРЯТЬ НЕ НАДО.
#
# Я написала сторож «список `_CARRIED` не переносит в поля, которых у объекта
# посещения больше нет», рассудив, что опечатка в целевом имени уронила бы
# создание ЛЮБОЙ тестовой базы. Проба покраснела и тем себя опровергла: четыре
# поля — `recon_checklist`, `recon_sector_posts`, `placement_assignments`,
# `journal_entries` — у СЕГОДНЯШНЕЙ модели действительно отсутствуют, и это
# нормально. Миграция работает с ИСТОРИЧЕСКИМИ моделями (`apps.get_model`),
# то есть с формой на момент 0068; более поздние снятия колонок её не касаются
# по построению.
#
# Оставить такую пробу значило бы запретить снимать колонки впредь — то есть
# заморозить модель ради миграции, которая от неё не зависит. Записано здесь,
# чтобы следующий не потратил на ту же мысль второй заход.
