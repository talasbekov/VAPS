"""Срез B1: /api/ops/security-events/ + /api/ops/personnel/ — жизненный цикл ОМ.

bulletin → recon → demand → forces → placement → approval → acknowledgement →
conduct → closed. Правила, коды и тексты — порт мок-слоя клиента
(mocks/ops/security-events-handlers.ts): он был первой реализацией контракта,
и карточка написана под его исходы. Сквозной тест ведёт ОДНО ОМ через все
девять стадий: цепочка целиком, а не девять изолированных проверок, — иначе
выход одной стадии никогда не встретился бы со входом следующей.
"""
import pytest

from organization_management.apps.dictionaries.models import Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.audit_service import (
    SECURITY_EVENT_CLOSED,
    SECURITY_EVENT_CREATED,
)
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_object import (
    OpsObjectSector,
    OpsPassportVersion,
    OpsSecurityObject,
    OpsSecurityPost,
)
from organization_management.apps.ops.passport import publish_version
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

URL = "/api/ops/security-events/"


def make_object(code="OBJ-1", name="Резиденция", with_passport=False):
    obj = OpsSecurityObject.objects.create(
        name=name,
        code=code,
        object_type="Госучреждение",
        region="г. Астана",
        address="пр. Мәңгілік Ел, 8",
        object_state=OpsSecurityObject.ObjectState.ACTIVE,
        passport_state=OpsSecurityObject.PassportState.GREEN,
    )
    if with_passport:
        sector = OpsObjectSector.objects.create(
            security_object=obj, name="Периметр", position=1
        )
        OpsSecurityPost.objects.create(
            sector=sector,
            name="Пост 1",
            task="Охрана периметра",
            requirements="Допуск",
            position=1,
        )
        publish_version(
            obj, effective_from="2026-01-01", note="первичная", actor="seed"
        )
    return obj


def make_employee(last_name="Абенов", first_name="Серик"):
    iin = str(940000000000 + Employee.objects.count())
    rank = Rank.objects.get_or_create(
        name="Майор", defaults={"level": 1, "code": "MAJOR"}
    )[0]
    return Employee.objects.create(
        personnel_number=f"P-{iin[-4:]}",
        last_name=last_name,
        first_name=first_name,
        birth_date="1990-01-01",
        gender="M",
        iin=iin,
        rank=rank,
        hire_date="2015-01-01",
        employment_status="working",
    )


@pytest.fixture
def manager():
    api, _ = client_for(
        "ev-manager", "EV_MANAGER", perms=("event.view", "event.manage")
    )
    return api


@pytest.fixture
def viewer():
    api, _ = client_for("ev-viewer", "EV_VIEWER", perms=("event.view",))
    return api


def create_event(api, obj, title="Визит делегации", business_date="2026-08-10"):
    return api.post(
        URL,
        {"title": title, "objectId": str(obj.pk), "businessDate": business_date},
        format="json",
    )


# ── Создание и реестр ────────────────────────────────────────────────────────


def test_create_binds_applicable_passport_version(manager):
    obj = make_object(with_passport=True)
    resp = create_event(manager, obj)
    assert resp.status_code == 201
    data = resp.json()
    assert data["stage"] == "BULLETIN"
    assert data["code"].startswith("ОМ-2026-")
    assert data["passportBinding"]["versionNumber"] == 1
    assert data["passportBinding"]["objectName"] == "Резиденция"
    assert [i["label"] for i in data["reconChecklist"]][:2] == [
        "Подъездные пути и парковка",
        "Периметр и ограждение",
    ]
    row = OpsAuditLog.objects.get(action=SECURITY_EVENT_CREATED)
    assert row.entity_type == "security_event"
    assert row.new_value["code"] == data["code"]


def test_create_without_applicable_version_leaves_binding_null(manager):
    obj = make_object(with_passport=True)
    # дата ОМ раньше effectiveFrom единственной публикации
    resp = create_event(manager, obj, business_date="2025-12-31")
    assert resp.status_code == 201
    assert resp.json()["passportBinding"] is None


def test_create_validation(manager):
    resp = manager.post(
        URL,
        {"title": " ", "objectId": "", "businessDate": "10.08.2026"},
        format="json",
    )
    assert resp.status_code == 400
    assert set(resp.json()["details"]) == {"title", "objectId", "businessDate"}


def test_create_requires_manage(viewer):
    obj = make_object()
    assert create_event(viewer, obj).status_code == 403


