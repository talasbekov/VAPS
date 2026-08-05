"""Сдача дня: окно, повтор, событие diff'ом, опоздание, журнал.

Событие дня — не украшение, а то, по чему потом отличают «подтвердили как
вчера» от «обстановка изменилась», поэтому diff проверяется с обеих сторон:
что считается изменением и что им НЕ считается.
"""
from datetime import date, datetime, time, timedelta, timezone

import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import audit_service, clock
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.models_submission import (
    DEFAULT_CONTROL_HOUR,
    OpsDailySubmission,
)
from organization_management.apps.operations.tests.test_status_service import (
    make_employee,
    seed_types,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

TODAY = date(2026, 8, 4)
ACTOR = "7"
# Момент внутри рабочего дня по локальной зоне стенда (+05): 09:00 местного.
MORNING = datetime(2026, 8, 4, 4, 0, tzinfo=timezone.utc)
EVENING = datetime(2026, 8, 4, 13, 30, tzinfo=timezone.utc)  # 18:30 местного


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


def in_slot(division, **overrides):
    employee = make_employee(**overrides)
    StaffUnit.objects.create(division=division, employee=employee, index=employee.id)
    return employee


def fact(employee, code="DUTY", start=None, end=None, **extra):
    fields = {
        "employee_id": employee.id,
        "status_type_code": code,
        "date_start": TODAY if start is None else start,
        "date_end": TODAY + timedelta(days=2) if end is None else end,
        "source": OpsEmployeeStatus.Source.USER,
        "created_by": ACTOR,
    }
    fields.update(extra)
    return OpsEmployeeStatus.objects.create(**fields)


def submitted(division, business_date, *, version=1, is_current=True, snapshot=None):
    """Готовая строка сдачи в обход сервиса — база для diff и для повтора."""
    return OpsDailySubmission.objects.create(
        division_id=division.id,
        business_date=business_date,
        version=version,
        is_current=is_current,
        event=OpsDailySubmission.Event.CHANGED,
        submitted_by=ACTOR,
        submitted_at=MORNING,
        snapshot={"schema_version": 1, "roster": [], "rows": []}
        if snapshot is None
        else snapshot,
    )


class TestGuards:
    def test_actor_is_required(self, division):
        with clock.override(MORNING), pytest.raises(DomainError) as exc:
            submit_day(division_id=division.id, business_date=TODAY, actor="  ")
        assert exc.value.http_status == 400
        assert OpsDailySubmission.objects.count() == 0

    def test_unknown_division_is_404_before_anything_is_written(self, division):
        # Иначе снимок призрака собрался бы ПУСТЫМ, и сдача выглядела бы
        # честной сдачей подразделения без людей.
        with clock.override(MORNING), pytest.raises(DomainError) as exc:
            submit_day(
                division_id=division.id + 10_000,
                business_date=TODAY,
                actor=ACTOR,
            )
        assert exc.value.code == "ENTITY_NOT_FOUND"
        assert exc.value.http_status == 404
        assert OpsDailySubmission.objects.count() == 0

    def test_date_outside_the_window_is_422(self, division):
        with clock.override(MORNING), pytest.raises(DomainError) as exc:
            submit_day(
                division_id=division.id,
                business_date=TODAY - timedelta(days=1),
                actor=ACTOR,
            )
        assert exc.value.code == "BUSINESS_DATE_OUT_OF_WINDOW"
        assert exc.value.http_status == 422
        assert exc.value.detail["allowed"] == [
            str(TODAY),
            str(TODAY + timedelta(days=1)),
        ]

    def test_default_window_covers_today_and_tomorrow(self, division):
        with clock.override(MORNING):
            submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)
            submit_day(
                division_id=division.id,
                business_date=TODAY + timedelta(days=1),
                actor=ACTOR,
            )
        assert OpsDailySubmission.objects.count() == 2

    def test_explicit_window_overrides_the_default(self, division):
        # Окно приходит параметром: догон за прошлый день — законная
        # операция вызывающего, а не обход правила внутри сервиса.
        past = TODAY - timedelta(days=3)
        with clock.override(MORNING):
            submission = submit_day(
                division_id=division.id,
                business_date=past,
                actor=ACTOR,
                window_dates=[past],
            )
        assert submission.business_date == past

    def test_second_submission_of_the_same_day_is_409(self, division):
        submitted(division, TODAY)
        with clock.override(MORNING), pytest.raises(DomainError) as exc:
            submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)
        assert exc.value.code == "DAY_ALREADY_SUBMITTED"
        assert exc.value.http_status == 409
        assert OpsDailySubmission.objects.count() == 1

    def test_retired_version_still_blocks_a_first_submission(self, division):
        # ОТЛИЧИЕ ОТ ИСТОЧНИКА: блокирует ЛЮБАЯ версия дня, не только
        # текущая. Первичная сдача пишет версию 1, и на дне со снятой с
        # текущих версией 1 она упёрлась бы в уникальность номера — то есть
        # в 500 вместо внятного отказа.
        submitted(division, TODAY, is_current=False)
        with clock.override(MORNING), pytest.raises(DomainError) as exc:
            submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)
        assert exc.value.code == "DAY_ALREADY_SUBMITTED"
        assert exc.value.http_status == 409
        assert OpsDailySubmission.objects.count() == 1

    def test_race_duplicate_is_stopped_by_the_database(self, division):
        # Предпроверка — не единственный рубеж: параллельная сдача,
        # проскочившая её, упирается в частичное ограничение.
        submitted(division, TODAY)
        with pytest.raises(IntegrityError), transaction.atomic():
            OpsDailySubmission.objects.create(
                division_id=division.id,
                business_date=TODAY,
                version=2,
                is_current=True,
                event=OpsDailySubmission.Event.CHANGED,
                submitted_by=ACTOR,
                submitted_at=MORNING,
            )


