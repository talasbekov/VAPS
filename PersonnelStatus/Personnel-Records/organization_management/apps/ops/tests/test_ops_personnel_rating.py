"""Кадровая ручка отдаёт рейтинг и отбирает по нему НА СЕРВЕРЕ (Plane №67,
шаг РЙ-4).

Заказчик в карточке ответил коротко: «Научи отдавать рейтинг».

Что было. Доска подбора фильтровала кандидатов по рейтингу в пределах
ЗАГРУЖЕННОЙ СТРАНИЦЫ: рейтинг живёт в своей ручке под своим правом, и ручка
кадров о нём не знала. На базе больше страницы «нет кандидатов» означало «нет
на этой странице» — худший вид вранья в подборе людей, потому что отличить
его от правды с экрана нельзя.

Пробы стерегут три свойства, каждое из которых легко потерять:

1. отбор по полосе идёт ДО постранички — иначе задача не решена вовсе;
2. право уважается: без `rating.view_aggregate` поля НЕТ и отбор ОТБИТ, а не
   молча проигнорирован (проигнорированный фильтр показал бы полный список и
   выглядел бы как сработавший);
3. `null` значит «судить не по чему» и отбирается отдельной полосой.
"""
import datetime as dt

import pytest

from organization_management.apps.operations.models_rating import (
    OpsEventEvaluation,
    OpsEvaluationEvent,
    OpsRatedParticipant,
    OpsRatingFeatureFlags,
)
from organization_management.apps.operations.models_settings import (
    OpsPolicySectionVersion,
    OpsPolicySetting,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)

from .test_ops_security_events_api import make_employee

pytestmark = pytest.mark.django_db

URL = "/api/ops/personnel/"


@pytest.fixture
def rating_policy(db):
    """Методика: период, порог оценок, версия. Без неё сводка отвечает
    `POLICY_UNDEFINED`, и агрегата не бывает ни у кого."""
    for code, value in (
        # Период широкий, порог оценок 1: проба стережёт ОТБОР, а не методику,
        # и не должна краснеть от того, что оценок «мало».
        ("RATING.PERIOD.PARAMETER", 3650),
        ("RATING.MIN_EVALUATIONS.PARAMETER", 1),
        ("RATING.SUPPRESSION_MIN_GROUP.PARAMETER", 1),
    ):
        OpsPolicySetting.objects.create(
            setting_code=code, section_code="RATING_POLICY", kind="NUMBER",
            value_type="COUNT", safe_label=code, description="", value=value,
            min_value=1, max_value=3650, options=None, editable=True,
            locked_reason=None,
        )
    OpsPolicySectionVersion.objects.create(
        section_code="RATING_POLICY", version="OPERATIONAL-RATING-2026.07.1"
    )
    OpsRatingFeatureFlags.objects.update_or_create(
        singleton_key=1,
        defaults={"operational_ratings": True, "rating_conflicts": True},
    )


def rated(employee, score):
    """Связанный участник рейтинга с одной оценкой — минимальный набор,
    дающий агрегат."""
    participant = OpsRatedParticipant.objects.create(
        participant_code=f"employee-{employee.pk}",
        safe_label=f"{employee.last_name} {employee.first_name[0]}.",
        group_code="division-1",
        employee_id=employee.pk,
    )
    event = OpsEvaluationEvent.objects.create(
        event_code=f"ev-{employee.pk}",
        event_run_code=f"ev-{employee.pk}-run-1",
        number=f"ОМ-{employee.pk}",
        title="Мероприятие",
        object_label="Объект",
        actual_starts_at=dt.datetime(2026, 6, 1, tzinfo=dt.timezone.utc),
        actual_ends_at=dt.datetime(2026, 6, 1, tzinfo=dt.timezone.utc),
        state_label="Завершено",
    )
    OpsEventEvaluation.objects.create(
        evaluation_code=f"eval-{employee.pk}",
        event_code=event.event_code,
        participant_code=participant.participant_code,
        score=score,
        evaluated_at=dt.date(2026, 6, 1),
        evaluation_direction="SENIOR_TO_EMPLOYEE",
        method="MANUAL",
    )
    return participant


@pytest.fixture
def rater():
    """Тот, кто И ведёт мероприятия, И вправе видеть агрегат рейтинга."""
    api, _ = client_for(
        "pers-rater",
        "PERS_RATER",
        perms=("event.view", "event.manage", "rating.view_aggregate"),
    )
    return api


@pytest.fixture
def plain():
    """Тот, кто ведёт мероприятия, но агрегат видеть НЕ вправе."""
    api, _ = client_for(
        "pers-plain", "PERS_PLAIN", perms=("event.view", "event.manage")
    )
    return api


def test_rating_is_returned_to_those_who_may_see_it(rater, rating_policy):
    high = make_employee(last_name="Абенов")
    rated(high, 9)

    rows = rater.get(URL).json()["results"]
    row = next(item for item in rows if item["id"] == str(high.pk))

    assert row["aggregateRating"] == 9.0


