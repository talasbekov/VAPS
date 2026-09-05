"""Назначения сотрудника по роли в данных (Plane №403, `[ОЗН-09]`).

Сотрудник без единого права раздела читает СВОИ назначения и подтверждает
СВОЁ ознакомление; чужие — нет. Начальник читает подчинённого по области
`status.manage`, чужое подразделение — отказ. Без кадровой привязки —
пустой ответ с причиной, не 403.
"""
import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.staff_unit.models import StaffUnit

from .test_ops_security_events_api import (  # noqa: F401
    URL,
    create_event,
    make_employee,
    make_object,
    manager,
)

pytestmark = pytest.mark.django_db

MINE = f"{URL}my-assignments/"


def placed(manager, employee):  # noqa: F811
    """ОМ с одним назначением сотрудника на пост из паспорта."""
    from organization_management.apps.operations.models_object import OpsSecurityObject

    obj = make_object(
        code=f"OBJ-{OpsSecurityObject.objects.count() + 1}", with_passport=True
    )
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    manager.patch(
        f"{base}recon/",
        {
            "checklist": [{**i, "state": "NORMAL"} for i in data["reconChecklist"]],
            "sectorPosts": data["reconSectorPosts"],
        },
        format="json",
    )
    manager.post(f"{base}recon/complete/")
    post_id = data["reconSectorPosts"][0]["id"]
    resp = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk)},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    return base, resp.json()["placementAssignments"][0]["id"]


def linked_client(username, employee, **grant):
    api, user = client_for(username, **grant)
    employee.user = user
    employee.save(update_fields=["user"])
    return api


def test_employee_reads_own_assignments_without_any_permission(manager):  # noqa: F811
    me = make_employee("Свой", "Сотрудник")
    other = make_employee("Чужой", "Сотрудник")
    base, assignment_id = placed(manager, me)
    placed(manager, other)
    api = linked_client("emp-own", me)

    resp = api.get(MINE)
    assert resp.status_code == 200, resp.data
    body = resp.json()
    assert body["employeeId"] == str(me.pk)
    assert [r["assignmentId"] for r in body["results"]] == [assignment_id]
    row = body["results"][0]
    assert row["eventId"] == base.split("/")[-2]
    assert (row["sector"], row["post"], row["task"]) == (
        "Периметр", "Пост 1", "Охрана периметра"
    )
    assert row["acknowledgedAt"] is None

    # Чужие — нет: ни по параметру, ни реестром.
    assert api.get(f"{MINE}?employee={other.pk}").status_code == 403
    assert api.get(URL).status_code == 403


def test_unlinked_account_gets_a_reason_not_403():
    api, _ = client_for("nobody")
    resp = api.get(MINE)
    assert resp.status_code == 200
    assert resp.json()["results"] == []
    assert "не связана" in resp.json()["unlinkedReason"]


def test_chief_reads_subordinate_by_status_scope_and_not_a_stranger(manager):  # noqa: F811
    mine_div = Division.objects.create(
        name="Первое управление", division_type=Division.DivisionType.DIRECTORATE
    )
    foreign_div = Division.objects.create(
        name="Второе управление", division_type=Division.DivisionType.DIRECTORATE
    )
    subordinate = make_employee("Подчинённый", "Ф")
    stranger = make_employee("Посторонний", "Ф")
    StaffUnit.objects.create(division=mine_div, employee=subordinate, index=1)
    StaffUnit.objects.create(division=foreign_div, employee=stranger, index=1)
    _, sub_assignment = placed(manager, subordinate)
    placed(manager, stranger)
    chief, _ = client_for(
        "chief", "HEAD_DIRECTORATE", perms=("status.manage",),
        scope_division_id=mine_div.pk,
    )

    resp = chief.get(f"{MINE}?employee={subordinate.pk}")
    assert resp.status_code == 200, resp.data
    assert [r["assignmentId"] for r in resp.json()["results"]] == [sub_assignment]
    assert chief.get(f"{MINE}?employee={stranger.pk}").status_code == 403


