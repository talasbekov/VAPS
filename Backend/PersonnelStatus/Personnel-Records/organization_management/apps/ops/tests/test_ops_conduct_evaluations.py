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


def test_reading_the_summary_needs_the_manage_right_too(  # noqa: F811
    manager, approver, two_objects_on_conduct
):
    """Оценки закрыты правом ВЕДЕНИЯ целиком — и на чтение тоже
    (`[ЗАК-02]`, Plane №433; комментарий выправлен по факту в №776).

    🔴 ЗАЧЕМ ЭТО ПИН, А НЕ КОММЕНТАРИЙ. Над картой прав стояла фраза «читает
    тот, кто видит ОМ; ставит тот, кто его ведёт» — контракт, которого нет:
    обе ручки закрыты `event.manage`, а `visit_object_evaluations` — ОДНО
    действие DRF на GET и POST, и развести их правами, не разведя маршруты,
    нельзя в принципе. Врущий комментарий дороже отсутствующего: следующий,
    кто придёт чинить панель оценок, примет 403 у читателя за дефект гейта.

    Теперь правило не написано, а проверено. `approver` подходит для этого
    лучше любого другого клиента: у него ЕСТЬ `event.view` (он видит
    мероприятие и решает по расстановке) и НЕТ `event.manage` — то есть он и
    есть тот самый «кто видит ОМ», которому фраза обещала чтение оценок.

    Правило то же, что рядом: №695 закрывает оценки в «Скачать дело» тем, у
    кого прав на них нет. Открыть их здесь значило бы завести два ответа на
    один вопрос «кому видны баллы людей».
    """
    _, event_id, first, _ = two_objects_on_conduct

    # Ведущий читает — иначе проба доказывала бы «ручка закрыта всем».
    allowed = manager.get(_url(event_id, first))
    assert allowed.status_code == 200, allowed.content
    assignment_id = allowed.json()["rows"][0]["assignmentId"]

    refused_read = approver.get(_url(event_id, first))
    assert refused_read.status_code == 403, refused_read.content

    refused_write = approver.post(
        _url(event_id, first),
        {"assignmentId": assignment_id, "score": 7},
        format="json",
    )
    assert refused_write.status_code == 403, refused_write.content

    # «Всем 10» — та же мерка: соседняя ручка того же экрана.
    refused_all = approver.post(f"{_url(event_id, first)}all/", {"score": 10}, format="json")
    assert refused_all.status_code == 403, refused_all.content


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


def test_reading_the_summary_takes_no_row_lock(manager, two_objects_on_conduct):  # noqa: F811
    """Чтение сводки не берёт `SELECT … FOR UPDATE` (Plane №647).

    Ручка читалась через `lock_event` внутри явной транзакции. React Query
    перезапрашивает её при каждом возврате фокуса в окно, и открытый экран
    проведения держал замок строки мероприятия, выстраивая в очередь любые
    параллельные переходы этапа.

    Замок виден в САМОМ ЗАПРОСЕ: `FOR UPDATE` — часть SQL, и проверять его
    надёжнее по тексту запроса, чем по поведению двух соединений (второе
    соединение в тестовой транзакции pytest-django просто не увидит строки).
    """
    from django.test.utils import CaptureQueriesContext
    from django.db import connection

    _, event_id, first, _ = two_objects_on_conduct
    url = _url(event_id, first)

    with CaptureQueriesContext(connection) as captured:
        assert manager.get(url).status_code == 200
    locking = [
        query["sql"]
        for query in captured.captured_queries
        if "FOR UPDATE" in query["sql"].upper()
        and "ops_security_events" in query["sql"]
    ]

    assert locking == [], f"чтение сводки взяло замок строки: {locking[:1]}"


def test_unknown_event_on_read_is_the_same_404(manager, two_objects_on_conduct):  # noqa: F811
    """Отказы чтения и правки одинаковы (Plane №647).

    У чтения свой путь получения мероприятия, и разойтись с правкой по коду
    ответа он не имеет права: по коду читатель узнавал бы, каким из двух
    путей его обслужили.
    """
    _, event_id, first, _ = two_objects_on_conduct
    assert manager.get(f"{URL}999999/visit-objects/{first.pk}/evaluations/").status_code == 404
    assert manager.get(f"{URL}nope/visit-objects/{first.pk}/evaluations/").status_code == 404


