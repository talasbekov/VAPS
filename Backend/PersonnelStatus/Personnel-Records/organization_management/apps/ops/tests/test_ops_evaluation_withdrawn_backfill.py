"""Перенос отзыва оценки в своё поле (Plane №646, миграция 0094).

Проба проверяет ПЕРЕНОС НАКОПЛЕННЫХ строк, а не то, что миграция не упала:
на живых базах уже лежат оценки, снятые повторным кликом, и у них в
`superseded_by_code` стоит слово `'withdrawn'`. Без переноса ограничение
`chk_ops_evaluation_superseded_is_a_code` не встало бы вовсе, а сами строки
остались бы «исправленными» в реестре — тем самым дефектом, ради которого
поле и заводится (та же болезнь, что в Plane №752: миграция, которая молча
ничего не делает).
"""
import datetime as dt

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

pytestmark = pytest.mark.django_db

BEFORE = ("operations", "0093_notification_dedupe_key")
AFTER = ("operations", "0094_evaluation_withdrawn_at")


def migrate_to(target):
    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate([target])
    executor.loader.build_graph()
    return executor


@pytest.fixture
def at_0093():
    executor = migrate_to(BEFORE)
    yield executor.loader.project_state([BEFORE]).apps
    # Возврат вперёд обязателен: следующая проба прогона ждёт актуальную схему.
    migrate_to(AFTER)


def _evaluation(model, code, superseded):
    return model.objects.create(
        evaluation_code=code,
        event_code="security-event-1",
        participant_code=f"participant-{code}",
        evaluator_user_id="7",
        score=8,
        comment=None,
        evaluation_direction="SENIOR_TO_EMPLOYEE",
        method="MANUAL",
        basis_code="EXECUTION_OF_DUTIES",
        basis_note=None,
        evaluated_at=dt.date(2026, 9, 1),
        superseded_by_code=superseded,
    )


def test_withdrawn_rows_move_to_their_own_field(at_0093):
    model = at_0093.get_model("operations", "OpsEventEvaluation")
    withdrawn = _evaluation(model, "evaluation-withdrawn", "withdrawn")
    corrected = _evaluation(model, "evaluation-corrected", "evaluation-next")
    live = _evaluation(model, "evaluation-live", None)

    migrate_to(AFTER)

    after = MigrationExecutor(connection).loader.project_state([AFTER]).apps
    fresh = after.get_model("operations", "OpsEventEvaluation")
    moved = fresh.objects.get(pk=withdrawn.pk)
    assert moved.withdrawn_at is not None, "отзыв не перенесён — миграция промолчала"
    assert moved.superseded_by_code is None, "слово `withdrawn` осталось в ссылке"

    # Настоящее исправление миграция НЕ трогает: у него преемник есть.
    still_corrected = fresh.objects.get(pk=corrected.pk)
    assert still_corrected.superseded_by_code == "evaluation-next"
    assert still_corrected.withdrawn_at is None

    # Действующая остаётся действующей.
    untouched = fresh.objects.get(pk=live.pk)
    assert untouched.superseded_by_code is None and untouched.withdrawn_at is None
