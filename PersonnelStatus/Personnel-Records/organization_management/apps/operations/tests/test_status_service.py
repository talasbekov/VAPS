"""Статусы раздела ОМ: модель, матрица конфликтов, сервис создания/отмены.

Отдельно проверяется САМА гарантия БД (excl_hard_status_overlap): сервисная
предпроверка и ограничение — два разных рубежа, и зелёный сервис не
доказывает, что ограничение доехало до схемы. Поэтому тест вставляет строку
в обход сервиса и ждёт IntegrityError.
"""
from datetime import date, timedelta

import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.conflict_matrix import (
    ConflictSeverity,
    classify_pair,
    detect_conflicts,
)
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    StatusOverride,
)
from organization_management.apps.operations.status_service import (
    cancel_status,
    create_status,
)

TODAY = date(2026, 8, 4)
ACTOR = "7"


def seed_types():
    for code, hard in [
        ("VACATION", True),
        ("SICK_LEAVE", True),
        ("DUTY", False),
        ("STUDY", False),
        ("DETACHED", False),
        ("ATTACHED", False),
    ]:
        StatusType.objects.get_or_create(
            code=code,
            defaults={
                "name": code,
                "priority": 10,
                "report_column_code": "X",
                "is_hard_block": hard,
            },
        )


def make_employee(**overrides):
    # personnel_number/iin уникальны — счётчик держит фикстуры независимыми.
    seq = Employee.objects.count() + 1
    fields = {
        "first_name": "Иван",
        "last_name": "Иванов",
        "personnel_number": f"P{seq:05d}",
        "iin": f"{seq:012d}",
        "hire_date": date(2020, 1, 1),
    }
    fields.update(overrides)
    return Employee.objects.create(**fields)


# ── Чистая матрица (без БД) ──────────────────────────────────────────────

class TestConflictMatrix:
    def test_hard_wins_regardless_of_side(self):
        assert classify_pair("VACATION", "DUTY") is ConflictSeverity.HARD
        assert classify_pair("DUTY", "VACATION") is ConflictSeverity.HARD

    def test_secondment_pair_is_compatible(self):
        assert classify_pair("DETACHED", "ATTACHED") is ConflictSeverity.COMPATIBLE

    def test_plain_pair_is_soft(self):
        assert classify_pair("DUTY", "STUDY") is ConflictSeverity.SOFT

    def test_planned_soft_is_only_a_warning(self):
        report = detect_conflicts(
            new_type="DUTY",
            existing_rows=[
                {
                    "status_type_code": "STUDY",
                    "date_start": TODAY + timedelta(days=3),
                    "date_end": TODAY + timedelta(days=5),
                }
            ],
            business_date=TODAY,
        )
        assert report.warnings and not report.soft
        assert not report.has_blocking()

    def test_planned_hard_still_blocks(self):
        report = detect_conflicts(
            new_type="DUTY",
            existing_rows=[
                {
                    "status_type_code": "VACATION",
                    "date_start": TODAY + timedelta(days=3),
                    "date_end": TODAY + timedelta(days=5),
                }
            ],
            business_date=TODAY,
        )
        assert report.hard and report.has_blocking()


# ── Выводимое состояние ──────────────────────────────────────────────────

