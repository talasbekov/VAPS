"""Ни один маршрут раздела не отвечает анониму делом.

Гейт в разделе устроен ТРЕМЯ разными способами, и это не беспорядок, а история:
основная поверхность закрыта миксином с картой прав (fail-closed по умолчанию),
администрирование ролей — построчными вызовами require_permission внутри каждого
действия, а личная лента и «мои права» открыты любому опознанному (там вопрос не
«кому можно», а «чьё»).

Проверка поэтому ПОВЕДЕНЧЕСКАЯ, а не структурная: она обходит РЕАЛЬНО
зарегистрированные маршруты и стучится в каждый анонимом. Структурная проверка
(«у всех есть permission_map») знала бы только про один способ из трёх и объявила
бы дырой два законных; поведенческая не зависит от того, как гейт написан, и
поймает новый способ тоже.

Главное, ради чего файл существует: НОВОЕ ДЕЙСТВИЕ. Добавить @action к
проходному viewset и забыть про право — работа одной строки, и никакой
существующий тест этого не заметит: он про свои маршруты. Здесь маршруты
перечисляет сам роутер, поэтому новый попадает под проверку сам, без чьей-либо
памяти.
"""
import pytest
from rest_framework.test import APIClient

from organization_management.apps.operations.api.urls import router

pytestmark = pytest.mark.django_db

# Что считается «не пустили»: 403 — гейт раздела, 401 — контракт
# аутентификации. Всё прочее означает, что запрос ушёл ДАЛЬШЕ гейта.
REFUSALS = frozenset({401, 403})

# Метод, которым щупается каждое действие.
METHOD_OF = {
    "list": "get",
    "retrieve": "get",
    "create": "post",
    "update": "put",
    "partial_update": "patch",
    "destroy": "delete",
}


def _routes():
    """(имя маршрута, путь, метод) по каждому зарегистрированному действию.

    Источник — сам роутер, а не список в тесте: список пришлось бы дописывать
    руками, и ровно этого никто не сделает для маршрута, о котором забыл.
    """
    found = []
    for prefix, viewset, _basename in router.registry:
        extra = {
            action.__name__: action for action in viewset.get_extra_actions()
        }
        for name, action in extra.items():
            method = "post" if "post" in action.mapping else next(iter(action.mapping))
            path = (
                f"/api/operations/{prefix}/1/{action.url_path}/"
                if action.detail
                else f"/api/operations/{prefix}/{action.url_path}/"
            )
            found.append((f"{prefix}.{name}", path, method))
        for name, method in METHOD_OF.items():
            if name in extra or not hasattr(viewset, name):
                continue
            detail = name in ("retrieve", "update", "partial_update", "destroy")
            base = f"/api/operations/{prefix}/"
            path = f"{base}1/" if detail else base
            found.append((f"{prefix}.{name}", path, method))
    return sorted(found)


ROUTES = _routes()


def test_the_router_actually_exposes_routes():
    """Опора всего файла: пустой список маршрутов сделал бы проверку ниже
    вечнозелёной — параметризация по нулю случаев рапортует об успехе."""
    assert len(ROUTES) >= 30, f"роутер отдал подозрительно мало маршрутов: {ROUTES}"


@pytest.mark.parametrize(
    "name,path,method", ROUTES, ids=[route[0] for route in ROUTES]
)
def test_an_anonymous_request_is_refused(name, path, method):
    """Аноним не должен получить НИ ДЕЛА, НИ ПОДСКАЗКИ.

    Проверяется именно 401/403, а не «не 200»: 404 или 400 означали бы, что
    запрос прошёл гейт и дошёл до поиска объекта или разбора формы — то есть
    гейта нет, а отказ случаен и исчезнет, как только аноним угадает
    существующий id или пришлёт верное тело.
    """
    response = getattr(APIClient(), method)(path)

    assert response.status_code in REFUSALS, (
        f"{name}: {method.upper()} {path} ответил {response.status_code} "
        "вместо отказа — маршрут не закрыт гейтом"
    )


# ── Почему аноним — не вся проверка ──────────────────────────────────────


def test_an_action_missing_from_the_map_is_denied_to_everyone():
    """Граница возможностей проверки выше — и причина, по которой её мало.

    Проба «завести @action и забыть право» аноним НЕ ловит, и это не дыра теста:
    миксин fail-closed, действие вне карты запрещено само по себе, и аноним
    получил бы отказ в любом случае. Свойство несущее, поэтому закреплено прямо:
    сделай карту разрешающей по умолчанию — и забытое право стало бы открытым
    маршрутом, а поведенческая проверка выше этого не заметила бы.

    Зовётся НАСТОЯЩИЙ initial() миксина. Первый проход этого теста считал
    решение гейта своей копией кода — то есть проверял копию, а не миксин, и
    остался бы зелёным при любой правке настоящего. Здесь под миксином стоит
    заглушка-основание, чтобы super().initial() ничего не разбирал: интересует
    только решение гейта.
    """
    from rest_framework.exceptions import PermissionDenied

    from organization_management.apps.operations.api.permissions import (
        RequirePermissionMixin,
    )

    class Base:
        def initial(self, request, *args, **kwargs):
            return None

    class Probe(RequirePermissionMixin, Base):
        permission_map = {"known": "status.view"}
        http_method_names = ["get"]
        action = "forgotten"

    class FakeRequest:
        method = "GET"

    with pytest.raises(PermissionDenied):
        Probe().initial(FakeRequest())


def test_the_same_mixin_lets_a_mapped_action_through_to_the_permission_check():
    """Обратная сторона: отказ выше должен быть про ОТСУТСТВИЕ в карте, а не про
    то, что миксин отвергает всё подряд.

    Действие, которое в карте ЕСТЬ, доходит до проверки права — и падает уже на
    ней (у поддельного запроса нет идентичности). Разные причины отказа
    различаются тем, что этот путь вообще добирается до require_permission.
    """
    from rest_framework.exceptions import PermissionDenied

    from organization_management.apps.operations.api.permissions import (
        RequirePermissionMixin,
    )

    class Base:
        def initial(self, request, *args, **kwargs):
            return None

    class Probe(RequirePermissionMixin, Base):
        permission_map = {"known": "status.view"}
        http_method_names = ["get"]
        action = "known"

    class FakeRequest:
        method = "GET"
        user = None

    with pytest.raises(PermissionDenied):
        Probe().initial(FakeRequest())
