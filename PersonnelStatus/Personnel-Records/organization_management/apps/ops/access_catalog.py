"""Каталог функций права: где право применяется (Plane №36, шаг «П-1»).

Заказчик отказался от третьего уровня «функция» отдельной сущностью: право
(`Permission`) остаётся тем, что проверяют ручки, а «функции» — read-only
список мест, которые это право открывает.

Поэтому каталог НЕ ХРАНИТСЯ, а собирается из карт `permission_map`, у которых
уже есть владелец — сами вьюсеты. Копия в базе устаревала бы при первой же
правке гейта, и экран настроек обещал бы доступ, которого нет.

Обход идёт по URL-резолверу, а не по списку роутеров: маршрут, подключённый
мимо роутера, тоже гейтится и обязан попасть в каталог.

ВТОРОЙ СПОСОБ ГЕЙТА — ПОСТРОЧНЫЙ (Plane №108). Часть ручек закрыта не картой,
а вызовом прямо в теле метода: `require_permission(request, "admin.roles")` и
`require_scoped_permission(request, CODE, …)`. Так закрыт ВЕСЬ админ-API
раздела доступа (`/api/operations/{roles,permissions,accounts,user-roles}`) и
звенья цепочки сбора сил, где право проверяется вместе с областью. Карты у них
нет, и до 26.08.2026 каталог не показывал их вовсе: экран «Права» отвечал
«право не стоит ни на одной ручке» ровно про то право, которым закрыт сам этот
экран.

Построчные вызовы читаются РАЗБОРОМ ИСХОДНИКА (ast), а не запуском кода:
выполнить метод, чтобы узнать, что он проверяет, нельзя — у него запрос,
транзакция и побочные действия. Разбор видит то же, что видит человек, читая
метод, и не может ничего изменить.
"""
import ast
import inspect
import re
import textwrap

from django.urls import URLPattern, URLResolver, get_resolver

#: Имена функций, которыми право проверяют построчно.
_INLINE_GUARDS = frozenset({"require_permission", "require_scoped_permission"})

#: Именованная группа регекса → читаемый плейсхолдер: администратору нужен
#: адрес ручки, а не выражение, по которому он матчится.
_GROUP = re.compile(r"\(\?P<(?P<name>\w+)>[^)]*\)")


#: Классы символов и остатки паттерна после снятия именованных групп.
#:
#: Нужны потому, что `_GROUP` разбирает группу НЕЖАДНО до первой `)`: у
#: маршрута с проверкой внутри — `(?P<assignment_id>(?!assign/|complete/)[^/]+)`
#: — после подстановки остаётся хвост `[^/]+)`. Отдельного снятия
#: проверочных групп не требуется: пробовал, вывод не меняется ни на одном
#: маршруте (красная проба зелёная — значит код мёртвый).
_CHARCLASS = re.compile(r"\[[^\]]*\][+*?]?")


def _readable(path):
    """Путь маршрута словами: без якорей и регексов."""
    cleaned = _GROUP.sub(lambda match: "<" + match.group("name") + ">", path)
    cleaned = _CHARCLASS.sub("", cleaned)
    for junk in ("^", "$", "\\", "(", ")"):
        cleaned = cleaned.replace(junk, "")
    return "/" + cleaned.lstrip("/")


def _as_codes(value):
    """Значение карты обходов — код или их список; наружу всегда список."""
    if value is None:
        return ()
    if isinstance(value, str):
        return (value,)
    return tuple(value)


def _inline_codes(view_class):
    """{действие: код права} — из построчных проверок в теле методов.

    Возвращает пусто, если исходник недоступен (класс собран динамически) или
    не разбирается: каталог обязан остаться работоспособным, даже когда одну
    вьюху прочитать не удалось. Молчаливое исключение здесь опаснее пустоты —
    оно уронило бы экран целиком.
    """
    cached = getattr(view_class, "_inline_permission_cache", None)
    if cached is not None:
        return cached
    try:
        source = textwrap.dedent(inspect.getsource(view_class))
        tree = ast.parse(source)
        module = inspect.getmodule(view_class)
    except (OSError, TypeError, SyntaxError):
        return {}

    def code_of(call):
        """Второй аргумент вызова: строка или модульная константа."""
        if len(call.args) < 2:
            return None
        node = call.args[1]
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.Name) and module is not None:
            value = getattr(module, node.id, None)
            return value if isinstance(value, str) else None
        return None

    found = {}
    for class_node in ast.walk(tree):
        if not isinstance(class_node, ast.ClassDef):
            continue
        for member in class_node.body:
            if not isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for node in ast.walk(member):
                if not isinstance(node, ast.Call):
                    continue
                name = getattr(node.func, "id", None) or getattr(
                    node.func, "attr", None
                )
                if name not in _INLINE_GUARDS:
                    continue
                code = code_of(node)
                # Первая проверка в методе и есть его гейт: дальше в теле
                # могут стоять проверки ДРУГИХ прав по ветвям, и показывать
                # их как «функцию» права значило бы обещать вход, которого у
                # него нет.
                if code is not None and member.name not in found:
                    found[member.name] = code
    try:
        view_class._inline_permission_cache = found
    except (AttributeError, TypeError):
        pass
    return found


