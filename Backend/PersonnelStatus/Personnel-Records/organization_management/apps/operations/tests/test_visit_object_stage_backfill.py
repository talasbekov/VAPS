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


#: Канон переносимых пар — ЗАКРЕПЛЁН ОТДЕЛЬНО ОТ `_CARRIED`.
#:
#: 🔴 ПОЧЕМУ ОТДЕЛЬНО (найдено ревью №825). Проба вела ОБЕ стороны от одного
#: и того же кортежа: `FakeEvent` расставлял поля `for source, _ in _CARRIED`,
#: а утверждение перебирало `for source, target in _CARRIED`. Убрать из
#: `_CARRIED` любую пару, кроме `stage`, — `FakeEvent` её не поставит,
#: миграция не скопирует, утверждение не проверит: ЗЕЛЁНАЯ. При этом докстрока
#: обещала обратное — «убрать любую пару, и соответствующее поле не доедет».
#: `_CARRIED` — первое, что карточка №529 называет оставшимся без надзора, и
#: надзора у него как раз и не было.
#:
#: Канон здесь — не дубль ради дубля: изъятие пары становится ОСОЗНАННОЙ
#: правкой двух мест, а не тихой пропажей одного.
_CANON = (
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


def test_the_carried_list_keeps_its_canon():
    """Состав `_CARRIED` не меняется молча (Plane №529).

    Красная на мутации «убрать пару из `_CARRIED`» и на мутации «дописать
    пару»: обе — правки канона переноса, и обе обязаны быть замечены.
    """
    assert tuple(migration._CARRIED) == _CANON


def test_every_carried_field_exists_in_the_historical_models():
    """Каждое имя пары есть у моделей ФОРМЫ 0068 (Plane №529).

    🔴 БЕЗ БАЗЫ. Историческое состояние читается `MigrationLoader(None)` прямо
    с диска — подключение и прогон схемы не нужны, а значит и чужой прогон по
    общей тестовой базе не страдает. Именно этого не хватало снятой пятой
    пробе: она сверялась с СЕГОДНЯШНЕЙ моделью, у которой четырёх колонок уже
    нет по решению №413, — и потому опровергла сама себя. Вопрос был задан не
    тому состоянию, а не бессмыслен.

    Красная на мутации: опечатка в любом имени внутри `_CARRIED`.
    """
    from django.db.migrations.loader import MigrationLoader

    state = MigrationLoader(None).project_state(
        ("operations", "0068_visit_object_stage_fields")
    )
    # `fields` исторической модели — пары «имя → поле», а не список полей.
    event = set(dict(state.models["operations", "opssecurityevent"].fields))
    visit = set(
        dict(state.models["operations", "opssecurityeventvisitobject"].fields)
    )
    assert event, "историческое состояние пусто — проба вакуумна"
    missing = [
        f"{source}→{target}"
        for source, target in migration._CARRIED
        if source not in event or target not in visit
    ]
    assert missing == [], (
        "пара переноса называет поле, которого у моделей формы 0068 нет: "
        + ", ".join(missing)
    )


def test_the_only_object_receives_the_whole_progress():
    """Объект ровно один — прямая копия ВСЕХ перечисленных полей.

    Мутация, на которой проба обязана краснеть: сломать копирование любого
    поля в `_carry_stages`. Изъятие пары из `_CARRIED` стережёт СОСЕДНЯЯ проба
    (`test_the_carried_list_keeps_its_canon`) — здесь оно невидимо по
    построению: обе стороны читают один и тот же кортеж.
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


# 🔴 ПЯТАЯ ПРОБА БЫЛА НАПИСАНА И СНЯТА — И СНЯТА НАПОЛОВИНУ ЗРЯ.
#
# Наблюдение ниже верно, вывод из него — нет (уточнено ревью №825). Проверять
# надо было не по сегодняшней модели, а по ИСТОРИЧЕСКОЙ, и добывается она без
# базы: `MigrationLoader(None).project_state(...)` читает файлы миграций с
# диска. Проба заведена выше — `test_every_carried_field_exists_in_the_historical_models`.
# Прежняя редакция этого послесловия отговаривала следующего от починки, и это
# хуже, чем отсутствие пробы: сторож выглядел закрытым вопросом.
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
