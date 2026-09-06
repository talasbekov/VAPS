"""Статус участия несёт СВОИ мероприятия и вид участия (Plane №274, Ш-3).

ЗАЧЕМ. Заказчик: статус «Участие на ОМ» «будет иметь возможность выбрать
несколько причастных ОМ, выбор Физнаряд и разные специфические группы, эти
группы имеют разные статусы (например: группа Досмотра, внутри досмотрщик,
кинолог)».

До этого связь с мероприятием была ОДНА и жила строкой `source_ref =
"security-event:<id>"`: выделение штабом писало ровно одно ОМ, и второго
человек получить не мог. Вида участия не было вовсе — его подменяли два кода
статуса (наряд и группа), и роль внутри группы записать было негде.

🔴 Что стерегут пробы:
1. НЕСКОЛЬКО мероприятий у одного статуса — ради этого всё и делалось;
2. вид и роль проверяются ПО СПРАВОЧНИКУ, а не принимаются строкой;
3. роль обязана принадлежать СВОЕЙ группе — иначе кинолог попадёт в досмотр;
4. одно мероприятие дважды в одном статусе не заводится: расход посчитал бы
   человека два раза;
5. `None` не трогает сохранённое, пустой список — осознанное «участий нет».
"""
from datetime import timedelta

import pytest

