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
        employment_status=Employee.EmploymentStatus.FIRED,
        is_active=False,
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


# ── Неполная сборка и отправка дежурному (Plane №990, `[РАСХ-РШ-01]`) ────


def test_allow_incomplete_lets_a_summary_form_without_every_child(types, tree):
    """RED до фикса: `allow_incomplete` не существовал, любой недостающий
    ребёнок отвечал 422 независимо от намерения вызывающего."""
    root, left, right = tree
    submit(left)
    # right не сдал вовсе.

    with clock.override(MORNING):
        summary = assemble_summary(
            division_id=root.id,
            business_date=TODAY,
            actor=ACTOR,
            allow_incomplete=True,
        )

    # Точная форма пина (division_id/submission_id/version) уже покрыта
    # `test_the_summary_pins_the_children_versions` — здесь важно только то,
    # что сборка ВООБЩЕ прошла и пин несдавшего в ней отсутствует.
    pinned = {pin["division_id"] for pin in summary.snapshot["sources"]}
    assert pinned == {left.id}


def test_allow_incomplete_still_refuses_without_the_flag(types, tree):
    """Умолчание НЕ меняется: существующие читатели (например, вкладка
    «Ежедневный расход») продолжают получать строгую сборку, если явно не
    попросили иное."""
    root, left, _ = tree
    submit(left)

    with pytest.raises(DomainError) as exc:
        assemble(root)

    assert exc.value.code == "SUMMARY_CHILDREN_NOT_SUBMITTED"


def test_summary_laggards_reports_none_when_no_summary_exists(types, tree):
    from organization_management.apps.operations.summary_service import (
        summary_laggards,
    )

    root, _, _ = tree
    assert summary_laggards(root.id, TODAY) is None


def test_summary_laggards_reports_the_missing_children(types, tree):
    from organization_management.apps.operations.summary_service import (
        summary_laggards,
    )

    root, left, right = tree
    submit(left)
    with clock.override(MORNING):
        assemble_summary(
            division_id=root.id, business_date=TODAY, actor=ACTOR, allow_incomplete=True
        )

    assert summary_laggards(root.id, TODAY) == [right.id]


def test_summary_laggards_is_empty_once_complete(types, tree):
    from organization_management.apps.operations.summary_service import (
        summary_laggards,
    )

    root, left, right = tree
    submit(left)
    submit(right)
    assemble(root)

    assert summary_laggards(root.id, TODAY) == []


def send(division, business_date=TODAY, actor=ACTOR, reason=""):
    from organization_management.apps.operations.summary_service import send_summary

    with clock.override(MORNING):
        return send_summary(
            division_id=division.id, business_date=business_date, actor=actor, reason=reason
        )


def test_send_summary_needs_an_assembled_summary_first(types, tree):
    root, _, _ = tree

    with pytest.raises(DomainError) as exc:
        send(root)

    assert exc.value.code == "ENTITY_NOT_FOUND"
    assert exc.value.http_status == 404


def test_send_summary_refuses_a_plain_submission_not_a_summary(types, tree):
    root, _, _ = tree
    submit(root)

    with pytest.raises(DomainError) as exc:
        send(root)

    assert exc.value.code == "VALIDATION_ERROR"
    assert exc.value.http_status == 400


def test_send_summary_of_a_complete_summary_needs_no_reason(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)
    assemble(root)

    sent = send(root)

    assert sent.sent_at is not None
    assert sent.sent_by == ACTOR
    assert sent.incomplete_reason == ""


def test_send_summary_of_an_incomplete_summary_without_a_reason_is_400(types, tree):
    """RED до фикса: `send_summary` не существовал вовсе."""
    root, left, right = tree
    submit(left)
    with clock.override(MORNING):
        assemble_summary(
            division_id=root.id, business_date=TODAY, actor=ACTOR, allow_incomplete=True
        )

    with pytest.raises(DomainError) as exc:
        send(root, reason="")

    assert exc.value.code == "VALIDATION_ERROR"
    assert exc.value.detail["laggards"] == [right.id]


def test_send_summary_of_an_incomplete_summary_with_a_reason_succeeds(types, tree):
    root, left, right = tree
    submit(left)
    with clock.override(MORNING):
        assemble_summary(
            division_id=root.id, business_date=TODAY, actor=ACTOR, allow_incomplete=True
        )

    sent = send(root, reason="  второй отдел не сдал, штаб предупреждён  ")

    assert sent.sent_at is not None
    assert sent.incomplete_reason == "второй отдел не сдал, штаб предупреждён"