def test_list_filters_and_pages(manager, viewer):
    obj = make_object()
    for i in range(3):
        assert create_event(manager, obj, title=f"ОМ номер {i}").status_code == 201
    OpsSecurityEvent.objects.filter(title="ОМ номер 2").update(stage="CONDUCT")
    data = viewer.get(URL, {"stage": "CONDUCT"}).json()
    assert data["count"] == 1
    assert data["results"][0]["title"] == "ОМ номер 2"
    data = viewer.get(URL, {"search": "номер 1"}).json()
    assert data["count"] == 1
    data = viewer.get(URL, {"page": "2", "page_size": "2"}).json()
    assert data["count"] == 3
    assert len(data["results"]) == 1
    assert data["previous"] == "1"


def test_bindable_objects_carries_version_count(manager):
    make_object(code="OBJ-A", with_passport=True)
    make_object(code="OBJ-B")
    data = manager.get(f"{URL}bindable-objects/").json()
    counts = {r["code"]: r["publishedVersionCount"] for r in data["results"]}
    assert counts == {"OBJ-A": 1, "OBJ-B": 0}


def test_personnel_snapshot_shape(manager):
    employee = make_employee()
    division = Division.objects.create(
        name="Отдел охраны объектов", code="D-OO", division_type="division"
    )
    StaffUnit.objects.create(division=division, employee=employee, index=1)
    data = manager.get("/api/ops/personnel/").json()
    assert data["results"] == [
        {
            "id": str(employee.pk),
            "name": "Абенов С.",
            "rankLabel": "Майор",
            "unit": "Отдел охраны объектов",
        }
    ]


# ── Сквозной проход всех девяти стадий ───────────────────────────────────────


