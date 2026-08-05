"""Пересборка сводки «взамен»: новая версия, свежие пины, прежняя цела.

Пересборка — поправка сводки, и главное здесь то же, что у поправки дня:
прежняя версия не переписывается. Плюс своё: пины обновляются (иначе
пересобирать было бы незачем), обычная сдача сводкой не становится, а
свежесть у записи не спрашивается.
"""
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
from organization_management.apps.operations.summary_service import (
    FRESH,
    assemble_summary,
    rebuild_summary,
    summary_freshness,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    in_slot,
)
from organization_management.apps.operations.tests.test_status_service import seed_types

pytestmark = pytest.mark.django_db

ACTOR = "7"
REASON = "ребёнок исправил наряд"
SANCTION = "замечание"


@pytest.fixture
def types():
    seed_types()


@pytest.fixture
def tree():
    root = Division.objects.create(name="Управление")
    left = Division.objects.create(name="Первый отдел", parent=root)
    right = Division.objects.create(name="Второй отдел", parent=root)
    in_slot(left, iin="790000000001")
    in_slot(right, iin="790000000002")
    return root, left, right


def submit(division, business_date=TODAY):
    with clock.override(MORNING):
        return submit_day(
            division_id=division.id, business_date=business_date, actor=ACTOR
        )


def amend(division, business_date=TODAY):
    with clock.override(MORNING):
        return amend_day(
            division_id=division.id,
            business_date=business_date,
            actor=ACTOR,
            reason="ошибка",
            sanction="замечание",
        )


def assemble(division, business_date=TODAY):
    with clock.override(MORNING):
        return assemble_summary(
            division_id=division.id, business_date=business_date, actor=ACTOR
        )


def rebuild(division, business_date=TODAY, reason=REASON, sanction=SANCTION):
    with clock.override(MORNING):
        return rebuild_summary(
            division_id=division.id,
            business_date=business_date,
            actor=ACTOR,
            reason=reason,
            sanction=sanction,
        )


@pytest.fixture
def summary(types, tree):
    root, left, right = tree
    submit(left)
    submit(right)
    return assemble(root)


# ── Новая версия поверх прежней ──────────────────────────────────────────


def test_the_rebuild_writes_a_new_version(types, tree, summary):
    root, left, _ = tree
    amend(left)

    rebuilt = rebuild(root)

    assert rebuilt.version == summary.version + 1
    assert rebuilt.is_current is True
    assert rebuilt.event == OpsDailySubmission.Event.AMENDED
    assert rebuilt.reason == REASON
    assert rebuilt.sanction == SANCTION
    # Поздность — свойство акта сдачи в контрольный час; у пересборки его нет.
    assert rebuilt.late is False


def test_the_previous_version_survives_untouched(types, tree, summary):
    root, left, _ = tree
    before = OpsDailySubmission.objects.get(pk=summary.pk).snapshot
    amend(left)

    rebuild(root)

    previous = OpsDailySubmission.objects.get(pk=summary.pk)
    assert previous.is_current is False
    # Снимок прежней версии — байт в байт: она заявляла о ТЕХ версиях детей.
    assert previous.snapshot == before


def test_the_rebuild_refreshes_the_pins(types, tree, summary):
    """Иначе пересобирать было бы незачем."""
    root, left, _ = tree
    amended = amend(left)

    rebuilt = rebuild(root)

    pinned = {
        pin["division_id"]: (pin["version"], pin["submission_id"])
        for pin in rebuilt.snapshot["sources"]
    }
    assert pinned[left.id] == (2, amended.pk)


def test_the_rebuilt_summary_is_fresh_again(types, tree, summary):
    root, left, _ = tree
    amend(left)

    rebuild(root)

    assert summary_freshness(root.id, TODAY).status == FRESH


