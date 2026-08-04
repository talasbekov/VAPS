"""Сдача дня: инварианты держит БАЗА, а не только будущий сервис.

Сервиса сдачи ещё нет — тем важнее закрепить ограничения сейчас: строки
пишет пока что кто угодно (перенос данных, shell, будущий сервис), и
единственный рубеж, который переживёт любого писателя, — ограничение схемы.
Поэтому каждая проба вставляет строку НАПРЯМУЮ, в обход какого бы то ни было
сервиса, и ждёт отказа базы.
"""
from datetime import date, datetime, timedelta, timezone

import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)

pytestmark = pytest.mark.django_db

TODAY = date(2026, 8, 4)
SUBMITTED_AT = datetime(2026, 8, 4, 6, 0, tzinfo=timezone.utc)
DIVISION = 101
ACTOR = "7"


def make(**overrides):
    fields = {
        "division_id": DIVISION,
        "business_date": TODAY,
        "version": 1,
        "is_current": True,
        "event": OpsDailySubmission.Event.CONFIRMED_NO_CHANGES,
        "submitted_by": ACTOR,
        "submitted_at": SUBMITTED_AT,
        "snapshot": {"schema_version": 1, "roster": [], "rows": []},
    }
    fields.update(overrides)
    return OpsDailySubmission.objects.create(**fields)


def rejected(**overrides):
    """Вставка отвергнута базой. Свой savepoint: после IntegrityError
    транзакция теста отравлена, и следующий запрос упал бы уже не по делу."""
    with pytest.raises(IntegrityError) as exc:
        with transaction.atomic():
            make(**overrides)
    return exc.value


class TestCurrentVersionUniqueness:
    def test_two_current_versions_of_one_day_are_rejected(self):
        make(version=1)
        exc = rejected(version=2)
        assert "unique_ops_submission_current" in str(exc)

    def test_previous_version_stays_alongside_when_not_current(self):
        # Поправка живёт рядом с прошлой версией — та лишь перестаёт быть
        # текущей. Иначе история сдач была бы неотличима от правки на месте.
        first = make(version=1, is_current=False)
        second = make(version=2, event=OpsDailySubmission.Event.CHANGED)
        assert OpsDailySubmission.objects.count() == 2
        assert not OpsDailySubmission.objects.get(pk=first.pk).is_current
        assert OpsDailySubmission.objects.get(pk=second.pk).is_current

    def test_zero_current_versions_is_allowed(self):
        # База требует «не более одной», а не «ровно одну»: существование
        # строки ей не потребовать, и вторую половину инварианта держит
        # сервис в своей транзакции.
        make(version=1, is_current=False)
        assert OpsDailySubmission.objects.filter(is_current=True).count() == 0

    def test_other_division_and_other_day_are_independent(self):
        make()
        make(division_id=DIVISION + 1)
        make(business_date=TODAY + timedelta(days=1))
        assert OpsDailySubmission.objects.filter(is_current=True).count() == 3

    def test_duplicate_version_number_is_rejected(self):
        make(version=1, is_current=False)
        exc = rejected(version=1)
        assert "unique_ops_submission_version" in str(exc)


class TestEventDictionary:
    def test_every_declared_event_is_accepted_by_the_check(self):
        # Зеркальность словаря и ограничения проверяется ПЕРЕЧИСЛЕНИЕМ
        # choices: добавленное значение, не доехавшее до CHECK, краснит эту
        # пробу, а не всплывает на проде первой же сдачей нового вида.
        for offset, value in enumerate(OpsDailySubmission.Event.values):
            extra = (
                {"reason": "перепроверка", "sanction": "приказ №1"}
                if value == OpsDailySubmission.Event.AMENDED
                else {}
            )
            make(
                business_date=TODAY + timedelta(days=offset),
                event=value,
                **extra,
            )
        assert OpsDailySubmission.objects.count() == len(
            OpsDailySubmission.Event.values
        )

    def test_unknown_event_is_rejected(self):
        exc = rejected(event="SUBMITTED")
        assert "chk_ops_submission_event" in str(exc)

    def test_empty_event_is_rejected(self):
        # У поля нет дефолта, и choices на пути create() не проверяются —
        # без CHECK молчаливое "" легло бы строкой без события.
        exc = rejected(event="")
        assert "chk_ops_submission_event" in str(exc)


class TestVersionFloor:
    def test_zero_version_is_rejected(self):
        # Авто-CHECK положительного поля пропускает 0; нумерация с 1 — своё
        # ограничение.
        exc = rejected(version=0)
        assert "chk_ops_submission_version_min" in str(exc)


class TestAmendmentMustBeExplained:
    def test_amended_without_reason_and_sanction_is_rejected(self):
        exc = rejected(event=OpsDailySubmission.Event.AMENDED)
        assert "chk_ops_submission_amended_explained" in str(exc)

    def test_amended_with_whitespace_only_reason_is_rejected(self):
        # Пробельная причина — это отсутствие причины; проверка на
        # непустоту строки пропустила бы её.
        rejected(
            event=OpsDailySubmission.Event.AMENDED,
            reason="   ",
            sanction="приказ №5",
        )

    def test_amended_with_whitespace_only_sanction_is_rejected(self):
        rejected(
            event=OpsDailySubmission.Event.AMENDED,
            reason="ошибка ввода",
            sanction="  ",
        )

    def test_amended_with_both_filled_is_accepted(self):
        row = make(
            event=OpsDailySubmission.Event.AMENDED,
            reason="ошибка ввода",
            sanction="приказ №5",
            triggered_by_status_id=42,
        )
        from_db = OpsDailySubmission.objects.get(pk=row.pk)
        assert from_db.reason == "ошибка ввода"
        assert from_db.sanction == "приказ №5"
        assert from_db.triggered_by_status_id == 42

    def test_first_submission_needs_no_explanation(self):
        # Ограничение адресное: первичную сдачу оно не трогает, иначе
        # каждая обычная сдача требовала бы оправдания.
        row = make(event=OpsDailySubmission.Event.CHANGED)
        from_db = OpsDailySubmission.objects.get(pk=row.pk)
        assert from_db.reason == ""
        assert from_db.sanction == ""
        assert from_db.triggered_by_status_id is None


class TestSnapshotStorage:
    def test_snapshot_survives_the_round_trip(self):
        snapshot = {
            "schema_version": 1,
            "roster": [
                {"employee_id": 5, "full_name": "Иванов И.И.", "rank": "капитан"}
            ],
            "rows": [
                {
                    "employee_id": 5,
                    "status_type_code": "DUTY",
                    "status_id": 77,
                    "date_start": "2026-08-04",
                    "date_end": "2026-08-06",
                    "source": "USER",
                }
            ],
        }
        row = make(snapshot=snapshot)
        assert OpsDailySubmission.objects.get(pk=row.pk).snapshot == snapshot

    def test_submitted_at_is_not_auto_stamped(self):
        # Время сдачи ставит писатель (часы раздела), а не база: сдача за
        # прошлый день, занесённая сегодня, обязана нести СВОЙ момент.
        past = datetime(2026, 7, 1, 5, 30, tzinfo=timezone.utc)
        row = make(submitted_at=past)
        from_db = OpsDailySubmission.objects.get(pk=row.pk)
        assert from_db.submitted_at == past
        # Таймстамп строки при этом свой и живёт отдельно.
        assert from_db.created_at != past
