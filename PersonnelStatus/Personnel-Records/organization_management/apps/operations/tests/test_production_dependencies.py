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

# 🔴 ХРАПОВИК, А НЕ РАЗРЕШЕНИЕ. Список — НАКОПЛЕННЫЙ ДОЛГ на 05.09.2026,
# найденный этой же пробой в момент её написания. Он существует ровно затем,
# чтобы проба была зелёной СЕГОДНЯ и краснела на ЗАВТРАШНЕЙ ошибке: новая
# строка сюда не дописывается, она чинится. Каждая из этих зависимостей
# приезжает транзитивно (`lxml` с `python-docx`, `asgiref` с Django, `PIL` с
# чем-то ещё, `django_filters` не объявлен вовсе) — то есть работает по
# случайности чужой поставки, а не по объявленному контракту.
#
# Разбор и починка — своя карточка; чинить чужой долг внутри задачи про pypdf
# значило бы подменить предмет и заодно уронить гейт четырём сессиям.
KNOWN_UNDECLARED = frozenset({
    "organization_management/apps/audit/filters.py → django_filters",
    "organization_management/apps/audit/views.py → django_filters",
    "organization_management/apps/employees/management/commands/seed_employee_photos.py → PIL",
    "organization_management/apps/notifications/services/websocket_service.py → asgiref",
    "organization_management/apps/notifications/signals.py → asgiref",
    "organization_management/apps/operations/docx_fingerprint.py → lxml",
    "organization_management/apps/operations/notify_service.py → asgiref",
    "organization_management/apps/ops/document_templates/build_placement_template.py → PIL",
    "organization_management/apps/statuses/api/filters.py → django_filters",
    "organization_management/apps/statuses/api/views.py → django_filters",
})


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


def test_production_code_imports_only_what_base_requirements_declare():
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

    offenders = []
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
            if is_declared(module):
                continue
            found = f"{source.relative_to(ROOT)} → {module}"
            if found not in KNOWN_UNDECLARED:
                offenders.append(found)

    assert offenders == [], (
        "боевой код импортирует пакеты, не объявленные в requirements/base.txt "
        "— в бою это 500 ModuleNotFoundError, и гейт его не увидит "
        "(на стенде и в тестах стоит development.txt поверх base):\n  "
        + "\n  ".join(offenders)
    )


def test_the_known_debt_list_does_not_rot():
    """Храповик не должен переживать починку долга.

    Список известных нарушений обязан УМЕНЬШАТЬСЯ. Строка, оставшаяся в нём
    после того, как импорт исправлен или файл удалён, тихо ослабляет пробу:
    завтра тот же путь снова начнёт импортировать незаявленное, и проба
    промолчит. Поэтому мёртвая строка — тоже отказ.
    """
    stale = sorted(
        entry
        for entry in KNOWN_UNDECLARED
        if not (ROOT / entry.split(" → ", 1)[0]).exists()
    )
    assert stale == [], (
        "в списке известного долга остались строки о несуществующих файлах — "
        "уберите их, иначе проба ослаблена молча:\n  " + "\n  ".join(stale)
    )