def _walk(patterns, prefix=""):
    for entry in patterns:
        if isinstance(entry, URLResolver):
            yield from _walk(entry.url_patterns, prefix + str(entry.pattern))
        elif isinstance(entry, URLPattern):
            yield prefix + str(entry.pattern), entry


def _rows():
    """Плоский список (право, метод, путь, действие, вьюсет)."""
    for path, entry in _walk(get_resolver().url_patterns):
        view_class = getattr(entry.callback, "cls", None)
        if view_class is None:
            continue
        permission_map = getattr(view_class, "permission_map", None) or {}
        inline_map = _inline_codes(view_class)
        # Права, которые действие не закрывают, а открывают шире (Plane №602).
        bypass_map = getattr(view_class, "permission_bypass_map", None) or {}
        # Пусто И там, и там — вьюха не гейтится вовсе, показывать нечего.
        # Раньше здесь стоял выход по пустой КАРТЕ, и вьюсеты, закрытые только
        # построчными вызовами, отсекались до разбора: весь админ-API раздела
        # доступа не попадал в каталог, хотя закрыт правом `admin.roles`
        # (Plane №108).
        if not permission_map and not inline_map and not bypass_map:
            continue
        # DRF кладёт карту «метод → действие» атрибутом `actions` на саму
        # view-функцию (не в `initkwargs` роутера — там только suffix и
        # basename). У маршрутов, подключённых как APIView, её нет: действие
        # неизвестно, и такой маршрут в каталог не попадает, вместо того чтобы
        # попасть с выдуманным именем.
        actions = getattr(entry.callback, "actions", None)
        if not actions:
            continue
        # `.json`-суффиксы DRF — тот же маршрут во втором написании: в
        # каталоге они дали бы каждую функцию дважды.
        if "format" in path:
            continue
        for method, action in actions.items():
            # HEAD и OPTIONS — служебные двойники (DRF отображает HEAD на то
            # же действие, что и GET). В каталоге они дали бы вторую строку с
            # тем же адресом: администратор прочитал бы её как ВТОРУЮ функцию
            # права, хотя это тот же самый вход (поймано на экране «Права»).
            # HEAD и OPTIONS — служебные двойники (DRF отображает HEAD на то
            # же действие, что и GET). В каталоге они дали бы вторую строку с
            # тем же адресом: администратор прочитал бы её как ВТОРУЮ функцию
            # права, хотя это тот же самый вход (поймано на экране «Права»).
            if method.lower() in ("head", "options"):
                continue
            # 🔴 ПРАВО-ОБХОД ПОКАЗЫВАЕТСЯ ОТДЕЛЬНОЙ СТРОКОЙ (Plane №602).
            # Бывает право, которое действие не ЗАКРЫВАЕТ, а ОТКРЫВАЕТ шире:
            # `placement.command` не гейтит расстановку (её гейтит
            # `placement.manage`), он снимает проверку «своё ли мероприятие».
            # Проверяется он членством в наборе прав, а не вызовом-гвардом,
            # поэтому ни карта, ни разбор построчных гвардов его не видели — и
            # экран «Права» говорил администратору, что право не стоит НИ НА
            # ОДНОЙ ручке. Ровно тот регресс, ради которого написана проба
            # `test_catalog_sees_routes_closed_by_an_inline_check`, только с
            # другой стороны: там гейт был не в карте, здесь — не гейт вовсе.
            #
            # Объявляется вьюсетом явно (`permission_bypass_map`), а не
            # выводится разбором: «право снимает проверку» — решение автора
            # вьюхи, и угадывать его по коду значило бы завести второй, неявный
            # источник правды о правах.
            for extra in _as_codes(bypass_map.get(action)):
                yield {
                    "permission": extra,
                    "method": method.upper(),
                    "path": _readable(path),
                    "action": action,
                    "view": view_class.__name__,
                }
            code = permission_map.get(action)
            if code is None:
                # Карта молчит — смотрим построчный гейт в теле метода
                # (Plane №108). Порядок именно такой: карта — объявленное
                # правило вьюсета, построчная проверка — частный случай.
                code = inline_map.get(action)
            if code is None:
                continue
            yield {
                "permission": code,
                "method": method.upper(),
                "path": _readable(path),
                "action": action,
                "view": view_class.__name__,
            }


def catalog(search=""):
    """{код права: [функции]} — отсортировано и пригодно для показа.

    `search` фильтрует по пути и действию: администратор ищет «где вообще
    трогают расстановку», а не только «как называется право».
    """
    needle = (search or "").strip().lower()
    grouped = {}
    for row in _rows():
        if needle != "" and needle not in (
            f"{row['permission']} {row['path']} {row['action']} {row['view']}".lower()
        ):
            continue
        grouped.setdefault(row["permission"], []).append(row)
    for rows in grouped.values():
        rows.sort(key=lambda row: (row["path"], row["method"]))
    return grouped