from organization_management.apps.operations import clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_settings import (
    OpsDictionaryEntry,
)
from organization_management.apps.operations.models_status import (
    OpsStatusParticipation,
)
from organization_management.apps.operations.status_service import (
    create_status,
    update_status,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    division,  # noqa: F401 — фикстура pytest
    make_employee,
    types,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db

ACTOR = "user:probe"


@pytest.fixture
def participation_catalog(db):
    """Виды участия и роли — как их кладёт сид (Ш-2)."""
    for code, label, group in (
        ("PHYSICAL_SQUAD", "Физический наряд", None),
        ("SCREENING_GROUP", "Группа досмотра", None),
        ("CANINE_GROUP", "Кинологическая группа", None),
    ):
        OpsDictionaryEntry.objects.create(
            dictionary_code="EVENT_PARTICIPATION_KINDS", code=code, label=label,
            description="", is_active=True, group_code=group,
        )
    for code, label, group in (
        ("SCREENER", "Досмотрщик", "SCREENING_GROUP"),
        ("DOG_HANDLER", "Кинолог", "CANINE_GROUP"),
    ):
        OpsDictionaryEntry.objects.create(
            dictionary_code="EVENT_GROUP_ROLES", code=code, label=label,
            description="", is_active=True, group_code=group,
        )


def _create(employee, participations, code="DUTY"):
    with clock.override(TODAY):
        return create_status(
            employee_id=employee.id,
            status_type_code=code,
            date_start=TODAY,
            date_end=TODAY + timedelta(days=1),
            actor=ACTOR,
            participations=participations,
        )


def test_one_status_carries_several_events(types, division, participation_catalog):  # noqa: F811
    employee = make_employee(division)

    status = _create(
        employee,
        [
            {"event_id": 101, "kind_code": "PHYSICAL_SQUAD"},
            {"event_id": 102, "kind_code": "SCREENING_GROUP", "role_code": "SCREENER"},
        ],
    )

    rows = OpsStatusParticipation.objects.filter(status=status).order_by("event_id")
    assert [(r.event_id, r.kind_code, r.role_code) for r in rows] == [
        (101, "PHYSICAL_SQUAD", ""),
        (102, "SCREENING_GROUP", "SCREENER"),
    ]


def test_a_role_from_another_group_is_refused(types, division, participation_catalog):  # noqa: F811
    """Кинолог в группе досмотра — самая правдоподобная ошибка этой формы."""
    employee = make_employee(division)

    with pytest.raises(DomainError) as failure:
        _create(
            employee,
            [
                {
                    "event_id": 101,
                    "kind_code": "SCREENING_GROUP",
                    "role_code": "DOG_HANDLER",
                }
            ],
        )

    assert failure.value.detail["participations.0.role_code"] == [
        "Роль принадлежит другой группе."
    ]
    assert OpsStatusParticipation.objects.count() == 0


def test_an_unknown_kind_is_refused(types, division, participation_catalog):  # noqa: F811
    employee = make_employee(division)

    with pytest.raises(DomainError) as failure:
        _create(employee, [{"event_id": 101, "kind_code": "ГРУППА ДОСМОТРА"}])

    assert "participations.0.kind_code" in failure.value.detail


def test_the_same_event_twice_is_refused(types, division, participation_catalog):  # noqa: F811
    """Два участия в одном ОМ — человек посчитан дважды в расходе."""
    employee = make_employee(division)

    with pytest.raises(DomainError) as failure:
        _create(
            employee,
            [
                {"event_id": 101, "kind_code": "PHYSICAL_SQUAD"},
                {"event_id": 101, "kind_code": "SCREENING_GROUP"},
            ],
        )

    assert failure.value.detail["participations.1.event_id"] == [
        "Мероприятие уже выбрано в этом статусе."
    ]


def test_no_key_means_untouched_and_empty_list_means_none(
    types, division, participation_catalog  # noqa: F811
):
    """«Не прислали» и «прислали пусто» — разные заявления.

    🔴 ПРОВЕРЯЕТСЯ НА ПРАВКЕ, а не на создании. Первая версия этой пробы
    создавала статус с `None` и убеждалась, что участий ноль, — и была
    ВАКУУМНОЙ: у новой строки участий ноль в любом случае, и мутация
    «считать None пустым списком» её не убивала (проверено). Разница между
    «не прислали» и «прислали пусто» существует только там, где уже есть что
    стирать.
    """
    employee = make_employee(division)
    status = _create(employee, [{"event_id": 101, "kind_code": "PHYSICAL_SQUAD"}])
    assert OpsStatusParticipation.objects.filter(status=status).count() == 1

    with clock.override(TODAY):
        update_status(status, actor=ACTOR, comment="правка без участий")
    assert (
        OpsStatusParticipation.objects.filter(status=status).count() == 1
    ), "сохранение без ключа участий стёрло выбранные мероприятия"

    with clock.override(TODAY):
        update_status(status, actor=ACTOR, participations=[])
    assert (
        OpsStatusParticipation.objects.filter(status=status).count() == 0
    ), "пустой список не снял участия — «участий нет» не записалось"


def test_one_event_may_live_on_two_status_rows_of_the_same_person(
    types, division, participation_catalog  # noqa: F811
):
    """Что ограничение уникальности РЕАЛЬНО запрещает (Plane №833).

    🔴 ПОЧЕМУ ПРОБА ВООБЩЕ НУЖНА. Рядом с `uniq_status_participation_event`
    стоял комментарий «один человек участвует в одном мероприятии ОДИН раз».
    Ограничение при этом взято по паре (СТРОКА СТАТУСА, мероприятие), а не
    (СОТРУДНИК, мероприятие) — то есть комментарий обещал больше, чем
    ограничение делает. Проверка была только словами, и слова разошлись с
    кодом; замер 06.09.2026 на стенде: семь пар (сотрудник, мероприятие)
    висят на нескольких строках статуса, у одной — тринадцать строк.

    Проба делает смысл ограничения ИСПОЛНЯЕМЫМ: одно мероприятие на двух
    РАЗНЫХ строках статуса одного человека — сегодня законно и не отбивается.
    Соседняя проба стережёт вторую половину: то же мероприятие ДВАЖДЫ в ОДНОЙ
    строке отбивается.

    ⚠️ ЭТА ПРОБА ЗАКРЕПЛЯЕТ СЕГОДНЯШНИЙ ДОГОВОР, А НЕ ОДОБРЯЕТ ЕГО. Верно ли
    само намерение — вопрос заказчика (Plane №833): если он выберет «один
    человек — одно ОМ», ограничение расширится до (сотрудник, деловая дата,
    мероприятие), и эта проба обязана покраснеть и смениться. Красная на этой
    мутации — и есть её польза: молча такое изменение не пройдёт.
    """
    employee = make_employee(division)

    # Строки РАЗВЕДЕНЫ ПО ДНЯМ намеренно: две строки на одни даты сервер
    # отбивает как пересечение (`STATUS_OVERLAP_WARNING`), и проба падала бы на
    # чужом правиле, ничего не сказав о своём предмете. Предмет здесь —
    # ограничение уникальности участий, а не совместимость статусов.
    with clock.override(TODAY):
        first = create_status(
            employee_id=employee.id,
            status_type_code="DUTY",
            date_start=TODAY,
            date_end=TODAY + timedelta(days=1),
            actor=ACTOR,
            participations=[{"event_id": 707, "kind_code": "PHYSICAL_SQUAD"}],
        )
        second = create_status(
            employee_id=employee.id,
            status_type_code="DUTY",
            date_start=TODAY + timedelta(days=3),
            date_end=TODAY + timedelta(days=4),
            actor=ACTOR,
            participations=[
                {"event_id": 707, "kind_code": "SCREENING_GROUP", "role_code": "SCREENER"}
            ],
        )

    assert first.id != second.id, "фикстура завела одну строку вместо двух"
    rows = OpsStatusParticipation.objects.filter(
        event_id=707, status__employee_id=employee.id
    )
    assert rows.count() == 2, (
        "одно мероприятие на двух строках статуса одного человека отбилось — "
        "значит ограничение уже не то, что описано рядом с ним (Plane №833)"
    )
