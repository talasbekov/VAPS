"""Срез B1: /api/ops/security-events/ + /api/ops/personnel/ — жизненный цикл ОМ.

bulletin → recon → demand → forces → placement → approval → acknowledgement →
conduct → closed. Правила, коды и тексты — порт мок-слоя клиента
(mocks/ops/security-events-handlers.ts): он был первой реализацией контракта,
и карточка написана под его исходы. Сквозной тест ведёт ОДНО ОМ через все
девять стадий: цепочка целиком, а не девять изолированных проверок, — иначе
выход одной стадии никогда не встретился бы со входом следующей.
"""
import pytest
from django.db.utils import IntegrityError

from organization_management.apps.dictionaries.models import Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.audit_service import (
    SECURITY_EVENT_CLOSED,
    SECURITY_EVENT_CREATED,
    SECURITY_EVENT_STAGE_OVERRIDDEN,
)
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventTransition,
    OpsSecurityEventVisitObject,
)
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
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
        ownership=OpsSecurityObject.Ownership.GUARDED,
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


def create_event(
    api, obj, title="Визит делегации", business_date="2026-08-10", **extra
):
    return api.post(
        URL,
        {
            "title": title,
            "objectId": str(obj.pk),
            "businessDate": business_date,
            "kind": "INTERNAL",
            **extra,
        },
        format="json",
    )


# ── Создание и реестр ────────────────────────────────────────────────────────


def test_create_binds_applicable_passport_version(manager):
    obj = make_object(with_passport=True)
    resp = create_event(manager, obj)
    assert resp.status_code == 201
    data = resp.json()
    # ОМ с объектом заводится СРАЗУ на рекогносцировке (Plane «Реестр ОМ-5»):
    # рекогносцировка — первый шаг эталонной цепочки, а бюллетень своего шага
    # не имеет с 24.08.2026 и правится панелью над этапами.
    assert data["stage"] == "RECON"
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
    """Обязательны название, дата и тип. Объект — НЕТ (решение 24.08).

    Пустой objectId в списке ошибок больше не ждём: бюллетень заводят до
    согласования маршрута, а объекты дописывают позже (ClickUp 86eyqf7a7).
    """
    resp = manager.post(
        URL,
        {"title": " ", "objectId": "", "businessDate": "10.08.2026"},
        format="json",
    )
    assert resp.status_code == 400
    assert set(resp.json()["details"]) == {"title", "businessDate", "kind"}


