"""Story 10.1d — справочник статус-типов (GET /api/operations/statuses/types/).

Каталог для combobox грида: плоский массив активных типов в порядке
``(priority, code)``. Проверяет слой поверхности — форму строки (ровно шесть
полей), порядок, отсечение деактивированных и грубый гейт права
``status.view``.

RBAC берётся из живого сида (``seed_operations``): держатели — ADMIN (``*``),
DIVISION_OPERATOR, VIEWER; INTEGRATION_USER держит ТОЛЬКО ``status.manage`` и
служит DENY-дискриминатором. Каталог берётся из живого ``seed_statuses``, а не
из рукописных двух типов: ассерт порядка несущий лишь потому, что настоящий
порядок приоритетов не совпадает ни с алфавитом кодов, ни с алфавитом подписей.
"""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import Division, DivisionType, Organization
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import StatusType

pytestmark = pytest.mark.django_db

URL = reverse("ops-status-types")

# Порядок (priority, code) живого сида. НЕ алфавит кодов и НЕ алфавит подписей —
# именно поэтому сравнение со списком целиком является гардом, а не совпадением.
EXPECTED_CODES = [
    "SICK_LEAVE",
    "LEAVE_BY_REPORT",
    "VACATION",
    "COMMAND",
    "STUDY",
    "COMPETITION",
    "CONFERENCE",
    "OTHER_ABSENCE",
    "DETACHED",
    "ATTACHED",
    "REST_AFTER_DUTY",
    "BEFORE_DUTY",
    "DUTY",
    "GEV",
    "EVENT_ASSIGNMENT",
    "PENDING_CLARIFICATION",
    "IN_SERVICE",
]

ROW_KEYS = {
    "code",
    "name",
    "is_hard_block",
    "priority",
    "report_column_code",
    "color",
}


@pytest.fixture
def env():
    """Живой RBAC-сид + живой каталог статус-типов + один дивизион под scope."""
    call_command("seed_operations")
    call_command("seed_statuses")
    org = Organization.objects.create(name="HQ", code="HQ-101d")
    dtp = DivisionType.objects.create(code="mgmt101d", name="Управление")
    div = Division.objects.create(
        organization=org, type_code=dtp, name="D1", code="D1-101d"
    )
    return org, dtp, div


def _grant(user_id, role_code, division=None):
    UserRole.objects.create(
        user_id=user_id,
        role_code_id=role_code,
        scope_division_id=division.id if division else None,
    )


def _client(actor):
    c = APIClient()
    c.raise_request_exception = False
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


def _get(actor):
    return _client(actor).get(URL)


# --- AC-1: happy path, шесть полей ------------------------------------------


def test_catalog_returns_seventeen_rows_with_exactly_six_fields(env):
    _grant("op-1", "DIVISION_OPERATOR")

    r = _get("op-1")

    assert r.status_code == 200
    assert isinstance(r.data, list)
    assert len(r.data) == 17
    # Лишнее поле в сериализаторе иначе проехало бы молча.
    assert set(r.data[0].keys()) == ROW_KEYS
    first = r.data[0]
    assert first["code"] == "SICK_LEAVE"
    assert first["name"] == "На больничном"
    assert first["is_hard_block"] is True
    assert first["priority"] == 10
    assert first["report_column_code"] == "SICK"


# --- AC-2: порядок задаёт сервер, и он не алфавитный ------------------------


def test_catalog_order_is_priority_then_code(env):
    _grant("op-1", "DIVISION_OPERATOR")

    codes = [row["code"] for row in _get("op-1").data]

    assert codes == EXPECTED_CODES
    # Гард самого гарда: если бы порядок совпал с алфавитом, ассерт выше был бы
    # вакуумен — любая клиентская сортировка дала бы то же.
    assert codes != sorted(codes)


# --- AC-3: деактивированные не отдаются -------------------------------------


def test_deactivated_type_is_absent(env):
    _grant("op-1", "DIVISION_OPERATOR")
    StatusType.objects.filter(code="STUDY").update(is_active=False)

    codes = [row["code"] for row in _get("op-1").data]

    assert "STUDY" not in codes
    assert len(codes) == 16


# --- AC-4: гейт права -------------------------------------------------------


def test_status_manage_without_view_is_forbidden(env):
    # INTEGRATION_USER держит ТОЛЬКО status.manage — не status.view.
    _grant("int-1", "INTEGRATION_USER")

    r = _get("int-1")

    assert r.status_code == 403
    assert r.data["error_code"] == "PERMISSION_DENIED"


def test_anonymous_forbidden(env):
    r = _get(None)

    assert r.status_code == 403
    assert r.data["error_code"] == "PERMISSION_DENIED"


# --- AC-5: держатели проходят, scope на каталог не влияет -------------------


def test_scoped_operator_gets_full_catalog(env):
    org, dtp, div = env
    # Скоуп на дивизион не должен сужать глобальный справочник.
    _grant("op-scoped", "DIVISION_OPERATOR", div)

    r = _get("op-scoped")

    assert r.status_code == 200
    assert [row["code"] for row in r.data] == EXPECTED_CODES


def test_viewer_and_admin_allowed(env):
    _grant("viewer-1", "VIEWER")
    _grant("admin-1", "ADMIN")

    assert _get("viewer-1").status_code == 200
    assert _get("admin-1").status_code == 200


# --- AC-6: Meta.ordering пинится литерально ---------------------------------


def test_status_type_meta_ordering_is_pinned():
    # Поведенческой пробы AC-2 недостаточно: селектор задаёт order_by явно, и
    # молчаливая смена Meta развела бы роут с Admin и names_map, оставив AC-2
    # зелёным.
    assert StatusType._meta.ordering == ["priority", "code"]