def test_a_fresh_summary_can_be_rebuilt(types, tree, summary):
    """Пересборка — явное действие и не спрашивает, протухла ли сводка.

    Свежесть выводится на чтении и к моменту записи уже могла измениться, а
    отказ «она и так свежая» заставил бы вызывающего гадать, пересобралось ли.
    """
    root, _, _ = tree

    rebuilt = rebuild(root)

    assert rebuilt.version == 2


# ── Гарды ────────────────────────────────────────────────────────────────


def test_a_plain_submission_does_not_become_a_summary(types, tree):
    """У обычной сдачи нет и не было заявления о версиях детей.

    Приписать его задним числом значило бы объявить, что подразделение всё
    это время отчитывалось за подчинённых.
    """
    _, left, _ = tree
    submit(left)

    with pytest.raises(DomainError) as exc:
        rebuild(left)

    assert exc.value.http_status == 400
    assert OpsDailySubmission.objects.filter(division_id=left.id).count() == 1


def test_a_day_without_any_version_cannot_be_rebuilt(types, tree):
    root, _, _ = tree

    with pytest.raises(DomainError) as exc:
        rebuild(root)

    assert exc.value.code == "NO_SUBMISSION_TO_AMEND"
    assert exc.value.http_status == 422


@pytest.mark.parametrize("field", ["reason", "sanction"])
def test_an_unexplained_rebuild_is_400(types, tree, summary, field):
    root, _, _ = tree

    with pytest.raises(DomainError) as exc:
        rebuild(root, **{field: "   "})

    assert exc.value.http_status == 400
    assert OpsDailySubmission.objects.filter(division_id=root.id).count() == 1


def test_a_child_that_has_not_submitted_blocks_the_rebuild(types, tree, summary):
    """Свежие пины собираются по тем же правилам, что и первые.

    Появившийся обязанный ребёнок обязан сдать — иначе пересборка записала бы
    сводку без него, притворившись полной.
    """
    root, _, _ = tree
    newcomer = Division.objects.create(name="Новый отдел", parent=root)
    in_slot(newcomer, iin="790000000003")

    with pytest.raises(DomainError) as exc:
        rebuild(root)

    assert exc.value.code == "SUMMARY_CHILDREN_NOT_SUBMITTED"
    assert exc.value.detail["laggards"] == [newcomer.id]
    assert OpsDailySubmission.objects.filter(division_id=root.id).count() == 1


def test_an_unknown_division_is_404(types, tree, summary):
    root, _, _ = tree

    with clock.override(MORNING), pytest.raises(DomainError) as exc:
        rebuild_summary(
            division_id=root.id + 10_000,
            business_date=TODAY,
            actor=ACTOR,
            reason=REASON,
            sanction=SANCTION,
        )

    assert exc.value.http_status == 404


# ── Журнал ───────────────────────────────────────────────────────────────


def test_the_rebuild_is_logged_with_both_halves(types, tree, summary):
    root, left, _ = tree
    amend(left)

    rebuilt = rebuild(root)

    entry = OpsAuditLog.objects.get(action=audit_service.DAILY_SUMMARY_REBUILT)
    assert entry.entity_id == rebuilt.pk
    # «До» — прежняя версия КАК БЫЛА: текущей. Сними снимок после гашения
    # флага, и журнал утверждал бы, что она и до пересборки текущей не была.
    assert entry.old_value["version"] == 1
    assert entry.old_value["is_current"] is True
    assert entry.new_value["version"] == 2
    assert entry.new_value["sources"] == [
        {"division_id": left.id, "version": 2},
        {"division_id": tree[2].id, "version": 1},
    ]
    assert entry.reason == REASON


def test_a_refused_rebuild_writes_nothing(types, tree, summary):
    root, _, _ = tree
    Division.objects.create(name="Новый отдел", parent=root).pk
    in_slot(Division.objects.get(name="Новый отдел"), iin="790000000004")

    with pytest.raises(DomainError):
        rebuild(root)

    assert OpsAuditLog.objects.filter(
        action=audit_service.DAILY_SUMMARY_REBUILT
    ).count() == 0
