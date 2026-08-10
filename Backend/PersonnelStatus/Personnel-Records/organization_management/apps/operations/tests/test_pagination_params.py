"""limit/offset у списков раздела ОМ исполняются, а не только описаны.

Вьюхи раздела — plain ViewSet: пагинацию они делают руками
(DefaultPagination() внутри list), а pagination_class на классе объявлен
исключительно ради схемы. Из-за этой развилки схема и поведение способны
разойтись молча: атрибут можно снять, не сломав ни одного теста, и клиент
из schema.yaml перестанет знать про листание, которое сервер по-прежнему
исполняет. Тесты ниже закрепляют обе половины контракта: что параметры
действительно работают — и что схема о них говорит.

Список statuses уже покрыт test_status_list_api.test_pagination_envelope.
"""
from datetime import timedelta

import pytest

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.services import RoleAdminService

from .test_bulk_status_api import client_for, make_employee
from .test_rbac_admin_api import TEMP_DUTY_URL
from .test_rbac_admin_api import client_for as admin_client_for
from .test_secondment_api import get as get_secondments
from .test_secondment_api import home, host, seed_pair, types  # noqa: F401


@pytest.mark.django_db
def test_temporary_duty_honours_limit_and_offset():
    api, _ = admin_client_for("page-td", "ADMIN", ["*"])
    now = Clock.now()
    for offset in (1, 2, 3):
        RoleAdminService.grant_temporary_duty(
            user_id="42",
            duty_role_code="HQ_DUTY",
            starts_at=now - timedelta(hours=offset),
            ends_at=now + timedelta(hours=1),
            created_by="test",
        )
    # Без параметров страница отдаёт всё — иначе усечение ниже было бы
    # неотличимо от того, что строк просто мало.
    full = api.get(TEMP_DUTY_URL).json()
    assert full["count"] == 3
    assert len(full["results"]) == 3

    page = api.get(TEMP_DUTY_URL, {"limit": 1}).json()
    assert page["count"] == 3
    assert len(page["results"]) == 1
    assert page["next"] is not None

    nxt = api.get(TEMP_DUTY_URL, {"limit": 1, "offset": 1}).json()
    assert nxt["results"][0]["id"] != page["results"][0]["id"]


@pytest.mark.django_db
def test_secondments_honour_limit_and_offset(types, home, host):  # noqa: F811
    api, _ = client_for("page-sec", "ADMIN", ["*"])
    for _ in range(3):
        seed_pair(make_employee(home), host, admin=api)

    full = get_secondments(api).data
    assert full["count"] == 3
    assert len(full["results"]) == 3

    page = get_secondments(api, limit=1).data
    assert page["count"] == 3
    assert len(page["results"]) == 1
    assert page["next"] is not None

    nxt = get_secondments(api, limit=1, offset=1).data
    assert nxt["results"][0]["id"] != page["results"][0]["id"]


# Каждый список раздела, у которого страничную обёртку и limit/offset выводит
# pagination_class. Перечень намеренно ЛИТЕРАЛЬНЫЙ, а не собранный из схемы:
# выведенный из неё список сам бы усох вместе с потерянным атрибутом и тест
# остался бы зелёным — ровно та дыра, ради которой он и пишется.
PAGINATED_LISTS = [
    ("/api/operations/audit-logs/", "PaginatedOpsAuditLogList"),
    ("/api/operations/daily-submissions/", "PaginatedOpsDailySubmissionList"),
    ("/api/operations/notifications/", "PaginatedOpsNotificationList"),
    ("/api/operations/permissions/", "PaginatedPermissionList"),
    ("/api/operations/roles/", "PaginatedRoleList"),
    ("/api/operations/secondments/", "PaginatedSecondmentList"),
    ("/api/operations/status-types/", "PaginatedStatusTypeList"),
    ("/api/operations/statuses/", "PaginatedOpsEmployeeStatusList"),
    ("/api/operations/temporary-duty/", "PaginatedTemporaryDutyList"),
    ("/api/operations/user-roles/", "PaginatedUserRoleList"),
]


@pytest.fixture(scope="module")
def schema():
    from drf_spectacular.generators import SchemaGenerator

    return SchemaGenerator().get_schema(request=None, public=True)