def test_create_without_object(manager):
    """ОМ без объекта заводится: ни привязки, ни объекта посещения.

    Пустое имя объекта — «не выбран», а не «объект без названия»; раскрытие
    строки реестра у такого ОМ честно пусто, и объекты добавляются кнопкой.
    """
    resp = manager.post(
        URL,
        {
            "title": "Визит без маршрута",
            "businessDate": "2026-08-10",
            "kind": "INTERNAL",
        },
        format="json",
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["objectId"] is None
    assert data["objectName"] == ""
    assert data["passportBinding"] is None
    assert data["visitObjects"] == []
    # Осматривать нечего — ОМ остаётся на «Бюллетене» (Plane «Реестр ОМ-5»).
    assert data["stage"] == "BULLETIN"

    # Импорт постов из паспорта у такого ОМ отвечает СВОИМ отказом, а не 500.
    base = f"{URL}{data['id']}/"
    manager.patch(
        f"{base}bulletin/",
        {"briefDescription": "x", "initialTasks": "y"},
        format="json",
    )
    manager.post(f"{base}bulletin/complete/")
    failed = manager.post(f"{base}recon/import-from-passport/")
    assert failed.status_code == 422
    assert failed.json()["error_code"] == "NO_PASSPORT_VERSION"


def test_create_with_unknown_object_still_refused(manager):
    """Необязательное поле не значит «любое значение»: чужой id — ошибка."""
    resp = manager.post(
        URL,
        {
            "title": "Визит",
            "objectId": "9999",
            "businessDate": "2026-08-10",
            "kind": "INTERNAL",
        },
        format="json",
    )
    assert resp.status_code == 400
    assert resp.json()["details"]["objectId"] == ["Объект не найден в реестре."]


def test_create_carries_bulletin_fields(manager):
    """Поля бюллетеня эталона доезжают до строки и обратно в контракт.

    До 23.08.2026 окно создания собирало только название, объект и даты:
    тип мероприятия, время, охраняемое лицо, локация и старший в форме
    прототипа есть, а хранить их было негде — введённое пропадало.
    """
    person = OpsProtectedPerson.objects.create(
        name="А. Тлеубердиев",
        callsign="Беркут",
        category=OpsProtectedPerson.Category.FOREIGN,
    )
    chief = make_employee(last_name="Нуртаев", first_name="Санжар")
    resp = create_event(
        manager,
        make_object(with_passport=True),
        kind="FOREIGN",
        eventTime="09:30",
        protectedPersonId=str(person.pk),
        location="г. Алматы",
        chiefEmployeeId=str(chief.pk),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["kind"] == "FOREIGN"
    assert data["eventTime"] == "09:30"
    assert data["protectedPersonId"] == str(person.pk)
    assert data["location"] == "г. Алматы"
    assert data["chiefEmployeeId"] == str(chief.pk)
    # Подписи — снимок рядом со ссылкой: скрытие лица из справочника или
    # увольнение старшего не должны стирать имя из истории мероприятия.
    assert data["protectedPersonName"] == "А. Тлеубердиев"
    assert data["chiefName"] == "Нуртаев С."


def test_create_optional_bulletin_fields_stay_empty(manager):
    """Незаполненные поля остаются пустыми, а не подставляются за автора."""
    resp = create_event(manager, make_object())
    assert resp.status_code == 201
    data = resp.json()
    assert data["eventTime"] is None
    assert data["protectedPersonId"] is None
    assert data["chiefEmployeeId"] is None
    assert data["protectedPersonName"] == ""
    assert data["chiefName"] == ""
    assert data["location"] == ""


@pytest.mark.parametrize(
    "payload,field",
    [
        ({"kind": "OUTER"}, "kind"),
        ({"eventTime": "25:00"}, "eventTime"),
        ({"protectedPersonId": "999999"}, "protectedPersonId"),
        ({"chiefEmployeeId": "999999"}, "chiefEmployeeId"),
    ],
)
def test_create_rejects_bad_bulletin_fields(manager, payload, field):
    resp = create_event(manager, make_object(), **payload)
    assert resp.status_code == 400
    assert field in resp.json()["details"]


def test_create_rejects_inactive_protected_person(manager):
    """Скрытое лицо не выбирается: справочник отдаёт только активные."""
    hidden = OpsProtectedPerson.objects.create(
        name="Б. Скрытый",
        category=OpsProtectedPerson.Category.OURS,
        is_active=False,
    )
    resp = create_event(
        manager, make_object(), protectedPersonId=str(hidden.pk)
    )
    assert resp.status_code == 400
    assert "protectedPersonId" in resp.json()["details"]


def test_create_requires_manage(viewer):
    obj = make_object()
    assert create_event(viewer, obj).status_code == 403


def test_owner_name_is_personnel_name_not_account_id():
    """«Ответственный за ОМ» читает человек — там ФИО, а не id учётки.

    Идентификатор актора остаётся у аудита: там он и нужен, а на экране
    карточки и в значениях фильтра реестра стояло «1».
    """
    api, user = client_for(
        "ev-owner", "EV_OWNER", perms=("event.view", "event.manage")
    )
    employee = make_employee(last_name="Сеитов", first_name="Алихан")
    employee.user = user
    employee.save(update_fields=["user"])

    resp = create_event(api, make_object(with_passport=True))
    assert resp.status_code == 201
    assert resp.json()["ownerName"] == "Сеитов А."
    assert resp.json()["ownerName"] != str(user.pk)
    # Аудит по-прежнему хранит идентификатор, а не подпись
    row = OpsAuditLog.objects.get(action=SECURITY_EVENT_CREATED)
    assert row.actor_user_id == str(user.pk)


def test_owner_name_falls_back_to_username_without_personnel_record():
    """Привязки `Employee.user` у части учёток нет (сид её не заполняет) —
    username там штатный исход, а не аварийный."""
    api, _ = client_for(
        "ev-nolink", "EV_NOLINK", perms=("event.view", "event.manage")
    )
    assert create_event(api, make_object(with_passport=True)).status_code == 201

    data = api.get(URL).json()
    assert data["results"][0]["ownerName"] == "ev-nolink"
    # Значения фильтра «ответственный» собираются из тех же строк
    assert data["owners"] == ["ev-nolink"]


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

    # ОМ с объектом стартует с рекогносцировки — завершать бюллетень нечего:
    # своего шага у него нет, и сервер отвечает отказом «не на этом этапе».
    resp = manager.post(f"{base}bulletin/complete/")
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "INVALID_STAGE_TRANSITION"
    # Сведения бюллетеня при этом правятся на любой стадии — панель над
    # этапами живёт всю жизнь ОМ.
    resp = manager.patch(
        f"{base}bulletin/",
        {"briefDescription": "Обеспечение визита.", "initialTasks": "Усиление."},
        format="json",
    )
    assert resp.status_code == 200
    data = resp.json()
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


# ── Объекты посещения ────────────────────────────────────────────────────────


def test_create_seeds_visit_object_from_bulletin(manager):
    """Объект, выбранный в окне создания, становится объектом посещения.

    Реестр раскрывает строку мероприятия ИМЕННО этим списком: пустой список у
    только что заведённого ОМ читался бы как «объекты не заведены».
    """
    obj = make_object(with_passport=True)
    person = OpsProtectedPerson.objects.create(
        name="Ахметов Т. Б.", category=OpsProtectedPerson.Category.OURS
    )
    data = create_event(
        manager, obj, protectedPersonId=str(person.pk)
    ).json()

    assert len(data["visitObjects"]) == 1
    visit = data["visitObjects"][0]
    assert visit["objectId"] == str(obj.pk)
    assert visit["objectName"] == "Резиденция"
    assert visit["protectedPersonId"] == str(person.pk)
    assert visit["protectedPersonName"] == "Ахметов Т. Б."
    assert visit["passportBinding"]["versionNumber"] == 1
    assert visit["position"] == 0
    # Расчёт постов ещё не делался: «ноль постов», а не «неизвестно».
    assert visit["placementNeed"] == 0
    assert visit["placementAssigned"] == 0


def test_visit_object_placement_counts_posts_and_assignments(manager):
    """Готовность расстановки единственного объекта = его посты и назначения.

    Числа берутся из расчёта постов и назначений мероприятия, а не из
    readinessPercent стадии: «готовность расстановки» — это сколько постов
    закрыто людьми, а не как далеко ушло ОМ по этапам.
    """
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
    posts = data["reconSectorPosts"]
    assert len(posts) == 1
    posts[0]["need"] = 2

    data = manager.patch(
        f"{base}recon/",
        {"checklist": data["reconChecklist"], "sectorPosts": posts},
        format="json",
    ).json()
    visit = data["visitObjects"][0]
    assert (visit["placementNeed"], visit["placementAssigned"]) == (2, 0)

    data = manager.post(
        f"{base}placement/assign/",
        {"postId": posts[0]["id"], "employeeId": str(employee.pk)},
        format="json",
    ).json()
    visit = data["visitObjects"][0]
    assert (visit["placementNeed"], visit["placementAssigned"]) == (2, 1)


def test_second_visit_object_without_post_mapping_reports_unknown(manager):
    """Пока посты не размечены по объектам, готовность ВТОРОГО — неизвестна.

    Общий расчёт нельзя ни отнести целиком к каждому объекту (число задвоится),
    ни поделить поровну (такого факта в системе нет). Размеченные строки при
    этом считаются точно — по своему объекту.
    """
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    manager.patch(
        f"{base}bulletin/",
        {"briefDescription": "x", "initialTasks": "y"},
        format="json",
    )
    manager.post(f"{base}bulletin/complete/")
    data = manager.post(f"{base}recon/import-from-passport/").json()
    manager.patch(
        f"{base}recon/",
        {
            "checklist": data["reconChecklist"],
            "sectorPosts": data["reconSectorPosts"],
        },
        format="json",
    )

    second_object = make_object(code="OBJ-2", name="Концертный зал")
    second = OpsSecurityEventVisitObject.objects.create(
        event_id=event_id,
        security_object=second_object,
        object_name=second_object.name,
        passport_binding=None,
        position=1,
    )

    visits = manager.get(f"{base}").json()["visitObjects"]
    assert [v["objectName"] for v in visits] == ["Резиденция", "Концертный зал"]
    assert visits[0]["placementNeed"] is None
    assert visits[1]["placementNeed"] is None

    # Размечаем единственный пост за вторым объектом — его готовность
    # становится известной, у первого остаётся неизвестной.
    event = OpsSecurityEvent.objects.get(pk=event_id)
    event.recon_sector_posts[0]["visitObjectId"] = str(second.pk)
    event.save(update_fields=["recon_sector_posts"])

    visits = manager.get(f"{base}").json()["visitObjects"]
    assert visits[0]["placementNeed"] is None
    assert (visits[1]["placementNeed"], visits[1]["placementAssigned"]) == (1, 0)


def test_same_object_not_added_to_event_twice(manager):
    """Один объект реестра — одна строка посещения в мероприятии."""
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    with pytest.raises(IntegrityError):
        OpsSecurityEventVisitObject.objects.create(
            event_id=event_id,
            security_object=obj,
            object_name=obj.name,
            passport_binding=None,
            position=1,
        )


def test_add_visit_object_binds_passport_and_person(manager):
    """Объект дописывается к бюллетеню позже — с привязкой и своим лицом.

    Заказчик заводит ОМ, когда маршрут ещё не согласован, и дописывает объекты
    по мере уточнения; привязка версии паспорта считается на дату ОМ так же,
    как при создании.
    """
    obj = make_object(with_passport=True)
    second = make_object(code="OBJ-2", name="Концертный зал", with_passport=True)
    person = OpsProtectedPerson.objects.create(
        name="Ким Е. С.", category=OpsProtectedPerson.Category.OURS
    )
    event_id = create_event(manager, obj).json()["id"]

    resp = manager.post(
        f"{URL}{event_id}/visit-objects/",
        {"objectId": str(second.pk), "protectedPersonId": str(person.pk)},
        format="json",
    )
    assert resp.status_code == 201
    visits = resp.json()["visitObjects"]
    assert [v["objectName"] for v in visits] == ["Резиденция", "Концертный зал"]
    assert [v["position"] for v in visits] == [0, 1]
    added = visits[1]
    assert added["protectedPersonName"] == "Ким Е. С."
    assert added["passportBinding"]["versionNumber"] == 1


def test_add_visit_object_rejects_duplicate_and_unknown(manager):
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]

    # Тот же объект второй раз — беда поля, а не конверт про ограничение базы.
    resp = manager.post(
        f"{URL}{event_id}/visit-objects/",
        {"objectId": str(obj.pk)},
        format="json",
    )
    assert resp.status_code == 400
    assert resp.json()["details"]["objectId"] == [
        "Этот объект уже добавлен в мероприятие."
    ]

    resp = manager.post(
        f"{URL}{event_id}/visit-objects/", {"objectId": "9999"}, format="json"
    )
    assert resp.status_code == 400
    assert resp.json()["details"]["objectId"] == ["Объект не найден в реестре."]


def test_remove_visit_object(manager):
    obj = make_object(with_passport=True)
    second = make_object(code="OBJ-2", name="Концертный зал")
    event_id = create_event(manager, obj).json()["id"]
    added = manager.post(
        f"{URL}{event_id}/visit-objects/",
        {"objectId": str(second.pk)},
        format="json",
    ).json()["visitObjects"][1]

    resp = manager.delete(f"{URL}{event_id}/visit-objects/{added['id']}/")
    assert resp.status_code == 200
    assert [v["objectName"] for v in resp.json()["visitObjects"]] == ["Резиденция"]

    # Повторное удаление — 404 с конвертом, а не тихий успех.
    resp = manager.delete(f"{URL}{event_id}/visit-objects/{added['id']}/")
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "ENTITY_NOT_FOUND"


def test_remove_visit_object_with_posts_is_refused(manager):
    """Объект с постами в расчёте не удаляется молча — посты осиротели бы."""
    obj = make_object(with_passport=True)
    second = make_object(code="OBJ-2", name="Концертный зал")
    event_id = create_event(manager, obj).json()["id"]
    added = manager.post(
        f"{URL}{event_id}/visit-objects/",
        {"objectId": str(second.pk)},
        format="json",
    ).json()["visitObjects"][1]

    event = OpsSecurityEvent.objects.get(pk=event_id)
    event.recon_sector_posts = [
        {
            "id": "post-1",
            "sector": "Периметр",
            "post": "Пост 1",
            "task": "",
            "need": 1,
            "requirements": "",
            "result": None,
            "comment": "",
            "sourceSectorId": None,
            "sourcePostId": None,
            "minRating": None,
            "visitObjectId": added["id"],
        }
    ]
    event.save(update_fields=["recon_sector_posts"])

    resp = manager.delete(f"{URL}{event_id}/visit-objects/{added['id']}/")
    assert resp.status_code == 422
    assert "посты в расчёте" in resp.json()["message"]
    assert OpsSecurityEventVisitObject.objects.filter(pk=added["id"]).exists()


def test_visit_objects_need_manage_permission(viewer, manager):
    """Право на просмотр реестра не даёт править маршрут мероприятия."""
    obj = make_object(with_passport=True)
    second = make_object(code="OBJ-2", name="Концертный зал")
    event_id = create_event(manager, obj).json()["id"]

    resp = viewer.post(
        f"{URL}{event_id}/visit-objects/",
        {"objectId": str(second.pk)},
        format="json",
    )
    assert resp.status_code == 403


# ── Заведение объекта из окна создания ОМ ────────────────────────────────────


def test_create_object_from_event_dialog(manager):
    """«Объекта нет в списке — добавить»: минимальная карточка, код по порядку.

    Паспорт у новой карточки НЕ оформлен — это факт: секторы и посты заводит
    владелец объекта, и привязывать к мероприятию до публикации версии нечего.
    """
    make_object(code="OBJ-1", name="Резиденция")
    api, _ = client_for(
        "obj-manager", "OBJ_MANAGER", perms=("object.view", "object.manage")
    )
    resp = api.post(
        "/api/ops/objects/",
        {
            "name": "Новый концертный зал",
            "objectType": "Культура",
            "region": "г. Астана",
            "address": "ул. Кунаева, 1",
        },
        format="json",
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Новый концертный зал"
    assert data["code"] == "OBJ-002"
    assert data["passportState"] == "RED"
    assert data["objectState"] == "ACTIVE"

    # Заведённый объект сразу виден в списке выбора окна создания ОМ.
    listed = manager.get("/api/ops/security-events/bindable-objects/").json()
    assert data["id"] in [row["id"] for row in listed["results"]]


def test_create_object_refuses_blank_and_duplicate_name(manager):
    make_object(code="OBJ-1", name="Резиденция")
    api, _ = client_for(
        "obj-manager2", "OBJ_MANAGER2", perms=("object.view", "object.manage")
    )
    resp = api.post("/api/ops/objects/", {"name": "  "}, format="json")
    assert resp.status_code == 400
    assert resp.json()["details"]["name"] == ["Обязательное поле."]

    # Тёзка — почти всегда повтор ввода: две одинаковые строки в списке
    # выбора потом неразличимы.
    resp = api.post("/api/ops/objects/", {"name": "резиденция"}, format="json")
    assert resp.status_code == 400
    assert resp.json()["details"]["name"] == [
        "Объект с таким названием уже есть в реестре."
    ]


def test_create_object_needs_manage_permission(manager):
    """Право вести мероприятия не даёт заводить объекты в реестре."""
    resp = manager.post(
        "/api/ops/objects/", {"name": "Чужой объект"}, format="json"
    )
    assert resp.status_code == 403


# ── Перевод на любой этап (админ) ────────────────────────────────────────────


@pytest.fixture
def stage_admin():
    """Персона с правом обхода. ОТДЕЛЬНАЯ от manager: весь смысл проб ниже в
    том, что право обхода не выводится из права вести мероприятие."""
    api, _ = client_for(
        "ev-stage-admin",
        "EV_STAGE_ADMIN",
        perms=("event.view", "event.manage", "event.stage_override"),
    )
    return api


def test_stage_override_jumps_forward_and_back(stage_admin):
    """Админ проходит цепочку в любом порядке, не выполняя условий этапов."""
    obj = make_object(with_passport=True)
    event_id = create_event(stage_admin, obj).json()["id"]
    url = f"{URL}{event_id}/stage/"

    # Прыжок ЧЕРЕЗ этапы: с рекогносцировки сразу на согласование. По правилам
    # цепочки сюда нельзя — ни расчёта постов, ни расстановки нет.
    resp = stage_admin.post(url, {"stage": "APPROVAL"}, format="json")
    assert resp.status_code == 200
    assert resp.json()["stage"] == "APPROVAL"
    # Готовность едет за стадией — иначе карточка показывала бы 0% на
    # согласовании.
    assert resp.json()["readinessPercent"] == 75
    # Ассерт из БАЗЫ, а не из ответа: ответ мог бы собраться из входа.
    event = OpsSecurityEvent.objects.get(pk=event_id)
    assert event.stage == "APPROVAL"

    # И назад — на рекогносцировку.
    resp = stage_admin.post(url, {"stage": "RECON"}, format="json")
    assert resp.status_code == 200
    assert OpsSecurityEvent.objects.get(pk=event_id).stage == "RECON"

    # Журнал переходов различает направление: возврат не должен считаться
    # прогрессом воронки.
    kinds = list(
        OpsSecurityEventTransition.objects.filter(event_id=event_id)
        .order_by("id")
        .values_list("from_stage", "to_stage", "kind")
    )
    # Первая строка журнала — заведение ОМ (None → BULLETIN), она не наша:
    # сверяем ХВОСТ, а не весь список, иначе проба ломалась бы от любого
    # нового перехода, записанного при создании.
    assert kinds[-2:] == [
        ("RECON", "APPROVAL", "FORWARD"),
        ("APPROVAL", "RECON", "RETURN"),
    ]

    # Обход условий — решение человека, и он поимённо в журнале мутаций.
    rows = OpsAuditLog.objects.filter(action=SECURITY_EVENT_STAGE_OVERRIDDEN)
    assert rows.count() == 2
    assert rows.order_by("id").first().new_value["stage"] == "APPROVAL"


def test_stage_override_needs_its_own_permission(manager):
    """Право вести мероприятие НЕ даёт обходить этапы."""
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    resp = manager.post(
        f"{URL}{event_id}/stage/", {"stage": "APPROVAL"}, format="json"
    )
    assert resp.status_code == 403
    # Отказ обязан быть без последствий: стадия осталась прежней (у ОМ с
    # объектом это стадия заведения — RECON).
    assert OpsSecurityEvent.objects.get(pk=event_id).stage == "RECON"


def test_stage_override_refuses_closed_and_unknown(stage_admin):
    """Закрытие — по итогам, а не переводом; неизвестная стадия — ошибка поля."""
    obj = make_object(with_passport=True)
    event_id = create_event(stage_admin, obj).json()["id"]
    url = f"{URL}{event_id}/stage/"

    # CLOSED завёл бы архив без итогов направлений и без времени закрытия.
    resp = stage_admin.post(url, {"stage": "CLOSED"}, format="json")
    assert resp.status_code == 400
    assert resp.json()["details"]["stage"] == ["Недопустимый этап для перевода."]

    for bad in ("FORCES", "ЧТО-ТО", ""):
        assert stage_admin.post(url, {"stage": bad}, format="json").status_code == 400
    assert OpsSecurityEvent.objects.get(pk=event_id).stage == "RECON"


def test_stage_override_to_current_stage_writes_nothing(stage_admin):
    """Повтор запроса не должен писать переход из этапа в него же."""
    obj = make_object(with_passport=True)
    event_id = create_event(stage_admin, obj).json()["id"]
    url = f"{URL}{event_id}/stage/"
    stage_admin.post(url, {"stage": "RECON"}, format="json")
    before = OpsSecurityEventTransition.objects.filter(event_id=event_id).count()

    resp = stage_admin.post(url, {"stage": "RECON"}, format="json")
    assert resp.status_code == 200
    assert resp.json()["stage"] == "RECON"
    assert (
        OpsSecurityEventTransition.objects.filter(event_id=event_id).count() == before
    )


def test_stage_override_out_of_closed_clears_closed_at(stage_admin):
    """Возврат из закрытия снимает время закрытия, но не стирает итоги."""
    obj = make_object(with_passport=True)
    event_id = create_event(stage_admin, obj).json()["id"]
    event = OpsSecurityEvent.objects.get(pk=event_id)
    event.stage = "CLOSED"
    event.closed_at = "2026-08-20T10:00:00+00:00"
    event.closure_direction_summaries = [
        {"direction": "Периметр", "summary": "без замечаний"}
    ]
    event.save()

    resp = stage_admin.post(
        f"{URL}{event_id}/stage/", {"stage": "CONDUCT"}, format="json"
    )
    assert resp.status_code == 200
    event.refresh_from_db()
    assert event.stage == "CONDUCT"
    # Живое мероприятие со штампом «закрыто в …» врало бы в карточке и выгрузках.
    assert event.closed_at is None
    # А собранные итоги — факт, а не следствие стадии: они остаются.
    assert event.closure_direction_summaries == [
        {"direction": "Периметр", "summary": "без замечаний"}
    ]


def test_event_with_object_opens_on_recon(manager):
    """Задача заказчика «Реестр ОМ-5»: ОМ с объектом открывается СРАЗУ
    рекогносцировкой — ни стадии «Бюллетень», ни лишнего клика «Открыть
    рекогносцировку» у него нет.

    Проверяется не только поле ответа: рекогносцировка должна ПРИНИМАТЬ
    правку сразу после заведения — иначе «открылась» означало бы только
    подпись, а форма получала бы отказ этапа.
    """
    obj = make_object(with_passport=True)
    data = create_event(manager, obj).json()
    assert (data["stage"], data["readinessPercent"]) == ("RECON", 15)

    event = OpsSecurityEvent.objects.get(pk=data["id"])
    assert event.stage == "RECON"
    # Вход в цепочку записан рекогносцировкой, а не бюллетенем.
    entry = OpsSecurityEventTransition.objects.get(event=event, from_stage=None)
    assert (entry.to_stage, entry.kind) == ("RECON", "FORWARD")

    base = f"{URL}{data['id']}/"
    saved = manager.patch(
        f"{base}recon/",
        {
            "checklist": data["reconChecklist"],
            "sectorPosts": [
                {
                    "id": "recon-local-1",
                    "sector": "Сектор A",
                    "post": "Пост 1",
                    "task": "Досмотр",
                    "need": 2,
                    "requirements": "",
                    "result": None,
                    "comment": "",
                }
            ],
        },
        format="json",
    )
    assert saved.status_code == 200
    assert [row["post"] for row in saved.json()["reconSectorPosts"]] == ["Пост 1"]


def test_bulletin_complete_opens_recon_when_object_present(manager):
    """ОМ, заведённые ДО правила (стадия «Бюллетень») и имеющие объект, тоже
    открывают рекогносцировку без заполненного бюллетеня: гейт держит объект,
    а не текст. Без объекта текст остаётся условием — старшему наряда больше
    ничего не приходит до выезда."""
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    # Возвращаем ОМ в состояние «до правила» напрямую: сервисом такой стадии
    # у ОМ с объектом больше не получить.
    OpsSecurityEvent.objects.filter(pk=event_id).update(
        stage="BULLETIN", brief_description="", initial_tasks=""
    )
    resp = manager.post(f"{URL}{event_id}/bulletin/complete/")
    assert resp.status_code == 200
    assert resp.json()["stage"] == "RECON"

    # А ОМ без объекта — по-прежнему через заполненный бюллетень.
    bare = manager.post(
        URL,
        {"title": "Без маршрута", "businessDate": "2026-08-10", "kind": "INTERNAL"},
        format="json",
    ).json()
    refused = manager.post(f"{URL}{bare['id']}/bulletin/complete/")
    assert refused.status_code == 422
    assert refused.json()["error_code"] == "BULLETIN_INCOMPLETE"