def test_employee_acknowledges_own_assignment_but_not_a_colleagues(manager):  # noqa: F811
    me = make_employee("Свой", "С")
    colleague = make_employee("Коллега", "К")
    base, my_assignment = placed(manager, me)
    _, their_assignment = placed(manager, colleague)
    their_base = _
    api = linked_client("emp-ack", me)

    resp = api.post(f"{base}acknowledge/{my_assignment}/")
    assert resp.status_code == 200, resp.data
    assert resp.json()["placementAssignments"][0]["acknowledgedAt"] is not None
    assert api.get(MINE).json()["results"][0]["acknowledgedAt"] is not None

    assert api.post(f"{their_base}acknowledge/{their_assignment}/").status_code == 403


def test_decline_needs_a_reason_and_is_exclusive_with_acknowledgement(manager):  # noqa: F811
    """«Не могу заступить» (Plane №405): причина обязательна, отказ и
    подтверждение снимают друг друга, чужое назначение — 403."""
    me = make_employee("Свой", "С")
    colleague = make_employee("Коллега", "К")
    base, my_assignment = placed(manager, me)
    their_base, their_assignment = placed(manager, colleague)
    api = linked_client("emp-decline", me)

    resp = api.post(f"{base}decline/{my_assignment}/", {"reason": "  "}, format="json")
    assert resp.status_code == 400
    assert "reason" in resp.json()["details"]

    resp = api.post(
        f"{base}decline/{my_assignment}/", {"reason": "Болен"}, format="json"
    )
    assert resp.status_code == 200, resp.data
    row = resp.json()["placementAssignments"][0]
    assert (row["declineReason"], row["acknowledgedAt"]) == ("Болен", None)
    assert row["declinedAt"] is not None
    mine = api.get(MINE).json()["results"][0]
    assert (mine["declineReason"], mine["declinedAt"] is not None) == ("Болен", True)

    # Передумал — подтверждение снимает отказ.
    row = api.post(f"{base}acknowledge/{my_assignment}/").json()["placementAssignments"][0]
    assert row["acknowledgedAt"] is not None
    assert (row["declinedAt"], row["declineReason"]) == (None, None)

    assert api.post(
        f"{their_base}decline/{their_assignment}/", {"reason": "Не моё"}, format="json"
    ).status_code == 403


def _close_event(event_id):
    """Закрыть мероприятие мимо цепочки — предмет проб ниже это ОТВЕТ на
    закрытом ОМ, а не путь к закрытию."""
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    OpsSecurityEvent.objects.filter(pk=event_id).update(stage="CLOSED")


def test_acknowledge_on_a_closed_event_is_refused(manager):  # noqa: F811
    """Закрытое мероприятие подтверждением НЕ правится (Plane №587).

    🔴 ЧТО СТЕРЕЖЁТСЯ. Гард стоял только у близнеца `decline`. До №405
    отсутствие его здесь было безобидно: подтверждение лишь ставило
    `acknowledgedAt`. С №405 оно ещё и СТИРАЕТ отказ — а «отказов N» в сводке
    закрытия считается на чтении по этим полям. Один запрос на закрытый ОМ
    менял отчёт о УЖЕ ЗАКРЫТОМ мероприятии, и причина отказа терялась
    навсегда.

    Красная на снятии `_require_open` из `acknowledge`: отказ исчезнет.
    """
    me = make_employee("Свой", "С")
    base, assignment = placed(manager, me)
    api = linked_client("emp-ack-closed", me)
    assert api.post(
        f"{base}decline/{assignment}/", {"reason": "Болен"}, format="json"
    ).status_code == 200
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    _close_event(event_id)

    resp = api.post(f"{base}acknowledge/{assignment}/")

    assert resp.status_code == 422, resp.data
    assert resp.json()["error_code"] == "INVALID_STAGE_TRANSITION"
    # 🔴 ГЛАВНОЕ: отчёт закрытого мероприятия НЕ изменился.
    from organization_management.apps.operations.models_event import OpsSecurityEvent

    row = OpsSecurityEvent.objects.get(pk=event_id).placement_assignments[0]
    assert row["declineReason"] == "Болен"
    assert row["acknowledgedAt"] is None


