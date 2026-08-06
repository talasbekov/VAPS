"""Спецификация раздела описывает КАЖДЫЙ его маршрут и КАЖДЫЙ успешный ответ.

По этой спецификации фронт генерирует типы. Маршрут, выпавший из неё, и ответ без
описанного тела — это не «некрасиво в документации»: у клиента просто не
появляется тип, и он пишет запрос вслепую, узнавая форму ответа опытным путём.
Сервер при этом отвечает правильно, тесты зелены, и заметить пропажу можно только
глазами в сгенерированном файле — то есть никогда.

Файл заведён не впрок: он сразу нашёл, что GET .../strength-report/period/ отдаёт
«200 без тела» — при правке соседнего маршрута оба декоратора схемы съехали на
выгрузку, а сам период остался без своего. Ни один тест поведения этого увидеть не
мог, потому что поведение было верным.

Спецификация здесь СТРОИТСЯ, а не читается с диска: файл на диске отстаёт ровно
тогда, когда его забыли пересобрать, — то есть в том самом случае, ради которого
проверка нужна.
"""
import pytest
from drf_spectacular.generators import SchemaGenerator

from organization_management.apps.operations.api.urls import router

OPS_PREFIX = "/api/operations/"

# 204 «нет содержимого» — тело не положено по определению, и требовать его
# значило бы требовать нарушения протокола.
BODILESS_STATUSES = frozenset({"204"})


@pytest.fixture(scope="module")
def schema():
    return SchemaGenerator().get_schema(request=None, public=True)


@pytest.fixture(scope="module")
def ops_paths(schema):
    return {
        path: operations
        for path, operations in schema["paths"].items()
        if path.startswith(OPS_PREFIX)
    }


def _success_responses(operations):
    for method, operation in operations.items():
        if method not in ("get", "post", "put", "patch", "delete"):
            continue
        for status, body in (operation.get("responses") or {}).items():
            if status.startswith("2"):
                yield method, status, body


# ── Маршруты на месте ────────────────────────────────────────────────────


def test_the_schema_is_built_at_all(ops_paths):
    """Опора файла: пустая спецификация сделала бы всё ниже вечнозелёным."""
    assert len(ops_paths) >= 40


def _registered_action_paths():
    """Пути ИМЕНОВАННЫХ действий по роутеру: {prefix}/{url_path}/.

    Именно они теряются незаметно. Генератор схемы при ошибке разбора вьюхи
    пишет «Ignoring view for now» и молча выкидывает её операции — в логе это
    строка среди прочих, в файле схемы просто нет маршрута, а прогон зелёный.
    """
    paths = set()
    for prefix, viewset, _basename in router.registry:
        for action in viewset.get_extra_actions():
            middle = "{id}/" if action.detail else ""
            paths.add(f"{OPS_PREFIX}{prefix}/{middle}{action.url_path}/")
    return paths


def test_every_named_action_reaches_the_schema(ops_paths):
    """Действие, выпавшее из спецификации, для клиента не существует.

    Сравнение идёт с РОУТЕРОМ, а не со списком в тесте: список пришлось бы
    дописывать руками, и для забытого действия этого никто не сделает.

    Чего проверка НЕ ловит и не должна: удаление маршрута целиком — он пропадает
    и из роутера, и из схемы одновременно. Это осознанное действие, а не
    просачивание.
    """
    missing = sorted(_registered_action_paths() - set(ops_paths))

    assert missing == []


# ── Ответы описаны ───────────────────────────────────────────────────────


def test_every_successful_response_describes_its_body(ops_paths):
    """Несущий тест файла — тот, что нашёл дефект.

    «200 без тела» означает, что кодогенерация не даст клиенту типа: он будет
    писать запрос вслепую. Сервер при этом отвечает правильно, и тесты поведения
    молчат.
    """
    bodiless = [
        f"{method.upper()} {path} → {status}"
        for path, operations in ops_paths.items()
        for method, status, body in _success_responses(operations)
        if status not in BODILESS_STATUSES and not body.get("content")
    ]

    assert bodiless == []


def test_the_bodiless_exception_is_only_no_content(ops_paths):
    """Исключение ровно одно и оно протокольное.

    Без этой проверки список исключений можно было бы тихо расширить, и «все
    ответы описаны» стало бы означать «все, кроме тех, что мы решили не
    описывать».
    """
    exceptions = {
        status
        for _path, operations in ops_paths.items()
        for _method, status, body in _success_responses(operations)
        if not body.get("content")
    }

    assert exceptions <= BODILESS_STATUSES


# ── Тот самый маршрут ────────────────────────────────────────────────────


def test_the_period_route_describes_its_pages(ops_paths):
    """Поимённо, потому что именно он и потерялся: общая проверка выше скажет
    «что-то не описано», а этот тест — что именно сломали."""
    body = ops_paths[f"{OPS_PREFIX}strength-report/period/"]["get"]["responses"]["200"]

    assert "application/json" in body["content"]


def test_the_period_export_route_stays_a_file_and_not_json(ops_paths):
    """Соседний маршрут не должен пострадать от починки первого: он отдаёт файл,
    и объявленный как json он ввёл бы кодогенерацию в заблуждение."""
    body = ops_paths[f"{OPS_PREFIX}strength-report/period-export/"]["get"]["responses"][
        "200"
    ]

    assert "text/csv" in body["content"]