class TestWrittenRow:
    def test_first_submission_is_version_one_and_current(self, division):
        employee = in_slot(division)
        with clock.override(MORNING):
            submission = submit_day(
                division_id=division.id, business_date=TODAY, actor=ACTOR
            )
        from_db = OpsDailySubmission.objects.get(pk=submission.pk)
        assert from_db.version == 1
        assert from_db.is_current is True
        assert from_db.submitted_by == ACTOR
        assert from_db.submitted_at == MORNING
        assert [row["employee_id"] for row in from_db.snapshot["roster"]] == [
            employee.id
        ]

    def test_snapshot_is_frozen_against_later_changes(self, division):
        # Смысл сдачи: после подписи живые правки её не переписывают.
        employee = in_slot(division)
        with clock.override(MORNING):
            submission = submit_day(
                division_id=division.id, business_date=TODAY, actor=ACTOR
            )
        fact(employee)
        Employee.objects.filter(pk=employee.id).update(last_name="Петров")
        from_db = OpsDailySubmission.objects.get(pk=submission.pk)
        assert from_db.snapshot["rows"] == []
        assert "Петров" not in from_db.snapshot["roster"][0]["full_name"]


class TestEvent:
    def _submit(self, division, business_date, **kwargs):
        with clock.override(MORNING):
            return submit_day(
                division_id=division.id,
                business_date=business_date,
                actor=ACTOR,
                **kwargs,
            )

    def test_first_ever_submission_is_changed(self, division):
        in_slot(division)
        assert self._submit(division, TODAY).event == (
            OpsDailySubmission.Event.CHANGED
        )

    def test_identical_day_is_confirmed_without_changes(self, division):
        seed_types()
        employee = in_slot(division)
        fact(employee, start=TODAY - timedelta(days=1), end=TODAY + timedelta(days=5))
        yesterday = TODAY - timedelta(days=1)
        self._submit(division, yesterday, window_dates=[yesterday])
        assert self._submit(division, TODAY).event == (
            OpsDailySubmission.Event.CONFIRMED_NO_CHANGES
        )

    def test_new_fact_makes_it_changed(self, division):
        seed_types()
        employee = in_slot(division)
        yesterday = TODAY - timedelta(days=1)
        self._submit(division, yesterday, window_dates=[yesterday])
        fact(employee, start=TODAY, end=TODAY + timedelta(days=2))
        assert self._submit(division, TODAY).event == (
            OpsDailySubmission.Event.CHANGED
        )

    def test_new_person_in_the_roster_makes_it_changed(self, division):
        in_slot(division)
        yesterday = TODAY - timedelta(days=1)
        self._submit(division, yesterday, window_dates=[yesterday])
        in_slot(division)
        assert self._submit(division, TODAY).event == (
            OpsDailySubmission.Event.CHANGED
        )

    def test_rename_alone_is_not_a_change(self, division):
        # Переименование меняет снимок (денорм), но не обстановку: объявить
        # его изменением значило бы врать в событии дня.
        employee = in_slot(division, last_name="Иванов")
        yesterday = TODAY - timedelta(days=1)
        first = self._submit(division, yesterday, window_dates=[yesterday])
        Employee.objects.filter(pk=employee.id).update(last_name="Петров")
        second = self._submit(division, TODAY)
        assert second.event == OpsDailySubmission.Event.CONFIRMED_NO_CHANGES
        # Снимки при этом РАЗНЫЕ — сравнивается не они целиком.
        assert first.snapshot["roster"] != second.snapshot["roster"]

    def test_recreated_identical_fact_is_not_a_change(self, division):
        # Удалили и завели тот же факт заново: id строки другой, обстановка
        # прежняя. Сравнение по id объявило бы это изменением.
        seed_types()
        employee = in_slot(division)
        row = fact(
            employee, start=TODAY - timedelta(days=1), end=TODAY + timedelta(days=5)
        )
        yesterday = TODAY - timedelta(days=1)
        self._submit(division, yesterday, window_dates=[yesterday])
        row.delete()
        fact(employee, start=TODAY - timedelta(days=1), end=TODAY + timedelta(days=5))
        assert self._submit(division, TODAY).event == (
            OpsDailySubmission.Event.CONFIRMED_NO_CHANGES
        )

    def test_baseline_is_the_nearest_previous_not_literally_yesterday(
        self, division
    ):
        # База сравнения — ближайшая предыдущая сдача: между сдачами бывают
        # выходные, и «вчера» буквально объявляло бы изменением всё.
        seed_types()
        employee = in_slot(division)
        fact(employee, start=TODAY - timedelta(days=10), end=TODAY + timedelta(days=5))
        long_ago = TODAY - timedelta(days=5)
        self._submit(division, long_ago, window_dates=[long_ago])
        assert self._submit(division, TODAY).event == (
            OpsDailySubmission.Event.CONFIRMED_NO_CHANGES
        )

    def test_other_division_submission_is_not_a_baseline(self, division):
        other = Division.objects.create(name="Управление 2")
        yesterday = TODAY - timedelta(days=1)
        self._submit(other, yesterday, window_dates=[yesterday])
        assert self._submit(division, TODAY).event == (
            OpsDailySubmission.Event.CHANGED
        )


