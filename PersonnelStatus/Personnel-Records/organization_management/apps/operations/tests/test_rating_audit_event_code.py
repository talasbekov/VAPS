"""`event_code` журнала оценивания — вид записи, а НЕ код мероприятия.

Ловушка, ради которой написан файл, сработала на человеке 27.08.2026: при
очистке данных мероприятий (Plane №186) 33 строки журнала были посчитаны
привязанными к ОМ — по ИМЕНИ колонки, не по значениям. Удаление по ней снесло
бы журнал оценивания целиком; спас сухой прогон с откатом.

Причина путаницы в том, что имя `event_code` встречается в разделе трижды и
означает три разных вещи:

- `OpsRatingAuditEntry.event_code` — вид записи журнала (`EVALUATION_SUBMITTED`);
- `OpsEventEvaluation`/`OpsEvaluationWorkItem`/`OpsEvaluationEvent.event_code` —
  код кампании оценивания (`event-1`);
- код охранного мероприятия (`ОМ-2026-1`) не лежит ни в одном из них — для
  него есть `security_event_code`.

Переименовать нельзя: поле уезжает наружу как `eventCode` и типизировано на
клиенте (`RatingAuditEventCode`). Значит защищать надо не имя, а СОДЕРЖИМОЕ.
"""
import pytest
from django.db import IntegrityError, transaction

from organization_management.apps.operations.models_rating import (
    _AUDIT_EVENT_CODES,
    OpsRatingAuditEntry,
)

pytestmark = pytest.mark.django_db


def _entry(**over):
    data = {
        "entry_code": "audit-1",
        "occurred_at": "2026-08-27T10:00:00Z",
        "actor_user_id": "1",
        "event_code": "EVALUATION_SUBMITTED",
        "outcome": "SUCCESS",
    }
    data.update(over)
    return OpsRatingAuditEntry.objects.create(**data)


def test_a_known_kind_of_entry_is_written():
    """Опора: без неё проверки ниже зелены и на сломанной модели."""
    assert _entry().event_code == "EVALUATION_SUBMITTED"


def test_the_code_of_a_security_event_cannot_be_stored_here():
    """КРАСНАЯ ПРОБА №187: ровно то значение, из-за которого вышла путаница.

    Пока колонка была свободной строкой, `ОМ-2026-1` лёг бы сюда молча — и
    следующий человек, увидев его, укрепился бы в мысли, что колонка про
    мероприятия.
    """
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _entry(entry_code="audit-om", event_code="ОМ-2026-1")


def test_the_code_of_an_evaluation_campaign_cannot_be_stored_here():
    """Второе значение той же путаницы: `event-1` у соседних моделей."""
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _entry(entry_code="audit-campaign", event_code="event-1")


@pytest.mark.parametrize("code", _AUDIT_EVENT_CODES)
def test_every_kind_from_the_contract_is_accepted(code):
    """Перечень не должен быть уже того, что раздел реально пишет.

    Иначе CHECK начал бы ронять живой путь — отказ на записи в журнал хуже
    свободной колонки: он откатывает то действие, которое журналировал.
    """
    assert _entry(entry_code=f"audit-{code}", event_code=code).event_code == code


def test_the_server_list_matches_the_client_contract():
    """Перечень зеркалит `RatingAuditEventCode` клиента, и это надо стеречь.

    Разъехавшись, стороны дадут худший из исходов: сервер запишет код, для
    которого у экрана нет подписи, и журнал покажет `undefined` вместо
    названия действия. Список клиента продублирован здесь НАМЕРЕННО — тест
    обязан падать при правке одной стороны, а не читать вторую и соглашаться
    с любой.
    """
    from_client_contract = {
        "EVALUATION_SUBMITTED",
        "EVALUATION_SCORE_CHANGED_FROM_INITIAL",
        "EVALUATION_LOW_SCORE_WITHOUT_COMMENT",
        "EVALUATION_CORRECTED",
        "EVALUATION_CORRECTION_REJECTED",
        "EVALUATION_ACCESS_DENIED",
        "RATING_EXPORT_REQUESTED",
        "RATING_EXPORT_DOWNLOADED",
        "RATING_EXPORT_REJECTED",
    }

    assert set(_AUDIT_EVENT_CODES) == from_client_contract