def test_entering_conduct_addresses_the_work_items_to_the_actor(  # noqa: F811
    manager, two_objects_on_approval, actor  # noqa: F811
):
    """Задания оценщика заводятся НЕ ничьими (Plane №642).

    `advance_visits` открывала оценивание с `actor=None`, и каждое задание
    получало пустого адресата. Очередь оценщика фильтруется ровно по этому
    полю (`filter(evaluator_user_id=actor)`), поэтому заявленная цель «задания
    заводятся входом в этап 5» не достигалась вовсе: заведённые задания не
    попадали в очередь НИ К КОМУ.
    """
    base, event_id, _, _, _ = two_objects_on_approval
    # До «Ознакомления» доводим обходом админа — предмет пробы не согласование.
    # ДАЛЬШЕ обхода нет намеренно: `override_stage` и так передаёт актора, и
    # пройти им же в «Проведение» значило бы проверить не тот путь. Штатная
    # цепочка идёт ручкой завершения ознакомления, и ровно она была без актора.
    service.override_stage(event_id, stage="ACKNOWLEDGEMENT", actor=actor)
    event = service.lock_event(event_id)
    assert event.placement_assignments, "расстановка пуста — оценивать некого"
    done = manager.post(
        f"{base}acknowledgement/complete/",
        {"force": True, "comment": "Проба: подтвердили не все."},
        format="json",
    )
    assert done.status_code == 200, done.content
    assert service.lock_event(event_id).stage == "CONDUCT"

    items = list(
        OpsEvaluationWorkItem.objects.filter(event_code=f"security-event-{event_id}")
    )
    assert items, "задания не заведены входом в «Проведение»"
    assert all(item.evaluator_user_id != "" for item in items), (
        "задание заведено ничьим — очередь оценщика не отдаст его никому"
    )


# ── Ревью 2b6c12c1: оценивание видит НОВОЕ состояние ОМ (Plane №700) ────────


def test_reviving_a_closed_event_does_not_leave_the_task_marked_finished(
    manager, two_objects_on_conduct, actor  # noqa: F811
):
    """🔴 Plane №700: админский перевод CLOSED→CONDUCT не метит задание
    «Завершено».

    `open_evaluation_for_event` читает `event.stage` и `event.closed_at` и по
    ним пишет метку задания и время начала. Звали её ДО сохранения
    мероприятия — то есть на СТАРОМ состоянии: при оживлении закрытого ОМ
    задание получало `state_label="Завершено"` и `actual_starts_at`, равное
    моменту ЗАКРЫТИЯ. А это `update_or_create`, поэтому неверная метка
    ЗАТИРАЛА верную. Администратор оживлял мероприятие и оставлял оценщику
    завершённое задание — ровно то, чего этим переводом избегал.

    Мутация: вернуть вызов `open_evaluation_for_event` ДО `event.save(...)` —
    метка снова станет «Завершено», а время начала — временем закрытия.
    """
    from organization_management.apps.operations.models_rating import (
        OpsEvaluationEvent,
    )

    _base, event_id, first, second = two_objects_on_conduct
    manager.post(f"{URL}{event_id}/visit-objects/{first.pk}/close/", {}, format="json")
    manager.post(f"{URL}{event_id}/visit-objects/{second.pk}/close/", {}, format="json")
    closed = service.lock_event(event_id)
    assert closed.stage == "CLOSED" and closed.closed_at is not None
    code = f"security-event-{event_id}"
    assert OpsEvaluationEvent.objects.get(event_code=code).state_label == "Завершено"

    service.override_stage(event_id, stage="CONDUCT", actor=actor)

    row = OpsEvaluationEvent.objects.get(event_code=code)
    assert row.state_label == "Проведение", (
        "оживлённое мероприятие оставило оценщику задание с меткой «Завершено»"
    )
    assert service.lock_event(event_id).closed_at is None
