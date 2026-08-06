"""Обход хранилища: находит ВСЮ порчу и молчит в журнале.

Три свойства несут срез. Обход не останавливается на первой порче — иначе
инцидент из двадцати документов разбирался бы по одному за прогон. Он ничего не
пишет в журнал выдач: обход это проверка, а не выдача, и событие «документ
выдан» на каждый прогон сделало бы ленту выдач бессмысленной. И «нашли порчу»
отличается от «всё цело» ненулевым выходом, а не только текстом — команду ставят
в расписание.
"""
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import audit_service, clock
from organization_management.apps.operations.document_release import (
    issue_expense_document,
)
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    in_slot,
)
from organization_management.apps.operations.tests.test_submitted_expense import submit
from organization_management.apps.operations.tests.test_traffic_light import types  # noqa: F401

pytestmark = pytest.mark.django_db

ACTOR = "7"


@pytest.fixture
def storage(tmp_path):
    with override_settings(OPS_PRIVATE_STORAGE_ROOT=str(tmp_path)):
        yield tmp_path


def issue_for(division, days_back=0):
    """Сдать и выпустить день, отстоящий на days_back назад.

    Часы сдвигаются вместе с деловым днём: окно сдачи прошлое не принимает.
    """
    business_date = TODAY - timedelta(days=days_back)
    at = MORNING - timedelta(days=days_back)
    in_slot(division)
    submit(division, business_date=business_date, at=at)
    with clock.override(at):
        return issue_expense_document(
            division_id=division.id, business_date=business_date, actor=ACTOR
        )


@pytest.fixture
def division():
    return Division.objects.create(name="Управление")


def run(**options):
    call_command("check_document_integrity", **options)


def spoil(storage, issued):
    (storage / str(issued.attachment.storage_key)).write_bytes("подмена".encode())


# ── Целое хранилище ──────────────────────────────────────────────────────


def test_an_intact_store_passes(storage, types, division, capsys):  # noqa: F811
    issue_for(division)

    run()

    assert "Порчи не обнаружено" in capsys.readouterr().out


def test_an_empty_store_says_so_instead_of_reporting_health(storage, capsys):
    """Пустое хранилище и исправное — разные новости; одинаково бодрый ответ
    скрыл бы, что проверять было нечего."""
    run()

    assert "проверять нечего" in capsys.readouterr().out


def test_the_number_of_checked_documents_is_reported(storage, types, division, capsys):  # noqa: F811
    issue_for(division)
    issue_for(division, days_back=1)

    run()

    assert "Проверено выпусков: 2" in capsys.readouterr().out


# ── Порча ────────────────────────────────────────────────────────────────


def test_a_damaged_document_fails_the_run(storage, types, division):  # noqa: F811
    """Ненулевой выход: команду ставят в расписание, и «нашли порчу» обязано
    отличаться от «всё цело» так, чтобы это заметил наблюдатель."""
    issued = issue_for(division)
    spoil(storage, issued)

    with pytest.raises(CommandError) as exc:
        run()

    assert "Испорчено документов: 1" in str(exc.value)


def test_missing_bytes_count_as_damage(storage, types, division):  # noqa: F811
    issued = issue_for(division)
    (storage / str(issued.attachment.storage_key)).unlink()

    with pytest.raises(CommandError):
        run()


def test_the_run_does_not_stop_at_the_first_damaged_document(
    storage, types, division, capsys  # noqa: F811
):
    """Несущий тест: отказ на первом же файле сообщал бы об одном испорченном
    документе там, где их несколько, и разбирать инцидент пришлось бы по одному
    за прогон.

    Испорчены ОБА, и оба обязаны быть названы.
    """
    first = issue_for(division)
    second = issue_for(division, days_back=1)
    spoil(storage, first)
    spoil(storage, second)

    with pytest.raises(CommandError) as exc:
        run()

    printed = capsys.readouterr().out
    assert f"№{first.number}" in printed
    assert f"№{second.number}" in printed
    assert "Испорчено документов: 2" in str(exc.value)


def test_an_intact_neighbour_is_not_reported_as_damaged(
    storage, types, division, capsys  # noqa: F811
):
    """Иначе «нашли порчу» означало бы «в хранилище что-то есть»."""
    intact = issue_for(division)
    damaged = issue_for(division, days_back=1)
    spoil(storage, damaged)

    with pytest.raises(CommandError):
        run()

    printed = capsys.readouterr().out
    assert f"№{damaged.number}" in printed
    assert f"ПОРЧА: расход №{intact.number}" not in printed


# ── Журнал ───────────────────────────────────────────────────────────────


def test_the_sweep_writes_no_handover_into_the_journal(storage, types, division):  # noqa: F811
    """Событие «документ выдан» на каждый обход означало бы, что раз в сутки все
    документы кто-то скачивает, — и лента выдач перестала бы отвечать на вопрос,
    ради которого заведена."""
    issue_for(division)

    run()

    assert OpsAuditLog.objects.filter(
        action=audit_service.DOCUMENT_DOWNLOADED
    ).count() == 0


def test_a_damaged_sweep_writes_nothing_either(storage, types, division):  # noqa: F811
    issued = issue_for(division)
    spoil(storage, issued)

    with pytest.raises(CommandError):
        run()

    assert OpsAuditLog.objects.filter(
        action=audit_service.DOCUMENT_DOWNLOADED
    ).count() == 0


# ── Сужение обхода ───────────────────────────────────────────────────────


def test_the_sweep_can_be_narrowed_to_one_division(storage, types, division, capsys):  # noqa: F811
    """Хранилище растёт, и разбирать инцидент одного управления, обходя все,
    незачем."""
    other = Division.objects.create(name="Второе управление")
    issue_for(division)
    theirs = issue_for(other)
    spoil(storage, theirs)

    run(division=division.id)

    printed = capsys.readouterr().out
    assert "Проверено выпусков: 1" in printed
    assert "Порчи не обнаружено" in printed


def test_the_narrowed_sweep_still_finds_damage_inside_its_scope(
    storage, types, division  # noqa: F811
):
    """Иначе сужение выглядело бы способом получить зелёный ответ."""
    mine = issue_for(division)
    spoil(storage, mine)

    with pytest.raises(CommandError):
        run(division=division.id)
