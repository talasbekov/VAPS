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
from fnmatch import fnmatch
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

#: `pytest.ini` — ЕДИНСТВЕННЫЙ источник правды о том, что считается пробой.
PYTEST_INI = APPS.parents[1] / "pytest.ini"

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


def _masks():
    """Маски файлов проб — прочитанные из `pytest.ini`, а не вспомненные.

    🔴 ПОЧЕМУ НЕ СВОЙ СПИСОК (Plane №874). Первая редакция обходила
    `*/tests/**/*.py` — то есть ТОЛЬКО каталоги `tests`, — а `pytest.ini`
    объявляет пробами ещё и `tests.py`, `tests_*.py`, `*_tests.py` рядом с
    кодом приложения. Десять файлов (`audit/tests_api.py`,
    `notifications/tests_websockets.py` и соседи) не попадали в разбор ВОВСЕ:
    сторож был зелен не потому, что там чисто, а потому, что он туда не
    смотрел. Найдено ревью — мутацией: проба с `date.today()`, дописанная в
    `audit/tests_migration.py`, сторожа не покраснила.

    Маски читаются из файла, поэтому правка `python_files` (как в №799, где
    шаблон `tests_*.py` и добавили) автоматически расширяет и обход сторожа.
    """
    for line in PYTEST_INI.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if clean.startswith("python_files"):
            masks = tuple(clean.split("=", 1)[1].split())
            assert masks, "python_files пуст — сторожу нечего обходить"
            return masks
    raise AssertionError(
        f"в {PYTEST_INI} нет строки python_files — сторож не знает, "
        "что pytest считает пробой"
    )


def _test_files():
    """Все файлы проб раздела — один список на сторожа и на его проверку.

    Обход идёт по ВСЕМУ дереву приложений, а отбор — по маскам pytest: где
    лежит проба, решает не сторож, а `pytest.ini`.
    """
    masks = _masks()
    return sorted(
        path
        for path in APPS.rglob("*.py")
        if any(fnmatch(path.name, mask) for mask in masks)
    )


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


def test_the_guard_walks_everything_pytest_calls_a_test():
    """Обход сторожа совпадает с тем, что пробой считает pytest.

    🔴 ДВЕ РАЗНЫЕ БЕДЫ, И ОБЕ СЛУЧИЛИСЬ. Первая: путь склеивался как
    `apps/apps/*/tests/**`, глоб не находил ни одного файла, и сторож был
    зелёным по построению — это ловит проверка «список не пуст». Вторая
    (Plane №874, найдена ревью): список был НЕ ПУСТ, но НЕ ПОЛОН — обходились
    только каталоги `tests/`, а десять файлов проб лежат рядом с кодом
    приложения. Проверка «больше ста» такую потерю не пробивает, ровно как
    порог «обработчиков больше ста» не пробивал потерю набора в соседнем
    стороже №834.

    Поэтому проверяются ОБЕ стороны: список не пуст И в нём есть файлы,
    которых в каталогах `tests/` нет по построению.
    """
    files = _test_files()
    outside_tests_dirs = [f for f in files if "/tests/" not in str(f)]

    assert len(files) > 100, f"сторож обошёл {len(files)} файлов — путь неверен"
    assert outside_tests_dirs, (
        "в обходе нет ни одного файла проб ВНЕ каталогов tests/ — значит "
        "отбор снова идёт по каталогу, а не по маскам pytest.ini"
    )
    names = {f.name for f in outside_tests_dirs}
    # Поимённо — те самые файлы, из-за которых заведена №874: они существуют,
    # pytest их собирает, и сторож обязан их видеть.
    assert {"tests_migration.py", "tests_websockets.py"} <= names, sorted(names)


def test_the_allowed_list_does_not_rot():
    """Исключение остаётся в списке, только пока оно нужно.

    Конвенция раздела: у каждого храповика есть проба «не гниёт»
    (`KNOWN_UNDECLARED` в `test_production_dependencies`, `KNOWN_PROBE_CALLS`
    в стороже пагинации). Здесь её не было — расхождение с собственной
    конвенцией, найдено ревью (Plane №874). Без неё файл, переставший
    нарушать, остался бы в `ALLOWED` навсегда и молча прикрывал бы будущее
    нарушение в себе.
    """
    for relative in sorted(ALLOWED):
        path = APPS / relative
        assert path.exists(), f"{relative} в ALLOWED, а файла нет"
        tree = ast.parse(path.read_text(encoding="utf-8"))
        assert any(_violation(name) for name, _ in _calls(tree)), (
            f"{relative} больше не нарушает — исключение пора снять"
        )


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
