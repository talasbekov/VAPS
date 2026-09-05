"""Оценивание заводится закрытием ОМ (Plane №96, шаг РЙ-3).

До этой правки мероприятия оценивания заводил ТОЛЬКО `seed_operations`: из
живого реестра ОМ не создавалось ни одного. Связать участника рейтинга с
кадрами (шаг РЙ-1) было мало — связывать оказалось нечего, оценок у настоящих
людей взяться неоткуда. Заказчик сказал это прямо: «оценивание на каждом ОМ».

Пробы стерегут свойства, которые легко потерять и трудно заметить:

1. закрытие заводит мероприятие оценивания, его участников и задания;
2. участник СВЯЗАН с кадровой записью — иначе рейтинг снова не дойдёт до
   расстановки, и вся цепочка окажется собранной впустую;
3. оценивать некого — не заводится НИЧЕГО: пустое мероприятие висело бы в
   очереди оценщика шумом;
4. повтор ничего не удваивает.
"""
import datetime as dt

import pytest

from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_rating import (
    OpsEvaluationEvent,
    OpsEvaluationWorkItem,
    OpsRatedParticipant,
)
from organization_management.apps.ops import ratings as ratings_service

pytestmark = pytest.mark.django_db


def make_event(code, *, assignments, posts=None):
    return OpsSecurityEvent.objects.create(
        code=code,
        title="Официальный визит",
        object_name="Резиденция «Акорда»",
        business_date=dt.date(2026, 6, 18),
        stage="CLOSED",
        readiness_percent=100,
        force_need=0,
        conflicts_count=0,
        owner_name="Абенов",
        recon_checklist=[],
        recon_sector_posts=posts
        or [{"id": "post-1", "sector": "Периметр", "post": "Пост 1", "need": 1}],
        demand_rows=[],
        demand_approved=True,
        force_requests=[],
        placement_assignments=assignments,
        approval_status=OpsSecurityEvent.ApprovalStatus.PENDING,
        journal_entries=[],
        closure_direction_summaries=[],
    )


def assignment(employee_id, name, post_id="post-1", division="4"):
    return {
        "id": f"assignment-{employee_id}",
        "postId": post_id,
        "employeeId": str(employee_id),
        "employeeName": name,
        "divisionId": division,
        "divisionName": "Отдел охраны объектов",
    }


def test_closing_opens_evaluation_with_participants_and_work_items():
    event = make_event(
        "ОМ-О-1",
        assignments=[assignment(11, "Абенов С."), assignment(12, "Байжанов Е.")],
    )

    opened = ratings_service.open_evaluation_for_event(event, actor="user-7")

    assert opened is not None
    assert opened.security_event_id == event.pk
    assert opened.number == "ОМ-О-1"
    codes = set(
        OpsRatedParticipant.objects.values_list("participant_code", flat=True)
    )
    assert codes == {"employee-11", "employee-12"}
    items = list(OpsEvaluationWorkItem.objects.all())
    assert len(items) == 2
    assert {item.status for item in items} == {"PENDING"}
    # Оценивает тот, кто закрыл: он вёл мероприятие и видел людей на постах.
    assert {item.evaluator_user_id for item in items} == {"user-7"}
    assert {item.post_label for item in items} == {"Пост 1"}


def test_participant_is_linked_to_the_personnel_record():
    """Главная проба шага: без связи вся цепочка собрана впустую.

    Рейтинг доходит до расстановки ТОЛЬКО через `employee_id` участника
    (шаги РЙ-1 и РЙ-2). Заведи оценивание без связи — и симптом исходной
    карточки вернётся целиком, но уже на живых данных.
    """
    event = make_event("ОМ-О-2", assignments=[assignment(21, "Есимов Б.")])

    ratings_service.open_evaluation_for_event(event, actor="user-7")

    participant = OpsRatedParticipant.objects.get(participant_code="employee-21")
    assert participant.employee_id == 21
    assert participant.safe_label == "Есимов Б."


def test_event_without_placement_opens_nothing():
    """Оценивать некого — не заводится ничего."""
    event = make_event("ОМ-О-3", assignments=[])

    assert ratings_service.open_evaluation_for_event(event, actor="user-7") is None
    assert OpsEvaluationEvent.objects.count() == 0
    assert OpsEvaluationWorkItem.objects.count() == 0
    assert OpsRatedParticipant.objects.count() == 0


