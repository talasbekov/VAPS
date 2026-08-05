"""Сборка сводки уровня выше: пины, гарды и своё содержимое.

Главные вопросы среза: сводка собрана ИЗ КОНКРЕТНЫХ версий детей (пин, а не
ссылка «посмотреть сейчас»), её снимок — СВОЙ уровень, а не объединение
детских, и ждёт она только тех детей, кому есть что сдавать.
"""
from datetime import timedelta

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service, clock
from organization_management.apps.operations.day_submission_service import (
    amend_day,
    submit_day,
)
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.summary_service import assemble_summary
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    in_slot,
)
from organization_management.apps.operations.tests.test_status_service import seed_types

pytestmark = pytest.mark.django_db

ACTOR = "7"


@pytest.fixture
def types():
    seed_types()


@pytest.fixture
def tree():
    """Родитель с двумя детьми; в каждом ребёнке есть люди."""
    root = Division.objects.create(name="Управление")
    left = Division.objects.create(name="Первый отдел", parent=root)
    right = Division.objects.create(name="Второй отдел", parent=root)
    in_slot(left, iin="770000000001")
    in_slot(right, iin="770000000002")
    return root, left, right


def submit(division, business_date=TODAY):
    with clock.override(MORNING):
        return submit_day(
            division_id=division.id, business_date=business_date, actor=ACTOR
        )


def assemble(division, business_date=TODAY, actor=ACTOR):
    with clock.override(MORNING):
        return assemble_summary(
            division_id=division.id, business_date=business_date, actor=actor
        )


# ── Пины ─────────────────────────────────────────────────────────────────


def test_the_summary_pins_the_children_versions(types, tree):
    root, left, right = tree
    left_day = submit(left)
    right_day = submit(right)

    summary = assemble(root)

    assert summary.snapshot["sources"] == [
        {
            "division_id": left.id,
            "submission_id": left_day.pk,
            "version": left_day.version,
        },
        {
            "division_id": right.id,
            "submission_id": right_day.pk,
            "version": right_day.version,
        },
    ]


def test_the_pins_are_ordered_by_division(types, tree):
    """Снимок иммутабелен — его содержимое не смеет зависеть от порядка,
    в котором база вернула строки."""
    root, left, right = tree
    submit(right)  # сдаём в обратном порядке
    submit(left)

    summary = assemble(root)

    assert [pin["division_id"] for pin in summary.snapshot["sources"]] == sorted(
        [left.id, right.id]
    )


def test_the_pin_keeps_the_version_it_was_built_from(types, tree):
    """Пин — заявление «собрана из ВОТ ЭТОЙ версии», а не ссылка на текущую.

    Поправка ребёнка после сборки не смеет переписать снимок сводки, иначе
    подпись под ней означала бы каждый раз что-то новое.
    """
    root, left, right = tree
    submit(left)
    submit(right)
    summary = assemble(root)

    with clock.override(MORNING):
        amend_day(
            division_id=left.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="ошибка",
            sanction="замечание",
        )

    summary.refresh_from_db()
    pinned = {pin["division_id"]: pin["version"] for pin in summary.snapshot["sources"]}
    assert pinned[left.id] == 1


def test_a_child_that_submitted_an_empty_day_is_still_pinned(types, tree):
    """Сдавший пустой день — сдал день.

    Не записать его значило бы объявить сводку собранной без него.
    """
    root, left, right = tree
    empty = Division.objects.create(name="Пустой отдел", parent=root)
    submit(left)
    submit(right)
    submit(empty)

    summary = assemble(root)

    assert empty.id in {pin["division_id"] for pin in summary.snapshot["sources"]}


# ── Свой уровень, а не объединение ───────────────────────────────────────


def test_the_summary_roster_is_own_level_only(types, tree):
    """Люди детей в снимок сводки НЕ попадают.

    Слей их — и один человек оказался бы сдан дважды, а расход по сводке
    разошёлся бы с суммой расходов детей.
    """
    root, left, right = tree
    own = in_slot(root, iin="770000000003")
    submit(left)
    submit(right)

    summary = assemble(root)

    assert [row["employee_id"] for row in summary.snapshot["roster"]] == [own.id]


def test_the_summary_is_the_same_entity_as_a_submission(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)

    summary = assemble(root)

    assert isinstance(summary, OpsDailySubmission)
    assert summary.version == 1
    assert summary.is_current is True
    assert summary.division_id == root.id


# ── Кого ждёт сводка ─────────────────────────────────────────────────────


def test_a_child_with_people_must_submit_first(types, tree):
    root, left, _ = tree

    with pytest.raises(DomainError) as exc:
        assemble(root)

    assert exc.value.code == "SUMMARY_CHILDREN_NOT_SUBMITTED"
    assert exc.value.http_status == 422
    assert left.id in exc.value.detail["laggards"]
    assert OpsDailySubmission.objects.filter(division_id=root.id).count() == 0


def test_a_child_with_nobody_in_it_is_not_waited_for(types, tree):
    """Ребёнку, у которого некому сдавать, нечего консолидировать.

    Держать сводку родителя из-за пустой ветки значило бы закрыть её
    навсегда — сдать за неё некому.
    """
    root, left, right = tree
    Division.objects.create(name="Пустая ветка", parent=root)
    submit(left)
    submit(right)

    summary = assemble(root)

    assert summary.pk is not None