@pytest.mark.parametrize(("path", "component"), PAGINATED_LISTS)
def test_schema_owns_limit_offset_on_every_list(schema, path, component):
    """pagination_class — единственный владелец страницы, и он удержан.

    Снятие атрибута у любого из списков краснит этот тест дважды: ответ
    перестаёт ссылаться на компонент Paginated…List (spectacular описал бы
    голый массив, которого клиент никогда не получит), а limit/offset
    пропадают из parameters. До этого теста снятие проходило молча —
    поведение держал соседний прогон по HTTP, схему не держал никто.

    Ручной inline_serializer рядом с атрибутом был вторым владельцем той же
    обёртки и потому снят: удержан тем же ассертом ровно один.
    """
    get = schema["paths"][path]["get"]

    body = get["responses"]["200"]["content"]["application/json"]
    assert body["schema"] == {"$ref": f"#/components/schemas/{component}"}

    page = schema["components"]["schemas"][component]
    assert page["type"] == "object"
    assert set(page["properties"]) == {"count", "next", "previous", "results"}
    assert page["properties"]["results"]["type"] == "array"

    assert {"limit", "offset"} <= {p["name"] for p in get["parameters"]}


# ── Потолок страницы ─────────────────────────────────────────────────────

# Журнал взят намеренно: он append-only и растёт без предела, поэтому «отдай
# всё» дорожает с каждым днём и сорвётся уже на живой эксплуатации, а не на
# стенде. Проверять потолок на списке, который сам по себе короткий, значило бы
# проверять его там, где он не нужен.
JOURNAL_URL = "/api/operations/audit-logs/"
CEILING = 1000


def _fill_journal(rows):
    from organization_management.apps.operations import audit_service

    for index in range(rows):
        audit_service.record(
            actor="7",
            action=audit_service.STATUS_CREATED,
            entity_type=audit_service.ENTITY_STATUS,
            entity_id=index,
        )


@pytest.mark.django_db
def test_a_huge_limit_does_not_pull_the_whole_table():
    """Несущий тест: размер страницы назначает СЕРВЕР, а не спросивший.

    Строк заведомо больше потолка нет — ставить их тысячу ради одной проверки
    дорого, — поэтому потолок демонстрируется на самом ответе: сколько бы ни
    просили, отдаётся не больше `max_limit`, и `count` при этом честно говорит,
    сколько строк всего.
    """
    from organization_management.apps.operations.api.views import DefaultPagination

    api, _ = client_for("page-ceiling", "ADMIN", ["*"])
    _fill_journal(3)

    assert DefaultPagination.max_limit == CEILING

    body = api.get(JOURNAL_URL, {"limit": 1000000}).json()
    assert body["count"] == 3
    assert len(body["results"]) <= CEILING


@pytest.mark.django_db
def test_the_ceiling_is_the_number_actually_served():
    """Потолок должен РЕЗАТЬ, а не только стоять в атрибуте.

    Строк здесь больше маленького потолка, подставленного на время пробы:
    настоящую тысячу заводить дорого, а свойство «отдано ровно потолок, хотя
    просили больше» от величины не зависит.
    """
    from organization_management.apps.operations.api import views

    api, _ = client_for("page-ceiling2", "ADMIN", ["*"])
    _fill_journal(7)

    original = views.DefaultPagination.max_limit
    # Подменять можно только НАСТОЯЩИЙ потолок: не будь его, тест поставил бы
    # его сам и остался бы зелёным на разделе, где потолка нет вовсе.
    assert original is not None
    try:
        views.DefaultPagination.max_limit = 3
        body = api.get(JOURNAL_URL, {"limit": 1000000}).json()
    finally:
        views.DefaultPagination.max_limit = original

    assert body["count"] == 7
    assert len(body["results"]) == 3
    # Листание при этом не сломано: клиенту есть куда идти дальше.
    assert body["next"] is not None


@pytest.mark.django_db
def test_a_limit_under_the_ceiling_is_obeyed_as_asked():
    """Иначе «отдано не больше потолка» выполнялось бы и жёсткой константой,
    которая игнорирует запрошенное число вовсе."""
    api, _ = client_for("page-ceiling3", "ADMIN", ["*"])
    _fill_journal(5)

    body = api.get(JOURNAL_URL, {"limit": 2}).json()

    assert len(body["results"]) == 2
    assert body["count"] == 5
