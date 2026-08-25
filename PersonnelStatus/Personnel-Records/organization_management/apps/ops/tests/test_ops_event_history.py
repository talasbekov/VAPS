"""История мероприятий в «Охраняемых лицах» и «Объектах» (Plane №38).

Требование заказчика: «если в Реестре ОМ в бюллетене указали какое-либо ОЛ, то
в модуле Охраняемые лица будет кнопка история, и при нажатии откроется список
мероприятий, внутри — вложенные объекты, которые он ЛИЧНО посетил. Внутри
мероприятия могут быть больше объектов, но должны показываться те, которые
связаны именно с этим ОЛ».

Отсюда два правила, которые тут и проверяются: история показывает ТОЛЬКО
закрытые ОМ, и объекты в ней отобраны ПО ЛИЦУ, а не по мероприятию. Обратная
сторона — история объекта: мероприятия на нём и лица, посещавшие ИМЕННО его.
"""
import pytest

from organization_management.apps.operations.models_event import (
    OpsSecurityEvent,
    OpsSecurityEventVisitObject,
)
from organization_management.apps.operations.models_gvo import OpsProtectedPerson

from .test_ops_objects_api import reader
from .test_ops_security_events_api import make_object, manager  # noqa: F401

pytestmark = pytest.mark.django_db

PERSONS_URL = "/api/ops/protected-persons/"
OBJECTS_URL = "/api/ops/objects/"


def make_event(code, *, stage="CLOSED", person=None, date="2026-05-01"):
    return OpsSecurityEvent.objects.create(
        code=code,
        title=f"Мероприятие {code}",
        object_name="",
        passport_binding=None,
        business_date=date,
        kind="FOREIGN",
        protected_person=person,
        protected_person_name=person.name if person is not None else "",
        location="",
        stage=stage,
        readiness_percent=0,
        force_need=0,
        conflicts_count=0,
        owner_name="test",
        brief_description="",
        initial_tasks="",
        recon_checklist=[],
        recon_sector_posts=[],
        demand_rows=[],
        demand_approved=False,
        force_requests=[],
        placement_assignments=[],
        approval_status="PENDING",
        approval_comment="",
        journal_entries=[],
        closure_direction_summaries=[],
        closed_at=None,
    )


def make_visit(event, security_object, person, position=0):
    return OpsSecurityEventVisitObject.objects.create(
        event=event,
        security_object=security_object,
        object_name=security_object.name,
        passport_binding=None,
        protected_person=person,
        protected_person_name=person.name if person is not None else "",
        position=position,
    )


@pytest.fixture
def object_reader():
    """Историю объекта открывает право РЕЕСТРА ОБЪЕКТОВ (`object.view`), а не
    право мероприятий: экран, с которого её зовут, — «Объекты и паспорта»."""
    api, _ = reader("ops-history-reader")
    return api


@pytest.fixture
def persons():
    return (
        OpsProtectedPerson.objects.create(
            name="Хассан Аль-Фарси", category="FOREIGN"
        ),
        OpsProtectedPerson.objects.create(
            name="Салимова Гульнара", category="OURS"
        ),
    )


# ── История охраняемого лица ─────────────────────────────────────────────


def test_person_history_shows_only_the_objects_that_person_visited(
    manager, persons  # noqa: F811
):
    """Главное требование заказчика: в мероприятии объектов может быть больше,
    но лицу показываются ЕГО.

    В ОМ ТРИ объекта и ДВА лица, иначе «отобрали по лицу» неотличимо от «взяли
    все объекты мероприятия».
    """
    first, second = persons
    event = make_event("ОМ-2026-100")
    theirs = make_object(code="OBJ-A", name="Резиденция")
    also_theirs = make_object(code="OBJ-B", name="Конгресс-центр")
    stranger = make_object(code="OBJ-C", name="Аэропорт")
    make_visit(event, theirs, first, position=0)
    make_visit(event, also_theirs, first, position=1)
    make_visit(event, stranger, second, position=2)

    data = manager.get(f"{PERSONS_URL}{first.pk}/history/").json()

    assert [row["code"] for row in data["results"]] == ["ОМ-2026-100"]
    assert [obj["objectName"] for obj in data["results"][0]["objects"]] == [
        "Резиденция",
        "Конгресс-центр",
    ]