def test_sending_twice_is_409(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)
    assemble(root)
    send(root)

    with pytest.raises(DomainError) as exc:
        send(root)

    assert exc.value.code == "SUMMARY_ALREADY_SENT"
    assert exc.value.http_status == 409


def test_sending_is_written_to_the_log(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)
    summary = assemble(root)
    send(root)

    entry = OpsAuditLog.objects.get(action=audit_service.DAILY_SUMMARY_SENT)
    assert entry.entity_id == summary.pk
    assert entry.new_value["laggards"] == []


# ── Отправка уведомляет оперативных дежурных (Plane №1222, Ш-3) ────────────


def _duty_officer(user_id):
    from organization_management.apps.operations.models import Role, UserRole

    role, _ = Role.objects.get_or_create(
        code="DUTY_OFFICER", defaults={"name": "Оперативный дежурный"}
    )
    return UserRole.objects.create(user_id=user_id, role_code=role, scope_division_id=None)


def _default_duty_recipient(value):
    from organization_management.apps.operations.models_submission import (
        OpsSubmissionControlSettings,
    )

    settings = OpsSubmissionControlSettings.objects.first() or OpsSubmissionControlSettings()
    settings.default_notify_recipient = value
    settings.save()


def test_send_summary_notifies_every_duty_officer_and_the_default_recipient(types, tree):
    """RED до фикса: `send_summary` писал только аудит — дежурный узнавал о
    своде, лишь открыв экран (`[ДОП-20-09]`, решение заказчика 12.09.2026)."""
    from organization_management.apps.operations.models_notification import OpsNotification
    from organization_management.apps.operations.summary_service import send_summary

    root, left, right = tree
    submit(left)
    submit(right)
    summary = assemble(root)
    _duty_officer("42")
    _duty_officer("43")
    _default_duty_recipient(" duty ")

    with clock.override(MORNING):
        send_summary(division_id=root.id, business_date=TODAY, actor=ACTOR)

    rows = OpsNotification.objects.filter(kind=OpsNotification.Kind.SUMMARY_SENT)
    assert sorted(rows.values_list("recipient", flat=True)) == ["42", "43", "duty"]
    row = rows.get(recipient="42")
    assert row.business_date == TODAY
    assert row.dedupe_key == f"summary:{root.id}:v{summary.version}"
    assert row.payload == {
        "division_id": root.id,
        "division_name": "Управление",
        "submission_id": summary.pk,
        "version": summary.version,
        "sent_by": ACTOR,
        "incomplete": False,
        "incomplete_reason": "",
        "laggard_division_ids": [],
    }


def test_send_summary_incomplete_notification_carries_reason_and_laggards(types, tree):
    from organization_management.apps.operations.models_notification import OpsNotification
    from organization_management.apps.operations.summary_service import send_summary

    root, left, right = tree
    submit(left)
    with clock.override(MORNING):
        assemble_summary(division_id=root.id, business_date=TODAY, actor=ACTOR, allow_incomplete=True)
    _duty_officer("42")

    with clock.override(MORNING):
        send_summary(division_id=root.id, business_date=TODAY, actor=ACTOR, reason="штаб предупреждён")

    row = OpsNotification.objects.get(kind=OpsNotification.Kind.SUMMARY_SENT, recipient="42")
    assert row.payload["incomplete"] is True
    assert row.payload["incomplete_reason"] == "штаб предупреждён"
    assert row.payload["laggard_division_ids"] == [right.id]


def test_send_summary_without_any_duty_officer_still_sends(types, tree):
    """Некому сообщить — не отказ отправки: факт доставки фиксируется в строке
    свода и аудите, а получателей администратор заведёт позже."""
    from organization_management.apps.operations.models_notification import OpsNotification
    from organization_management.apps.operations.summary_service import send_summary

    root, left, right = tree
    submit(left)
    submit(right)
    assemble(root)

    with clock.override(MORNING):
        sent = send_summary(division_id=root.id, business_date=TODAY, actor=ACTOR)

    assert sent.sent_at is not None
    assert OpsNotification.objects.filter(kind=OpsNotification.Kind.SUMMARY_SENT).count() == 0


def test_send_summary_notifies_an_inactive_duty_officer_never(types, tree):
    from organization_management.apps.operations.models_notification import OpsNotification
    from organization_management.apps.operations.summary_service import send_summary

    root, left, right = tree
    submit(left)
    submit(right)
    assemble(root)
    assignment = _duty_officer("42")
    assignment.is_active = False
    assignment.save(update_fields=["is_active"])

    with clock.override(MORNING):
        send_summary(division_id=root.id, business_date=TODAY, actor=ACTOR)

    assert OpsNotification.objects.filter(kind=OpsNotification.Kind.SUMMARY_SENT).count() == 0
