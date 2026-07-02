"""RBAC-матрица роль×endpoint — сквозной gate-тест (Story 2.9, AR-9).

Параметризованная проверка «роль × зарегистрированный роут →
разрешено/запрещено» по 8 ролям + анониму. Назначение (epics.md#L468):

* completeness-gate: каждый обслуживаемый (роут, метод) обязан иметь
  строку в ``MATRIX``; роут вне матрицы → красный тест; протухшая строка
  (роут удалён) → красный тест.
* поведение: загейченные роуты (operations) проверяются вживую; держатели
  права выводятся из посева ``seed_operations`` — источник истины (AC-2).

ЖИВОЙ РЕЕСТР: новый endpoint ⇒ строка в ``MATRIX``, иначе AR-9 красный
(epics.md#L729: новые permission-коды добавляются в ``seed_operations`` +
строкой в эту матрицу).

Решение по core (Bratan, 2026-06-23): весь ``api/core/`` сейчас НЕ
загейчен (нет ``require_permission``). 2.9 не чинит гейты — фиксирует их
как ``_DeferredGate``; инвариант «аноним → 403» закодирован
``xfail(strict=True)`` и сам перевернётся, когда гейт появится (стори
2.13). Per-role политика core отложена в 2.13 (``PENDING``).

seed-в-тестах: общий канон запрещает seed в тестах (architecture.md#L437,
factory_boy). Здесь — санкционированное исключение: тест проверяет именно
РЕАЛЬНЫЙ посев ``seed_operations``, а не выдуманную фабриками копию (как
весь существующий RBAC-suite).
"""

import pytest
from django.core.management import call_command
from django.urls import NoReverseMatch, get_resolver, reverse
from django.urls.resolvers import URLPattern, URLResolver
from rest_framework.test import APIClient

from apps.operations.management.commands.seed_operations import (
    ROLE_PERMISSIONS,
)
from apps.operations.management.commands.seed_operations import (
    ROLES as SEED_ROLES,
)
from apps.operations.rbac.models import UserRole

pytestmark = pytest.mark.django_db

# --- акторы матрицы (AC: 8 ролей + аноним) ---
ROLE_CODES = [code for code, _name in SEED_ROLES]
ANON = "__anon__"
ACTORS = [*ROLE_CODES, ANON]

# --- ожидания ---
ALLOW = "allow"
DENY = "deny"
PENDING = "pending"  # core per-role политика → стори 2.13

# Служебные DRF-роуты без бизнес-стража — вне матрицы.
_NON_ENDPOINT_NAMES = {"api-root"}
_IGNORED_METHODS = {"head", "options", "trace"}


# ---------------------------------------------------------------------------
# Виды стражей роута
# ---------------------------------------------------------------------------
def _holders(code):
    return {
        role
        for role, perms in ROLE_PERMISSIONS.items()
        if code in perms or "*" in perms
    }


class _Gate:
    """Загейчен правом ``code`` (одно право на все методы роута): ALLOW
    держателям code (по seed), аноним DENY."""

    def __init__(self, code):
        self.code = code

    def expected(self, actor, method=None):
        if actor == ANON:
            return DENY
        return ALLOW if actor in _holders(self.code) else DENY


class _MethodGate:
    """Per-method страж: разные коды на разные HTTP-методы одного роута
    (смешанная view/edit политика, story 2.14 / deferred 2.9 #L215).
    ``methods`` обязан == served-методам роута (per-метод completeness)."""

    def __init__(self, method_codes):
        self.method_codes = {m.lower(): c for m, c in method_codes.items()}

    @property
    def methods(self):
        return set(self.method_codes)

    def expected(self, actor, method):
        if actor == ANON:
            return DENY
        return ALLOW if actor in _holders(self.method_codes[method]) else DENY


class _AnyAuthenticated:
    """ALLOW любому actor_id (право не требуется), аноним DENY."""

    def expected(self, actor, method=None):
        return DENY if actor == ANON else ALLOW


