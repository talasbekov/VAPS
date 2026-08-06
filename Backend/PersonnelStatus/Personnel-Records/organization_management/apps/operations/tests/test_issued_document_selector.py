"""Какой выпуск действует: точность разреза и слепота к отозванным.

Метод отвечает на единственный вопрос — «что действует сейчас по этому дню», —
и цена ошибки у него ассиметрична. Вернуть None вместо действующего выпуска
значит выпустить второй документ на тот же день; вернуть ОТОЗВАННЫЙ значит
объявить заменяемым то, что уже заменено.

Поэтому проверяется не только «находит», но и каждая ось разреза по отдельности:
чужой вид, чужое подразделение, чужой день.
"""
from datetime import date

import pytest

from organization_management.apps.operations.models_document import (
    OpsAttachment,
    OpsIssuedDocument,
)
from organization_management.apps.operations.selectors import (
    OpsIssuedDocumentSelector,
)

pytestmark = pytest.mark.django_db

TYPE = "расход"
DAY = date(2026, 8, 6)
DIVISION = 42

_number = iter(range(1, 1000))


def issue(**overrides):
    fields = {
        "doc_type": TYPE,
        "number": next(_number),
        "year": 2026,
        "business_date": DAY,
        "division_id": DIVISION,
        "submission_id": 100,
        "submission_version": 1,
        "attachment": OpsAttachment.objects.create(
            original_name="расход.docx", content_type="text/plain",
            size=10, sha256="a" * 64,
        ),
        "status": OpsIssuedDocument.Status.ISSUED,
    }
    fields.update(overrides)
    return OpsIssuedDocument.objects.create(**fields)


def current(**overrides):
    args = {"doc_type": TYPE, "division_id": DIVISION, "business_date": DAY}
    args.update(overrides)
    return OpsIssuedDocumentSelector.current(**args)


# ── Находит действующий ──────────────────────────────────────────────────


def test_the_current_issue_of_the_day_is_returned():
    row = issue()

    assert current() == row


def test_nothing_is_returned_when_the_day_was_never_issued():
    assert current() is None


# ── Слепота к отозванным ─────────────────────────────────────────────────


def test_a_superseded_issue_alone_reads_as_no_current_issue():
    """Отозванный документ — не «действующий за неимением лучшего».

    Проба со ВСЕЙ выборкой из заменённых ловит фильтр, наложенный «только когда
    действующий уже нашёлся».
    """
    issue(status=OpsIssuedDocument.Status.SUPERSEDED)

    assert current() is None


def test_the_current_issue_is_picked_out_from_among_superseded_ones():
    """Заменённые заведены ПЕРВЫМИ и их больше одного: без фильтра по состоянию
    метод вернул бы самый старый выпуск дня — тот, что уже отозван."""
    first = issue(status=OpsIssuedDocument.Status.SUPERSEDED)
    second = issue(
        status=OpsIssuedDocument.Status.SUPERSEDED,
        supersedes=first, reason="первая поправка",
    )
    live = issue(supersedes=second, reason="вторая поправка")

    assert current() == live


# ── Точность разреза ─────────────────────────────────────────────────────


def test_another_divisions_issue_is_not_mistaken_for_this_ones():
    """Ошибка здесь означала бы отзыв ЧУЖОГО документа при выпуске своего."""
    issue(division_id=DIVISION + 1)

    assert current() is None


def test_another_days_issue_is_not_mistaken_for_this_days():
    issue(business_date=date(2026, 8, 7))

    assert current() is None


def test_another_document_type_is_not_mistaken_for_this_one():
    issue(doc_type="приказ")

    assert current() is None


def test_each_division_sees_only_its_own_current_issue():
    """Соседние строки существуют одновременно — иначе проба на разрез вакуумна:
    отсутствие чужого могло бы объясняться пустой таблицей."""
    mine = issue()
    theirs = issue(division_id=DIVISION + 1)

    assert current() == mine
    assert current(division_id=DIVISION + 1) == theirs
