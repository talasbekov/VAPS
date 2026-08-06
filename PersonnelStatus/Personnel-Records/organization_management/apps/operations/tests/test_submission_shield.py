"""Сданный день не переписывается живыми данными.

Это несущее свойство «щита»: сдачу берут, чтобы доказать, ЧТО именно было
заявлено в тот день. Доказывать нечего, если завтрашняя правка живых данных
меняет вчерашнее заявление задним числом — и меняет тихо, потому что версия,
время и подпись остаются прежними.

Отдельный тест на переименование у билдера снимка уже был. Здесь проверяется
не билдер, а ЦЕПОЧКА: сдача → сохранённый снимок → расход, выведенный из него.
И проверяется не одна правка, а весь набор, которым живой мир способен
измениться после сдачи: заведение статуса, отмена статуса, увольнение, перевод
в другое подразделение, переименование, смена уровня должности, освобождение
слота.

Сравнение идёт ПОБАЙТНО по канонической сериализации: «ключи те же и числа те
же» пропустило бы перестановку, а документ сверяют с предыдущим глазами.
"""
import json
from datetime import timedelta

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.strength_report import (
    StatusCatalog,
    expense_from_snapshot,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    ACTOR,
    MORNING,
    TODAY,
    division,  # noqa: F401 — фикстура pytest
    fact,
    in_slot,
)
from organization_management.apps.operations.tests.test_traffic_light import (
    types,  # noqa: F401 — фикстура pytest: справочник + выводимое «в строю»
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db


def catalog():
    """Справочник расхода — через тот же селектор, что зовёт маршрут.

    Своя выборка из StatusType не годится: селектор досыпает выводимое «в
    строю», которого в справочнике нет и быть не может (это ОТСУТСТВИЕ
    фактов), а без него расходу некуда положить тех, у кого статуса нет.
    """
    from organization_management.apps.operations.selectors import StatusTypeSelector

    return StatusCatalog.from_rows(StatusTypeSelector.catalog_rows())


def canonical(payload):
    """Каноническая сериализация: побайтное сравнение ловит и перестановку."""
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


@pytest.fixture
def submission(types, division):  # noqa: F811
    """Сданный день с людьми и фактами — то, что потом обязано не шелохнуться."""
    on_duty = in_slot(division, last_name="Дежурный")
    plain = in_slot(division, last_name="Обычный")
    fact(on_duty, code="DUTY")
    with clock.override(MORNING):
        submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)
    row = OpsDailySubmission.objects.get(
        division_id=division.id, business_date=TODAY, is_current=True
    )
    return row, division, on_duty, plain


def stored(row):
    """Снимок ИЗ БАЗЫ, а не из объекта в памяти: правка живых данных могла бы
    не тронуть строку и всё равно изменить то, что читают потом."""
    return OpsDailySubmission.objects.get(pk=row.pk).snapshot


def unchanged(row, before_snapshot, before_expense):
    fresh = stored(row)
    assert canonical(fresh) == before_snapshot
    assert canonical(expense_from_snapshot(fresh, TODAY, catalog())) == before_expense


@pytest.fixture
def baseline(submission):
    row, *_ = submission
    snapshot = stored(row)
    return (
        canonical(snapshot),
        canonical(expense_from_snapshot(snapshot, TODAY, catalog())),
    )


# ── Правки живого мира после сдачи ───────────────────────────────────────


def test_a_status_created_afterwards_does_not_enter_the_taken_day(
    submission, baseline
):
    """Самая частая правка: статус завели задним числом.

    Попади он в сданный день — заявление изменилось бы, а версия, время и
    подпись остались бы прежними, и отличить одно от другого стало бы нечем.
    """
    row, _division, _on_duty, plain = submission

    fact(plain, code="VACATION")

    unchanged(row, *baseline)


def test_cancelling_a_status_does_not_empty_the_taken_day(submission, baseline):
    """Отмена — правка не менее опасная: она УБИРАЕТ строку, а не добавляет,
    и сданный день молча обеднел бы."""
    row, _division, on_duty, _plain = submission

    with clock.override(MORNING):
        OpsEmployeeStatus.objects.filter(employee_id=on_duty.id).update(
            cancelled_at=clock.Clock.now(), cancelled_by=ACTOR
        )

    unchanged(row, *baseline)