def test_decline_on_a_closed_event_names_the_stage_not_the_form(manager):  # noqa: F811
    """Пустая причина на ЗАКРЫТОМ ОМ — отказ про этап, а не про форму (№589).

    Проверка пустой причины стояла ПЕРВОЙ, и человек получал 400 «Проверьте
    заполнение формы» с ошибкой поля. Он правил текст, отправлял снова и
    упирался в другой отказ — про этап. Состояние мероприятия старше формы:
    если действие невозможно вовсе, форму править незачем.

    Красная на возврате прежнего порядка проверок: ответ станет 400.
    """
    me = make_employee("Свой", "С")
    base, assignment = placed(manager, me)
    api = linked_client("emp-decline-closed", me)
    _close_event(base.rstrip("/").rsplit("/", 1)[-1])

    resp = api.post(f"{base}decline/{assignment}/", {"reason": "  "}, format="json")

    assert resp.status_code == 422, resp.data
    assert resp.json()["error_code"] == "INVALID_STAGE_TRANSITION"
    assert "закрыто" in resp.json()["message"]


def test_decline_records_who_wrote_it(manager):  # noqa: F811
    """Отказ несёт АВТОРА и строку журнала (Plane №588).

    Отказ читается как слова самого сотрудника — «Не могу заступить: …» стоит
    в его карточке и в листе ознакомления. А вписать их может не только он:
    гейт ручки пускает старшего и ведущего мероприятие, и это сделано
    намеренно (человек может позвонить). Без автора чужая формулировка
    выдавалась за его собственную, и опровергнуть её было нечем.

    Красная на снятии `declinedBy` и записи журнала.
    """
    from organization_management.apps.operations.models_audit import OpsAuditLog

    me = make_employee("Свой", "С")
    base, assignment = placed(manager, me)
    before = set(OpsAuditLog.objects.values_list("pk", flat=True))

    # Пишет ВЕДУЩИЙ мероприятие, а не сам сотрудник — тот самый случай, ради
    # которого авторство и заводится.
    resp = manager.post(
        f"{base}decline/{assignment}/", {"reason": "Наряд по части"}, format="json"
    )

    assert resp.status_code == 200, resp.data
    row = resp.json()["placementAssignments"][0]
    assert row["declineReason"] == "Наряд по части"
    written = OpsAuditLog.objects.exclude(pk__in=before).filter(
        action="ASSIGNMENT_DECLINED"
    )
    assert written.count() == 1, "отказ не оставил следа в журнале"
    assert written.first().new_value["reason"] == "Наряд по части"
    assert written.first().new_value["declinedBy"] != ""
    # Автор доезжает и до читателя карточки, а не только до журнала.
    mine = linked_client("emp-decline-author", me).get(MINE).json()["results"][0]
    assert mine["declinedBy"] != ""


def test_dismissed_employee_stops_reading_his_own_assignments(manager):  # noqa: F811
    """Уволенный не читает даже СВОИ назначения (Plane №596).

    🔴 ЧТО СТЕРЕЖЁТСЯ. Учётка живёт дольше кадровой записи. В ветке «сам себе»
    проверки `is_active` не было, а начальники прикрыты ею через
    `_find_personnel` (он фильтрует активных) — то есть правило держалось для
    чужих и не держалось для своих. Уволенный продолжал видеть задачу поста,
    требования, форму одежды и вооружение: сведения о наряде, к которому он
    больше не имеет отношения.

    ПУТЕЙ ДВА, и проверок тоже две: без параметра право отдаётся раньше
    `may_read`, поэтому гард стоит и во вьюхе; с параметром `?employee=` —
    в `may_read`. Проба идёт обоими.

    Ответ 200 с причиной, а не 403: учётка законная и экран законный, отказ
    по праву читался бы как поломка доступа.
    """
    me = make_employee("Уволенный", "У")
    base, _assignment = placed(manager, me)
    api = linked_client("emp-dismissed", me)
    assert len(api.get(MINE).json()["results"]) == 1, "до увольнения назначение видно"

    me.is_active = False
    me.save(update_fields=["is_active"])

    own = api.get(MINE)
    assert own.status_code == 200, own.data
    body = own.json()
    assert body["results"] == [], "уволенный видит свои назначения"
    assert "уволен" in (body["unlinkedReason"] or "").lower(), body
    # Причина СВОЯ, а не общая с «нет кадровой привязки»: это разные положения.
    assert "не связана" not in (body["unlinkedReason"] or "")

    # Второй путь — по параметру: тот же отказ, но уже правом.
    assert api.get(f"{MINE}?employee={me.pk}").status_code == 403
