"""Сторож: пробы берут «сегодня» тем же вызовом, что и сервис (Plane №842).

ЗАЧЕМ СТОРОЖ, А НЕ ОДНА ПРАВКА. Класс собрал ЧЕТЫРЕ карточки подряд (№374,
№696, №816, №842), и каждый раз чинились найденные места, а следующая проба
писалась по-старому: `timezone.now().date()` короче и «работает». Дефект
возвращается молча — прогон зелёный, потому что запасы ±2/±5 дней вокруг
границы спасают, — и всплывает ночью между полуночью и пятью утра по местному
времени, когда календарные даты UTC и `Asia/Almaty` расходятся на сутки.

ЧТО ЗАПРЕЩЕНО И ЧЕМ ЗАМЕНЯЕТСЯ:

* `timezone.now().date()` — календарный день UTC. Кадровая половина системы
  считает день `timezone.localdate()` (`test_business_date_is_local.py`).
* `date.today()` / `dt.date.today()` — день по часам ПРОЦЕССА, то есть зоне
  контейнера. Это хуже предыдущего: там хотя бы UTC, здесь — что настроено.
  Раздел ОМ считает день `Clock.today_local()`, кадровая половина —
  `timezone.localdate()`.

ПОЧЕМУ РАЗБОР ДЕРЕВОМ, А НЕ ГРЕПОМ. Греп не отличает вызов от упоминания, а
запрещённые имена стоят в докстроках и комментариях доброго десятка проб —
там они объясняют, почему так нельзя. Сторож, кричащий на объяснение, будет
снят через неделю, поэтому здесь `ast`: считаются ВЫЗОВЫ и только они.

🔴 КРАСНАЯ ПРОБА: впиши `today = timezone.now().date()` в любую пробу раздела
— сторож назовёт файл и строку.
"""
import ast
from pathlib import Path

#: Каталог `apps`. Считается от файла, а не от рабочего каталога: pytest зовут
#: и из корня проекта, и из `Personnel-Records`.
#:
#: 🔴 ПУТЬ ПРОВЕРЯЕТСЯ СЧЁТОМ ФАЙЛОВ, А НЕ ГЛАЗАМИ. Первая редакция сторожа
#: брала `parents[2]` и склеивала `apps/apps/*/tests/**` — глоб не находил
#: НИЧЕГО, и сторож был зелёным по построению. Поймано мутацией (вписать
#: `timezone.now().date()` в живую пробу — сторож промолчал), поэтому ниже
#: стоит проба на то, что дерево вообще обойдено — она же поймала и вторую
#: попытку (`parents[1]`, то есть каталог одного приложения).
APPS = Path(__file__).resolve().parents[2]

#: Файлы, где запрещённый вызов стоит ПО ДЕЛУ. Список поимённый: «исключение по
#: маске» через год закрыло бы половину дерева.
ALLOWED = {
    # Сторож местной даты сравнивает две даты между собой — обе стороны спора
    # обязаны присутствовать, иначе проверять нечего (Plane №374).
    "statuses/tests/test_business_date_is_local.py",
}


def _rendered(node):
    """Имя выражения в виде строки: `timezone.now().date`, `dt.date.today`.

    Вложенный вызов печатается скобками, поэтому цепочка читается так же, как
    в исходнике, и правило можно записать концом строки, а не разбором узлов.
    """
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_rendered(node.value)}.{node.attr}"
    if isinstance(node, ast.Call):
        return f"{_rendered(node.func)}()"
    return "?"


def _calls(tree):
    """Имена вызовов дерева — по одному на вызов, со строкой."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            yield _rendered(node.func), node.lineno


def _violation(name):
    """Запрещённый вызов или `None`.

    🔴 ЗАПРЕЩЁН ИМЕННО `now().date()`, А НЕ ЛЮБОЙ `.date()` ПО ВЫЗОВУ. Первая
    редакция сторожа ловила «внешний `.date()` по результату вызова» и
    обвинила `test_lagging_check.py`, где `local_night.astimezone(utc).date()`
    стоит ПО ДЕЛУ — проба доказывает, что дата по UTC и местная расходятся.
    Сторож, кричащий на доказательство собственной правоты, был бы снят
    первым же читателем.
    """
    if name.endswith("now().date"):
        return "now().date() — календарный день UTC"
    if name.endswith("date.today"):
        return "date.today() — день по часам процесса"
    return None


def _test_files():
    """Все файлы проб раздела — один список на сторожа и на его проверку."""
    return sorted(APPS.glob("*/tests/**/*.py"))


def _offenders():
    found = []
    for path in _test_files():
        relative = str(path.relative_to(APPS))
        if relative in ALLOWED:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for name, lineno in _calls(tree):
            what = _violation(name)
            if what is not None:
                found.append(f"{relative}:{lineno} — {what}")
    return found


def test_no_test_takes_today_by_the_process_clock():
    offenders = _offenders()

    assert not offenders, (
        "пробы берут «сегодня» не тем вызовом, что сервис (Plane №842): "
        + "; ".join(offenders)
        + ". Кадровая половина — timezone.localdate(), раздел ОМ — "
        "Clock.today_local()."
    )


def test_the_guard_actually_walks_the_tree():
    """Сторож обошёл дерево, а не промолчал на пустом списке.

    🔴 РОВНО ЭТО И СЛУЧИЛОСЬ в первой редакции: путь склеивался как
    `apps/apps/*/tests/**`, глоб не находил ни одного файла, и сторож был
    зелёным по построению. Число намеренно грубое — оно стережёт «список
    пуст», а не состав дерева, и не будет краснеть от каждой новой пробы.
    """
    files = _test_files()

    assert len(files) > 100, f"сторож обошёл {len(files)} файлов — путь неверен"
    assert any(
        str(f).endswith("statuses/tests/test_business_date_is_local.py") for f in files
    ), "в обходе нет файла, который заведомо есть"


def test_the_guard_itself_can_see_a_violation():
    """Сторож обязан УМЕТЬ найти нарушение, а не быть зелёным по построению.

    Без этой пробы ошибка в разборе дерева (например, не тот вид узла) сделала
    бы сторожа вечно зелёным — и он молча перестал бы стеречь что-либо.
    """
    tree = ast.parse(
        "from django.utils import timezone\n"
        "import datetime as dt\n"
        "today = timezone.now().date()\n"
        "other = dt.date.today()\n"
    )
    names = [name for name, _ in _calls(tree)]

    assert any(_violation(n) for n in names if n.endswith("now().date")), names
    assert any(_violation(n) for n in names if n.endswith("date.today")), names
    # И обратное: законный `.date()` по результату вызова обвинён НЕ будет.
    legal = ast.parse("moment.astimezone(utc).date()\n")
    assert all(_violation(n) is None for n, _ in _calls(legal))
