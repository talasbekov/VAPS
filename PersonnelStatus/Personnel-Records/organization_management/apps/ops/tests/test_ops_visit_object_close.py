"""Закрытие объекта и автозакрытие мероприятия (`[ЗАК-05]`/`[ЗАК-12]`, Plane №404).

Спецификация: «Кнопка „Закрыть объект“… После закрытия изменения невозможны»
и «Мероприятие закрывается автоматически, когда закрыты все его объекты; в
реестре „Закрыто · 100%“». До этого шага закрыть можно было только
мероприятие целиком — одной кнопкой с итогами направлений, и у ОМ с двумя
объектами старший первого не мог закрыть своё, не дожидаясь второго.

Пробы стерегут:

1. закрытие одного из двух объектов НЕ закрывает мероприятие;
2. закрытие последнего — закрывает: стадия, готовность 100, штамп, переход в
   журнале, оценивание открыто, аудит — те же следствия, что у ручного;
3. вне «Проведения» закрыть объект нельзя; дважды — нельзя;
4. комментарий по объекту сохраняется и отдаётся контрактом;
5. ручное закрытие мероприятия целиком по-прежнему закрывает все объекты.
"""
import pytest

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_event import (
    OpsSecurityEventTransition,
    OpsSecurityEventVisitObject,
)
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    two_objects_on_approval,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    approver,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


@pytest.fixture
def actor(db):
    from django.contrib.auth import get_user_model

    return get_user_model().objects.create_user(username="closer", password="x")


@pytest.fixture
def two_objects_on_conduct(manager, actor, two_objects_on_approval):  # noqa: F811
    """Оба объекта доведены до «Проведения» обходом админа — предмет проб
    здесь закрытие, а не согласование и ознакомление."""
    base, event_id, first, second, _ = two_objects_on_approval
    service.override_stage(event_id, stage="CONDUCT", actor=actor)
    first.refresh_from_db()
    second.refresh_from_db()
    return base, event_id, first, second


def _visits(event_id):
    return list(
        OpsSecurityEventVisitObject.objects.filter(event_id=event_id).order_by(
            "position", "pk"
        )
    )


def test_closing_one_of_two_objects_keeps_the_event_open(manager, two_objects_on_conduct):  # noqa: F811
    base, event_id, first, second = two_objects_on_conduct

    resp = manager.post(
        f"{base}visit-objects/{first.pk}/close/",
        {"comment": "Без происшествий."},
        format="json",
    )

    assert resp.status_code == 200, resp.content
    data = resp.json()
    assert data["stage"] == "CONDUCT", "мероприятие закрылось по одному объекту"
    rows = {row["id"]: row for row in data["visitObjects"]}
    assert rows[str(first.pk)]["stage"] == "CLOSED"
    assert rows[str(first.pk)]["closedAt"] is not None
    assert rows[str(first.pk)]["closingComment"] == "Без происшествий."
    assert rows[str(second.pk)]["stage"] == "CONDUCT"
    event = service.lock_event(event_id)
    assert event.closed_at is None


def test_closing_the_last_object_closes_the_event_with_the_same_consequences(
    manager, two_objects_on_conduct  # noqa: F811
):
    base, event_id, first, second = two_objects_on_conduct
    manager.post(f"{base}visit-objects/{first.pk}/close/", {}, format="json")

    resp = manager.post(f"{base}visit-objects/{second.pk}/close/", {}, format="json")

    assert resp.status_code == 200, resp.content
    data = resp.json()
    assert (data["stage"], data["readinessPercent"]) == ("CLOSED", 100)
    assert data["closedAt"] is not None
    assert {row["stage"] for row in data["visitObjects"]} == {"CLOSED"}
    assert OpsSecurityEventTransition.objects.filter(
        event_id=event_id, to_stage="CLOSED"
    ).exists(), "переход в «Закрыто» не записан"
    record = OpsAuditLog.objects.filter(
        action=audit_service.SECURITY_EVENT_CLOSED, entity_id=event_id
    ).first()
    assert record is not None, "аудит закрытия мероприятия не записан"
    # 🔴 И ЗАПИСЬ НЕ ОБЕЗЛИЧЕНА (дописано по ревью, задача №825). Актор здесь
    #    был постоянной строкой «system:visit-object-removed», и уходила она НЕ
    #    ТОЛЬКО в аудит: `_finalize_event_closure` передаёт его в
    #    `open_evaluation_for_event`, а тот в ветке «добор адресата»
    #    ПЕРЕПИСЫВАЕТ `evaluator_user_id` у каждого неотправленного задания.
    #    Очередь оценщика фильтруется ровно по этому полю — то есть живые
    #    задания уходили из очередей настоящих людей в учётную запись, которой
    #    не существует (тот же дефект, что №641/№642, через другую дверь).
    assert not str(record.actor_user_id).startswith("system"), (
        f"закрытие мероприятия подписано псевдоактором: {record.actor_user_id!r}"
    )
    # И задания оценивания остались у ЖИВЫХ адресатов, а не у метки.
    from organization_management.apps.operations.models_rating import OpsEvaluationWorkItem

    stolen = list(
        OpsEvaluationWorkItem.objects.filter(
            evaluator_user_id__startswith="system"
        ).values_list(
            "id", "evaluator_user_id"
        )
    )
    assert stolen == [], (
        f"задания оценивания переписаны на несуществующую учётку: {stolen}"
    )
    assert OpsAuditLog.objects.filter(
        action=audit_service.VISIT_OBJECT_CLOSED, entity_id=event_id
    ).count() == 2