class _DeferredGate:
    """core-роут без стража: гейт отложен в стори-гейт."""

    def __init__(self, fix_ref):
        self.fix_ref = fix_ref

    def expected(self, actor, method=None):
        # Инвариант безопасности: аноним должен получать DENY (пока xfail).
        return DENY if actor == ANON else PENDING


# ---------------------------------------------------------------------------
# Декларативная матрица: name → страж. ОБНОВЛЯТЬ при добавлении endpoint.
# ---------------------------------------------------------------------------
MATRIX = {
    # operations — загейчено require_permission("admin.roles"):
    "ops-role-list": _Gate("admin.roles"),
    "ops-role-detail": _Gate("admin.roles"),
    "ops-permission-list": _Gate("admin.roles"),
    "ops-permission-detail": _Gate("admin.roles"),
    "ops-user-role-list": _Gate("admin.roles"),
    "ops-user-role-detail": _Gate("admin.roles"),
    "ops-temp-duty-list": _Gate("admin.roles"),
    "ops-temp-duty-expire": _Gate("admin.roles"),
    "ops-my-permissions-list": _AnyAuthenticated(),
    # daily-submissions — сдача дня (story 5.8a), POST-only до 5.8b/5.8c. Гейт
    # RequirePermissionMixin {"create": mark_update} — здесь ГРУБАЯ проверка
    # кода (resolver division-free); scope «чужое подразделение → 403» живёт в
    # сервис-гарде ensure_division_scope и матрицей не проверяется (payloadless
    # POST держателя = 400 бизнес-слоя = ALLOW по канону).
    "ops-daily-submission-list": _MethodGate({"post": "daily_report.mark_update"}),
    # amend сдачи (story 5.8b, POST /{id}/amend/). Гейт mixin {"amend":
    # daily_report.correct}; scope «чужое подразделение → 403» — в сервис-гарде
    # ensure_division_scope (матрицей не проверяется: payloadless POST держателя
    # на pk=0 = 400 формы = ALLOW по канону).
    "ops-daily-submission-amend": _MethodGate({"post": "daily_report.correct"}),
    # audit — read-only журнал, загейчен RequirePermissionMixin("audit.view")
    # (story 4.5). GET-only (list+retrieve); ORGD/ADMIN → ALLOW, прочие/аноним
    # → DENY (из seed).
    "audit-log-list": _Gate("audit.view"),
    "audit-log-detail": _Gate("audit.view"),
    # notifications — личный read-only feed (story 5.7c). Гейт = аутентификация
    # (self-scope recipient==actor_id в NotificationSelector — контроль доступа,
    # НЕ RBAC-код); зеркало ops-my-permissions-list. Аноним → 403, любой actor →
    # ALLOW (его список, возможно пустой). seed_operations НЕ трогается.
    "notification-list": _AnyAuthenticated(),
    # core — загейчено RequirePermissionMixin (story 2.13 механизм A + 2.14
    # раскатка). GET=view, write(create/update/destroy/archive/...)=edit/manage.
    "vacancy-list": _Gate("personnel.view"),  # GET-only (2.13 пилот)
    # personnel.* (Employee + StaffingSlot):
    "employee-list": _MethodGate({"get": "personnel.view", "post": "personnel.edit"}),
    "employee-detail": _MethodGate(
        {"get": "personnel.view", "patch": "personnel.edit"}
    ),
    "employee-archive": _Gate("personnel.edit"),
    "employee-restore": _Gate("personnel.edit"),
    "staffing-slot-list": _MethodGate(
        {"get": "personnel.view", "post": "personnel.edit"}
    ),
    "staffing-slot-detail": _MethodGate(
        {"get": "personnel.view", "patch": "personnel.edit"}
    ),
    "staffing-slot-assign-employee": _Gate("personnel.edit"),  # закрывает #L25
    "staffing-slot-release": _Gate("personnel.edit"),
    # orgstructure.* (Division + Position + Rank):
    "division-list": _MethodGate(
        {"get": "orgstructure.view", "post": "orgstructure.manage"}
    ),
    "division-detail": _MethodGate(
        {
            "get": "orgstructure.view",
            "put": "orgstructure.manage",
            "patch": "orgstructure.manage",
            "delete": "orgstructure.manage",
        }
    ),
    "division-leaf-descendants": _Gate("orgstructure.view"),  # GET-only
    "position-list": _MethodGate(
        {"get": "orgstructure.view", "post": "orgstructure.manage"}
    ),
    "position-detail": _MethodGate(
        {"get": "orgstructure.view", "patch": "orgstructure.manage"}
    ),
    "rank-list": _MethodGate(
        {"get": "orgstructure.view", "post": "orgstructure.manage"}
    ),
    "rank-detail": _MethodGate(
        {"get": "orgstructure.view", "patch": "orgstructure.manage"}
    ),
}


