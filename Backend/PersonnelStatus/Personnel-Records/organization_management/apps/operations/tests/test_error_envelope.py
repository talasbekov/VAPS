"""Конверт отказа: одна форма на ВСЕ доменные коды раздела.

Клиент разбирает отказ одним куском кода. Стоит одному коду приехать в другой
форме — без `error_code`, без `details`, с иным набором ключей — и этот кусок
свалится в ветку «неизвестная ошибка» ровно на том отказе, который важнее всего
показать человеку внятно.

Проверка идёт ПО СЛОВАРЮ кодов, а не по списку в тесте: новый код попадает под
неё сам. Список пришлось бы дописывать руками, и для нового кода этого никто не
сделает — а он-то и рискует уехать в своей форме.

Отдельно закреплено, что у раздела ДВЕ формы отказа, и это осознанно: доменный
отказ едет конвертом, отказ ФОРМЫ — штатным ответом DRF. Клиент обязан уметь обе,
и лучше он узнает об этом отсюда, чем опытным путём.
"""
import pytest

from organization_management.apps.operations import clock
from organization_management.apps.operations.api.exception_handler import (
    ops_exception_handler,
)
from organization_management.apps.operations.error_codes import CODES
from organization_management.apps.operations.exceptions import DomainError

ENVELOPE_KEYS = frozenset(
    {"error_code", "message", "details", "request_id", "timestamp"}
)

# Коды и их канонический статус: берётся ПЕРВЫЙ объявленный, чтобы проба была
# однозначной; многозначность самого словаря стережёт test_error_codes.
CODE_CASES = sorted((code, sorted(statuses)[0]) for code, statuses in CODES.items())


def envelope_of(code, http_status, **kwargs):
    return ops_exception_handler(DomainError(code, http_status, **kwargs), {})


# ── Одна форма на все коды ───────────────────────────────────────────────


def test_the_dictionary_is_not_empty():
    """Опора: пустой словарь сделал бы параметризацию ниже вечнозелёной."""
    assert len(CODE_CASES) >= 20


@pytest.mark.parametrize("code,http_status", CODE_CASES, ids=[c for c, _ in CODE_CASES])
def test_every_code_renders_the_same_envelope(code, http_status):
    response = envelope_of(code, http_status)

    assert set(response.data) >= ENVELOPE_KEYS
    assert response.data["error_code"] == code
    assert response.status_code == http_status


@pytest.mark.parametrize("code,http_status", CODE_CASES, ids=[c for c, _ in CODE_CASES])
def test_no_code_carries_extra_keys_of_its_own(code, http_status):
    """Лишний ключ у одного кода — это ключ, которого нет у остальных.

    Клиент, научившийся его читать, начнёт ждать его везде, а получит только
    здесь. Единственное законное дополнение — признак обходимости, и он
    проверяется отдельно.
    """
    response = envelope_of(code, http_status)

    assert set(response.data) - ENVELOPE_KEYS <= {"overridable"}


@pytest.mark.parametrize("code,http_status", CODE_CASES, ids=[c for c, _ in CODE_CASES])
def test_details_are_always_a_mapping_even_when_empty(code, http_status):
    """`details` без нагрузки — пустой словарь, а не None и не отсутствие ключа.

    Клиент читает details у каждого отказа; отсутствие ключа заставило бы его
    проверять наличие перед каждым обращением, а None — ещё и тип.
    """
    response = envelope_of(code, http_status)

    assert isinstance(response.data["details"], dict)


# ── Признак обходимости ──────────────────────────────────────────────────


def test_the_overridable_flag_appears_only_when_the_refusal_is_overridable():
    """Клиент не должен угадывать обходимость по коду: её несёт сам ответ."""
    soft = envelope_of("STATUS_OVERLAP_WARNING", 409, overridable=True)
    hard = envelope_of("OVERLAPPING_HARD_STATUS", 422)

    assert soft.data["overridable"] is True
    assert "overridable" not in hard.data


def test_a_refusal_that_is_not_overridable_says_nothing_rather_than_false():
    """Отсутствие ключа, а не `false`: клиент ветвится на наличии, и `false`
    заставил бы его различать «нельзя обойти» и «про обход не сказано»."""
    assert "overridable" not in envelope_of("ENTITY_NOT_FOUND", 404).data


# ── Момент отказа ────────────────────────────────────────────────────────


def test_the_timestamp_comes_from_the_sections_clock():
    """Момент отказа берётся у часов РАЗДЕЛА: иначе он разошёлся бы с моментами
    журнала на том же запросе.

    Дата нарочно ДАЛЁКАЯ. Первый проход брал «сегодня» проекта — и совпадал с
    настоящей датой машины, поэтому подмена часов на datetime.now() оставалась
    незаметной: проба была зелёной при обоих источниках времени.
    """
    from datetime import datetime, timezone as tz

    long_ago = datetime(2019, 3, 4, 9, 0, tzinfo=tz.utc)

    with clock.override(long_ago):
        stamp = envelope_of("ENTITY_NOT_FOUND", 404).data["timestamp"]

    assert stamp.startswith("2019-03-04")


def test_the_timestamp_carries_a_zone():
    """Голый момент без зоны читатель достроит своей — и получит другой день."""
    from datetime import datetime, timezone as tz

    with clock.override(datetime(2019, 3, 4, 9, 0, tzinfo=tz.utc)):
        stamp = envelope_of("ENTITY_NOT_FOUND", 404).data["timestamp"]

    assert stamp[-6] in "+-" or stamp.endswith("Z")


# ── Две формы отказа — и это осознанно ───────────────────────────────────


@pytest.mark.django_db
def test_a_domain_refusal_over_http_arrives_in_the_envelope():
    """Связка обработчика с реальностью: проверки выше зовут его напрямую, и
    сами по себе не доказывают, что маршруты им пользуются."""
    from organization_management.apps.operations.tests.test_bulk_status_api import (
        client_for,
    )

    api, _ = client_for("envelope-probe", "ORGD", ["status.view"])

    response = api.get("/api/operations/statuses/999999999/")

    assert response.status_code == 404
    assert set(response.json()) >= ENVELOPE_KEYS
    assert response.json()["error_code"] == "ENTITY_NOT_FOUND"


@pytest.mark.django_db
def test_a_form_refusal_deliberately_uses_another_shape():
    """У раздела ДВЕ формы отказа, и это решение, а не недосмотр.

    Обработчик чужие ошибки намеренно не переписывает: отказ формы уходит
    штатным ответом DRF ({поле: [сообщения]}), без error_code. Клиент обязан
    уметь обе формы — и лучше узнает об этом отсюда, чем опытным путём.
    """
    from organization_management.apps.operations.tests.test_bulk_status_api import (
        client_for,
    )

    api, _ = client_for("form-probe", "ORGD", ["status.view"])

    response = api.get("/api/operations/strength-report/period/", {"date_from": "нет"})

    assert response.status_code == 400
    assert "error_code" not in response.json()
