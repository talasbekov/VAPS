"""Боевой код не зависит от пакетов, объявленных только для разработки.

🔴 ЗАЧЕМ ЭТА ПРОБА ВООБЩЕ СУЩЕСТВУЕТ (Plane №492/№639). Этот класс дефекта
гейт не поймает НИКОГДА — по построению. Тесты и стенд ставят
`requirements/development.txt`, а он тянет `base.txt` поверх себя: пакет,
объявленный только в dev, на них присутствует, и всё зелено. Разница видна
исключительно в бою, где ставится один `base.txt`, — и находит её не гейт, а
пользователь, получивший 500 `ModuleNotFoundError`.

Так и вышло с `pypdf`: он был заведён «для чтения .pdf в ТЕСТАХ», а потом им
воспользовался боевой путь — водяной знак «ПРОЕКТ» на несогласованной
расстановке (`stamp_draft`, `[СОГ-03]`). На стенде и в гейте всё работало.

Проба смотрит не на один пакет, а на ПРАВИЛО: всё, что импортирует боевой код,
обязано быть объявлено в `base.txt`. Не «объявлено где-нибудь», а именно там —
иначе `development.txt` остаётся лазейкой, и следующая такая ошибка пройдёт
тем же путём.

СООТВЕТСТВИЕ «модуль → дистрибутив» берётся у самого окружения
(`importlib.metadata.packages_distributions`), а не из выдуманного словаря:
`python-docx` ставит модуль `docx`, `djangorestframework` — `rest_framework`,
`psycopg2-binary` — `psycopg2`. Словарь руками разошёлся бы с реальностью на
первом же новом пакете и начал бы врать в обе стороны.
"""
import ast
import pathlib
import re
import sys
from importlib.metadata import packages_distributions

ROOT = pathlib.Path(__file__).resolve().parents[4]
APPS = ROOT / "organization_management" / "apps"

# 🔴 ХРАПОВИК, А НЕ РАЗРЕШЕНИЕ. Список — НАКОПЛЕННЫЙ ДОЛГ, найденный этой же
# пробой в момент её написания (05.09.2026). Он существует ровно затем, чтобы
# проба была зелёной СЕГОДНЯ и краснела на ЗАВТРАШНЕЙ ошибке: новая строка сюда
# не дописывается, она чинится.
#
# 05.09.2026 долг ПОГАШЕН (Plane №794): `asgiref`, `django-filter`, `lxml` и
# `pillow` объявлены в `base.txt`, и список опустел. Пустым он и обязан
# остаться — `test_the_known_debt_list_does_not_rot` краснеет на строке,
# которая больше не нарушение, поэтому вернуть сюда починенное молча нельзя.
KNOWN_UNDECLARED = frozenset()


def _declared(path):
    """Имена дистрибутивов из файла зависимостей, без версий и без `-r` строк."""
    names = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        name = re.split(r"[<>=!~\[]", line, maxsplit=1)[0].strip()
        if name:
            names.add(name.lower().replace("_", "-"))
    return names


def _imported_modules(source_path):
    """Модули верхнего уровня, которые импортирует файл (включая импорты
    ВНУТРИ функций — именно так `stamp_draft` и звал `pypdf`)."""
    tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(source_path))
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found.add(alias.name.split(".", 1)[0])
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            found.add(node.module.split(".", 1)[0])
    return found


