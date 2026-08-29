"""Срез 156: контракт /api/core/ranks/ поверх СТАРОГО справочника званий.

Парный к срезу 155: SPA берёт звания по `/api/core/ranks/`, в целевом бэке
такого адреса нет, а звание живёт как dictionaries.Rank с другим набором
полей. Переносится КОНТРАКТ, а не модель — по конвенции переезда (срезы 153,
154b, 155).

ТРИ РАЗНЫХ СУДЬБЫ У ПЯТИ ПОЛЕЙ, И ТЕСТЫ ЗАКРЕПЛЯЮТ ИМЕННО ИХ:
  * `code` (заведён срезом 154a) и `name` читаются напрямую;
  * `rank_index` ← `level`. Это ЕДИНСТВЕННОЕ поле контракта, у которого
    источник не одноимённый: у донора это порядковый индекс звания в
    иерархии, здесь ту же роль играет level («чем меньше число, тем выше
    звание»). Прецедент — EmployeeSerializer.get_rank_index из среза 154b,
    где та же величина уже отдаётся под тем же именем; разойтись двум местам
    нельзя, иначе индекс сотрудника и индекс справочника перестали бы
    сравниваться;
  * `category` и `is_active` источника не имеют — отдаются null.
"""
import pytest
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Rank
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

pytestmark = pytest.mark.django_db

URL = "/api/core/ranks/"

CONTRACT_FIELDS = {"code", "name", "category", "rank_index", "is_active"}


@pytest.fixture
def ranks():
    """Три звания с РАЗНЫМИ ненулевыми уровнями.

    Уровни не нулевые намеренно: на level=0 подмена rank_index нулём (или
    отсутствие перевода вовсе) дала бы то же значение, что и «пусто», и
    ключевой кейс среза стал бы вакуумным.
    """
    return {
        "colonel": Rank.objects.create(name="Полковник", code="R-COL", level=3),
        "major": Rank.objects.create(name="Майор", code="R-MAJ", level=6),
        "sergeant": Rank.objects.create(name="Сержант", code="R-SGT", level=11),
    }


def reader(name="core-rank-reader"):
    return client_for(name, "VIEWER", ["orgstructure.view"])


def rows(response):
    body = response.json()
    # Пагинация DRF заворачивает список в конверт; контракт донора — тот же
    # постраничный конверт, поэтому строки достаём одинаково.
    return body["results"] if isinstance(body, dict) else body


def by_code(response, code):
    return next(r for r in rows(response) if r["code"] == code)


# ── Гейт ─────────────────────────────────────────────────────────────────


def test_anonymous_is_refused(ranks):
    assert APIClient().get(URL).status_code == 403


def test_permission_is_required(ranks):
    """Аутентификации мало: действие вне карты прав закрыто (fail-closed)."""
    api, _ = client_for("core-rank-nobody")

    assert api.get(URL).status_code == 403


def test_read_permission_opens_the_list(ranks):
    api, _ = reader()

    assert api.get(URL).status_code == 200


# ── Контракт ─────────────────────────────────────────────────────────────


def test_row_carries_exactly_the_contract_fields(ranks):
    """Поля пиним точным равенством.

    Проверка «поля присутствуют» пропустила бы лишнее: клиент донора
    сгенерирован из схемы, и поле сверх контракта разошлось бы со схемой
    молча. Здесь это особенно важно: `level` старой модели наружу выходить
    НЕ должен — он уезжает под именем rank_index.
    """
    api, _ = reader()
    row = by_code(api.get(URL), "R-COL")

    assert set(row) == CONTRACT_FIELDS
    assert "level" not in row


def test_code_and_name_are_not_swapped(ranks):
    """Ключ формы — именно `code`: имя меняется при переименовании звания, и
    клиент, принявший его за ключ, разъехался бы молча (см. срез 154a)."""
    api, _ = reader()
    row = by_code(api.get(URL), "R-MAJ")

    assert row["code"] == "R-MAJ"
    assert row["name"] == "Майор"