def test_without_the_permission_the_field_is_absent_not_null(plain, rating_policy):
    """Отсутствие поля и `null` — РАЗНЫЕ ответы.

    `null` значит «рейтинга нет», а здесь он есть и его просто не показывают.
    Клиент, увидевший `null`, нарисовал бы «нет данных» — то есть соврал бы о
    сотруднике вместо того, чтобы промолчать о своём праве.
    """
    employee = make_employee(last_name="Байжанов")
    rated(employee, 9)

    rows = plain.get(URL).json()["results"]
    row = next(item for item in rows if item["id"] == str(employee.pk))

    assert "aggregateRating" not in row


def test_band_selects_across_the_whole_base_not_the_page(rater, rating_policy):
    """Главная проба шага: отбор идёт ДО постранички.

    Девятка стоит последней по алфавиту и на первую страницу размером 1 не
    попадает. Пока отбор жил на клиенте, она была невидима — ровно этим и
    был дефект.
    """
    for last_name, score in (
        ("Абенов", 7),
        ("Байжанов", 8),
        ("Ярулин", 9),
    ):
        rated(make_employee(last_name=last_name), score)

    body = rater.get(URL, {"rating_band": "9_10", "page_size": "1"}).json()

    assert body["count"] == 1
    assert body["results"][0]["aggregateRating"] == 9.0
    assert body["results"][0]["name"].startswith("Ярулин")


def test_band_without_data_selects_those_who_cannot_be_judged(rater, rating_policy):
    """`null` — своя полоса: человек без рейтинга не «ниже семи»."""
    rated(make_employee(last_name="Абенов"), 9)
    make_employee(last_name="Досжанов")  # рейтинга нет вовсе

    body = rater.get(URL, {"rating_band": "no_data"}).json()

    assert body["count"] == 1
    assert body["results"][0]["name"].startswith("Досжанов")
    assert body["results"][0]["aggregateRating"] is None


def test_band_without_the_permission_is_refused_not_ignored(plain, rating_policy):
    """Молча проигнорированный фильтр ХУЖЕ отказа: спросивший увидел бы
    полный список и решил, что отбор сработал."""
    rated(make_employee(last_name="Абенов"), 9)
    make_employee(last_name="Досжанов")

    response = plain.get(URL, {"rating_band": "9_10"})

    assert response.status_code == 403
    assert response.json()["error_code"] == "PERMISSION_DENIED"


def test_unknown_band_is_a_request_error(rater, rating_policy):
    """Опечатка в полосе не должна молча расширять выбор до «всех»."""
    response = rater.get(URL, {"rating_band": "9-10"})

    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"


# ── Ранжирование по баллу (решение заказчика 26.08.2026) ──────────────────


def test_ordering_ranks_the_whole_base_not_the_page(rater, rating_policy):
    """Порядок считается по ВСЕЙ выборке и только потом режется на страницы.

    Девятка стоит последней по алфавиту: при странице размером 1 она попадает
    первой ТОЛЬКО если сервер упорядочил всю базу. Порядок «внутри страницы»
    вернул бы сюда семёрку — то есть ровно исходный дефект, но в сортировке.
    """
    for last_name, score in (("Абенов", 7), ("Байжанов", 8), ("Ярулин", 9)):
        rated(make_employee(last_name=last_name), score)

    body = rater.get(URL, {"ordering": "rating", "page_size": "1"}).json()

    assert body["count"] == 3
    assert body["results"][0]["name"].startswith("Ярулин")
    assert body["results"][0]["aggregateRating"] == 9.0


def test_those_without_a_rating_go_last_not_first(rater, rating_policy):
    """`null` — не ноль. Человек без оценок не «худший», его просто не по чему
    судить, и в ранжировании он идёт В КОНЕЦ."""
    rated(make_employee(last_name="Абенов"), 7)
    make_employee(last_name="Байжанов")  # рейтинга нет вовсе

    rows = rater.get(URL, {"ordering": "rating"}).json()["results"]

    assert rows[0]["name"].startswith("Абенов")
    assert rows[-1]["name"].startswith("Байжанов")
    assert rows[-1]["aggregateRating"] is None


def test_equal_scores_keep_a_stable_order(rater, rating_policy):
    """Равные баллы упорядочены по фамилии.

    Без второго ключа порядок задавала бы база, которая его не обещает, — и
    страницы «плавали» бы между запросами: один и тот же человек попадал бы
    то на первую страницу, то на вторую.
    """
    for last_name in ("Ярулин", "Абенов", "Байжанов"):
        rated(make_employee(last_name=last_name), 8)

    rows = rater.get(URL, {"ordering": "rating"}).json()["results"]

    assert [row["name"].split()[0] for row in rows] == [
        "Абенов", "Байжанов", "Ярулин",
    ]


def test_ordering_without_the_permission_is_refused(plain, rating_policy):
    """Порядок САМ РАССКАЗЫВАЕТ рейтинг: кто выше, тот сильнее. Право на
    агрегат закрывает и значение, и порядок."""
    rated(make_employee(last_name="Абенов"), 9)

    response = plain.get(URL, {"ordering": "rating"})

    assert response.status_code == 403
    assert response.json()["error_code"] == "PERMISSION_DENIED"


def test_unknown_ordering_is_a_request_error(rater, rating_policy):
    response = rater.get(URL, {"ordering": "salary"})

    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"
