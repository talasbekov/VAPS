"""Оценки на этапе 5 (`[МД-08]`/`[ЗАК-02]`/`[ЗАК-05]`, Plane №433).

Пробы стерегут: задания заводятся входом объекта в «Проведение»; сводка
объекта считает «Оценено K из N» по его назначениям; клик ставит, повторный
снимает (прежняя строка помечается superseded); «Всем 10» не трогает
поставленное вручную; закрытый объект и чужая стадия отбиваются; оценка этапа
попадает в средний балл тем же `included_evaluations`, что и оценка из
модуля рейтинга.
"""
import pytest

from organization_management.apps.operations.models_rating import (
    OpsEvaluationWorkItem,
    OpsEventEvaluation,
)
from organization_management.apps.ops import conduct_evaluations, ratings
from organization_management.apps.ops import security_events as service
from organization_management.apps.ops.tests.test_ops_visit_object_close import (  # noqa: F401
    actor,
    two_objects_on_conduct,
)
from organization_management.apps.ops.tests.test_ops_visit_object_approval import (  # noqa: F401
    two_objects_on_approval,
)
from organization_management.apps.ops.tests.test_ops_security_events_api import (  # noqa: F401
    URL,
    approver,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db


def _url(event_id, visit):
    return f"{URL}{event_id}/visit-objects/{visit.pk}/evaluations/"


def test_entering_conduct_opens_work_items(two_objects_on_conduct):  # noqa: F811
    _, event_id, _, _ = two_objects_on_conduct
    event = service.lock_event(event_id)
    assert event.stage == "CONDUCT"
    assert OpsEvaluationWorkItem.objects.filter(
        event_code=f"security-event-{event.pk}"
    ).count() == len(event.placement_assignments)


def test_summary_counts_only_this_objects_assignments(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, second = two_objects_on_conduct
    a = manager.get(_url(event_id, first)).json()
    b = manager.get(_url(event_id, second)).json()
    assert a["total"] >= 1 and b["total"] >= 1
    event = service.lock_event(event_id)
    assert a["total"] + b["total"] == len(event.placement_assignments)
    assert a["evaluated"] == 0 and b["evaluated"] == 0
    row = a["rows"][0]
    assert set(row) >= {"assignmentId", "post", "sector", "employeeName", "score", "comment", "replaced"}


def test_click_sets_and_second_click_withdraws(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, _ = two_objects_on_conduct
    row = manager.get(_url(event_id, first)).json()["rows"][0]
    resp = manager.post(
        _url(event_id, first),
        {"assignmentId": row["assignmentId"], "score": 7, "comment": "норма"},
        format="json",
    )
    assert resp.status_code == 200, resp.content
    assert resp.json()["evaluated"] == 1
    mine = next(r for r in resp.json()["rows"] if r["assignmentId"] == row["assignmentId"])
    assert mine["score"] == 7 and mine["comment"] == "норма"
    # Перестановка: прежняя строка помечена, действующая одна.
    resp = manager.post(
        _url(event_id, first),
        {"assignmentId": row["assignmentId"], "score": 9},
        format="json",
    )
    assert resp.status_code == 200
    # 🔴 ОТБОР «ДЕЙСТВУЮЩАЯ» ПРАВЛЕН ОСОЗНАННО (Plane №646). Прежде отзыв
    # писали в `superseded_by_code` словом `'withdrawn'`, и одного условия
    # «не замещена» хватало, чтобы отсечь и снятые. Теперь отзыв — своё поле,
    # и условий два. Смысл пробы тот же: после повторного клика действующей
    # оценки не остаётся.
    live = OpsEventEvaluation.objects.filter(
        event_code=f"security-event-{event_id}",
        superseded_by_code__isnull=True,
        withdrawn_at__isnull=True,
    )
    assert live.count() == 1 and live.get().score == 9
    assert OpsEventEvaluation.objects.filter(event_code=f"security-event-{event_id}").count() == 2
    # Повторный клик — снять.
    resp = manager.post(
        _url(event_id, first),
        {"assignmentId": row["assignmentId"], "score": None},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.json()["evaluated"] == 0
    assert not live.exists()


def test_all_ten_skips_manual_scores(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, _ = two_objects_on_conduct
    summary = manager.get(_url(event_id, first)).json()
    rows = [r for r in summary["rows"] if not r["replaced"]]
    manager.post(
        _url(event_id, first),
        {"assignmentId": rows[0]["assignmentId"], "score": 6},
        format="json",
    )
    resp = manager.post(_url(event_id, first) + "all/", {}, format="json")
    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert body["evaluated"] == body["total"]
    scores = {r["assignmentId"]: r["score"] for r in body["rows"] if not r["replaced"]}
    assert scores[rows[0]["assignmentId"]] == 6
    assert all(v == 10 for k, v in scores.items() if k != rows[0]["assignmentId"])


def test_scale_and_stage_are_guarded(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, _ = two_objects_on_conduct
    row = manager.get(_url(event_id, first)).json()["rows"][0]
    out = manager.post(
        _url(event_id, first), {"assignmentId": row["assignmentId"], "score": 11}, format="json"
    )
    assert out.status_code == 422 and out.json()["error_code"] == "SCORE_OUT_OF_SCALE"
    unknown = manager.post(
        _url(event_id, first), {"assignmentId": "nope", "score": 5}, format="json"
    )
    assert unknown.status_code == 404
    # Закрытый объект — изменения невозможны.
    manager.post(f"{URL}{event_id}/visit-objects/{first.pk}/close/", {}, format="json")
    closed = manager.post(
        _url(event_id, first), {"assignmentId": row["assignmentId"], "score": 5}, format="json"
    )
    assert closed.status_code == 422
    assert closed.json()["error_code"] == "VISIT_OBJECT_ALREADY_CLOSED"


def test_stage_score_feeds_the_average(manager, two_objects_on_conduct):  # noqa: F811
    _, event_id, first, _ = two_objects_on_conduct
    row = manager.get(_url(event_id, first)).json()["rows"][0]
    manager.post(
        _url(event_id, first), {"assignmentId": row["assignmentId"], "score": 4}, format="json"
    )
    code = ratings._participant_code_for(int(row["employeeId"]))
    evaluations = list(OpsEventEvaluation.objects.filter(participant_code=code))
    from organization_management.apps.operations.clock import Clock
    today = Clock.today_local()
    included = ratings.included_evaluations(evaluations, code, today, today)
    assert [e.score for e in included] == [4]
    assert included[0].method == conduct_evaluations.STAGE_METHOD


def _second_person_on_the_same_post(event_id, visit):
    """Второй человек на посту объекта: без него проба про число вызовов
    вакуумна — при одной строке «на каждую запись» и «раз на ручку» дают
    одно и то же число.

    Строка дописывается прямо в расстановку, а не ручкой `placement/assign/`:
    на «Проведении» расстановка уже закрыта для правки, а предмет пробы —
    не правила назначения, а работа ручки оценок с УЖЕ стоящим составом.
    """
    event = service.lock_event(event_id)
    posts = {str(p.get("id")) for p in service.visit_object_posts(event, visit)}
    origin = next(
        a for a in event.placement_assignments if str(a.get("postId")) in posts
    )
    employee = make_employee(last_name="Второйнапосту")
    event.placement_assignments = [
        *event.placement_assignments,
        {
            **origin,
            "id": f"{origin['id']}-double",
            "employeeId": str(employee.pk),
            "employeeName": "Второйнапосту В.",
        },
    ]
    event.save(update_fields=["placement_assignments", "updated_at"])
    return employee


def test_evaluation_is_opened_once_per_request(manager, two_objects_on_conduct, monkeypatch):  # noqa: F811
    """Оценивание открывается на входе в ручку, а не на каждую оценку (Plane №640).

    `open_evaluation_for_event` проходит по ВСЕМ назначениям мероприятия и
    делает по два `update_or_create` на каждое. Вызов сидел внутри `_write`,
    то есть повторялся на каждой оцениваемой строке: «Всем 10» по сотне
    человек — двадцать тысяч записей в одной транзакции, при том что второй и
    следующие вызовы не меняют ничего (`create_defaults`, Plane №641).
    """
    _, event_id, first, _ = two_objects_on_conduct
    _second_person_on_the_same_post(event_id, first)

    calls = []
    real = ratings.open_evaluation_for_event

    def counted(event, *, actor):
        calls.append(actor)
        return real(event, actor=actor)

    monkeypatch.setattr(ratings, "open_evaluation_for_event", counted)

    resp = manager.post(_url(event_id, first) + "all/", {}, format="json")

    assert resp.status_code == 200, resp.content
    scored = [r for r in resp.json()["rows"] if not r["replaced"] and r["score"] == 10]
    assert len(scored) >= 2, "проба вакуумна: оценена одна строка"
    assert len(calls) == 1, (
        f"оценивание открыто {len(calls)} раз на {len(scored)} оценок — "
        "вызов вернулся внутрь записи"
    )


def test_single_score_opens_the_evaluation_when_the_stage_did_not(
    manager, two_objects_on_conduct, monkeypatch  # noqa: F811
):
    """Открытие не потерялось при переносе из записи в ручку (Plane №640).

    Вызов в `_write` был ещё и страховкой: у мероприятия, доведённого до
    «Проведения» ДО Plane №433, заданий оценщика нет вовсе, и без открытия
    оценка легла бы в пустоту. Страховка сохранена — но на входе в ручку.
    """
    _, event_id, first, _ = two_objects_on_conduct
    event_code = f"security-event-{event_id}"
    OpsEvaluationWorkItem.objects.filter(event_code=event_code).delete()
    assert not OpsEvaluationWorkItem.objects.filter(event_code=event_code).exists()

    row = manager.get(_url(event_id, first)).json()["rows"][0]
    resp = manager.post(
        _url(event_id, first),
        {"assignmentId": row["assignmentId"], "score": 8},
        format="json",
    )

    assert resp.status_code == 200, resp.content
    code = ratings._participant_code_for(int(row["employeeId"]))
    work_item = OpsEvaluationWorkItem.objects.get(work_item_code=f"{event_code}-{code}")
    assert work_item.status == "SUBMITTED", "задание не заведено — оценка легла в пустоту"


def test_summary_names_the_division_of_the_employee(manager, two_objects_on_conduct):  # noqa: F811
    """«ФИО · управление» на панели оценок печатается (Plane №643).

    Подразделение в строке расстановки НЕ ХРАНИТСЯ — оно считается на чтении
    (`placement_assignments_view`), поэтому проба и заводит штатную единицу
    ПОСЛЕ назначения: так же это выглядит в жизни при переводе человека.
    """
    from organization_management.apps.divisions.models import Division
    from organization_management.apps.employees.models import Employee
    from organization_management.apps.staff_unit.models import StaffUnit

    _, event_id, first, _ = two_objects_on_conduct
    row = manager.get(_url(event_id, first)).json()["rows"][0]
    assert row["divisionName"] == "", "у сотрудника пробы уже есть подразделение"

    division = Division.objects.create(
        name="Управление №9", division_type=Division.DivisionType.DIRECTORATE
    )
    employee = Employee.objects.get(pk=int(row["employeeId"]))
    StaffUnit.objects.create(division=division, employee=employee, index=employee.pk)

    again = next(
        r
        for r in manager.get(_url(event_id, first)).json()["rows"]
        if r["assignmentId"] == row["assignmentId"]
    )
    assert again["divisionName"] == "Управление №9"


def _incident_on(manager, event_id, post_id, title):  # noqa: F811
    resp = manager.post(
        f"{URL}{event_id}/journal/",
        {"type": "INCIDENT", "title": title, "postId": post_id},
        format="json",
    )
    assert resp.status_code in (200, 201), resp.content
    return resp


def test_summary_counts_only_this_objects_journal(manager, two_objects_on_conduct):  # noqa: F811
    """Замены и инциденты — ОБЪЕКТА, а не мероприятия (Plane №645).

    Журнал ведётся по мероприятию, а панель оценок и подтверждение закрытия
    говорят про ОДИН объект: до правки каждый объект печатал общее по ОМ
    число инцидентов как своё, и решение о закрытии принималось по чужой
    цифре.
    """
    _, event_id, first, second = two_objects_on_conduct
    event = service.lock_event(event_id)
    post_of = {
        str(visit.pk): str(service.visit_object_posts(event, visit)[0]["id"])
        for visit in (first, second)
    }
    assert post_of[str(first.pk)] != post_of[str(second.pk)], "посты объектов совпали"

    _incident_on(manager, event_id, post_of[str(first.pk)], "Происшествие на первом")
    _incident_on(manager, event_id, post_of[str(second.pk)], "Происшествие на втором")

    a = manager.get(_url(event_id, first)).json()
    b = manager.get(_url(event_id, second)).json()

    assert a["incidents"] == 1, "объект отчитался инцидентами соседа"
    assert b["incidents"] == 1, "объект отчитался инцидентами соседа"


def test_replacement_of_the_neighbour_is_not_listed(manager, two_objects_on_conduct):  # noqa: F811
    """Снятый заменой на СОСЕДНЕМ объекте в списке не появляется (Plane №645).

    Пост у записи о замене пишется с №727 — ровно ради того, чтобы отнести её
    к объекту; до этой правки поле писалось, но никем не читалось.
    """
    _, event_id, first, second = two_objects_on_conduct
    event = service.lock_event(event_id)
    second_posts = {str(p["id"]) for p in service.visit_object_posts(event, second)}
    victim = next(
        a for a in event.placement_assignments if str(a.get("postId")) in second_posts
    )
    incoming = make_employee(last_name="Заменовский")
    service.replace_assignment(
        event_id,
        assignment_id=victim["id"],
        incoming_employee_id=str(incoming.pk),
        reason_code="ILLNESS",
    )

    a = manager.get(_url(event_id, first)).json()
    b = manager.get(_url(event_id, second)).json()

    assert [r["employeeName"] for r in a["rows"] if r["replaced"]] == [], (
        "замена соседнего объекта перечислена как своя"
    )
    assert [r["employeeName"] for r in b["rows"] if r["replaced"]] != [], (
        "своя замена потерялась вместе с чужой"
    )


def test_withdrawn_score_is_not_a_correction(manager, two_objects_on_conduct):  # noqa: F811
    """Снятая оценка не объявляется исправленной (Plane №646).

    Отзыв писали в `superseded_by_code` словом `'withdrawn'` — строкой, которая
    кодом оценки не является: цепочка исправлений разрешала её в `None`, и
    реестр показывал запись «исправленной» без преемника и без строки
    `OpsEvaluationCorrection`.
    """
    from organization_management.apps.operations.models_rating import (
        OpsEvaluationCorrection,
    )

    _, event_id, first, _ = two_objects_on_conduct
    row = manager.get(_url(event_id, first)).json()["rows"][0]
    url = _url(event_id, first)
    manager.post(url, {"assignmentId": row["assignmentId"], "score": 7}, format="json")
    manager.post(url, {"assignmentId": row["assignmentId"], "score": None}, format="json")

    code = ratings._participant_code_for(int(row["employeeId"]))
    evaluation = OpsEventEvaluation.objects.get(
        event_code=f"security-event-{event_id}", participant_code=code
    )
    assert evaluation.withdrawn_at is not None, "отзыв не записан"
    assert evaluation.superseded_by_code is None, (
        "снятая оценка объявлена замещённой — преемника у неё нет"
    )
    # Исправлением отзыв не является: строки §19.18 у него быть не должно.
    assert not OpsEvaluationCorrection.objects.filter(
        original_evaluation_code=evaluation.evaluation_code
    ).exists()
    # В средний балл снятая по-прежнему не входит — поведение то же, изменился
    # только способ его записать.
    from organization_management.apps.operations.clock import Clock

    today = Clock.today_local()
    assert ratings.included_evaluations([evaluation], code, today, today) == []
    assert manager.get(url).json()["evaluated"] == 0


def test_restaging_a_score_leaves_a_correction_with_a_reason(  # noqa: F811
    manager, two_objects_on_conduct
):
    """Замещение на этапе подписано причиной и автором (Plane №646, §19.18).

    Порядок исправлений требует, чтобы у КАЖДОГО замещения были причина и
    автор. Путь этапа замещал молча — в том числе записи формального
    `submit_evaluation`, — и в цепочке это выглядело как исправление
    неизвестно кем и почему.
    """
    from organization_management.apps.operations.models_rating import (
        OpsEvaluationCorrection,
    )

    _, event_id, first, _ = two_objects_on_conduct
    row = manager.get(_url(event_id, first)).json()["rows"][0]
    url = _url(event_id, first)
    manager.post(url, {"assignmentId": row["assignmentId"], "score": 4}, format="json")
    manager.post(url, {"assignmentId": row["assignmentId"], "score": 9}, format="json")

    code = ratings._participant_code_for(int(row["employeeId"]))
    rows = list(
        OpsEventEvaluation.objects.filter(
            event_code=f"security-event-{event_id}", participant_code=code
        ).order_by("pk")
    )
    assert [r.score for r in rows] == [4, 9]
    assert rows[0].superseded_by_code == rows[1].evaluation_code

    correction = OpsEvaluationCorrection.objects.get(
        original_evaluation_code=rows[0].evaluation_code
    )
    assert correction.replacement_evaluation_code == rows[1].evaluation_code
    assert correction.reason.strip() != "", "замещение без причины — обход §19.18"
    assert correction.corrected_by != "", "замещение без автора"