def test_people_deeper_in_the_subtree_make_the_child_required(types, tree):
    """Обязанность считается по ПОДДЕРЕВУ, а не по своему уровню.

    Ребёнок без своих людей, но с занятым внуком, обязан сдать: иначе целая
    ветка выпала бы из сводки молча.
    """
    root, left, right = tree
    middle = Division.objects.create(name="Промежуточный", parent=root)
    grandchild = Division.objects.create(name="Внук", parent=middle)
    in_slot(grandchild, iin="770000000004")
    submit(left)
    submit(right)

    with pytest.raises(DomainError) as exc:
        assemble(root)

    assert exc.value.detail["laggards"] == [middle.id]


def test_a_dismissed_occupant_does_not_make_a_child_required(types, tree):
    from organization_management.apps.employees.models import Employee

    root, left, right = tree
    stale = Division.objects.create(name="Расформированный", parent=root)
    employee = in_slot(stale, iin="770000000005")
    Employee.objects.filter(pk=employee.id).update(
        employment_status=Employee.EmploymentStatus.FIRED
    )
    submit(left)
    submit(right)

    assert assemble(root).pk is not None


# ── Гарды ────────────────────────────────────────────────────────────────


def test_a_leaf_has_nobody_to_consolidate(types, tree):
    _, left, _ = tree

    with pytest.raises(DomainError) as exc:
        assemble(left)

    assert exc.value.http_status == 400
    assert OpsDailySubmission.objects.filter(division_id=left.id).count() == 0


def test_an_unknown_division_is_404_before_the_children_are_checked(types, tree):
    root, _, _ = tree

    with clock.override(MORNING), pytest.raises(DomainError) as exc:
        assemble_summary(
            division_id=root.id + 10_000, business_date=TODAY, actor=ACTOR
        )

    assert exc.value.http_status == 404


def test_an_empty_actor_is_400(types, tree):
    root, _, _ = tree

    with pytest.raises(DomainError) as exc:
        assemble(root, actor="   ")

    assert exc.value.http_status == 400


def test_a_date_outside_the_window_is_422(types, tree):
    root, left, right = tree

    with pytest.raises(DomainError) as exc:
        assemble(root, business_date=TODAY - timedelta(days=5))

    assert exc.value.code == "BUSINESS_DATE_OUT_OF_WINDOW"
    assert exc.value.http_status == 422


def test_a_day_already_submitted_is_409(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)
    assemble(root)

    with pytest.raises(DomainError) as exc:
        assemble(root)

    assert exc.value.code == "DAY_ALREADY_SUBMITTED"
    assert exc.value.http_status == 409
    assert OpsDailySubmission.objects.filter(division_id=root.id).count() == 1


# ── Событие дня ──────────────────────────────────────────────────────────


def test_the_first_summary_is_changed(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)

    summary = assemble(root)

    assert summary.event == OpsDailySubmission.Event.CHANGED


def test_a_new_child_version_makes_the_next_day_changed(types, tree):
    """Сводка меняется и тогда, когда СВОЙ состав тот же.

    Она заявляет о версиях детей, и смена версии ребёнка — изменение
    сводки, даже если в штабе родителя не поменялось ничего.
    """
    root, left, right = tree
    submit(left)
    submit(right)
    assemble(root)

    tomorrow = TODAY + timedelta(days=1)
    submit(left, business_date=tomorrow)
    submit(right, business_date=tomorrow)
    with clock.override(MORNING):
        amend_day(
            division_id=left.id,
            business_date=tomorrow,
            actor=ACTOR,
            reason="ошибка",
            sanction="замечание",
        )

    assert assemble(root, business_date=tomorrow).event == (
        OpsDailySubmission.Event.CHANGED
    )


def test_the_same_pins_and_the_same_roster_confirm_without_changes(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)
    assemble(root)

    tomorrow = TODAY + timedelta(days=1)
    submit(left, business_date=tomorrow)
    submit(right, business_date=tomorrow)

    assert assemble(root, business_date=tomorrow).event == (
        OpsDailySubmission.Event.CONFIRMED_NO_CHANGES
    )


# ── Журнал ───────────────────────────────────────────────────────────────


def test_the_assembly_is_written_to_the_log_with_compact_pins(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)

    summary = assemble(root)

    entry = OpsAuditLog.objects.get(action=audit_service.DAILY_SUMMARY_ASSEMBLED)
    assert entry.entity_type == audit_service.ENTITY_SUBMISSION
    assert entry.entity_id == summary.pk
    # Пины в журнале — БЕЗ id строки: через год он не значит ничего, а
    # «ребёнок такой-то, версия такая-то» читается всегда.
    assert entry.new_value["sources"] == [
        {"division_id": left.id, "version": 1},
        {"division_id": right.id, "version": 1},
    ]


def test_a_refused_assembly_writes_nothing(types, tree):
    root, _, _ = tree

    with pytest.raises(DomainError):
        assemble(root)

    assert OpsAuditLog.objects.filter(
        action=audit_service.DAILY_SUMMARY_ASSEMBLED
    ).count() == 0