def test_rank_index_carries_the_level(ranks):
    """Ключевой перевод среза: rank_index — это level старой модели.

    Значения разные у всех трёх строк, поэтому совпадение не может быть
    случайным: перевод, взявший чужое поле или константу, дал бы одинаковые
    числа.
    """
    api, _ = reader()
    response = api.get(URL)

    assert by_code(response, "R-COL")["rank_index"] == 3
    assert by_code(response, "R-MAJ")["rank_index"] == 6
    assert by_code(response, "R-SGT")["rank_index"] == 11


def test_rank_index_matches_the_one_the_employee_card_reports(ranks):
    """Справочник и кадровая карточка обязаны отдавать ОДНО число.

    EmployeeSerializer.get_rank_index (срез 154b) уже переводит level под тем
    же именем. Разойдись эти два места — индекс сотрудника перестал бы
    сравниваться с индексом справочника, и старшинство в списках поехало бы.
    """
    from organization_management.apps.core.api.serializers import RankSerializer

    api, _ = reader()
    listed = by_code(api.get(URL), "R-SGT")

    assert listed["rank_index"] == ranks["sergeant"].level
    assert RankSerializer(ranks["sergeant"]).data["rank_index"] == (
        ranks["sergeant"].level
    )


# ── Поля без источника ───────────────────────────────────────────────────


def test_category_is_null_even_on_a_row_with_data(ranks):
    """`category` источника не имеет — отдаём null, а НЕ имя/уровень.

    Кейс идёт на заполненной строке: на пустой записи null вернулся бы и так,
    и подмена соседним полем прошла бы незаметно.
    """
    api, _ = reader()
    row = by_code(api.get(URL), "R-COL")

    assert row["name"] == "Полковник"
    assert row["rank_index"] == 3
    assert row["category"] is None


def test_is_active_is_null_for_every_row(ranks):
    """Признака действующего звания в старом справочнике нет вовсе.

    Вернуть True «по умолчанию» нельзя: строка выглядела бы подтверждённо
    действующей, хотя данных об этом нет.
    """
    api, _ = reader()
    listed = rows(api.get(URL))

    assert listed
    assert all(row["is_active"] is None for row in listed)


def test_every_stored_rank_is_listed(ranks):
    """Выборка не сужена: клиенту нужен весь справочник."""
    api, _ = reader()

    listed = {r["code"] for r in rows(api.get(URL))}
    assert listed == set(Rank.objects.values_list("code", flat=True))
    assert {"R-COL", "R-MAJ", "R-SGT"} <= listed


# ── Переход list → карточка (Plane №306) ─────────────────────────────────


def test_detail_opens_by_the_code_from_the_list(ranks):
    """Ключ, которым клиент располагает из списка, обязан открывать карточку.

    Строка списка отдаёт `code` и не отдаёт числового pk — значит и карточка
    обязана открываться кодом. Пока detail искал по pk, объявленный схемой
    переход был недостижим (Plane №306).
    """
    api, _ = reader()
    code = by_code(api.get(URL), "R-MAJ")["code"]

    response = api.get(f"{URL}{code}/")

    assert response.status_code == 200
    assert response.json()["code"] == "R-MAJ"


def test_detail_repeats_the_row_of_the_list(ranks):
    """Карточка и строка списка — одна запись в одном контракте.

    Сверяем целым словарём: тут это ловит ещё и утечку `level` наружу —
    карточка обязана звать его rank_index ровно так же, как список.
    """
    api, _ = reader()
    listed = by_code(api.get(URL), "R-SGT")

    assert api.get(f"{URL}R-SGT/").json() == listed


def test_detail_refuses_an_unknown_code(ranks):
    """Несуществующий код — честный 404, а не пятисотка и не чужая строка."""
    api, _ = reader()

    assert api.get(f"{URL}R-NO-SUCH-CODE/").status_code == 404


def test_detail_is_closed_without_the_permission(ranks):
    """Карточка закрыта тем же правом, что и список (fail-closed)."""
    api, _ = client_for("core-rank-detail-nobody")

    assert api.get(f"{URL}R-COL/").status_code == 403