# ---------------------------------------------------------------------------
# Интроспекция роутов из резолвера
# ---------------------------------------------------------------------------
def _walk(resolver):
    for pattern in resolver.url_patterns:
        if isinstance(pattern, URLResolver):
            yield from _walk(pattern)
        elif isinstance(pattern, URLPattern):
            callback = pattern.callback
            yield (
                pattern.name,
                getattr(callback, "cls", None),
                getattr(callback, "actions", None),
            )


_HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def _served_routes():
    """name → set(методы): что реально обслуживает API.

    Пересекаем с ``http_method_names`` (настоящий 405-фильтр), отсекаем
    format-suffix дубли (один name) и служебные методы. Покрываем оба
    DRF-паттерна, иначе роут проскользнёт мимо AR-9:

    * router-ViewSet → методы из ``callback.actions`` ∩ allowed;
    * plain ``APIView``/``GenericAPIView`` (``actions`` нет) → определённые
      хендлеры (get/post/...) ∩ allowed.
    """
    served = {}
    for name, cls, actions in _walk(get_resolver()):
        if cls is None or name in _NON_ENDPOINT_NAMES:
            continue
        allowed = {m.lower() for m in getattr(cls, "http_method_names", [])}
        if actions:
            methods = {m for m in actions if m in allowed and m not in _IGNORED_METHODS}
        else:
            methods = {
                m
                for m in allowed & _HTTP_METHODS
                if m not in _IGNORED_METHODS and callable(getattr(cls, m, None))
            }
        if methods:
            served.setdefault(name, set()).update(methods)
    return served


SERVED = _served_routes()


# ---------------------------------------------------------------------------
# Completeness-gate (AC-1)
# ---------------------------------------------------------------------------
def test_matrix_covers_every_registered_route():
    """Каждый обслуживаемый роут ∈ MATRIX; нет протухших строк (AR-9)."""
    served_names = set(SERVED)
    matrix_names = set(MATRIX)
    missing = served_names - matrix_names
    stale = matrix_names - served_names
    assert not missing, (
        f"роуты без строки в MATRIX (AR-9 — добавь строку): {sorted(missing)}"
    )
    assert not stale, f"протухшие строки MATRIX (роут удалён — убери): {sorted(stale)}"


def test_matrix_declares_all_actors_explicitly():
    """Каждая (строка, метод) даёт явное ожидание для 8 ролей + анонима."""
    for name, spec in MATRIX.items():
        for method in sorted(SERVED.get(name) or {"get"}):
            for actor in ACTORS:
                verdict = spec.expected(actor, method)
                assert verdict in (ALLOW, DENY, PENDING), (
                    f"{name}/{method}/{actor}: нет явного ожидания ({verdict!r})"
                )


def test_method_gates_cover_exactly_served_methods():
    """Per-метод completeness (AR-9 / deferred 2.9 #L215): _MethodGate обязан
    покрывать РОВНО served-методы роута — новый метод без кода → красный."""
    for name, spec in MATRIX.items():
        if isinstance(spec, _MethodGate):
            assert spec.methods == SERVED.get(name, set()), (
                f"{name}: _MethodGate методы {sorted(spec.methods)} ≠ "
                f"served {sorted(SERVED.get(name, set()))}"
            )


