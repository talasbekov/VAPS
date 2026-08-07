"""Срез 154a: код у справочников Position и Rank.

Зачем поле: контракт нового бэка идентифицирует записи справочников по `code`
(`rank_code`, `position_code` у сотрудника; `code` — первичный ключ формы у
самих справочников). В целевом бэке справочники несли только `name` и `level`,
источника для кода не было вовсе.

Отдать вместо кода `name` было нельзя: клиент считал бы строку стабильным
ключом, а она меняется при переименовании звания — и разъехалась бы молча, без
единой ошибки. Поэтому код заводится настоящим полем.

Существующим записям код проставляет data-миграция суррогатом (`RANK-<id>` /
`POS-<id>`): он детерминирован, уникален и не притворяется осмысленным
классификатором. Настоящие коды приедут вместе с импортом справочников.
"""
import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.dictionaries.models import Position, Rank

pytestmark = pytest.mark.django_db


# ── Поле есть и уникально ────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("model", "extra"),
    [(Position, {"level": 1}), (Rank, {"level": 1})],
)
def test_code_is_unique(model, extra):
    """Без уникальности код не годится в идентификатор контракта."""
    model.objects.create(name="Первая", code="DUP", **extra)

    with pytest.raises(IntegrityError), transaction.atomic():
        model.objects.create(name="Вторая", code="DUP", **{**extra, "level": 2})


@pytest.mark.parametrize(
    ("model", "extra"),
    [(Position, {"level": 1}), (Rank, {"level": 1})],
)
def test_code_is_required(model, extra):
    """Пустой код — молчаливая дыра: строка «» уникальна ровно один раз.

    CHECK на уровне БД, а не только blank=False в форме: через ORM-создание
    без валидации пустая строка прошла бы и заняла единственное свободное
    место под «» для всего справочника.
    """
    with pytest.raises(IntegrityError), transaction.atomic():
        model.objects.create(name="Без кода", code="", **extra)


# ── Существующие записи не остались без кода ─────────────────────────────


def test_rows_seeded_by_migrations_got_a_code():
    """Записи, заведённые сидовой миграцией 0002, код получили.

    Это и есть настоящая проверка data-шага: справочные строки приходят в базу
    миграцией ДО появления поля, и именно они рискуют остаться без кода.
    Проверять на строке, которую тест создал сам, было бы вырожденно — она
    заводится уже с кодом.

    Только Position: Rank сидовая миграция не заполняет (проверено — выборка
    пуста), поэтому у него доливать нечего, и параметризация обеими моделями
    сделала бы половину теста вакуумной.
    """
    seeded = Position.objects.all()

    assert seeded.exists(), "сидовая миграция не завела ни одной должности"
    assert not seeded.filter(code="").exists()
    # Суррогат детерминирован: код каждой сидовой строки — POS-<id>.
    assert all(row.code == f"POS-{row.pk}" for row in seeded)
