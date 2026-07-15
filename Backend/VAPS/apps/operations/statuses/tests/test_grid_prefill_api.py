"""Story 10.1b — REST query-загрузка «вчера» (GET /statuses/grid-prefill/).

HTTP-контракт префилла грида 10.2: roster (текущие WORKING & is_active;
по дате версионируется ТОЛЬКО принадлежность к дивизиону — фактическая
семантика roster_on E1, найм/увольнение не версионированы) + живые
статус-интервалы, содержащие дату, одним ответом. Проверяет слой поверхности:
query-валидация (400), грубый гейт права status.view (403 ДО селектора),
scope-сужение селектором (канон L451 — чужие дивизионы отсутствуют, НЕ 403),
метод-поверхность (405 в обе стороны, пин 5.8c), NFR-4 (константное число
SQL-запросов).

RBAC: seed_operations + UserRole; держатели status.view = DIVISION_OPERATOR,
VIEWER (+ADMIN `*`). Auth — X-User-Id header (2.13-seam). Урок 10.1a: каждый
negative-ассерт спарен с ненулевым позитивным дискриминатором.
"""

import itertools
from datetime import date, datetime, timezone

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import Division, DivisionType, Employee, Organization, Rank
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus, StatusType

pytestmark = pytest.mark.django_db

D = date(2026, 6, 5)
URL = reverse("ops-status-grid-prefill")
BULK_URL = reverse("ops-status-bulk")
_iin = itertools.count(950001)


@pytest.fixture
def env():
    """Seed RBAC + org/division + status types (реюз формы 10.1a-фикстур)."""
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ-101b")
    dtp = DivisionType.objects.create(code="mgmt101b", name="Управление")
    div = Division.objects.create(
        organization=org, type_code=dtp, name="D1", code="D1-101b"
    )
    StatusType.objects.create(
        code="VACATION", name="Отпуск", is_hard_block=True,
        priority=20, report_column_code="VACATION",
    )
    StatusType.objects.create(
        code="STUDY", name="Учёба", is_hard_block=False,
        priority=32, report_column_code="TRAINING",
    )
    return org, dtp, div


def _division(org, dtp, code):
    return Division.objects.create(
        organization=org, type_code=dtp, name=f"D-{code}", code=code
    )


def _emp(div, full_name="T", rank_code=""):
    return Employee.objects.create(
        iin=f"{next(_iin):012d}", full_name=full_name, rank_code=rank_code,
        position_code="", division=div,
    )


def _status(emp, code="STUDY", start=date(2026, 6, 1), end=date(2026, 6, 10),
            cancelled=False):
    return EmployeeStatus.objects.create(
        employee_id=emp.id, status_type_code=code,
        date_start=start, date_end=end,
        cancelled_at=(
            datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc) if cancelled else None
        ),
    )


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


def _get(client, business_date="2026-06-05"):
    params = {} if business_date is None else {"business_date": business_date}
    return client.get(URL, params)


# --- AC-1 happy path: форма ответа, живые интервалы на дату, rank, порядок ---


def test_prefill_happy_shape_live_statuses_rank_and_order(env):
    _org, _dtp, div = env
    Rank.objects.create(code="MAJ", name="Майор")
    _grant("oper", "DIVISION_OPERATOR", division=div)
    e_b = _emp(div, full_name="Борисов", rank_code="MAJ")
    e_a = _emp(div, full_name="Асанов")  # без rank_code и без статуса
    _status(e_b, code="STUDY", start=date(2026, 6, 1), end=date(2026, 6, 10))
    # Шумовые строки НЕ в ответе: cancelled на дату + живой ВНЕ даты.
    _status(e_b, code="VACATION", start=date(2026, 6, 4), end=date(2026, 6, 6),
            cancelled=True)
    _status(e_b, code="VACATION", start=date(2026, 6, 20), end=date(2026, 6, 25))
    resp = _get(_client("oper"))
    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert body["business_date"] == "2026-06-05"
    # employees: roster на дату, детерминированный порядок (full_name, id).
    assert [e["full_name"] for e in body["employees"]] == ["Асанов", "Борисов"]
    by_name = {e["full_name"]: e for e in body["employees"]}
    assert by_name["Борисов"]["id"] == str(e_b.id)
    assert by_name["Борисов"]["rank"] == "Майор"  # имя из справочника Rank
    assert by_name["Асанов"]["id"] == str(e_a.id)
    # rank_code="" → rank == "" (НЕ null и НЕ отсутствие ключа) — фактическая
    # семантика denorm_for (rank_names.get("", "")); контракт для маппера 10.2:
    # трактовать "" как отсутствие звания.
    assert by_name["Асанов"]["rank"] == ""
    # statuses: ТОЛЬКО живой интервал, содержащий дату; e_a без статуса —
    # отсутствует (дефолт IN_SERVICE доклеивает фронт, AC-2).
    assert body["statuses"] == [
        {
            "employee_id": str(e_b.id),
            "status_type_code": "STUDY",
            "date_start": "2026-06-01",
            "date_end": "2026-06-10",
        }
    ]