def test_assignment_without_a_personnel_id_is_skipped():
    """Строка расстановки без кадрового идентификатора не рождает участника:
    выдуманный код участника связался бы с кадрами неизвестно чьими."""
    event = make_event(
        "ОМ-О-4",
        assignments=[
            {"id": "a-1", "postId": "post-1", "employeeId": "", "employeeName": "—"}
        ],
    )

    assert ratings_service.open_evaluation_for_event(event, actor="user-7") is None


def test_running_it_twice_does_not_duplicate():
    event = make_event("ОМ-О-5", assignments=[assignment(31, "Жаксылыков Д.")])

    ratings_service.open_evaluation_for_event(event, actor="user-7")
    ratings_service.open_evaluation_for_event(event, actor="user-7")

    assert OpsEvaluationEvent.objects.count() == 1
    assert OpsRatedParticipant.objects.count() == 1
    assert OpsEvaluationWorkItem.objects.count() == 1


def test_running_it_twice_does_not_reset_the_evaluation_progress():
    """Второй вызов НЕ сбрасывает ход оценивания (Plane №641).

    До правки поля хода (`status`, `submitted_at`, `submitted_evaluation_code`,
    `revision`, `evaluator_user_id`) лежали в общем `defaults`, и КАЖДЫЙ
    повторный вызов сбрасывал их у всех заданий разом. Пока оценивание
    заводилось только закрытием, второго вызова в жизни задания не случалось.
    С Plane №433 задания открываются входом объекта в «Проведение» — значит к
    моменту закрытия ОМ они уже бывают отправлены, и закрытие стирало отметку
    об отправке у каждого. Хуже, чем потеря: `submit_evaluation` отказывает по
    закрытому мероприятию (`EVALUATION_ARCHIVE_LOCKED`), и сброшенные задания
    оставались PENDING навсегда — без единого способа их отправить.

    Описание задания при этом обязано обновляться: подпись поста меняется, и
    задание должно называть пост так, как он выглядит сейчас.
    """
    event = make_event("ОМ-О-6", assignments=[assignment(41, "Серикова Г.")])
    ratings_service.open_evaluation_for_event(event, actor="user-7")
    item = OpsEvaluationWorkItem.objects.get()
    item.status = "SUBMITTED"
    item.submitted_evaluation_code = "eval-1"
    item.submitted_at = dt.datetime(2026, 6, 19, 10, 0, tzinfo=dt.timezone.utc)
    item.revision = 2
    item.save()

    # Второй вызов — ровно тот, что делает закрытие ОМ, и другим актором:
    # закрывает мероприятие не обязательно тот, кто вёл его на «Проведении».
    event.recon_sector_posts = [
        {"id": "post-1", "sector": "Периметр", "post": "Пост 1 (север)", "need": 1}
    ]
    ratings_service.open_evaluation_for_event(event, actor="user-9")

    item.refresh_from_db()
    assert item.status == "SUBMITTED", "закрытие сбросило выставленную оценку"
    assert item.submitted_evaluation_code == "eval-1"
    assert item.submitted_at is not None
    assert item.revision == 2
    assert item.evaluator_user_id == "user-7", (
        "адресат отправленного задания переписан на того, кто закрыл ОМ"
    )
    # А описание — обновилось: подпись поста взята свежая.
    assert item.post_label == "Пост 1 (север)"


def test_the_evaluator_is_filled_in_later_when_the_stage_opened_it_anonymously():
    """Пустой адресат ДОБИРАЕТСЯ, пока задание не отправлено (Plane №641).

    Вход объекта в «Проведение» (Plane №433) зовёт эту ручку БЕЗ актора, и
    задание заводится с пустым `evaluator_user_id`. Очередь оценщика
    фильтруется ровно по этому полю — без добора такое задание не попало бы
    ни в чью очередь. Закрытие ОМ идёт с актором и адресата проставляет; это
    поведение было до правки №641, и снять его вместе с защитой отправленных
    заданий значило бы починить одно, сломав другое.
    """
    event = make_event("ОМ-О-7", assignments=[assignment(51, "Оспанов Т.")])

    # Так зовёт вход в «Проведение».
    ratings_service.open_evaluation_for_event(event, actor=None)
    item = OpsEvaluationWorkItem.objects.get()
    assert item.evaluator_user_id == "", "адресат взялся из ниоткуда"

    # Так зовёт закрытие ОМ.
    ratings_service.open_evaluation_for_event(event, actor="user-9")

    item.refresh_from_db()
    assert item.evaluator_user_id == "user-9", (
        "задание осталось без адресата — в очередь оценщика оно не попадёт"
    )
    assert item.status == "PENDING"
