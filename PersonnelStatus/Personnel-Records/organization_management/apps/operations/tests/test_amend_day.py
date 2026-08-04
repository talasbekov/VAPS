"""Поправка сданного дня: новая версия вместо правки заявления.

Проверяется не только то, что новая версия появилась, но и то, что прежняя
УЦЕЛЕЛА и осталась читаемой: в этом вся разница между поправкой и правкой
задним числом. Отдельно закрепляются отличия поправки от первичной сдачи —
окна нет, событие всегда AMENDED, опоздание не наследуется.
"""
from datetime import timedelta

import pytest
from django.db import connection

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
from organization_management.apps.operations.tests.test_day_submission_service import (
    EVENING,
    MORNING,
    TODAY,
    fact,
    in_slot,
    submitted,
)
from organization_management.apps.operations.tests.test_status_service import seed_types

pytestmark = pytest.mark.django_db

ACTOR = "7"
REASON = "Ошибка в наряде"
SANCTION = "Замечание оперативному дежурному"


@pytest.fixture
def types():
    seed_types()


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


def amend(division, business_date=TODAY, at=MORNING, **overrides):
    kwargs = {
        "division_id": division.id,
        "business_date": business_date,
        "actor": ACTOR,
        "reason": REASON,
        "sanction": SANCTION,
    }
    kwargs.update(overrides)
    with clock.override(at):
        return amend_day(**kwargs)


class TestGuards:
    def test_unsubmitted_day_cannot_be_amended(self, types, division):
        with pytest.raises(DomainError) as exc:
            amend(division)
        assert exc.value.code == "NO_SUBMISSION_TO_AMEND"
        assert exc.value.http_status == 422
        assert not OpsDailySubmission.objects.exists()

    def test_missing_division_is_404(self, types, division):
        submitted(division, TODAY)
        with pytest.raises(DomainError) as exc:
            amend(division, division_id=division.id + 10_000)
        assert exc.value.code == "ENTITY_NOT_FOUND"

    def test_another_day_of_the_same_division_is_not_a_submission(
        self, types, division
    ):
        # Сдан вчерашний — сегодняшний от этого сданным не становится.
        submitted(division, TODAY - timedelta(days=1))
        with pytest.raises(DomainError) as exc:
            amend(division, business_date=TODAY)
        assert exc.value.code == "NO_SUBMISSION_TO_AMEND"

    @pytest.mark.parametrize("field", ["reason", "sanction"])
    @pytest.mark.parametrize("value", ["", "   ", None])
    def test_reason_and_sanction_are_required(self, types, division, field, value):
        submitted(division, TODAY)
        with pytest.raises(DomainError) as exc:
            amend(division, **{field: value})
        assert exc.value.code == "VALIDATION_ERROR"
        assert exc.value.http_status == 400
        assert field in exc.value.detail
        assert OpsDailySubmission.objects.count() == 1

    def test_actor_is_required(self, types, division):
        submitted(division, TODAY)
        with pytest.raises(DomainError) as exc:
            amend(division, actor="  ")
        assert exc.value.code == "VALIDATION_ERROR"

    def test_rejected_amendment_leaves_the_previous_version_current(
        self, types, division
    ):
        # Гашение флага не должно пережить отказ: иначе у дня осталось бы
        # НОЛЬ текущих версий, и расход перестал бы находить сданное.
        first = submitted(division, TODAY)
        with pytest.raises(DomainError):
            amend(division, reason="")
        first.refresh_from_db()
        assert first.is_current is True


class TestNewVersion:
    def test_amendment_writes_the_next_version(self, types, division):
        first = submitted(division, TODAY)
        second = amend(division)
        assert second.version == first.version + 1
        assert second.is_current is True
        assert second.event == OpsDailySubmission.Event.AMENDED
        assert second.reason == REASON
        assert second.sanction == SANCTION
        assert second.submitted_by == ACTOR

    def test_previous_version_survives_and_steps_aside(self, types, division):
        first = submitted(division, TODAY)
        before_snapshot = first.snapshot
        amend(division)
        first.refresh_from_db()
        # Прежняя версия цела ЦЕЛИКОМ: снимок не переписан, номер тот же,
        # ушёл только флаг текущей.
        assert first.is_current is False
        assert first.version == 1
        assert first.snapshot == before_snapshot
        assert OpsDailySubmission.objects.count() == 2

    def test_version_numbers_keep_climbing(self, types, division):
        submitted(division, TODAY)
        amend(division)
        third = amend(division, reason="ещё одна", sanction="выговор")
        assert third.version == 3
        assert (
            OpsDailySubmission.objects.filter(
                division_id=division.id, business_date=TODAY, is_current=True
            ).count()
            == 1
        )

    def test_snapshot_is_rebuilt_not_copied(self, types, division):
        # Смысл поправки: новая версия показывает ИСПРАВЛЕННОЕ состояние.
        submitted(division, TODAY, snapshot={"schema_version": 1, "roster": [], "rows": []})
        employee = in_slot(division)
        fact(employee, code="DUTY")
        second = amend(division)
        assert [row["employee_id"] for row in second.snapshot["roster"]] == [
            employee.id
        ]
        assert [row["employee_id"] for row in second.snapshot["rows"]] == [employee.id]

    def test_amendment_reflects_the_removal_of_a_fact(self, types, division):
        employee = in_slot(division)
        row = fact(employee, code="DUTY")
        with clock.override(MORNING):
            first = submit_day(
                division_id=division.id, business_date=TODAY, actor=ACTOR
            )
        assert first.snapshot["rows"]
        row.delete()
        second = amend(division)
        assert second.snapshot["rows"] == []
        # Вытесненная версия по-прежнему помнит, как было.
        first.refresh_from_db()
        assert first.snapshot["rows"]

    def test_amendment_stores_trimmed_text(self, types, division):
        submitted(division, TODAY)
        second = amend(division, reason="  причина  ", sanction="  санкция  ")
        second.refresh_from_db()
        assert second.reason == "причина"
        assert second.sanction == "санкция"

    def test_triggered_by_status_id_rides_along(self, types, division):
        employee = in_slot(division)
        row = fact(employee, code="DUTY")
        submitted(division, TODAY)
        second = amend(division, triggered_by_status_id=row.pk)
        assert second.triggered_by_status_id == row.pk

    def test_manual_amendment_has_no_trigger(self, types, division):
        submitted(division, TODAY)
        assert amend(division).triggered_by_status_id is None


