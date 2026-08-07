"""Сводный документ не меняется от правок живого мира.

Срез 145 закрыл этим щитом дневной документ и личную копию. Сводка — третий
артефакт и самый уязвимый: она склеивает СВОЙ снимок с запиненными снимками
детей, то есть тянет живые данные не из одного места, а из стольких, сколько у
неё подчинённых. Каждая строка подписывается своим именем, считается своим
замороженным справочником и своим знаменателем.

Проверяется то же, что и у дневного: между двумя сборками живой мир меняется, и
обе сборки обязаны совпасть. Отдельно — правка, задевающая ТОЛЬКО одного
ребёнка: общий тест «всё разом» её пропустил бы, если строка ребёнка вообще не
пересобирается.

Сравнение по СЕРИАЛИЗОВАННОМУ документу целиком: перечисляя поля руками, я
закрепил бы ровно то, о чём уже знаю.
"""
import json
from dataclasses import asdict

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.expense_release import (
    build_summary_expense_document,
)
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.summary_service import assemble_summary
from organization_management.apps.operations.tests.test_day_submission_service import (
    ACTOR,
    MORNING,
    TODAY,
    fact,
    in_slot,
)
from organization_management.apps.operations.tests.test_traffic_light import (
    types,  # noqa: F401 — фикстура pytest
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db


@pytest.fixture
def assembled(types):  # noqa: F811
    """Управление со сводкой из двух отделов; у каждого свой человек."""
    root = Division.objects.create(name="Управление")
    left = Division.objects.create(name="Первый отдел", parent=root)
    right = Division.objects.create(name="Второй отдел", parent=root)

    chief = in_slot(root, last_name="Начальник")
    left_duty = in_slot(left, last_name="Левый")
    right_plain = in_slot(right, last_name="Правый")
    StaffUnit.objects.create(division=left, employee=None, index=91001)
    fact(left_duty, code="DUTY")

    with clock.override(MORNING):
        submit_day(division_id=left.id, business_date=TODAY, actor=ACTOR)
        submit_day(division_id=right.id, business_date=TODAY, actor=ACTOR)
        assemble_summary(division_id=root.id, business_date=TODAY, actor=ACTOR)
    return root, left, right, chief, left_duty, right_plain


def printed(root):
    document = build_summary_expense_document(root.id, TODAY)
    return json.dumps(asdict(document), ensure_ascii=False, sort_keys=True, default=str)


# ── Правки, задевающие ВСЕХ ──────────────────────────────────────────────


def test_editing_the_catalog_changes_nothing(assembled):
    root, *_ = assembled
    before = printed(root)

    StatusType.objects.filter(code="DUTY").update(
        name="Дежурство по части", report_column_code="ПЕРЕЕХАЛО"
    )
    StatusType.objects.filter(code="STUDY").update(priority=1)

    assert printed(root) == before


def test_renaming_the_parent_changes_nothing(assembled):
    root, *_ = assembled
    before = printed(root)

    Division.objects.filter(pk=root.pk).update(name="Управление имени Другого")

    assert printed(root) == before


# ── Правка, задевающая ОДНОГО ребёнка ────────────────────────────────────


def test_renaming_one_child_changes_nothing(assembled):
    """Строка ребёнка подписывается ЕГО именем из ЕГО снимка.

    Отдельно от общего теста: возьми сводка имя ребёнка живым, «всё разом» тоже
    покраснело бы — но было бы неясно, чья именно строка съехала.
    """
    root, left, *_ = assembled
    before = printed(root)

    Division.objects.filter(pk=left.pk).update(name="Переименованный отдел")

    assert printed(root) == before


def test_shrinking_one_child_staff_changes_nothing(assembled):
    """Знаменатель у КАЖДОЙ строки свой и заморожен в снимке того ребёнка."""
    root, _left, _right, _chief, left_duty, _plain = assembled
    before = printed(root)

    StaffUnit.objects.filter(employee=left_duty).delete()

    assert printed(root) == before


def test_editing_one_child_facts_changes_nothing(assembled):
    root, _left, _right, _chief, left_duty, right_plain = assembled
    before = printed(root)

    with clock.override(MORNING):
        OpsEmployeeStatus.objects.filter(employee_id=left_duty.id).update(
            cancelled_at=clock.Clock.now(), cancelled_by=ACTOR
        )
    fact(right_plain, code="VACATION")

    assert printed(root) == before


# ── Всё разом ────────────────────────────────────────────────────────────


def test_all_of_it_at_once_changes_nothing(assembled):
    root, left, right, chief, left_duty, right_plain = assembled
    before = printed(root)

    StatusType.objects.filter(code="DUTY").update(
        name="Дежурство по части", report_column_code="ПЕРЕЕХАЛО"
    )
    StatusType.objects.filter(code="STUDY").update(priority=1)
    Division.objects.filter(pk=root.pk).update(name="Другое управление")
    Division.objects.filter(pk=left.pk).update(name="Переименованный отдел")
    Division.objects.filter(pk=right.pk).update(name="Тоже переименованный")
    StaffUnit.objects.filter(employee=left_duty).delete()
    StaffUnit.objects.create(division=right, employee=None, index=91002)
    Employee.objects.filter(pk=chief.pk).update(last_name="Переименованный")
    with clock.override(MORNING):
        OpsEmployeeStatus.objects.filter(employee_id=left_duty.id).update(
            cancelled_at=clock.Clock.now(), cancelled_by=ACTOR
        )
    fact(right_plain, code="VACATION")

    assert printed(root) == before


# ── Проверка самой пробы ─────────────────────────────────────────────────


def test_the_summary_is_not_empty_to_begin_with(assembled):
    """Все тесты выше зелены и у документа, который ничего не печатает."""
    root, *_ = assembled

    document = build_summary_expense_document(root.id, TODAY)

    assert len(document.rows) == 3
    assert document.division_title == "Управление"
    assert document.totals.staff_total == 4  # начальник + двое + вакансия
    assert document.totals.columns["DUTY"] == 1


def test_the_live_world_really_did_change(assembled):
    """И что правки настоящие: живой расход после них другой."""
    from organization_management.apps.operations.strength_report import (
        StrengthReportService,
    )

    root, left, _right, _chief, left_duty, _plain = assembled
    with clock.override(MORNING):
        before = StrengthReportService.compute(TODAY, division_ids={left.id})

    StaffUnit.objects.filter(employee=left_duty).delete()

    with clock.override(MORNING):
        after = StrengthReportService.compute(TODAY, division_ids={left.id})
    assert after.rows[0].staff_total != before.rows[0].staff_total
    del root