def test_closing_outside_conduct_is_refused(manager, two_objects_on_approval):  # noqa: F811
    base, event_id, first, _, _ = two_objects_on_approval

    resp = manager.post(f"{base}visit-objects/{first.pk}/close/", {}, format="json")

    assert resp.status_code == 422, resp.content
    assert resp.json()["error_code"] == "INVALID_STAGE_TRANSITION"


def test_closing_twice_is_refused(manager, two_objects_on_conduct):  # noqa: F811
    base, event_id, first, _ = two_objects_on_conduct
    manager.post(f"{base}visit-objects/{first.pk}/close/", {}, format="json")

    resp = manager.post(f"{base}visit-objects/{first.pk}/close/", {}, format="json")

    assert resp.status_code == 422, resp.content
    assert resp.json()["error_code"] == "VISIT_OBJECT_ALREADY_CLOSED"


def test_manual_close_still_closes_every_object(manager, actor, two_objects_on_conduct):  # noqa: F811
    base, event_id, first, second = two_objects_on_conduct
    event = service.lock_event(event_id)
    summaries = [
        {"direction": sector, "summary": "Без происшествий."}
        for sector in {p.get("sector") for p in event.recon_sector_posts}
    ]

    service.close_event(event_id, direction_summaries=summaries, actor=actor)

    assert {v.stage for v in _visits(event_id)} == {"CLOSED"}
    assert service.lock_event(event_id).stage == "CLOSED"


# ── Правки ПОСЛЕ закрытия объекта (`[ЗАК-12]`, Plane №607) ──────────────────
#
# 🔴 ПОЧЕМУ ЭТОГО НЕ ЛОВИЛИ ПРЕЖНИЕ ПРОБЫ. Все шесть операций сторожил только
# `event.stage == "CLOSED"`, а этап мероприятия — НАИМЕНЬШИЙ среди объектов:
# пока жив хоть один незакрытый, мероприятие стоит на «Проведении». На ОМ с
# ОДНИМ объектом дефекта не видно вовсе — закрытие единственного объекта
# закрывает и мероприятие, и старый гард срабатывает за компанию. Нужна
# фикстура ровно с двумя, где закрыт ПЕРВЫЙ, а мероприятие живо вторым.


@pytest.fixture
def first_object_closed(manager, two_objects_on_conduct):  # noqa: F811
    """Первый объект закрыт, мероприятие держится на «Проведении» вторым."""
    base, event_id, first, second = two_objects_on_conduct
    closed = manager.post(f"{base}visit-objects/{first.pk}/close/", {}, format="json")
    assert closed.status_code == 200, closed.content
    assert closed.json()["stage"] == "CONDUCT", (
        "мероприятие закрылось вместе с первым объектом — проба проверяла бы "
        "гард мероприятия, а не объекта"
    )
    first.refresh_from_db()
    assert first.stage == "CLOSED"
    return base, event_id, first, second