class TestDifferencesFromSubmission:
    def test_window_does_not_apply(self, types, division):
        # Поправляют как раз прошлое: окно сдачи здесь не действует, иначе
        # исправить позавчерашний день было бы нечем.
        long_ago = TODAY - timedelta(days=30)
        submitted(division, long_ago)
        second = amend(division, business_date=long_ago)
        assert second.business_date == long_ago
        assert second.version == 2

    def test_amendment_is_never_late(self, types, division):
        # Поздность — свойство акта сдачи в контрольный час; наследовать её
        # значило бы объявить опоздавшим того, кто исправляет вчерашнее.
        submitted(division, TODAY)
        assert amend(division, at=EVENING).late is False

    def test_event_is_amended_even_when_nothing_changed(self, types, division):
        # Событие не считается diff'ом: поправка по определению утверждает,
        # что прежняя версия была неверна.
        in_slot(division)
        with clock.override(MORNING):
            submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)
        second = amend(division)
        assert second.event == OpsDailySubmission.Event.AMENDED

    def test_head_is_found_even_with_zero_current_versions(self, types, division):
        # «Ровно одна текущая» — прикладной инвариант, база держит лишь «не
        # более одной». В вырожденном состоянии поправка обязана продолжить
        # цепочку, а не начать её заново поверх существующей истории.
        submitted(division, TODAY, version=1, is_current=False)
        second = amend(division)
        assert second.version == 2


class TestConcurrency:
    def test_the_chain_head_is_locked(self, types, division):
        # Ассерт по ИМЕНИ таблицы: любой FOR UPDATE в трассе сделал бы
        # проверку вакуумной.
        submitted(division, TODAY)
        collected = []

        def collector(execute, sql, params, many, context):
            collected.append(sql)
            return execute(sql, params, many, context)

        with connection.execute_wrapper(collector):
            amend(division)
        table = OpsDailySubmission._meta.db_table
        assert any(
            "FOR UPDATE" in sql.upper() and table in sql for sql in collected
        ), collected


class TestAudit:
    def test_amendment_writes_one_event_with_both_sides(self, types, division):
        first = submitted(division, TODAY)
        second = amend(division)
        entry = OpsAuditLog.objects.get(action=audit_service.DAILY_SUBMISSION_AMENDED)
        assert entry.entity_type == audit_service.ENTITY_SUBMISSION
        assert entry.entity_id == second.pk
        assert entry.actor_user_id == ACTOR
        assert entry.reason == REASON
        # «До» — вытесняемая версия КАК ОНА БЫЛА: ещё текущая.
        assert entry.old_value["submission_id"] == first.pk
        assert entry.old_value["version"] == 1
        assert entry.old_value["is_current"] is True
        assert entry.new_value["version"] == 2
        assert entry.new_value["sanction"] == SANCTION

    def test_audit_value_does_not_carry_the_day_snapshot(self, types, division):
        submitted(division, TODAY)
        amend(division)
        entry = OpsAuditLog.objects.get(action=audit_service.DAILY_SUBMISSION_AMENDED)
        for value in (entry.old_value, entry.new_value):
            assert "snapshot" not in value
            assert "roster" not in value

    def test_rejected_amendment_writes_nothing(self, types, division):
        submitted(division, TODAY)
        before = OpsAuditLog.objects.count()
        with pytest.raises(DomainError):
            amend(division, sanction="")
        assert OpsAuditLog.objects.count() == before

    def test_submission_event_carries_the_amendment_fields_too(self, types, division):
        # Форма снимка одна на оба события: у первичной сдачи поля поправки
        # пусты, но ПРИСУТСТВУЮТ — иначе отсутствие ключа было бы неотличимо
        # от «причины не было».
        in_slot(division)
        with clock.override(MORNING):
            submit_day(division_id=division.id, business_date=TODAY, actor=ACTOR)
        value = OpsAuditLog.objects.get(
            action=audit_service.DAILY_SUBMISSION_SUBMITTED
        ).new_value
        assert value["reason"] == ""
        assert value["sanction"] == ""
        assert value["triggered_by_status_id"] is None