def test_full_lifecycle_walkthrough(manager):
    obj = make_object(with_passport=True)
    employee = make_employee()
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"

    # BULLETIN: завершение пустого — 422; после заполнения — RECON
    resp = manager.post(f"{base}bulletin/complete/")
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "BULLETIN_INCOMPLETE"
    resp = manager.patch(
        f"{base}bulletin/",
        {"briefDescription": "Обеспечение визита.", "initialTasks": "Усиление."},
        format="json",
    )
    assert resp.status_code == 200
    data = manager.post(f"{base}bulletin/complete/").json()
    assert (data["stage"], data["readinessPercent"]) == ("RECON", 15)

    # RECON: импорт из паспорта, повторный импорт — 422 NOTHING_TO_IMPORT
    data = manager.post(f"{base}recon/import-from-passport/").json()
    assert [r["post"] for r in data["reconSectorPosts"]] == ["Пост 1"]
    assert data["reconSectorPosts"][0]["sourcePostId"] is not None
    resp = manager.post(f"{base}recon/import-from-passport/")
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "NOTHING_TO_IMPORT"

    # чек-лист не закрыт — рекогносцировка не завершается
    resp = manager.post(f"{base}recon/complete/")
    assert resp.json()["error_code"] == "RECON_CHECKLIST_INCOMPLETE"
    checklist = [
        {**item, "done": True} for item in data["reconChecklist"]
    ]
    posts = data["reconSectorPosts"]
    resp = manager.patch(
        f"{base}recon/",
        {"checklist": checklist, "sectorPosts": posts},
        format="json",
    )
    assert resp.status_code == 200
    data = manager.post(f"{base}recon/complete/").json()
    assert (data["stage"], data["readinessPercent"]) == ("DEMAND", 30)

    # DEMAND: утверждение строк агрегирует запросы сил по группам
    rows = [
        {
            "id": "d-1", "sector": "Периметр", "task": "Охрана", "shift": "день",
            "need": 2, "group": "ГР-1", "requirements": "", "comment": "",
        },
        {
            "id": "d-2", "sector": "Периметр", "task": "КПП", "shift": "ночь",
            "need": 1, "group": "ГР-1", "requirements": "", "comment": "",
        },
    ]
    data = manager.post(f"{base}demand/approve/", {"rows": rows}, format="json").json()
    assert (data["stage"], data["forceNeed"]) == ("FORCES", 3)
    assert len(data["forceRequests"]) == 1
    assert data["forceRequests"][0]["requestedCount"] == 3

    # FORCES: частичное выделение не пропускает, полное — двигает
    request_id = data["forceRequests"][0]["id"]
    manager.patch(
        f"{base}forces/{request_id}/",
        {"allocatedCount": 1, "comment": "первая рота"},
        format="json",
    )
    resp = manager.post(f"{base}forces/complete/")
    assert resp.json()["error_code"] == "FORCE_ALLOCATION_INCOMPLETE"
    data = manager.patch(
        f"{base}forces/{request_id}/",
        {"allocatedCount": 3, "comment": "полностью"},
        format="json",
    ).json()
    assert data["forceRequests"][0]["status"] == "ALLOCATED"
    data = manager.post(f"{base}forces/complete/").json()
    assert (data["stage"], data["readinessPercent"]) == ("PLACEMENT", 60)

    # PLACEMENT: назначение на пост; неукомплектованность держит стадию
    post_id = data["reconSectorPosts"][0]["id"]
    data = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk)},
        format="json",
    ).json()
    assignment = data["placementAssignments"][0]
    assert assignment["employeeName"] == "Абенов С."
    data = manager.post(f"{base}placement/complete/").json()
    assert data["stage"] == "APPROVAL"

    # APPROVAL: возврат с причиной откатывает в PLACEMENT, повторное
    # прохождение — согласование открывает ознакомление
    resp = manager.post(f"{base}approval/return/", {"comment": ""}, format="json")
    assert resp.status_code == 400
    data = manager.post(
        f"{base}approval/return/", {"comment": "уточнить посты"}, format="json"
    ).json()
    assert (data["stage"], data["approvalStatus"]) == ("PLACEMENT", "RETURNED")
    assert data["approvalComment"] == "уточнить посты"
    data = manager.post(f"{base}placement/complete/").json()
    data = manager.post(f"{base}approval/approve/").json()
    assert (data["stage"], data["approvalStatus"]) == (
        "ACKNOWLEDGEMENT",
        "APPROVED",
    )

    # ACKNOWLEDGEMENT: без подтверждения — 422, после — CONDUCT
    resp = manager.post(f"{base}acknowledgement/complete/")
    assert resp.json()["error_code"] == "ACKNOWLEDGEMENT_INCOMPLETE"
    data = manager.post(f"{base}acknowledge/{assignment['id']}/").json()
    assert data["placementAssignments"][0]["acknowledgedAt"] is not None
    data = manager.post(f"{base}acknowledgement/complete/").json()
    assert (data["stage"], data["readinessPercent"]) == ("CONDUCT", 95)

    # CONDUCT: журнал штаба и замена выбывшего (атомарно, со строкой журнала)
    data = manager.post(
        f"{base}journal/",
        {"type": "ORDER", "title": "Приказ", "description": "Усилить."},
        format="json",
    ).json()
    assert data["journalEntries"][0]["title"] == "Приказ"
    replacement = make_employee(last_name="Оспанова", first_name="Айгуль")
    data = manager.post(
        f"{base}conduct/replace/",
        {
            "assignmentId": assignment["id"],
            "incomingEmployeeId": str(replacement.pk),
            "reasonCode": "болезнь",
        },
        format="json",
    ).json()
    names = [a["employeeName"] for a in data["placementAssignments"]]
    assert names == ["Оспанова А."]
    assert data["journalEntries"][0]["type"] == "REPLACEMENT"
    assert "Абенов С. → Оспанова А." in data["journalEntries"][0]["description"]

    # CLOSED: итоги всех направлений обязательны
    resp = manager.post(f"{base}close/", {"directionSummaries": []}, format="json")
    assert resp.json()["error_code"] == "CLOSURE_DIRECTIONS_INCOMPLETE"
    data = manager.post(
        f"{base}close/",
        {
            "directionSummaries": [
                {"direction": "Периметр", "summary": "Без происшествий."}
            ]
        },
        format="json",
    ).json()
    assert (data["stage"], data["readinessPercent"]) == ("CLOSED", 100)
    assert data["closedAt"] is not None
    row = OpsAuditLog.objects.get(action=SECURITY_EVENT_CLOSED)
    assert row.old_value == {"stage": "CONDUCT"}


# ── Точечные правила вне сквозного прохода ───────────────────────────────────


