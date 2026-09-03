"""Срез B1: /api/ops/security-events/ + /api/ops/personnel/ — жизненный цикл ОМ.

bulletin → recon → demand → forces → placement → approval → acknowledgement →
conduct → closed. Правила, коды и тексты — порт мок-слоя клиента
(mocks/ops/security-events-handlers.ts): он был первой реализацией контракта,
и карточка написана под его исходы. Сквозной тест ведёт ОДНО ОМ через все
девять стадий: цепочка целиком, а не девять изолированных проверок, — иначе
выход одной стадии никогда не встретился бы со входом следующей.
"""
from datetime import date

import pytest
from django.db.utils import IntegrityError

from organization_management.apps.dictionaries.models import Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.audit_service import (
    SECURITY_EVENT_CLOSED,
    SECURITY_EVENT_CREATED,
    SECURITY_EVENT_DELETED,
    SECURITY_EVENT_DEPUTY_ASSIGNED,
    SECURITY_EVENT_DEPUTY_REVOKED,
    SECURITY_EVENT_PLACEMENT_BY_DEPUTY,
    SECURITY_EVENT_STAGE_OVERRIDDEN,
)
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventTransition,
    OpsSecurityEventVisitObject,
    OpsVisitObjectDeputy,
)
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
from organization_management.apps.operations.models_object import (
    OpsObjectSector,
    OpsPassportVersion,
    OpsSecurityObject,
    OpsSecurityPost,
)
from organization_management.apps.ops.api.views import OpsPersonnelViewSet
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
    # Права цепочки сбора сил и расстановки выданы РЯДОМ с `event.manage`, а не
    # вместо него: ровно так их раздаёт бэкфилл миграции 0047 (Plane №74) —
    # каждая роль, которая вела цепочку через `event.manage`, сохраняет к ней
    # доступ через новые коды. Фикстура изображает того же человека, и
    # разойтись с миграцией она не имеет права.
    #
    # Разграничение проверяют СВОИ пробы (`test_scoped_permission`,
    # `test_ops_forces_scope`): там роль выдаётся с областью и отбивается на
    # чужой. Здесь проверяется работа цепочки, а не её гейт.
    api, _ = client_for(
        "ev-manager",
        "EV_MANAGER",
        perms=(
            "event.view",
            # Каталоги раздела (охраняемые лица, нормативная база) с
            # 28.08.2026 под своим правом (Plane №267). Ведущий мероприятие
            # их видит — в принятой модели `catalog.view` входит в базовое
            # чтение раздела у всех рабочих ролей.
            "catalog.view",
            "event.manage",
            # Свои права с Plane №382: ведущий мероприятие заводит карточку и
            # заполняет бюллетень, и разделение не должно у него ничего отнять.
            "event.create",
            "event.bulletin",
            "forces.command",
            "forces.allocate",
            "forces.select",
            "placement.manage",
        ),
    )
    return api


@pytest.fixture
def viewer():
    api, _ = client_for("ev-viewer", "EV_VIEWER", perms=("event.view",))
    return api


@pytest.fixture
def approver_client(approver):
    """Тот же согласующий под другим именем: в сквозном проходе переменная
    `approver` уже занята СТРОКОЙ МАРШРУТА, и фикстура затенила бы её."""
    return approver


@pytest.fixture
def approver():
    """Утверждающий: ВИДИТ расстановку и решает по ней, но не правит.

    Решение заказчика 28.08.2026 (Plane №267): «утверждающий только видит всю
    расстановку, но изменять не может, только согласовать или отклонить с
    комментарием». Поэтому у него нет `event.manage` — и это не упущение
    фикстуры, а сам предмет разграничения: с ним он смог бы переписать то,
    что подписывает.
    """
    api, _ = client_for(
        "ev-approver",
        "EV_APPROVER",
        perms=("event.view", "assignment.approve", "assignment.return"),
    )
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
    # 🔴 ПИН ПРАВЛЕН ОСОЗНАННО (Plane №408). Раньше импорт спотыкался о
    # ПАСПОРТ мероприятия и отвечал «нет опубликованной версии»; теперь посты
    # принадлежат объекту посещения, и у ОМ без объектов дело до паспорта не
    # доходит вовсе — отказ называет настоящую причину. Оба отказа 422, и
    # проверяется здесь именно то же самое: без объекта импортировать нечего.
    assert failed.json()["error_code"] == "VISIT_OBJECT_REQUIRED"


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
        "ev-owner", "EV_OWNER", perms=("event.view", "event.manage", "event.create", "event.bulletin")
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
        "ev-nolink", "EV_NOLINK", perms=("event.view", "event.manage", "event.create", "event.bulletin")
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
    # Ответ ВСЕГДА страница (Plane №61): безстраничной ветки у ручки больше нет.
    assert data["count"] == 1
    # Форма ответа ОДНА на оба случая (Plane №65, «Р-2»): без
    # `business_date` статус равен null и означает «не спрашивали». Две формы
    # заставили бы читателя гадать, что ему пришло, поэтому ключи стоят
    # всегда — пин расширен ОСОЗНАННО, а не подогнан под новый вывод.
    assert data["results"] == [
        {
            "id": str(employee.pk),
            "name": "Абенов С.",
            "rankLabel": "Майор",
            "unit": "Отдел охраны объектов",
            "statusCode": None,
            "statusLabel": None,
        }
    ]