def test_a_closed_visit_object_refuses_every_edit(
    manager, first_object_closed, actor  # noqa: F811
):
    """Шесть операций объекта отбиваются его СОБСТВЕННЫМ этапом.

    До правки каждая отвечала 200 и меняла закрытый объект: старший
    заменялся и уходил в аудит, день посещения и примечание переписывались,
    замещающие назначались и снимались — вопреки тексту диалога закрытия и
    записи `VISIT_OBJECT_CLOSED` в журнале.
    """
    base, _, first, _ = first_object_closed
    employee = make_employee(last_name="Послезакрытов")

    attempts = {
        "правка дня и примечания": manager.patch(
            f"{base}visit-objects/{first.pk}/",
            {"visitDay": "2026-12-30", "note": "после закрытия"},
            format="json",
        ),
        "снятие объекта": manager.delete(f"{base}visit-objects/{first.pk}/"),
        "назначение старшего": manager.post(
            f"{base}visit-objects/{first.pk}/chief/",
            {"employeeId": str(employee.pk)},
            format="json",
        ),
        "снятие старшего": manager.delete(f"{base}visit-objects/{first.pk}/chief/"),
        "назначение замещающего": manager.post(
            f"{base}visit-objects/{first.pk}/deputies/",
            {"employeeId": str(employee.pk), "canEditPlacement": True},
            format="json",
        ),
    }
    for what, resp in attempts.items():
        assert resp.status_code == 422, f"{what}: {resp.status_code} {resp.content}"
        assert resp.json()["error_code"] == "VISIT_OBJECT_ALREADY_CLOSED", what

    # Снятие замещающего — шестая операция; своего замещающего у закрытого
    # объекта нет (назначение только что отбито), поэтому берётся живой у
    # ВТОРОГО объекта: адрес операции — объект, и гард обязан сработать
    # раньше поиска строки.
    _, _, _, second = first_object_closed
    added = manager.post(
        f"{base}visit-objects/{second.pk}/deputies/",
        {"employeeId": str(employee.pk), "canEditPlacement": True},
        format="json",
    )
    assert added.status_code == 201, added.content
    deputy_id = added.json()["visitObjects"][1]["deputies"][0]["id"]
    removed = manager.delete(
        f"{base}visit-objects/{first.pk}/deputies/{deputy_id}/"
    )
    assert removed.status_code == 422, removed.content
    assert removed.json()["error_code"] == "VISIT_OBJECT_ALREADY_CLOSED"

    # И главное: закрытый объект остался таким, каким его закрыли.
    first.refresh_from_db()
    assert first.stage == "CLOSED"
    assert first.visit_day is None
    assert first.note == ""
    assert first.deputies.count() == 0
    assert OpsSecurityEventVisitObject.objects.filter(pk=first.pk).exists(), (
        "закрытый объект снят с мероприятия"
    )


# ── Журнал в сводке объекта — про ЭТОТ объект (Plane №727) ──────────────


def test_the_object_summary_counts_only_its_own_journal(
    manager, two_objects_on_conduct  # noqa: F811
):
    """Инцидент на посту одного объекта не считается вторым как свой.

    🔴 ЧТО БЫЛО НЕ ТАК. Назначения и отказы в сводке фильтровались по постам
    объекта, а замены и инциденты брались из `journal_entries` ЦЕЛИКОМ. У
    многообъектного ОМ каждый объект отчитывался общей цифрой мероприятия как
    своей: один инцидент превращался в «инцидентов 1» у обоих.
    """
    base, event_id, first, second = two_objects_on_conduct
    event = service.lock_event(event_id)
    first_posts = service.visit_object_posts(event, first)
    assert first_posts, "фикстура обязана дать первому объекту хоть один пост"

    manager.post(
        f"{base}journal/",
        {
            "type": "INCIDENT",
            "title": "Задержание на периметре",
            "description": "",
            "postId": str(first_posts[0]["id"]),
        },
        format="json",
    )

    rows = {row["id"]: row for row in manager.get(base).json()["visitObjects"]}

    assert rows[str(first.pk)]["closureSummary"]["incidents"] == 1
    assert rows[str(second.pk)]["closureSummary"]["incidents"] == 0, (
        "инцидент чужого объекта не может считаться своим"
    )


def test_a_journal_entry_without_a_post_is_not_shared_between_objects(
    manager, two_objects_on_conduct  # noqa: F811
):
    """Запись без поста у НЕСКОЛЬКИХ объектов не приписывается никому.

    Приписать её каждому значило бы посчитать одно событие по разу на объект —
    ровно то, ради чего карточка и заведена. Тот же довод, которым
    `_visit_placement` отказывается делить общий расчёт постов между
    объектами (Plane №409).
    """
    base, event_id, first, second = two_objects_on_conduct

    manager.post(
        f"{base}journal/",
        {"type": "INCIDENT", "title": "Общая обстановка", "description": ""},
        format="json",
    )

    rows = {row["id"]: row for row in manager.get(base).json()["visitObjects"]}

    assert rows[str(first.pk)]["closureSummary"]["incidents"] == 0
    assert rows[str(second.pk)]["closureSummary"]["incidents"] == 0
    # А сводка МЕРОПРИЯТИЯ её видит — запись не исчезла, она просто не чья-то.
    assert manager.get(base).json()["closureSummary"]["incidents"] == 1