def _undeclared_imports():
    """Все пары «боевой файл → незаявленный модуль», без вычитания храповика.

    Помощник общий у двух проб НАРОЧНО: одна спрашивает «есть ли нарушение вне
    списка», вторая — «осталась ли в списке строка, которая уже не нарушение».
    Считай их порознь — и второй пришлось бы гадать о починке по существованию
    файла, то есть не замечать самую частую починку: объявленную зависимость.
    """
    base = _declared(ROOT / "requirements" / "base.txt")
    assert "django" in base, "предусловие: base.txt разобран"

    # Модуль → дистрибутивы, которые его ставят. Берётся у окружения, поэтому
    # не расходится с реальностью.
    distributions_of = packages_distributions()
    first_party = {"organization_management"}

    def is_declared(module):
        if module in sys.stdlib_module_names or module in first_party:
            return True
        owners = {name.lower().replace("_", "-") for name in distributions_of.get(module, [])}
        if not owners:
            # Пакета нет в окружении вовсе: это либо опечатка в импорте, либо
            # зависимость, о которой не знает никто. И то и другое — находка.
            return False
        return bool(owners & base)

    found = set()
    for source in sorted(APPS.rglob("*.py")):
        parts = set(source.parts)
        # Пробы и миграции — не боевой путь. Имя файла проверяется НАРЯДУ с
        # каталогом: в `apps/notifications` пробы лежат файлом
        # `tests_websockets.py` рядом с кодом, и отбор только по каталогу
        # `tests/` объявил бы их боевыми.
        if "tests" in parts or "migrations" in parts:
            continue
        if source.name.startswith(("test_", "tests_")) or source.name.endswith("_test.py"):
            continue
        for module in sorted(_imported_modules(source)):
            if not is_declared(module):
                found.add(f"{source.relative_to(ROOT)} → {module}")
    return found


def test_production_code_imports_only_what_base_requirements_declare():
    offenders = sorted(_undeclared_imports() - KNOWN_UNDECLARED)

    assert offenders == [], (
        "боевой код импортирует пакеты, не объявленные в requirements/base.txt "
        "— в бою это 500 ModuleNotFoundError, и гейт его не увидит "
        "(на стенде и в тестах стоит development.txt поверх base):\n  "
        + "\n  ".join(offenders)
    )


def test_the_known_debt_list_does_not_rot():
    """Храповик не должен переживать починку долга.

    Список известных нарушений обязан УМЕНЬШАТЬСЯ. Строка, оставшаяся в нём
    после того, как зависимость объявлена, импорт исправлен или файл удалён,
    тихо ослабляет пробу: завтра тот же путь снова начнёт импортировать
    незаявленное, и проба промолчит. Поэтому мёртвая строка — тоже отказ.

    Сверка идёт с ФАКТИЧЕСКИМ списком нарушений, а не с существованием файлов:
    самая частая починка — объявить пакет в `base.txt`, и файл при ней никуда
    не девается. Прежняя проверка её не видела вовсе.
    """
    stale = sorted(KNOWN_UNDECLARED - _undeclared_imports())
    assert stale == [], (
        "в списке известного долга остались строки, которые больше не "
        "нарушения (зависимость объявлена или файл удалён) — уберите их, "
        "иначе проба ослаблена молча:\n  " + "\n  ".join(stale)
    )


def test_the_pinned_file_pins_everything_base_requires():
    """🔴 Закреплённый `requirements.txt` не имеет права отставать от `base.txt`.

    Второй файл зависимостей существует ровно ради воспроизводимости сборки:
    где-то ставится по нему, а не по диапазонам. Пакет, названный в `base.txt`
    и отсутствующий в пине, на такой сборке НЕ ВСТАНЕТ ВОВСЕ — это не «старая
    версия», а `ModuleNotFoundError` на старте (`psycopg2`) или при первом
    обращении к кэшу (`django_redis`). Дыра того же рода, что №492: объявлено
    в одном месте, ставится из другого.

    Имена сравниваются НОРМАЛИЗОВАННО (PEP 503: регистр и `_`/`-` в имени
    дистрибутива неразличимы). Без этого проба врала бы в обе стороны:
    `django_celery_results` в пине и `django-celery-results` в `base.txt` —
    один и тот же пакет, а буквально они не равны.
    """
    base = _declared(ROOT / "requirements" / "base.txt")
    pinned = _declared(ROOT / "requirements.txt")
    assert "django" in pinned, "предусловие: requirements.txt разобран"

    missing = sorted(base - pinned)
    assert missing == [], (
        "requirements/base.txt называет пакеты, которых нет в закреплённом "
        "requirements.txt — сборка по пину не поставит их вовсе:\n  "
        + "\n  ".join(missing)
    )