def test_personnel_search_and_pagination_on_the_server(manager):
    """Поиск и постраничка кадрового списка идут НА СЕРВЕР («Реестр ОМ-35.3»).

    Требование заказчика — «выпадающий список с пагинацией сотрудников с
    возможностью поиска». Поиск обязан идти сюда: фильтр по загруженной
    странице отвечал бы «такого нет», имея в виду «нет на этой странице».

    Проба держит и обратную половину контракта: ответ ВСЕГДА в конверте
    постранички, даже без параметров (Plane №61). Пока безстраничная ветка
    существовала, четыре экрана читали снимок целиком и фильтровали его на
    клиенте — два способа читать один список расходятся молча.
    """
    division = Division.objects.create(
        name="Отдел охраны объектов", code="D-OO", division_type="division"
    )
    people = [
        make_employee(last_name=name, first_name="Иван")
        for name in ("Абенов", "Битен", "Ваулин", "Гуров", "Дюсенов")
    ]
    StaffUnit.objects.create(division=division, employee=people[0], index=1)

    # Без параметров — ПЕРВАЯ страница размером с потолок, и она объявляет
    # `count`: клиент видит, что показано не всё, а не думает, что это весь
    # кадровый список.
    plain = manager.get("/api/ops/personnel/").json()
    assert len(plain["results"]) == 5
    assert plain["count"] == 5
    assert plain["next"] is None

    # Страница — ровно своего размера, с номерами соседних страниц.
    first = manager.get("/api/ops/personnel/?page_size=2").json()
    assert [p["name"] for p in first["results"]] == ["Абенов И.", "Битен И."]
    assert first["count"] == 5
    assert first["next"] == "2"
    assert first["previous"] is None

    third = manager.get("/api/ops/personnel/?page=3&page_size=2").json()
    assert [p["name"] for p in third["results"]] == ["Дюсенов И."]
    # Последняя страница НЕ обещает следующую: иначе список листался бы в
    # пустоту.
    assert third["next"] is None
    assert third["previous"] == "2"

    # Поиск сужает ВСЮ выборку, а не страницу: count тоже про найденное.
    found = manager.get("/api/ops/personnel/?search=улин&page_size=2").json()
    assert [p["name"] for p in found["results"]] == ["Ваулин И."]
    assert found["count"] == 1

    # Искать можно и по подразделению — оно видно в строке списка.
    by_unit = manager.get(
        "/api/ops/personnel/?search=охраны объектов&page_size=10"
    ).json()
    assert [p["name"] for p in by_unit["results"]] == ["Абенов И."]

    # Мусор в параметрах не роняет ручку — страница по умолчанию.
    junk = manager.get("/api/ops/personnel/?page=abc&page_size=xyz").json()
    assert junk["count"] == 5
    assert len(junk["results"]) == 5


def test_personnel_page_size_has_a_ceiling(manager):
    """`?page_size=1000000` не отдаёт кадры целиком: потолок ставит сервер.

    Проба заводит БОЛЬШЕ сотрудников, чем потолок: на пяти строках «обрезано»
    и «столько и было» неразличимы, и ассерт был бы вакуумным.
    """
    ceiling = OpsPersonnelViewSet.MAX_PAGE_SIZE
    Employee.objects.bulk_create(
        [
            Employee(
                personnel_number=f"P-C{i:04d}",
                last_name=f"Кадр{i:04d}",
                first_name="Иван",
                birth_date="1990-01-01",
                gender="M",
                iin=str(960000000000 + i),
                hire_date="2015-01-01",
                employment_status="working",
            )
            for i in range(ceiling + 1)
        ]
    )

    capped = manager.get("/api/ops/personnel/?page_size=1000000").json()
    assert capped["count"] == ceiling + 1
    assert len(capped["results"]) == ceiling
    # Следующая страница ОБЕЩАНА: остаток за потолком не потерян.
    assert capped["next"] == "2"

    # И ЗАПРОС БЕЗ ПАРАМЕТРОВ упирается в тот же потолок (Plane №61). Это и
    # есть смысл снятой безстраничной ветки: раньше именно так — не прося
    # ничего — клиент получал всю кадровую базу одним ответом.
    plain = manager.get("/api/ops/personnel/").json()
    assert len(plain["results"]) == ceiling
    assert plain["next"] == "2"


# ── Сквозной проход всех девяти стадий ───────────────────────────────────────