def test_a_replacement_now_records_its_post(manager, two_objects_on_conduct):  # noqa: F811
    """Замена записывает пост — без него её нельзя отнести к объекту.

    Инцидент несёт `postId` с `[ЗАК-03]`, у замены его просто забыли, и
    поэтому замены разъезжались по всем объектам сразу.
    """
    base, event_id, first, second = two_objects_on_conduct
    event = service.lock_event(event_id)
    first_posts = service.visit_object_posts(event, first)
    target = next(
        a
        for a in event.placement_assignments
        if str(a.get("postId")) == str(first_posts[0]["id"])
    )
    spare = make_employee("Сменный", "С")

    resp = manager.post(
        f"{base}conduct/replace/",
        {
            "assignmentId": target["id"],
            "incomingEmployeeId": str(spare.pk),
            "reasonCode": "Отказ: болезнь",
        },
        format="json",
    )

    assert resp.status_code == 200, resp.content
    replacement = next(
        e for e in resp.json()["journalEntries"] if e["type"] == "REPLACEMENT"
    )
    assert replacement["postId"] == str(first_posts[0]["id"])
    rows = {row["id"]: row for row in resp.json()["visitObjects"]}
    assert rows[str(first.pk)]["closureSummary"]["replacements"] == 1
    assert rows[str(second.pk)]["closureSummary"]["replacements"] == 0


# ── Ревью 8b12d8f7: снятие объекта тоже закрывает мероприятие (Plane №608) ──


def test_removing_the_last_open_object_closes_the_event(
    manager, two_objects_on_conduct  # noqa: F811
):
    """🔴 Plane №608: «все объекты закрыты» наступает и от СНЯТИЯ объекта.

    Автозакрытие `[ЗАК-12]` жило только в `close_visit_object`, а правдой
    «открытых объектов не осталось» становится и здесь: закрыли объект А
    (мероприятие осталось на «Проведении» из-за Б), сняли Б — и мероприятие
    навсегда стояло на CONDUCT с готовностью меньше 100. Добить его могло
    только ручное `close_event`: `close_visit_object(А)` отвечал «объект уже
    закрыт». В реестре ОМ без единого открытого объекта числился
    «Проведением».

    Мутация: убрать вызов `_finalize_event_closure` из `remove_visit_object` —
    мероприятие останется на CONDUCT, и переход в «Закрыто» не запишется.
    """
    base, event_id, first, second = two_objects_on_conduct
    closed = manager.post(f"{base}visit-objects/{first.pk}/close/", {}, format="json")
    assert closed.status_code == 200, closed.content
    assert closed.json()["stage"] == "CONDUCT", "мероприятие закрылось по одному объекту"
    # У снимаемого объекта не должно быть постов расчёта — иначе снятие
    # отбивается своим правилом, и до предмета пробы дело не дойдёт.
    event = service.lock_event(event_id)
    event.recon_sector_posts = [
        post
        for post in (event.recon_sector_posts or [])
        if str(post.get("visitObjectId") or "") != str(second.pk)
    ]
    event.save(update_fields=["recon_sector_posts", "updated_at"])

    removed = manager.delete(f"{base}visit-objects/{second.pk}/")

    assert removed.status_code in (200, 204), removed.content
    event = service.lock_event(event_id)
    assert event.stage == "CLOSED", "открытых объектов нет, а мероприятие не закрыто"
    assert event.readiness_percent == 100
    assert event.closed_at is not None
    assert OpsSecurityEventTransition.objects.filter(
        event_id=event_id, to_stage="CLOSED"
    ).exists(), "переход в «Закрыто» не записан"
    assert OpsAuditLog.objects.filter(
        action=audit_service.SECURITY_EVENT_CLOSED, entity_id=event_id
    ).exists(), "аудит закрытия мероприятия не записан"


def test_removing_an_object_while_another_stays_open_does_not_close_the_event(
    manager, two_objects_on_conduct  # noqa: F811
):
    """А пока открыт хоть один объект, снятие соседнего ничего не закрывает.

    Без этой пробы №608 можно было бы «починить» безусловным закрытием, и
    снятие лишнего объекта закрывало бы работающее мероприятие.
    """
    base, event_id, _first, second = two_objects_on_conduct
    event = service.lock_event(event_id)
    event.recon_sector_posts = [
        post
        for post in (event.recon_sector_posts or [])
        if str(post.get("visitObjectId") or "") != str(second.pk)
    ]
    event.save(update_fields=["recon_sector_posts", "updated_at"])

    removed = manager.delete(f"{base}visit-objects/{second.pk}/")

    assert removed.status_code in (200, 204), removed.content
    event = service.lock_event(event_id)
    assert event.stage == "CONDUCT"
    assert event.closed_at is None
