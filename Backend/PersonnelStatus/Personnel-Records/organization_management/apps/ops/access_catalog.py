"""Каталог функций права: где право применяется (Plane №36, шаг «П-1»).

Заказчик отказался от третьего уровня «функция» отдельной сущностью: право
(`Permission`) остаётся тем, что проверяют ручки, а «функции» — read-only
список мест, которые это право открывает.

Поэтому каталог НЕ ХРАНИТСЯ, а собирается из карт `permission_map`, у которых
уже есть владелец — сами вьюсеты. Копия в базе устаревала бы при первой же
правке гейта, и экран настроек обещал бы доступ, которого нет.

Обход идёт по URL-резолверу, а не по списку роутеров: маршрут, подключённый
мимо роутера, тоже гейтится и обязан попасть в каталог.
"""
import re

from django.urls import URLPattern, URLResolver, get_resolver

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
        permission_map = getattr(view_class, "permission_map", None)
        if not permission_map:
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
            code = permission_map.get(action)
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