def test_full_lifecycle_walkthrough(manager, approver_client):
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
    # Числа сотрудников на этапе никто не вводит (Plane №64 — запрос сил снят
    # с рекогносцировки): до завершения запрос пуст и штабу не виден.
    assert resp.json()["reconForceRequest"] == 0
    assert resp.json()["reconForceRequestedAt"] is None
    data = manager.post(f"{base}recon/complete/").json()
    # Завершение осмотра проводит ОМ через «Потребность» и «Запрос сил» и
    # оставляет на «Расстановке» (Plane №110): форм у этих двух стадий больше
    # нет, и человек их не проходит.
    assert (data["stage"], data["readinessPercent"]) == ("PLACEMENT", 60)
    # Штабу уходит РАСЧЁТ ПО ПОСТАМ, посчитанный сервером на завершении.
    assert data["reconForceRequest"] == sum(row["need"] for row in posts)
    assert data["reconForceRequestedAt"] is not None
    # Потребность собрана из расчёта постов, а не выдумана: строк столько же,
    # сколько постов, и сумма та же.
    assert data["demandApproved"] is True
    assert len(data["demandRows"]) == len(posts)
    assert data["forceNeed"] == sum(row["need"] for row in posts)
    assert len(data["forceRequests"]) == 1
    assert data["forceRequests"][0]["requestedCount"] == data["forceNeed"]
    # История переходов обязана показать, что пройденные стадии БЫЛИ: иначе
    # лента соврала бы про цепочку, по которой шло мероприятие.
    passed = list(
        OpsSecurityEventTransition.objects.filter(event_id=event_id)
        .order_by("id")
        .values_list("to_stage", flat=True)
    )
    assert passed[-3:] == ["DEMAND", "FORCES", "PLACEMENT"]

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
    resp = approver_client.post(f"{base}approval/return/", {"comment": ""}, format="json")
    assert resp.status_code == 400
    data = approver_client.post(
        f"{base}approval/return/", {"comment": "уточнить посты"}, format="json"
    ).json()
    assert (data["stage"], data["approvalStatus"]) == ("PLACEMENT", "RETURNED")
    assert data["approvalComment"] == "уточнить посты"
    data = manager.post(f"{base}placement/complete/").json()

    # Согласование по эталону («ОМ-37.3»): без маршрута и без отправки этап не
    # завершается — подпись под составом, которого согласующий не видел, это
    # не согласование.
    resp = approver_client.post(f"{base}approval/approve/")
    assert resp.json()["error_code"] == "APPROVAL_ROUTE_EMPTY"
    approver = manager.post(
        f"{base}approval/route/",
        {"name": "К. Оразов", "unit": "Департамент охраны", "position": "Зам."},
        format="json",
    ).json()["approvalRoute"][0]
    assert approver["status"] == "NOT_SENT"
    # Решать по неотправленному нечего.
    resp = approver_client.post(
        f"{base}approval/route/{approver['id']}/decide/",
        {"decision": "APPROVED", "comment": ""},
        format="json",
    )
    assert resp.json()["error_code"] == "APPROVAL_NOT_SENT"
    resp = approver_client.post(f"{base}approval/approve/")
    assert resp.json()["error_code"] == "APPROVAL_INCOMPLETE"

    data = manager.post(f"{base}approval/send/").json()
    assert data["approvalRoute"][0]["status"] == "PENDING"
    assert data["approvalStale"] is False
    # Возврат согласующего порождает замечание и блокирует завершение.
    data = approver_client.post(
        f"{base}approval/route/{approver['id']}/decide/",
        {"decision": "RETURNED", "comment": "уточнить пост 1"},
        format="json",
    ).json()
    remark = data["approvalRemarks"][0]
    assert (remark["text"], remark["resolved"]) == ("уточнить пост 1", False)
    resp = approver_client.post(f"{base}approval/approve/")
    assert resp.json()["error_code"] == "APPROVAL_RETURNED"

    data = manager.post(f"{base}approval/send/").json()
    data = approver_client.post(
        f"{base}approval/route/{approver['id']}/decide/",
        {"decision": "APPROVED", "comment": ""},
        format="json",
    ).json()
    # Комментарий согласования проставляет СЕРВЕР — его не спрашивают.
    assert data["approvalRoute"][0]["comment"] == "Без замечаний"
    # Замечание ещё открыто — этап не завершить.
    resp = approver_client.post(f"{base}approval/approve/")
    assert resp.json()["error_code"] == "APPROVAL_REMARKS_OPEN"
    manager.post(
        f"{base}approval/remarks/{remark['id']}/resolve/",
        {"resolved": True},
        format="json",
    )

    data = approver_client.post(f"{base}approval/approve/").json()
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
    # Id ручной строке выдаёт СЕРВЕР (Plane №30): «manual-1» — клиентская
    # пометка черновика, в сохранённом расчёте её нет. Оба id берутся из
    # ответа сохранения — так их и читает карточка.
    saved = manager.patch(
        f"{base}recon/",
        {"checklist": data["reconChecklist"], "sectorPosts": posts},
        format="json",
    ).json()["reconSectorPosts"]
    first_post, manual_post = saved[0]["id"], saved[1]["id"]
    assert manual_post != "manual-1"
    resp = manager.post(
        f"{base}placement/assign/",
        {"postId": first_post, "employeeId": str(employee.pk)},
        format="json",
    )
    assert resp.status_code == 200
    resp = manager.post(
        f"{base}placement/assign/",
        {"postId": manual_post, "employeeId": str(employee.pk)},
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

    # 🔴 РАЗМЕТКУ СНИМАЕМ НАМЕРЕННО (Plane №408). С этого шага импорт помечает
    # посты объектом, и «неразмеченный расчёт» сам собой больше не получается —
    # а правило про него ОСТАЛОСЬ и стережёт строки, заведённые раньше. Не
    # снять здесь значило бы тихо перестать его проверять.
    stored = OpsSecurityEvent.objects.get(pk=event_id)
    stored.recon_sector_posts = [
        {**row, "visitObjectId": None} for row in stored.recon_sector_posts
    ]
    stored.save(update_fields=["recon_sector_posts"])

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
    # 🔴 ПИН ПРАВЛЕН ОСОЗНАННО (Plane №409). Неразмеченных строк в расчёте не
    # осталось — значит про ПЕРВЫЙ объект теперь известно всё: постов у него
    # нет, и это НОЛЬ, а не «неизвестно». Раньше здесь стоял None, и объект,
    # которому ничего не расписали, выглядел так же, как объект, про который
    # нечего сказать. «Неизвестно» осталось ровно там, где оно правда: пока
    # хоть одна строка расчёта не размечена (ассерты выше).
    assert visits[0]["placementNeed"] == 0
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


def test_update_visit_object_day_and_note(manager):
    """День посещения и примечание правятся ручкой объекта, а не патчем сводки.

    До «Реестр ОМ-35.1» эти два факта жили свободным текстом патча ГВО, и
    список объектов там расходился со списком мероприятия. Проба держит
    ОБРАТНЫЙ путь тоже: пустой `visitDay` снимает день, возвращая объект в
    дату мероприятия, — это ответ, а не отсутствие ответа.
    """
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    visit_id = manager.get(f"{URL}{event_id}/").json()["visitObjects"][0]["id"]

    resp = manager.patch(
        f"{URL}{event_id}/visit-objects/{visit_id}/",
        {"visitDay": "2026-06-19", "note": "основной объект"},
        format="json",
    )
    assert resp.status_code == 200
    row = resp.json()["visitObjects"][0]
    assert row["visitDay"] == "2026-06-19"
    assert row["note"] == "основной объект"
    # Из базы, а не из ответа: правка должна была лечь в строку.
    saved = OpsSecurityEventVisitObject.objects.get(pk=visit_id)
    assert saved.visit_day.isoformat() == "2026-06-19"
    assert saved.note == "основной объект"

    resp = manager.patch(
        f"{URL}{event_id}/visit-objects/{visit_id}/",
        {"visitDay": "", "note": ""},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.json()["visitObjects"][0]["visitDay"] is None
    assert resp.json()["visitObjects"][0]["note"] == ""


def test_update_visit_object_rejects_bad_day_and_unknown_row(manager):
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    visit_id = manager.get(f"{URL}{event_id}/").json()["visitObjects"][0]["id"]

    resp = manager.patch(
        f"{URL}{event_id}/visit-objects/{visit_id}/",
        {"visitDay": "19.06.2026"},
        format="json",
    )
    assert resp.status_code == 400
    assert resp.json()["details"]["visitDay"] == [
        "Укажите дату в формате ГГГГ-ММ-ДД."
    ]

    resp = manager.patch(
        f"{URL}{event_id}/visit-objects/9999/",
        {"note": "нет такой строки"},
        format="json",
    )
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "ENTITY_NOT_FOUND"


# ── Старший объекта посещения (Plane «Реестр ОМ-35.2») ──────────────────────


def test_assign_and_replace_visit_object_chief(manager):
    """Назначение, ЗАМЕНА и снятие старшего объекта — с журналом на каждое.

    Замена идёт тем же POST: у объекта старший один, и «сначала снимите»
    превратило бы обычную замену в две операции. Журнал при замене обязан
    назвать и прежнего, и нового — иначе цепочка «кто стоял на объекте»
    рвётся.
    """
    from organization_management.apps.operations.models_audit import OpsAuditLog

    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    visit_id = manager.get(f"{URL}{event_id}/").json()["visitObjects"][0]["id"]
    first = make_employee(last_name="Битен", first_name="Асхат")
    second = make_employee(last_name="Тлесов", first_name="Ерлан")

    resp = manager.post(
        f"{URL}{event_id}/visit-objects/{visit_id}/chief/",
        {"employeeId": str(first.pk)},
        format="json",
    )
    assert resp.status_code == 200
    row = resp.json()["visitObjects"][0]
    assert row["chiefEmployeeId"] == str(first.pk)
    assert "Битен" in row["chiefName"]

    resp = manager.post(
        f"{URL}{event_id}/visit-objects/{visit_id}/chief/",
        {"employeeId": str(second.pk)},
        format="json",
    )
    assert resp.status_code == 200
    saved = OpsSecurityEventVisitObject.objects.get(pk=visit_id)
    assert saved.chief_employee_id == second.pk
    assert "Тлесов" in saved.chief_name

    replaced = OpsAuditLog.objects.filter(
        action="VISIT_OBJECT_CHIEF_ASSIGNED"
    ).order_by("-pk").first()
    # Замена названа с двух концов: кого сняли и кого поставили.
    assert replaced.old_value["employeeId"] == str(first.pk)
    assert replaced.new_value["employeeId"] == str(second.pk)
    assert replaced.new_value["objectName"] == saved.object_name

    resp = manager.delete(f"{URL}{event_id}/visit-objects/{visit_id}/chief/")
    assert resp.status_code == 200
    assert resp.json()["visitObjects"][0]["chiefEmployeeId"] is None
    assert resp.json()["visitObjects"][0]["chiefName"] == ""
    saved.refresh_from_db()
    assert saved.chief_employee_id is None
    revoked = OpsAuditLog.objects.filter(
        action="VISIT_OBJECT_CHIEF_REVOKED"
    ).order_by("-pk").first()
    assert revoked.old_value["employeeId"] == str(second.pk)


def test_visit_object_chief_rejects_unknown_employee_and_empty_removal(manager):
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    visit_id = manager.get(f"{URL}{event_id}/").json()["visitObjects"][0]["id"]

    resp = manager.post(
        f"{URL}{event_id}/visit-objects/{visit_id}/chief/",
        {"employeeId": "9999"},
        format="json",
    )
    assert resp.status_code == 400
    assert resp.json()["details"]["employeeId"] == ["Сотрудник не найден."]

    # Снимать некого — 404 с конвертом, а не тихий успех.
    resp = manager.delete(f"{URL}{event_id}/visit-objects/{visit_id}/chief/")
    assert resp.status_code == 404
    assert resp.json()["error_code"] == "ENTITY_NOT_FOUND"


def test_visit_object_chief_needs_manage_permission(viewer, manager):
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    visit_id = manager.get(f"{URL}{event_id}/").json()["visitObjects"][0]["id"]
    employee = make_employee(last_name="Асаинов", first_name="Дамир")

    resp = viewer.post(
        f"{URL}{event_id}/visit-objects/{visit_id}/chief/",
        {"employeeId": str(employee.pk)},
        format="json",
    )
    assert resp.status_code == 403


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

    # Правка дня и примечания — та же грань: она меняет сводку ГВО.
    visit_id = manager.get(f"{URL}{event_id}/").json()["visitObjects"][0]["id"]
    resp = viewer.patch(
        f"{URL}{event_id}/visit-objects/{visit_id}/",
        {"note": "чужая правка"},
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
        perms=(
            "event.view", "event.manage", "event.create", "event.bulletin",
            "event.stage_override",
        ),
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


def test_recon_force_request_survives_saves_without_the_field(manager):
    """Задача заказчика «Реестр ОМ-23»: запрос личного состава с
    рекогносцировки доходит до штаба 2-го департамента.

    Стережётся не «поле сохраняется», а то, что его НЕ СТИРАЕТ чужое
    сохранение: мок-слой и старые клиенты шлют тело рекогносцировки без
    `forceRequest`, и трактовка «нет ключа = ноль» обнуляла бы запрос при
    каждой правке расчёта постов — молча, между двумя заходами штаба.
    """
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    posts = data["reconSectorPosts"]

    saved = manager.patch(
        f"{base}recon/",
        {"checklist": data["reconChecklist"], "sectorPosts": posts, "forceRequest": 64},
        format="json",
    ).json()
    assert saved["reconForceRequest"] == 64

    # Правка расчёта БЕЗ поля запроса — запрос на месте.
    again = manager.patch(
        f"{base}recon/",
        {"checklist": data["reconChecklist"], "sectorPosts": posts},
        format="json",
    ).json()
    assert again["reconForceRequest"] == 64
    # И из БАЗЫ, а не из ответа: ответ мог бы собраться из входа.
    assert OpsSecurityEvent.objects.get(pk=event_id).recon_force_request == 64

    # Явный ноль — это правка, а не «не прислали»: старший наряда снимает
    # запрос тем же полем, каким его ставил.
    zeroed = manager.patch(
        f"{base}recon/",
        {"checklist": data["reconChecklist"], "sectorPosts": posts, "forceRequest": 0},
        format="json",
    ).json()
    assert zeroed["reconForceRequest"] == 0

    # Отрицательное — ошибка ПОЛЯ, а не молчаливый ноль.
    bad = manager.patch(
        f"{base}recon/",
        {"checklist": data["reconChecklist"], "sectorPosts": posts, "forceRequest": -3},
        format="json",
    )
    assert bad.status_code == 400
    assert bad.json()["details"]["forceRequest"] == [
        "Укажите целое число не меньше нуля."
    ]


def test_recon_force_request_reaches_the_registry_row(manager):
    """Штаб 2-го департамента читает запрос из РЕЕСТРА мероприятий (экран
    «Сбор сил на ОМ» строится на нём), а не из карточки — значит число и
    момент отправки обязаны быть в строке списка, а не только в детали."""
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    data = manager.post(f"{base}recon/import-from-passport/").json()
    manager.patch(
        f"{base}recon/",
        {
            "checklist": [{**i, "done": True} for i in data["reconChecklist"]],
            "sectorPosts": data["reconSectorPosts"],
            "forceRequest": 41,
        },
        format="json",
    )
    manager.post(f"{base}recon/complete/")

    rows = manager.get(URL).json()["results"]
    row = next(r for r in rows if r["id"] == str(event_id))
    assert row["reconForceRequest"] == 41
    assert row["reconForceRequestedAt"] is not None


# ── Замещающие на объекте посещения (Plane «Реестр ОМ-24») ───────────────────


def _deputy_persona(employee, username="ev-deputy"):
    """Учётка БЕЗ права `event.manage`, привязанная к сотруднику.

    Персона без права обязательна: с полными правами проба зеленела бы и без
    механизма замещающих — она проверяла бы право, а не назначение.
    """
    api, user = client_for(username, "EV_DEPUTY", perms=("event.view",))
    employee.user = user
    employee.save(update_fields=["user"])
    return api


def test_deputy_assignment_is_named_in_the_audit_log(manager):
    obj = make_object(with_passport=True)
    employee = make_employee(last_name="Замещающий", first_name="Пётр")
    data = create_event(manager, obj).json()
    visit_id = data["visitObjects"][0]["id"]
    url = f"{URL}{data['id']}/visit-objects/{visit_id}/deputies/"

    resp = manager.post(url, {"employeeId": str(employee.pk)}, format="json")
    assert resp.status_code == 201
    deputies = resp.json()["visitObjects"][0]["deputies"]
    assert len(deputies) == 1
    assert deputies[0]["employeeId"] == str(employee.pk)
    assert deputies[0]["canEditPlacement"] is True
    # Подпись, а не id учётки: журнал отвечает «кто пустил».
    assert deputies[0]["assignedBy"] != ""
    assert not deputies[0]["assignedBy"].isdigit()

    row = OpsAuditLog.objects.get(action=SECURITY_EVENT_DEPUTY_ASSIGNED)
    assert row.new_value["employeeId"] == str(employee.pk)
    assert row.new_value["visitObjectId"] == visit_id

    # Повтор — ошибка ПОЛЯ, а не конверт про ограничение базы.
    again = manager.post(url, {"employeeId": str(employee.pk)}, format="json")
    assert again.status_code == 400
    assert again.json()["details"]["employeeId"] == [
        "Этот сотрудник уже назначен замещающим."
    ]

    # Отзыв уносит право и называет, у кого сняли.
    deputy_id = deputies[0]["id"]
    gone = manager.delete(f"{url}{deputy_id}/")
    assert gone.status_code == 200
    assert gone.json()["visitObjects"][0]["deputies"] == []
    revoked = OpsAuditLog.objects.get(action=SECURITY_EVENT_DEPUTY_REVOKED)
    assert revoked.old_value["employeeName"].startswith("Замещающий")


def test_deputy_edits_placement_of_own_object_without_manage_right(manager):
    """Суть задачи: замещающий правит расстановку СВОЕГО объекта, не имея
    общего `event.manage`, и каждое его действие попадает в журнал."""
    obj = make_object(with_passport=True)
    deputy_employee = make_employee(last_name="Замещающий", first_name="Пётр")
    assignee = make_employee(last_name="Назначаемый", first_name="Иван")
    data = create_event(manager, obj).json()
    base = f"{URL}{data['id']}/"
    visit_id = data["visitObjects"][0]["id"]

    imported = manager.post(f"{base}recon/import-from-passport/").json()
    post_id = imported["reconSectorPosts"][0]["id"]

    deputy_api = _deputy_persona(deputy_employee)
    payload = {"postId": post_id, "employeeId": str(assignee.pk)}

    # ДО назначения замещающим — отказ гейта: право даёт назначение, а не
    # сама по себе привязка учётки к сотруднику.
    denied = deputy_api.post(f"{base}placement/assign/", payload, format="json")
    assert denied.status_code == 403

    manager.post(
        f"{base}visit-objects/{visit_id}/deputies/",
        {"employeeId": str(deputy_employee.pk)},
        format="json",
    )

    ok = deputy_api.post(f"{base}placement/assign/", payload, format="json")
    assert ok.status_code == 200
    assignments = ok.json()["placementAssignments"]
    assert [a["employeeId"] for a in assignments] == [str(assignee.pk)]

    # Действие замещающего названо в журнале: без записи разбирательство
    # «кто ставил людей» упиралось бы в безымянную строку агрегата.
    trace = OpsAuditLog.objects.filter(
        action=SECURITY_EVENT_PLACEMENT_BY_DEPUTY
    ).order_by("id")
    assert trace.count() == 1
    assert trace.first().new_value["operation"] == "ASSIGN"
    assert trace.first().new_value["deputyId"] == str(deputy_employee.pk)

    # Снятие — тоже его работа и тоже в журнале.
    removed = deputy_api.delete(f"{base}placement/{assignments[0]['id']}/")
    assert removed.status_code == 200
    assert removed.json()["placementAssignments"] == []
    assert trace.count() == 2
    assert trace.last().new_value["operation"] == "UNASSIGN"

    # Завершение этапа замещающему НЕ открыто: это переход цепочки.
    assert deputy_api.post(f"{base}placement/complete/").status_code == 403


def test_deputy_of_one_object_cannot_touch_unmarked_posts_of_a_multi_object_event(
    manager,
):
    """Право выдаётся ПО ОБЪЕКТУ. Пока расчёт постов не размечен по объектам,
    у ОМ с НЕСКОЛЬКИМИ объектами чей пост — неизвестно, и замещающий не
    получает ничего: ошибка здесь пускает человека в чужую расстановку."""
    obj = make_object(with_passport=True)
    other = make_object(name="Конгресс-центр", code="OBJ-B", with_passport=True)
    deputy_employee = make_employee(last_name="Замещающий", first_name="Пётр")
    assignee = make_employee(last_name="Назначаемый", first_name="Иван")
    data = create_event(manager, obj).json()
    base = f"{URL}{data['id']}/"
    first_visit = data["visitObjects"][0]["id"]

    imported = manager.post(f"{base}recon/import-from-passport/").json()
    post_id = imported["reconSectorPosts"][0]["id"]
    manager.post(
        f"{base}visit-objects/{first_visit}/deputies/",
        {"employeeId": str(deputy_employee.pk)},
        format="json",
    )
    deputy_api = _deputy_persona(deputy_employee)
    payload = {"postId": post_id, "employeeId": str(assignee.pk)}

    # Пока объект ОДИН — нерасписанный расчёт его, и правка проходит.
    first = deputy_api.post(f"{base}placement/assign/", payload, format="json")
    assert first.status_code == 200
    manager.delete(
        f"{base}placement/{first.json()['placementAssignments'][0]['id']}/"
    )

    # Появился ВТОРОЙ объект — принадлежность НЕРАЗМЕЧЕННОГО поста стала
    # неизвестной, и то же действие теперь отбивается.
    manager.post(f"{base}visit-objects/", {"objectId": str(other.pk)}, format="json")
    # 🔴 Разметку снимаем намеренно — см. пояснение в
    # `test_second_visit_object_without_post_mapping_reports_unknown` (Plane
    # №408): импорт теперь помечает посты, и старый мир надо изобразить.
    stored = OpsSecurityEvent.objects.get(pk=data["id"])
    stored.recon_sector_posts = [
        {**row, "visitObjectId": None} for row in stored.recon_sector_posts
    ]
    stored.save(update_fields=["recon_sector_posts"])
    assert (
        deputy_api.post(
            f"{base}placement/assign/", payload, format="json"
        ).status_code
        == 403
    )

    # Разметка поста за СВОИМ объектом право возвращает.
    posts = manager.get(f"{URL}{data['id']}/").json()["reconSectorPosts"]
    manager.patch(
        f"{base}recon/",
        {
            "checklist": data["reconChecklist"],
            "sectorPosts": [
                {**p, "visitObjectId": first_visit} if p["id"] == post_id else p
                for p in posts
            ],
        },
        format="json",
    )
    assert (
        deputy_api.post(
            f"{base}placement/assign/", payload, format="json"
        ).status_code
        == 200
    )


def test_deputy_without_edit_right_is_an_observer(manager):
    """Флаг `canEditPlacement=false` — назначенный наблюдатель: он в списке
    объекта, но расстановку не правит. Без флага «назначен» означало бы
    «может», и развести просмотр с правкой (как в эталоне) было бы нечем."""
    obj = make_object(with_passport=True)
    deputy_employee = make_employee(last_name="Наблюдатель", first_name="Пётр")
    assignee = make_employee(last_name="Назначаемый", first_name="Иван")
    data = create_event(manager, obj).json()
    base = f"{URL}{data['id']}/"
    visit_id = data["visitObjects"][0]["id"]
    post_id = manager.post(f"{base}recon/import-from-passport/").json()[
        "reconSectorPosts"
    ][0]["id"]

    created = manager.post(
        f"{base}visit-objects/{visit_id}/deputies/",
        {"employeeId": str(deputy_employee.pk), "canEditPlacement": False},
        format="json",
    ).json()
    assert created["visitObjects"][0]["deputies"][0]["canEditPlacement"] is False
    assert OpsVisitObjectDeputy.objects.get().can_edit_placement is False

    deputy_api = _deputy_persona(deputy_employee)
    refused = deputy_api.post(
        f"{base}placement/assign/",
        {"postId": post_id, "employeeId": str(assignee.pk)},
        format="json",
    )
    assert refused.status_code == 403


# ── Удаление мероприятия (Plane «Реестр ОМ-34») ──────────────────────────────


def test_next_code_survives_deletion(manager):
    """Номер ОМ — счётчик ВЫДАННЫХ, а не количество строк.

    Красная проба к дефекту, который вскрыла чистка реестра: при `count + 1`
    удаление старых строк возвращало счётчик на занятые номера, и КАЖДОЕ
    создание падало 500 на уникальности кода. Проба стережёт именно это —
    удаляем середину и заводим новое ОМ.
    """
    obj = make_object(with_passport=True)
    first = create_event(manager, obj, title="Первое").json()
    second = create_event(manager, obj, title="Второе").json()
    assert second["code"].endswith("-2")

    remover, _ = client_for(
        "ev-remover-3", "EV_REMOVER_3", perms=("event.view", "event.delete")
    )
    assert remover.delete(f"{URL}{first['id']}/").status_code == 204

    third = create_event(manager, obj, title="Третье")
    assert third.status_code == 201, third.content
    # Номер идёт ДАЛЬШЕ выданного, а не занимает освободившийся: код ОМ уходит
    # в бумагу, и переиспользование номера означало бы два разных дела под
    # одним номером.
    assert third.json()["code"].endswith("-3")


def test_event_delete_needs_its_own_permission(manager):
    """Право ВЕСТИ мероприятие не даёт стирать его из реестра."""
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    resp = manager.delete(f"{URL}{event_id}/")
    assert resp.status_code == 403
    # Отказ без последствий: строка на месте.
    assert OpsSecurityEvent.objects.filter(pk=event_id).exists()


def test_event_delete_removes_the_row_and_leaves_a_trace(manager):
    """Строка исчезает целиком — значит журнал остаётся ЕДИНСТВЕННЫМ следом
    того, что она была, и обязан нести снимок, а не один id."""
    obj = make_object(with_passport=True)
    data = create_event(manager, obj, title="Опечатка в названии").json()
    remover, _ = client_for(
        "ev-remover", "EV_REMOVER", perms=("event.view", "event.delete")
    )

    resp = remover.delete(f"{URL}{data['id']}/")
    assert resp.status_code == 204
    assert not OpsSecurityEvent.objects.filter(pk=data["id"]).exists()
    # Объекты посещения уезжают каскадом вместе с ОМ — сирот не остаётся.
    assert not OpsSecurityEventVisitObject.objects.filter(
        event_id=data["id"]
    ).exists()

    row = OpsAuditLog.objects.get(action=SECURITY_EVENT_DELETED)
    assert row.old_value["code"] == data["code"]
    assert row.old_value["title"] == "Опечатка в названии"
    assert row.old_value["stage"] == "RECON"


def test_event_delete_takes_its_participations_with_it(manager):
    """Удаление ОМ снимает участия на него, а статус, который ими и держался,
    закрывается (Plane №355, решение 02.09.2026).

    Проверено делом до правки: участие переживало мероприятие, теряло код и
    название («привлечён неизвестно куда») и ПРОДОЛЖАЛО занимать день
    сотрудника — новый статус на те же даты не заводился.
    """
    from organization_management.apps.operations.models_status import (
        OpsEmployeeStatus,
        OpsStatusParticipation,
    )

    obj = make_object(with_passport=True)
    data = create_event(manager, obj, title="ОМ под удаление с участием").json()
    employee = make_employee()
    status = OpsEmployeeStatus.objects.create(
        employee_id=employee.pk,
        status_type_code="EVENT_ASSIGNMENT",
        date_start=date(2026, 9, 5),
        date_end=date(2026, 9, 6),
        created_by="test",
    )
    OpsStatusParticipation.objects.create(
        status=status, event_id=int(data["id"]), kind_code="PHYSICAL_SQUAD"
    )
    remover, _ = client_for(
        "ev-remover-part", "EV_REMOVER_PART", perms=("event.view", "event.delete")
    )

    assert remover.delete(f"{URL}{data['id']}/").status_code == 204

    assert not OpsStatusParticipation.objects.filter(
        event_id=int(data["id"])
    ).exists(), "участие пережило своё мероприятие — снова сирота"
    assert not OpsEmployeeStatus.objects.filter(pk=status.pk).exists(), (
        "статус держался ТОЛЬКО этим участием и обязан был уйти вместе с ним — "
        "иначе день сотрудника занят привлечением в никуда"
    )


def test_event_delete_keeps_a_status_that_has_another_participation(manager):
    """А статус, у которого осталось живое участие, НЕ трогается.

    Обратная сторона правила: снести его значило бы стереть привлечение на
    другое, существующее мероприятие.
    """
    from organization_management.apps.operations.models_status import (
        OpsEmployeeStatus,
        OpsStatusParticipation,
    )

    obj = make_object(with_passport=True)
    doomed = create_event(manager, obj, title="ОМ под удаление").json()
    alive = create_event(manager, obj, title="ОМ, которое остаётся").json()
    employee = make_employee()
    status = OpsEmployeeStatus.objects.create(
        employee_id=employee.pk,
        status_type_code="EVENT_ASSIGNMENT",
        date_start=date(2026, 9, 5),
        date_end=date(2026, 9, 6),
        created_by="test",
    )
    for event in (doomed, alive):
        OpsStatusParticipation.objects.create(
            status=status, event_id=int(event["id"]), kind_code="PHYSICAL_SQUAD"
        )
    remover, _ = client_for(
        "ev-remover-keep", "EV_REMOVER_KEEP", perms=("event.view", "event.delete")
    )

    assert remover.delete(f"{URL}{doomed['id']}/").status_code == 204

    assert OpsEmployeeStatus.objects.filter(pk=status.pk).exists()
    assert set(
        OpsStatusParticipation.objects.filter(status=status).values_list(
            "event_id", flat=True
        )
    ) == {int(alive["id"])}


def test_event_delete_refuses_closed_and_worked_events(manager):
    """Удаление — для ошибок ввода, а не для истории и не вместо отмены."""
    obj = make_object(with_passport=True)
    employee = make_employee()
    data = create_event(manager, obj).json()
    base = f"{URL}{data['id']}/"
    remover, _ = client_for(
        "ev-remover-2", "EV_REMOVER_2", perms=("event.view", "event.delete")
    )

    imported = manager.post(f"{base}recon/import-from-passport/").json()
    manager.post(
        f"{base}placement/assign/",
        {
            "postId": imported["reconSectorPosts"][0]["id"],
            "employeeId": str(employee.pk),
        },
        format="json",
    )
    refused = remover.delete(base)
    assert refused.status_code == 422
    assert refused.json()["error_code"] == "EVENT_DELETE_FORBIDDEN"
    assert "работа людей" in refused.json()["message"]
    assert OpsSecurityEvent.objects.filter(pk=data["id"]).exists()

    # Закрытое ОМ — история: своя причина отказа, а не та же самая.
    OpsSecurityEvent.objects.filter(pk=data["id"]).update(
        stage="CLOSED", placement_assignments=[], journal_entries=[]
    )
    closed = remover.delete(base)
    assert closed.status_code == 422
    assert closed.json()["error_code"] == "EVENT_DELETE_FORBIDDEN"
    assert "история" in closed.json()["message"]


def test_purge_probe_events_is_dry_by_default(manager):
    """Команда чистки не удаляет с первого запуска: команда, которая стирает
    без спроса, рано или поздно снесёт живое."""
    from io import StringIO

    from django.core.management import call_command

    obj = make_object(with_passport=True)
    probe = create_event(manager, obj, title="Проба чего-нибудь (e2e)").json()
    live = create_event(manager, obj, title="Визит делегации").json()

    out = StringIO()
    call_command("purge_probe_events", stdout=out)
    assert "Сухой прогон" in out.getvalue()
    assert OpsSecurityEvent.objects.filter(pk=probe["id"]).exists()

    out = StringIO()
    call_command("purge_probe_events", "--yes", stdout=out)
    assert "Удалено: 1" in out.getvalue()
    assert not OpsSecurityEvent.objects.filter(pk=probe["id"]).exists()
    # Живая строка не тронута: метку «(e2e)» ставят только прогоны.
    assert OpsSecurityEvent.objects.filter(pk=live["id"]).exists()


def test_purge_probe_events_force_takes_worked_rows(manager):
    """Пробную строку с расстановкой обычный запрет НЕ отдаёт — и правильно
    делает: на живом ОМ это работа людей. Но у пробы основание другое: её
    пометил прогон. `--force` для этого и заведён, и обход виден в журнале."""
    from io import StringIO

    from django.core.management import call_command

    obj = make_object(with_passport=True)
    employee = make_employee()
    data = create_event(manager, obj, title="Проба с работой (e2e)").json()
    base = f"{URL}{data['id']}/"
    imported = manager.post(f"{base}recon/import-from-passport/").json()
    manager.post(
        f"{base}placement/assign/",
        {
            "postId": imported["reconSectorPosts"][0]["id"],
            "employeeId": str(employee.pk),
        },
        format="json",
    )

    out = StringIO()
    call_command("purge_probe_events", "--yes", stdout=out)
    assert "Оставлено (сервер отказал): 1" in out.getvalue()
    assert OpsSecurityEvent.objects.filter(pk=data["id"]).exists()

    out = StringIO()
    call_command("purge_probe_events", "--yes", "--force", stdout=out)
    assert "Удалено: 1" in out.getvalue()
    assert not OpsSecurityEvent.objects.filter(pk=data["id"]).exists()
    # Обход запрета помечен в журнале: удаление отработавшего ОМ и удаление
    # пустого бюллетеня — разные события.
    assert OpsAuditLog.objects.get(action=SECURITY_EVENT_DELETED).old_value[
        "forced"
    ] is True



def test_recon_post_ids_are_issued_by_server(manager):
    """Id строки расчёта постов выдаёт сервер, а не клиент (Plane №30).

    Клиент помечает не сохранённые строки именем из счётчика вкладки
    (`recon-local-N`), и счётчик начинается заново на каждой перезагрузке.
    Пока сервер писал присланное имя как есть, у одного ОМ набиралось шесть
    постов с `recon-local-1`, и `placement/assign` по такому id попадал в
    первый совпавший — назначение уезжало на чужую строку.

    Проба держит три факта сразу: присланные одинаковые имена расходятся;
    выданный сервером id ПЕРЕЖИВАЕТ следующую правку (иначе на него нельзя
    было бы сослаться из расстановки); ссылка подпоста на родителя
    переписывается на новый id родителя, а не остаётся клиентским именем.
    """
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    checklist = manager.get(base).json()["reconChecklist"]

    def row(row_id, post, **extra):
        return {
            "id": row_id, "sector": "Периметр", "post": post, "task": "",
            "need": 1, "requirements": "", "result": None, "comment": "",
            "sourceSectorId": None, "sourcePostId": None, "minRating": None,
            **extra,
        }

    saved = manager.patch(
        f"{base}recon/",
        {
            "checklist": checklist,
            "sectorPosts": [
                row("recon-local-1", "Пост 1"),
                row("recon-local-1", "Пост 2"),
                row("recon-local-1", "Подпост", parentPostId="recon-local-1"),
                row("", "Пост без имени"),
            ],
        },
        format="json",
    )
    assert saved.status_code == 200
    posts = saved.json()["reconSectorPosts"]
    ids = [p["id"] for p in posts]
    assert [p["post"] for p in posts] == [
        "Пост 1", "Пост 2", "Подпост", "Пост без имени",
    ]
    assert len(set(ids)) == 4, ids
    assert not any(i.startswith("recon-local-") or i == "" for i in ids), ids
    # Подпост ссылается на ПЕРВОЕ вхождение — туда и целился клиент.
    assert posts[2]["parentPostId"] == ids[0]

    # Повторная правка сохранённых строк их id не меняет: на него ссылается
    # расстановка, и «новый id на каждом сохранении» рвал бы назначения.
    again = manager.patch(
        f"{base}recon/",
        {
            "checklist": checklist,
            "sectorPosts": [{**posts[0], "task": "Досмотр"}, posts[1]],
        },
        format="json",
    )
    assert again.status_code == 200
    again_posts = again.json()["reconSectorPosts"]
    assert [p["id"] for p in again_posts] == ids[:2]
    assert again_posts[0]["task"] == "Досмотр"


def test_recon_import_ids_do_not_collide_across_imports(manager):
    """Импорт из паспорта тоже выдаёт уникальные id.

    Раньше id склеивался из отметки времени и счётчика, начинавшегося с
    единицы на КАЖДЫЙ импорт: два импорта в одну секунду (разные версии
    паспорта, разные объекты посещения) дали бы одинаковые имена.
    """
    obj = make_object(with_passport=True)
    event_id = create_event(manager, obj).json()["id"]
    base = f"{URL}{event_id}/"
    imported = manager.post(f"{base}recon/import-from-passport/").json()
    first_ids = [p["id"] for p in imported["reconSectorPosts"]]
    assert first_ids and len(set(first_ids)) == len(first_ids)

    # Строку из паспорта убираем из расчёта и импортируем заново — id новой
    # строки не повторяет ни одного прежнего.
    manager.patch(
        f"{base}recon/",
        {"checklist": imported["reconChecklist"], "sectorPosts": []},
        format="json",
    )
    again = manager.post(f"{base}recon/import-from-passport/").json()
    second_ids = [p["id"] for p in again["reconSectorPosts"]]
    assert len(set(second_ids)) == len(second_ids)
    assert not (set(second_ids) & set(first_ids))
