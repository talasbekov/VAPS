"""Настенные часы читает только Clock — и никто больше.

Раздел стоит на замораживаемых часах: сдача дня, окно поправки, контрольный час,
догон, момент отказа и время журнала берутся у Clock, и потому их можно
воспроизвести в тесте и объяснить в разбирательстве. Один прямой `timezone.now()`
в проде ломает это молча: код работает, тест на нём зелёный (сегодня действительно
сегодня), а под замороженными часами такой путь начинает жить в другом дне, чем
весь остальной раздел, — и обнаруживается это на расхождении дат в документе.

Проверка СТАТИЧЕСКАЯ и по исходникам: поведенческая увидела бы только те ветки, по
которым прошёл прогон, а опасна как раз редкая — обработчик ошибки, ветка догона,
путь, куда тест не заходил.

Тесты из-под проверки выведены намеренно: тест имеет полное право спросить у
машины настоящее время, чтобы сравнить его с замороженным.
"""
import ast
import pathlib

import pytest

PACKAGE_ROOT = pathlib.Path(__file__).resolve().parent.parent

# Владелец настенного времени в разделе. Ему читать часы не только можно, но и
# положено — он для этого и заведён.
CLOCK_OWNER = "clock.py"

# Как выглядит чтение настенных часов. Проверяется ИМЯ вызова, а не модуль: до
# `from django.utils.timezone import now` один шаг, и по модулю такой вызов
# проскочил бы.
WALL_CLOCK_CALLS = frozenset({"now", "today", "utcnow", "localtime", "localdate"})


def _wall_clock_reads(path):
    """Вызовы настенных часов в файле: [(строка, как записано)].

    `Clock.now()` и `Clock.today_local()` — НЕ находки: это и есть законный
    способ. Отсекаются по получателю вызова, а не по имени файла.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Attribute):
            name = func.attr
            receiver = getattr(func.value, "id", None) or getattr(
                func.value, "attr", None
            )
        elif isinstance(func, ast.Name):
            name, receiver = func.id, None
        else:
            continue
        if name not in WALL_CLOCK_CALLS:
            continue
        if receiver == "Clock":
            continue
        found.append((node.lineno, f"{receiver + '.' if receiver else ''}{name}()"))
    return found


def _production_files():
    return sorted(
        path
        for path in PACKAGE_ROOT.rglob("*.py")
        if "tests" not in path.parts and path.name != CLOCK_OWNER
    )


PRODUCTION = _production_files()


# ── Сам разбор должен работать ───────────────────────────────────────────


def test_the_scan_covers_the_package():
    """Опора: пустой список файлов сделал бы проверку ниже вечнозелёной."""
    assert len(PRODUCTION) >= 30


def test_the_scan_does_find_wall_clock_reads_where_they_are_legitimate():
    """Проверка самого детектора, а не кода раздела.

    Если бы разбор ничего не находил В ПРИНЦИПЕ (сменилась форма вызова,
    сломался обход), «в проде чисто» выполнялось бы само собой. Владелец часов
    их читает — значит детектор обязан его увидеть.
    """
    owner = PACKAGE_ROOT / CLOCK_OWNER

    assert _wall_clock_reads(owner) != []


# ── И в проде их нет ─────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path", PRODUCTION, ids=[str(p.relative_to(PACKAGE_ROOT)) for p in PRODUCTION]
)
def test_production_code_reads_the_clock_only_through_the_owner(path):
    """Поимённо по файлам: отказ называет ФАЙЛ и СТРОКУ, а не «где-то в разделе
    читают часы»."""
    reads = _wall_clock_reads(path)

    assert reads == [], (
        f"{path.relative_to(PACKAGE_ROOT)}: прямое чтение настенных часов "
        f"{reads} — время раздела берётся у Clock, иначе этот путь начнёт жить "
        "в другом дне, чем всё остальное"
    )