def test_prefill_deterministic_id_tiebreak_on_same_name(env):
    _org, _dtp, div = env
    _grant("oper", "DIVISION_OPERATOR", division=div)
    e1 = _emp(div, full_name="Тёзка")
    e2 = _emp(div, full_name="Тёзка")
    ids = sorted([str(e1.id), str(e2.id)])
    body = _get(_client("oper")).json()
    assert [e["id"] for e in body["employees"]] == ids


def test_prefill_statuses_deterministic_order_two_live_statuses(env):
    # Ревью 10.1b (P2): 2+ живых статуса одного сотрудника — легальная
    # секондмент-пара DETACHED+ATTACHED (COMPATIBLE_PAIRS, стори 3.10; оба
    # soft — exclusion-констрейнт не мешает). Вставка НАМЕРЕННО в обратном
    # сортировке порядке (сначала DETACHED — лексикографически больший):
    # natural pk-порядок ≠ отсортированному, ассерт не вакуумен.
    _org, _dtp, div = env
    StatusType.objects.create(
        code="ATTACHED", name="Прикомандирован", is_hard_block=False,
        priority=40, report_column_code="SECONDED_IN",
    )
    StatusType.objects.create(
        code="DETACHED", name="Откомандирован", is_hard_block=False,
        priority=41, report_column_code="SECONDED_OUT",
    )
    _grant("oper", "DIVISION_OPERATOR", division=div)
    e = _emp(div, full_name="Секондмент")
    _status(e, code="DETACHED", start=date(2026, 6, 1), end=date(2026, 6, 10))
    _status(e, code="ATTACHED", start=date(2026, 6, 1), end=date(2026, 6, 10))
    body = _get(_client("oper")).json()
    # Точный порядок: (employee_id, status_type_code, date_start) — селектор
    # сортирует сам; правило выбора «победителя» — маппер 10.2.
    assert [s["status_type_code"] for s in body["statuses"]] == [
        "ATTACHED",
        "DETACHED",
    ]


def test_prefill_half_open_interval_pins_endpoint_contract(env):
    # Ревью 10.1b (P3): пин полуинтервала [date_start, date_end) НА ЭНДПОИНТЕ
    # (period '[)' корректен в модели — тест запирает контракт от регресса).
    # date_end ИСКЛЮЧИТЕЛЕН: статус, кончающийся business_date, НЕ в ответе;
    # date_start ВКЛЮЧИТЕЛЕН: статус, начинающийся business_date, — В ответе.
    _org, _dtp, div = env
    _grant("oper", "DIVISION_OPERATOR", division=div)
    e = _emp(div, full_name="Граница")
    _status(e, code="STUDY", start=date(2026, 6, 1), end=date(2026, 6, 5))
    _status(e, code="VACATION", start=date(2026, 6, 5), end=date(2026, 6, 6))
    body = _get(_client("oper")).json()  # business_date = 2026-06-05
    assert [
        (s["status_type_code"], s["date_start"], s["date_end"])
        for s in body["statuses"]
    ] == [("VACATION", "2026-06-05", "2026-06-06")]


# --- AC-2 пустое управление → 200 пустые списки ------------------------------


def test_prefill_empty_division_200_empty_lists(env):
    org, dtp, div = env
    empty = _division(org, dtp, "EMPTY-101b")
    _grant("oper", "DIVISION_OPERATOR", division=empty)
    # Дискриминатор утечки «пустой roster → вся БД» (ревью 10.1b): чужой
    # сотрудник с живым статусом, накрывающим дату, в ДРУГОМ дивизионе.
    # Без него тест зелёный на пустой БД = вакуум; с ним ассерты ниже ловят
    # overlapping_on(employee_ids=[]) → вся БД.
    outsider = _emp(div, full_name="Чужак")
    _status(outsider)  # живой [06-01, 06-10) — накрывает business_date
    resp = _get(_client("oper"))
    assert resp.status_code == 200, resp.content
    assert resp.json() == {
        "business_date": "2026-06-05", "employees": [], "statuses": [],
    }


# --- AC-3 scope: сужение селектором, НЕ 403 (канон L451) ---------------------