@pytest.mark.django_db
class TestDerivedState:
    def test_property_and_annotation_agree(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY):
            create_status(
                employee_id=employee.id,
                status_type_code="DUTY",
                date_start=TODAY,
                date_end=TODAY + timedelta(days=2),
                actor=ACTOR,
            )
            create_status(
                employee_id=employee.id,
                status_type_code="STUDY",
                date_start=TODAY + timedelta(days=5),
                date_end=TODAY + timedelta(days=6),
                actor=ACTOR,
                override=True,
                override_reason="демо",
            )
            rows = OpsEmployeeStatus.objects.with_state().order_by("date_start")
            # Аннотация SQL и python-свойство обязаны совпадать построчно —
            # иначе список и карточка показали бы разное состояние.
            for row in rows:
                assert row.state_annotation == row.state.value
            assert [r.state_annotation for r in rows] == ["ACTIVE", "PLANNED"]

    def test_half_open_end_day_is_already_completed(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY):
            status = create_status(
                employee_id=employee.id,
                status_type_code="DUTY",
                date_start=TODAY - timedelta(days=1),
                date_end=TODAY,
                actor=ACTOR,
            )
        # [start, end): день end уже НЕ входит в статус.
        assert status.state_on(TODAY) == OpsEmployeeStatus.LifecycleState.COMPLETED
        assert status.state_on(TODAY - timedelta(days=1)) == (
            OpsEmployeeStatus.LifecycleState.ACTIVE
        )


# ── Создание ─────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestCreateStatus:
    def _create(self, employee, **overrides):
        payload = {
            "employee_id": employee.id,
            "status_type_code": "DUTY",
            "date_start": TODAY,
            "date_end": TODAY + timedelta(days=1),
            "actor": ACTOR,
        }
        payload.update(overrides)
        return create_status(**payload)

    def test_happy_path(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY):
            status = self._create(employee)
        assert status.pk is not None
        assert status.source == OpsEmployeeStatus.Source.USER
        assert status.created_by == ACTOR

    def test_actor_required(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY), pytest.raises(DomainError) as exc:
            self._create(employee, actor="   ")
        assert exc.value.http_status == 400

    def test_unknown_employee_is_404(self):
        seed_types()
        with clock.override(TODAY), pytest.raises(DomainError) as exc:
            create_status(
                employee_id=999999,
                status_type_code="DUTY",
                date_start=TODAY,
                date_end=TODAY + timedelta(days=1),
                actor=ACTOR,
            )
        assert exc.value.code == "ENTITY_NOT_FOUND"
        assert exc.value.http_status == 404

    def test_unknown_or_inactive_type_is_422(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY), pytest.raises(DomainError) as exc:
            self._create(employee, status_type_code="НЕТУ")
        assert exc.value.code == "INVALID_STATUS_TYPE"
        StatusType.objects.filter(code="DUTY").update(is_active=False)
        with clock.override(TODAY), pytest.raises(DomainError) as exc:
            self._create(employee)
        assert exc.value.code == "INVALID_STATUS_TYPE"

    def test_inverted_interval_is_422(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY), pytest.raises(DomainError) as exc:
            self._create(employee, date_start=TODAY, date_end=TODAY)
        assert exc.value.code == "INVALID_DATE_RANGE"

    def test_before_hire_is_422(self):
        seed_types()
        employee = make_employee(hire_date=TODAY)
        with clock.override(TODAY), pytest.raises(DomainError) as exc:
            self._create(employee, date_start=TODAY - timedelta(days=1))
        assert exc.value.code == "DATE_OUTSIDE_EMPLOYMENT"

    def test_after_dismissal_is_422(self):
        seed_types()
        employee = make_employee(dismissal_date=TODAY + timedelta(days=1))
        with clock.override(TODAY), pytest.raises(DomainError) as exc:
            self._create(employee, date_end=TODAY + timedelta(days=5))
        assert exc.value.code == "DATE_OUTSIDE_EMPLOYMENT"

    def test_max_duration_is_422(self):
        seed_types()
        StatusType.objects.filter(code="DUTY").update(max_duration_days=2)
        employee = make_employee()
        with clock.override(TODAY), pytest.raises(DomainError) as exc:
            self._create(employee, date_end=TODAY + timedelta(days=3))
        assert exc.value.code == "MAX_DURATION_EXCEEDED"

    def test_hard_overlap_is_422_and_not_overridable(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY):
            self._create(employee, status_type_code="VACATION")
            with pytest.raises(DomainError) as exc:
                self._create(employee, status_type_code="DUTY")
        assert exc.value.code == "OVERLAPPING_HARD_STATUS"
        assert exc.value.http_status == 422
        assert exc.value.overridable is False
        # Даже с override жёсткий конфликт не обходится.
        with clock.override(TODAY), pytest.raises(DomainError) as exc:
            self._create(employee, override=True, override_reason="очень надо")
        assert exc.value.code == "OVERLAPPING_HARD_STATUS"

    def test_soft_overlap_is_409_overridable(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY):
            self._create(employee, status_type_code="DUTY")
            with pytest.raises(DomainError) as exc:
                self._create(employee, status_type_code="STUDY")
        assert exc.value.code == "STATUS_OVERLAP_WARNING"
        assert exc.value.http_status == 409
        assert exc.value.overridable is True

    def test_override_records_bypass(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY):
            self._create(employee, status_type_code="DUTY")
            status = self._create(
                employee,
                status_type_code="STUDY",
                override=True,
                override_reason="приказ №7",
            )
        override = StatusOverride.objects.get(status=status)
        assert override.reason == "приказ №7"
        # Снимок обойдённого конфликта хранится, а не пересчитывается позже.
        assert override.conflicts[0]["status_type"] == "DUTY"

    def test_override_without_conflict_writes_nothing(self):
        # «Нет конфликта — нет записи»: иначе журнал обходов оброс бы шумом.
        seed_types()
        employee = make_employee()
        with clock.override(TODAY):
            self._create(employee, override=True, override_reason="на всякий")
        assert StatusOverride.objects.count() == 0

    def test_override_requires_reason(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY), pytest.raises(DomainError) as exc:
            self._create(employee, override=True, override_reason="  ")
        assert exc.value.http_status == 400

    def test_compatible_pair_coexists(self):
        # Пара «прикомандирован/откомандирован» законно живёт одним периодом:
        # матрица не считает её конфликтом. Порядок именно такой — обратный
        # упёрся бы в гард откомандированного (см. соседний тест), и это
        # свойство ГАРДА, а не матрицы: обе ноги прикомандирования пишет
        # свой сервис, который этот гард не зовёт.
        seed_types()
        employee = make_employee()
        with clock.override(TODAY):
            self._create(employee, status_type_code="ATTACHED")
            second = self._create(employee, status_type_code="DETACHED")
        assert second.pk is not None

    def test_detached_employee_is_read_only(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY):
            self._create(
                employee,
                status_type_code="DETACHED",
                date_end=TODAY + timedelta(days=10),
            )
            with pytest.raises(DomainError) as exc:
                self._create(employee, status_type_code="STUDY")
        assert exc.value.code == "PERMISSION_DENIED"
        assert exc.value.http_status == 403