def test_a_dismissal_does_not_shrink_the_taken_denominator(submission, baseline):
    """Увольнение выводит человека из списочного состава — но НЕ задним
    числом: в тот день он в строю числился, и знаменатель сдачи это отражает."""
    row, _division, _on_duty, plain = submission

    plain.employment_status = Employee.EmploymentStatus.FIRED
    with clock.override(MORNING):
        plain.save()

    unchanged(row, *baseline)


def test_a_transfer_to_another_division_does_not_move_anyone_out(
    submission, baseline
):
    """Перевод по штату переписал бы, за КОГО подразделение отвечало в тот
    день, — и заодно пополнил бы чужую сдачу человеком, которого там не было."""
    row, _division, _on_duty, plain = submission
    other = Division.objects.create(name="Второе управление")

    StaffUnit.objects.filter(employee=plain).update(division=other)

    unchanged(row, *baseline)


def test_a_freed_slot_does_not_turn_into_a_vacancy_after_the_fact(
    submission, baseline
):
    row, *_ = submission

    StaffUnit.objects.filter(employee__isnull=False).update(employee=None)

    unchanged(row, *baseline)


def test_renaming_and_repositioning_do_not_rewrite_the_taken_day(
    submission, baseline
):
    """ФИО, звание и уровень должности заморожены вместе со снимком: иначе
    повышение переставило бы человека в уже подписанном документе."""
    row, _division, on_duty, _plain = submission

    Employee.objects.filter(pk=on_duty.pk).update(last_name="Переименованный")

    unchanged(row, *baseline)


def test_all_of_it_at_once_still_changes_nothing(submission, baseline):
    """Все правки разом — потому что по одной каждая могла бы гаситься другой
    (убыло на одного, прибыло на одного), а вместе они сдвигают и знаменатель,
    и факты, и подписи."""
    row, _division, on_duty, plain = submission
    other = Division.objects.create(name="Третье управление")

    fact(plain, code="VACATION")
    with clock.override(MORNING):
        OpsEmployeeStatus.objects.filter(employee_id=on_duty.id).update(
            cancelled_at=clock.Clock.now(), cancelled_by=ACTOR
        )
    Employee.objects.filter(pk=on_duty.pk).update(last_name="Другой")
    StaffUnit.objects.filter(employee=plain).update(division=other)

    unchanged(row, *baseline)


# ── Проверка самой пробы ─────────────────────────────────────────────────


def test_the_live_world_really_did_change(submission):
    """Все тесты выше зелены и у снимка, который вообще ни от чего не зависит.

    Здесь показывается, что правки НАСТОЯЩИЕ: тот же расход, посчитанный по
    ЖИВЫМ данным на ту же дату, после них другой. Без этого весь файл был бы
    вакуумным.
    """
    row, division_, _on_duty, plain = submission  # noqa: F811
    before = canonical(expense_from_snapshot(stored(row), TODAY, catalog()))

    fact(plain, code="VACATION")

    from organization_management.apps.operations.snapshot import (
        build_division_snapshot,
    )

    live = build_division_snapshot(division_.id, TODAY)
    after = canonical(expense_from_snapshot(live, TODAY, catalog()))

    assert after != before, "правка не изменила даже живой расход — проба пуста"


def test_a_later_amendment_is_a_new_version_and_not_a_rewrite(submission, baseline):
    """Законный способ изменить заявление — поправка, и она заводит ВЕРСИЮ.

    Прежняя версия остаётся на месте со своим снимком: щит доказывает
    конкретное заявление, а не последнее.
    """
    from organization_management.apps.operations.day_submission_service import (
        amend_day,
    )

    row, division_, _on_duty, plain = submission  # noqa: F811
    fact(plain, code="VACATION")

    with clock.override(MORNING + timedelta(hours=1)):
        amend_day(
            division_id=division_.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="уточнение",
            sanction="разрешение начальника",
        )

    unchanged(row, *baseline)
    assert OpsDailySubmission.objects.filter(
        division_id=division_.id, business_date=TODAY
    ).count() == 2
    assert not OpsDailySubmission.objects.get(pk=row.pk).is_current