def test_double_assignment_rejected(manager):
    obj = make_object(with_passport=True)
    employee = make_employee()
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    manager.patch(
        f"{base}bulletin/",
        {"briefDescription": "x", "initialTasks": "y"},
        format="json",
    )
    manager.post(f"{base}bulletin/complete/")
    data = manager.post(f"{base}recon/import-from-passport/").json()
    # второй пост руками — чтобы было куда назначать дважды
    posts = data["reconSectorPosts"] + [
        {
            "id": "manual-1", "sector": "КПП", "post": "Пост 2", "task": "",
            "need": 1, "requirements": "", "result": None, "comment": "",
            "sourceSectorId": None, "sourcePostId": None, "minRating": None,
        }
    ]
    manager.patch(
        f"{base}recon/",
        {"checklist": data["reconChecklist"], "sectorPosts": posts},
        format="json",
    )
    first_post = posts[0]["id"]
    resp = manager.post(
        f"{base}placement/assign/",
        {"postId": first_post, "employeeId": str(employee.pk)},
        format="json",
    )
    assert resp.status_code == 200
    resp = manager.post(
        f"{base}placement/assign/",
        {"postId": "manual-1", "employeeId": str(employee.pk)},
        format="json",
    )
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "DOUBLE_ASSIGNMENT"


def test_rating_requirement_soft_conflict_and_override(manager):
    obj = make_object(with_passport=True)
    employee = make_employee()
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    manager.patch(
        f"{base}bulletin/",
        {"briefDescription": "x", "initialTasks": "y"},
        format="json",
    )
    manager.post(f"{base}bulletin/complete/")
    data = manager.post(f"{base}recon/import-from-passport/").json()
    # требование рейтинга на посту: данных рейтинга нет → мягкий конфликт
    posts = [{**data["reconSectorPosts"][0], "minRating": 4}]
    manager.patch(
        f"{base}recon/",
        {"checklist": data["reconChecklist"], "sectorPosts": posts},
        format="json",
    )
    resp = manager.post(
        f"{base}placement/assign/",
        {"postId": posts[0]["id"], "employeeId": str(employee.pk)},
        format="json",
    )
    assert resp.status_code == 409
    payload = resp.json()
    assert payload["error_code"] == "SOFT_CONFLICT_DETECTED"
    assert payload["overridable"] is True
    assert payload["details"]["conflicts"][0]["conflict_code"] == (
        "RATING_DATA_MISSING"
    )
    # обход причиной — протокол ConflictDialog: поля в корне тела
    resp = manager.post(
        f"{base}placement/assign/",
        {
            "postId": posts[0]["id"],
            "employeeId": str(employee.pk),
            "override": True,
            "override_reason": "решение старшего наряда",
        },
        format="json",
    )
    assert resp.status_code == 200
    assignment = resp.json()["placementAssignments"][0]
    assert assignment["ratingOverrideReason"] == "решение старшего наряда"


def test_unassign_removes_assignment(manager):
    obj = make_object(with_passport=True)
    employee = make_employee()
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    manager.patch(
        f"{base}bulletin/",
        {"briefDescription": "x", "initialTasks": "y"},
        format="json",
    )
    manager.post(f"{base}bulletin/complete/")
    data = manager.post(f"{base}recon/import-from-passport/").json()
    post_id = data["reconSectorPosts"][0]["id"]
    data = manager.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(employee.pk)},
        format="json",
    ).json()
    assignment_id = data["placementAssignments"][0]["id"]
    data = manager.delete(f"{base}placement/{assignment_id}/").json()
    assert data["placementAssignments"] == []


def test_journal_requires_conduct_stage(manager):
    obj = make_object()
    event_id = create_event(manager, obj).json()["id"]
    resp = manager.post(
        f"{URL}{event_id}/journal/",
        {"type": "ORDER", "title": "Приказ", "description": ""},
        format="json",
    )
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "INVALID_STAGE_TRANSITION"


def test_import_without_binding_is_explicit(manager):
    obj = make_object()  # без публикаций → binding null
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    manager.patch(
        f"{base}bulletin/",
        {"briefDescription": "x", "initialTasks": "y"},
        format="json",
    )
    manager.post(f"{base}bulletin/complete/")
    resp = manager.post(f"{base}recon/import-from-passport/")
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "NO_PASSPORT_VERSION"


def test_mutations_require_manage(viewer, manager):
    obj = make_object()
    event_id = create_event(manager, obj).json()["id"]
    resp = viewer.patch(
        f"{URL}{event_id}/bulletin/",
        {"briefDescription": "x", "initialTasks": "y"},
        format="json",
    )
    assert resp.status_code == 403
    # чтение реестра и карточки наблюдателю открыто
    assert viewer.get(URL).status_code == 200
    assert viewer.get(f"{URL}{event_id}/").status_code == 200


def test_unknown_event_is_enveloped_404(manager):
    resp = manager.get(f"{URL}999999/")
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "ENTITY_NOT_FOUND"