# ── Гарантия БД, а не сервиса ────────────────────────────────────────────

@pytest.mark.django_db(transaction=True)
class TestDatabaseGuarantee:
    def test_hard_overlap_blocked_by_constraint_not_only_by_service(self):
        seed_types()
        employee = make_employee()
        OpsEmployeeStatus.objects.create(
            employee_id=employee.id,
            status_type_code="VACATION",
            date_start=TODAY,
            date_end=TODAY + timedelta(days=5),
        )
        # В ОБХОД сервиса: так вставила бы параллельная транзакция,
        # проскочившая предпроверку.
        with pytest.raises(IntegrityError) as exc, transaction.atomic():
            OpsEmployeeStatus.objects.create(
                employee_id=employee.id,
                status_type_code="SICK_LEAVE",
                date_start=TODAY + timedelta(days=1),
                date_end=TODAY + timedelta(days=2),
            )
        # Именно ограничение пересечения, а не любая ошибка целостности:
        # «какой-нибудь IntegrityError» прошёл бы и при опечатке в фикстуре.
        assert "excl_hard_status_overlap" in str(exc.value)

    def test_cancelled_row_leaves_the_perimeter(self):
        seed_types()
        employee = make_employee()
        first = OpsEmployeeStatus.objects.create(
            employee_id=employee.id,
            status_type_code="VACATION",
            date_start=TODAY,
            date_end=TODAY + timedelta(days=5),
            cancelled_at=Clock.now(),
        )
        assert first.pk is not None
        # Отменённая строка не держит период: ограничение частичное.
        second = OpsEmployeeStatus.objects.create(
            employee_id=employee.id,
            status_type_code="VACATION",
            date_start=TODAY,
            date_end=TODAY + timedelta(days=5),
        )
        assert second.pk is not None

    def test_soft_overlap_is_allowed_by_the_constraint(self):
        # Мягкие пересечения — забота сервиса; БД их не запрещает, иначе
        # override был бы невозможен в принципе.
        seed_types()
        employee = make_employee()
        for _ in range(2):
            OpsEmployeeStatus.objects.create(
                employee_id=employee.id,
                status_type_code="DUTY",
                date_start=TODAY,
                date_end=TODAY + timedelta(days=1),
            )
        assert OpsEmployeeStatus.objects.filter(employee_id=employee.id).count() == 2