class TestLate:
    def test_before_the_control_hour_is_not_late(self, division):
        with clock.override(MORNING):
            submission = submit_day(
                division_id=division.id, business_date=TODAY, actor=ACTOR
            )
        assert submission.late is False

    def test_after_the_control_hour_is_late(self, division):
        with clock.override(EVENING):
            submission = submit_day(
                division_id=division.id, business_date=TODAY, actor=ACTOR
            )
        assert submission.late is True

    def test_the_boundary_is_strict(self, division):
        # Ровно в контрольный час ещё не поздно, секундой позже — уже.
        # Обе половины обязательны: одна «не поздно» зеленела бы и при
        # нестрогом сравнении, если бы граница уехала на минуту.
        other = Division.objects.create(name="Управление 2")
        assert DEFAULT_CONTROL_HOUR == time(17, 0)
        deadline_utc = datetime(2026, 8, 4, 12, 0, tzinfo=timezone.utc)
        with clock.override(deadline_utc):
            on_time = submit_day(
                division_id=division.id, business_date=TODAY, actor=ACTOR
            )
        with clock.override(deadline_utc + timedelta(seconds=1)):
            too_late = submit_day(
                division_id=other.id, business_date=TODAY, actor=ACTOR
            )
        assert on_time.late is False
        assert too_late.late is True

    def test_control_hour_is_a_parameter(self, division):
        # Утренняя сдача поздна, если контрольный час назначен на рассвет:
        # значение приходит извне, а не зашито сравнением.
        with clock.override(MORNING):
            submission = submit_day(
                division_id=division.id,
                business_date=TODAY,
                actor=ACTOR,
                control_hour=time(1, 0),
            )
        assert submission.late is True


class TestAudit:
    def test_successful_submission_writes_one_event(self, division):
        in_slot(division)
        with clock.override(MORNING):
            submission = submit_day(
                division_id=division.id, business_date=TODAY, actor=ACTOR
            )
        entries = list(OpsAuditLog.objects.all())
        assert len(entries) == 1
        entry = entries[0]
        assert entry.action == audit_service.DAILY_SUBMISSION_SUBMITTED
        assert entry.entity_type == audit_service.ENTITY_SUBMISSION
        assert entry.entity_id == submission.pk
        assert entry.actor_user_id == ACTOR
        assert entry.old_value is None
        assert entry.new_value["division_id"] == division.id
        assert entry.new_value["version"] == 1
        assert entry.new_value["event"] == submission.event

    def test_the_audit_value_does_not_carry_the_day_snapshot(self, division):
        in_slot(division)
        with clock.override(MORNING):
            submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)
        value = OpsAuditLog.objects.get().new_value
        assert "snapshot" not in value
        assert "roster" not in value

    def test_rejected_submission_writes_nothing(self, division):
        submitted(division, TODAY)
        with clock.override(MORNING), pytest.raises(DomainError):
            submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)
        assert OpsAuditLog.objects.count() == 0