def test_prefill_scoped_sees_own_not_foreign(env):
    org, dtp, div = env
    other = _division(org, dtp, "OTHER-101b")
    _grant("oper", "DIVISION_OPERATOR", division=div)
    mine = _emp(div, full_name="Свой")
    foreign = _emp(other, full_name="Чужой")
    _status(mine)
    _status(foreign)
    resp = _get(_client("oper"))
    assert resp.status_code == 200, resp.content  # сужение, НЕ 403
    body = resp.json()
    emp_ids = {e["id"] for e in body["employees"]}
    status_emp_ids = {s["employee_id"] for s in body["statuses"]}
    # Ненулевой дискриминатор (урок вакуума 10.1a): свой ПРИСУТСТВУЕТ...
    assert str(mine.id) in emp_ids
    assert str(mine.id) in status_emp_ids
    # ...и только после этого — чужой ОТСУТСТВУЕТ (и его статус тоже).
    assert str(foreign.id) not in emp_ids
    assert str(foreign.id) not in status_emp_ids


def test_prefill_unscoped_grant_sees_all_divisions(env):
    org, dtp, div = env
    other = _division(org, dtp, "OTHER2-101b")
    _grant("viewer", "VIEWER")  # unscoped → visible=None → вся БД
    e1 = _emp(div, full_name="Один")
    e2 = _emp(other, full_name="Два")
    body = _get(_client("viewer")).json()
    emp_ids = {e["id"] for e in body["employees"]}
    assert {str(e1.id), str(e2.id)} <= emp_ids


# --- AC-4 без права → 403 ДО селектора ---------------------------------------


def test_prefill_without_view_permission_403(env):
    _org, _dtp, div = env
    _grant("omd", "OMD")  # держит report/assignment-права, НЕ status.view
    _emp(div, full_name="Есть кого видеть")  # был бы в ответе, будь гейт дыряв
    resp = _get(_client("omd"))
    assert resp.status_code == 403, resp.content
    assert resp.json()["error_code"] == "PERMISSION_DENIED"


def test_prefill_anonymous_403(env):
    _org, _dtp, div = env
    _emp(div, full_name="Есть кого видеть")
    resp = _get(_client(None))
    assert resp.status_code == 403, resp.content


# --- AC-5 валидация query → 400 ----------------------------------------------


def test_prefill_missing_business_date_400(env):
    _org, _dtp, div = env
    _grant("oper", "DIVISION_OPERATOR", division=div)
    resp = _get(_client("oper"), business_date=None)
    assert resp.status_code == 400, resp.content
    assert resp.json()["error_code"] == "VALIDATION_ERROR"


def test_prefill_garbage_business_date_400(env):
    _org, _dtp, div = env
    _grant("oper", "DIVISION_OPERATOR", division=div)
    resp = _get(_client("oper"), business_date="abc")
    assert resp.status_code == 400, resp.content
    assert resp.json()["error_code"] == "VALIDATION_ERROR"


# --- AC-6 поверхность методов (пин 5.8c) --------------------------------------


def test_post_grid_prefill_405(env):
    _org, _dtp, div = env
    _grant("oper", "DIVISION_OPERATOR", division=div)
    resp = _client("oper").post(URL, {"business_date": "2026-06-05"}, format="json")
    assert resp.status_code == 405, resp.content


def test_get_bulk_405_not_403_not_200(env):
    # «get» в http_method_names НЕ открывает GET на post-only bulk: action=None
    # → MethodNotAllowed в mixin (permissions.py:49-57, ревью 5.8c). И держателю,
    # и анониму — это метод-поверхность, не право.
    _org, _dtp, div = env
    _grant("integ", "INTEGRATION_USER")
    assert _client("integ").get(BULK_URL).status_code == 405
    assert _client(None).get(BULK_URL).status_code == 405


# --- AC-7 NFR-4: константное число SQL-запросов -------------------------------


def test_prefill_constant_query_count(env, django_assert_num_queries):
    _org, _dtp, div = env
    Rank.objects.create(code="CPT", name="Капитан")
    _grant("oper", "DIVISION_OPERATOR", division=div)
    # rank_code непустой — иначе denorm_for срезает Rank-запрос (пустой __in)
    # и пин недосчитывает полный путь.
    for i in range(12):
        e = _emp(div, full_name=f"Сотрудник {i:02d}", rank_code="CPT")
        _status(e)
    # Пин фактического числа (зафиксировано прогоном): auth-seam=3 (гранты+
    # temp-duty+права) + RBAC-резолв селектора=4 (гранты+temp-duty+права+дерево)
    # + roster_on=2 + denorm_for=2 + overlapping_on=1 = 12. Рост с числом
    # сотрудников/статусов = регресс NFR-4 (per-row анти-паттерн).
    client = _client("oper")
    with django_assert_num_queries(12):
        resp = _get(client)
    assert resp.status_code == 200, resp.content
    assert len(resp.json()["employees"]) == 12
    assert len(resp.json()["statuses"]) == 12