# ── Отмена ───────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestCancelStatus:
    def _planned(self, employee):
        return create_status(
            employee_id=employee.id,
            status_type_code="DUTY",
            date_start=TODAY + timedelta(days=3),
            date_end=TODAY + timedelta(days=4),
            actor=ACTOR,
        )

    def test_planned_is_cancellable(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY):
            status = self._planned(employee)
            cancelled = cancel_status(status, actor=ACTOR, reason="приказ отменён")
        assert cancelled.state_on(TODAY) == OpsEmployeeStatus.LifecycleState.CANCELLED
        assert cancelled.cancelled_by == ACTOR
        # Факты записаны в БД, а не только в объекте.
        from_db = OpsEmployeeStatus.objects.get(pk=status.pk)
        assert from_db.cancelled_at is not None
        assert from_db.cancelled_reason == "приказ отменён"

    def test_reason_required(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY):
            status = self._planned(employee)
            with pytest.raises(DomainError) as exc:
                cancel_status(status, actor=ACTOR, reason=" ")
        assert exc.value.http_status == 400

    def test_active_is_not_cancellable(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY):
            status = create_status(
                employee_id=employee.id,
                status_type_code="DUTY",
                date_start=TODAY,
                date_end=TODAY + timedelta(days=2),
                actor=ACTOR,
            )
            with pytest.raises(DomainError) as exc:
                cancel_status(status, actor=ACTOR, reason="передумали")
        assert exc.value.code == "INVALID_LIFECYCLE_TRANSITION"

    def test_double_cancel_is_rejected(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY):
            status = self._planned(employee)
            cancel_status(status, actor=ACTOR, reason="первая")
            with pytest.raises(DomainError) as exc:
                cancel_status(status, actor="8", reason="вторая")
        assert exc.value.code == "INVALID_LIFECYCLE_TRANSITION"
        # Факты отмены append-once: вторая попытка их не переписала.
        from_db = OpsEmployeeStatus.objects.get(pk=status.pk)
        assert from_db.cancelled_by == ACTOR
        assert from_db.cancelled_reason == "первая"

    def test_cancelled_frees_the_interval(self):
        seed_types()
        employee = make_employee()
        with clock.override(TODAY):
            first = create_status(
                employee_id=employee.id,
                status_type_code="VACATION",
                date_start=TODAY + timedelta(days=3),
                date_end=TODAY + timedelta(days=4),
                actor=ACTOR,
            )
            cancel_status(first, actor=ACTOR, reason="ошибка ввода")
            # После отмены тот же период снова свободен — и для сервиса, и
            # для ограничения БД.
            second = create_status(
                employee_id=employee.id,
                status_type_code="VACATION",
                date_start=TODAY + timedelta(days=3),
                date_end=TODAY + timedelta(days=4),
                actor=ACTOR,
            )
        assert second.pk is not None