def test_person_history_holds_only_closed_events(manager, persons):  # noqa: F811
    """История — то, что уже случилось. Действующее ОМ живёт в реестре и ещё
    меняется; показывать его историей значило бы выдавать незаконченное за
    факт."""
    person, _ = persons
    obj = make_object(code="OBJ-A", name="Резиденция")
    closed = make_event("ОМ-2026-101")
    running = make_event("ОМ-2026-102", stage="PLACEMENT")
    make_visit(closed, obj, person)
    make_visit(running, obj, person)

    data = manager.get(f"{PERSONS_URL}{person.pk}/history/").json()

    assert [row["code"] for row in data["results"]] == ["ОМ-2026-101"]


def test_person_named_only_in_the_bulletin_still_has_history(
    manager, persons  # noqa: F811
):
    """У ОМ, заведённых до появления объектов посещения, связь есть ТОЛЬКО в
    бюллетене. Брать одну связь значило бы потерять половину истории; пустой
    список объектов у такой строки — факт, а не пропуск."""
    person, _ = persons
    make_event("ОМ-2026-103", person=person)

    data = manager.get(f"{PERSONS_URL}{person.pk}/history/").json()

    assert [row["code"] for row in data["results"]] == ["ОМ-2026-103"]
    assert data["results"][0]["objects"] == []


def test_person_history_runs_from_the_latest(manager, persons):  # noqa: F811
    """Историю читают от последнего. ТРИ строки, а не две: на двух «новые
    сверху» неотличимо от «как легло»."""
    person, _ = persons
    obj = make_object(code="OBJ-A", name="Резиденция")
    for code, date in (
        ("ОМ-2026-110", "2026-03-01"),
        ("ОМ-2026-111", "2026-07-01"),
        ("ОМ-2026-112", "2026-05-01"),
    ):
        make_visit(make_event(code, date=date), obj, person)

    data = manager.get(f"{PERSONS_URL}{person.pk}/history/").json()

    assert [row["code"] for row in data["results"]] == [
        "ОМ-2026-111",
        "ОМ-2026-112",
        "ОМ-2026-110",
    ]


# ── История объекта ──────────────────────────────────────────────────────


def test_object_history_lists_events_and_the_persons_who_visited_it(
    object_reader, persons
):
    """У объекта — мероприятия на нём и лица, посещавшие ИМЕННО его.

    Второй объект того же ОМ с другим лицом обязателен: без него «лица этого
    объекта» неотличимо от «лица мероприятия».
    """
    first, second = persons
    event = make_event("ОМ-2026-120")
    ours = make_object(code="OBJ-A", name="Резиденция")
    other = make_object(code="OBJ-B", name="Аэропорт")
    make_visit(event, ours, first, position=0)
    make_visit(event, other, second, position=1)

    data = object_reader.get(f"{OBJECTS_URL}{ours.pk}/history/").json()

    assert [row["code"] for row in data["results"]] == ["ОМ-2026-120"]
    assert [p["name"] for p in data["results"][0]["persons"]] == [
        "Хассан Аль-Фарси"
    ]


def test_object_history_holds_only_closed_events(object_reader, persons):
    person, _ = persons
    obj = make_object(code="OBJ-A", name="Резиденция")
    make_visit(make_event("ОМ-2026-121"), obj, person)
    make_visit(make_event("ОМ-2026-122", stage="CONDUCT"), obj, person)

    data = object_reader.get(f"{OBJECTS_URL}{obj.pk}/history/").json()

    assert [row["code"] for row in data["results"]] == ["ОМ-2026-121"]


def test_object_history_keeps_events_apart(object_reader, persons):
    """Два ОМ на одном объекте — две строки истории со СВОИМИ лицами.

    Один объект не заводится в одно ОМ дважды (ограничение БД), поэтому
    «повторов лица внутри мероприятия» не бывает по построению; а вот
    склеивание разных мероприятий в одну строку — беда реальная.
    """
    first, second = persons
    obj = make_object(code="OBJ-A", name="Резиденция")
    make_visit(make_event("ОМ-2026-123", date="2026-04-01"), obj, first)
    make_visit(make_event("ОМ-2026-124", date="2026-06-01"), obj, second)

    data = object_reader.get(f"{OBJECTS_URL}{obj.pk}/history/").json()

    assert [
        (row["code"], [p["name"] for p in row["persons"]])
        for row in data["results"]
    ] == [
        ("ОМ-2026-124", ["Салимова Гульнара"]),
        ("ОМ-2026-123", ["Хассан Аль-Фарси"]),
    ]


def test_object_history_is_empty_without_visits(object_reader):
    """Пустая история — законное состояние: объект мог ни разу не участвовать
    в закрытом ОМ, и экран обязан отличать это от сбоя."""
    obj = make_object(code="OBJ-Z", name="Архив")

    data = object_reader.get(f"{OBJECTS_URL}{obj.pk}/history/").json()

    assert data["results"] == []