def test_actor_set_is_eight_roles_plus_anon():
    assert len(ROLE_CODES) == 8, ROLE_CODES
    assert len(ACTORS) == 9 and ACTORS[-1] == ANON


def test_introspection_is_not_vacuous():
    # Защита от «зелёного-вакуума»: если резолвер/URLconf сломан и SERVED
    # пуст, completeness- и поведенческий гейты прошли бы ни о чём.
    assert SERVED, "интроспекция вернула 0 роутов — сломан резолвер/URLconf"
    assert _behavioral_params(), "0 поведенческих кейсов — пустая матрица"


# ---------------------------------------------------------------------------
# Ground-truth ожиданий operations (AC-3)
# ---------------------------------------------------------------------------
def test_operations_admin_routes_are_admin_only():
    spec = MATRIX["ops-role-list"]
    assert spec.expected("ADMIN") == ALLOW
    for role in ROLE_CODES:
        if role != "ADMIN":
            assert spec.expected(role) == DENY, role
    assert spec.expected(ANON) == DENY


def test_my_permissions_is_any_authenticated():
    spec = MATRIX["ops-my-permissions-list"]
    for role in ROLE_CODES:
        assert spec.expected(role) == ALLOW, role
    assert spec.expected(ANON) == DENY


# ---------------------------------------------------------------------------
# Поведенческая проверка роль×endpoint (AC-2, AC-3, AC-4)
# ---------------------------------------------------------------------------
def _user_for(role):
    return f"{role.lower()}-matrix-user"


def _url_for(name):
    try:
        return reverse(name)
    except NoReverseMatch:
        return reverse(name, kwargs={"pk": "0"})


def _behavioral_params():
    params = []
    for name in sorted(SERVED):
        spec = MATRIX.get(name)
        if spec is None:
            continue  # completeness-тест поймает missing
        for method in sorted(SERVED[name]):
            for actor in ACTORS:
                verdict = spec.expected(actor, method)
                if verdict == PENDING:
                    # core per-role → стори 2.13 (декларировано в MATRIX,
                    # не исполняется здесь).
                    continue
                marks = []
                if isinstance(spec, _DeferredGate):
                    marks = [
                        pytest.mark.xfail(
                            strict=True,
                            reason=f"core не загейчен; гейт → {spec.fix_ref}",
                        )
                    ]
                params.append(
                    pytest.param(
                        name,
                        method,
                        actor,
                        verdict,
                        id=f"{name}|{method}|{actor}",
                        marks=marks,
                    )
                )
    return params


@pytest.fixture
def matrix_actors():
    call_command("seed_operations")
    for role in ROLE_CODES:
        UserRole.objects.create(user_id=_user_for(role), role_code_id=role)


@pytest.mark.parametrize("name, method, actor, verdict", _behavioral_params())
def test_rbac_matrix_behaviour(matrix_actors, name, method, actor, verdict):
    client = APIClient()
    # Не пробрасывать исключения вьюхи: ALLOW-проба без валидного payload
    # может упасть в бизнес-логике — нам важен лишь слой авторизации (≠403).
    client.raise_request_exception = False
    if actor != ANON:
        client.credentials(HTTP_X_USER_ID=_user_for(actor))
    response = getattr(client, method)(_url_for(name))
    if verdict == DENY:
        assert response.status_code == 403, (
            f"{name}/{method}/{actor}: ожидался 403 DENY, "
            f"получен {response.status_code}"
        )
    else:
        # ALLOW = слой авторизации пропустил запрос. 401/403 = отказ
        # авторизации. 5xx на payloadless-create (страж зовётся ДО
        # request.data[...] → KeyError) = «пропущено»: снятие стража ловят
        # DENY-ячейки (роль без права → ≠403 → красный), не эта ветка.
        assert response.status_code not in (401, 403), (
            f"{name}/{method}/{actor}: ожидался ALLOW, получен {response.status_code}"
        )
