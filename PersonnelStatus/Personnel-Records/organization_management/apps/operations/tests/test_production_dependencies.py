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

🔴 ИМПОРТОВ МАЛО: ПОЛОВИНУ ПОДСИСТЕМ DJANGO ПОДНИМАЕТ ПО СТРОКЕ ИЗ НАСТРОЕК
(Plane №805). `CHANNEL_LAYERS`/`CACHES` `BACKEND`, `DATABASES` `ENGINE`,
`INSTALLED_APPS`, `MIDDLEWARE`, `AUTHENTICATION_BACKENDS`, `ASGI_APPLICATION` —
ни одна такая строка не является импортом, и файлы настроек лежат не в
`apps/`. Проба, читавшая только импорты и только `apps/**`, не знала о них
ВООБЩЕ — то есть тот же отказ старта проходил через другую дверь, а красная
проба выдавалась за полного сторожа.

Уже случившийся пример — `channels_redis`: назван строкой в `base.py` и
`production.py`, не объявлен нигде и не установлен; в бою Django поднимает слой
каналов и НЕ СТАРТУЕТ ВОВСЕ. Найден он был глазами при починке №794, а не этой
пробой.
"""
import ast
import pathlib
import re
import sys
from importlib.metadata import packages_distributions

ROOT = pathlib.Path(__file__).resolve().parents[4]
APPS = ROOT / "organization_management" / "apps"
SETTINGS = ROOT / "organization_management" / "config" / "settings"

#: Настройки-СПИСКИ, все значения которых — пути к модулям поставки.
#: Перечислены поимённо, а не «все строки настроек подряд»: в `DATABASES`
#: рядом с `ENGINE` лежит `NAME` со значением `db.sqlite3`, которое под форму
#: точечного пути подходит идеально и пакетом не является (проверено запуском —
#: первая версия его и нашла).
DOTTED_PATH_SETTINGS = frozenset({
    "INSTALLED_APPS",
    "MIDDLEWARE",
    "AUTHENTICATION_BACKENDS",
    "DEFAULT_FILE_STORAGE",
    "DEFAULT_AUTO_FIELD",
    "ASGI_APPLICATION",
    "WSGI_APPLICATION",
    "ROOT_URLCONF",
})

#: Ключи ВНУТРИ словарей настроек, чьё значение — путь к модулю поставки:
#: `CACHES`/`CHANNEL_LAYERS`/`TEMPLATES` → `BACKEND`, `DATABASES` → `ENGINE`.
#: Ищутся в любом словаре на любой глубине: у `CACHES` это второй уровень, у
#: `TEMPLATES` — элемент списка.
DOTTED_PATH_KEYS = frozenset({"BACKEND", "ENGINE"})

#: Форма пути к модулю: сегменты-идентификаторы, точки необязательны.
#: 🔴 БЕЗ ТОЧКИ — ТОЖЕ ПАКЕТ, И ИМЕННО ТАКИЕ СТРОКИ ОПАСНЕЕ ВСЕГО. В
#: `INSTALLED_APPS` сторонние приложения стоят голым именем (`rest_framework`,
#: `corsheaders`, `channels`), и требование точки выкинуло бы из проверки
#: самый населённый список настроек. Ложных срабатываний это не даёт: разбор
#: идёт по ПОИМЁННО названным настройкам, где строка не бывает ничем, кроме
#: пути к модулю.
DOTTED_PATH = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$")

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

# 🔴 ХРАПОВИК НАСТРОЕК — ровно такой же и ровно затем же (Plane №805).
# `channels_redis` назван строкой в `base.py` и `production.py`, не объявлен
# нигде и не установлен. Чинить это ЗДЕСЬ нельзя: карточка №804 — вилка для
# ЗАКАЗЧИКА, а не для кода («живы ли WebSocket-уведомления в бою»): либо
# объявить `channels-redis`, либо снять строку из настроек. Пока решения нет,
# проба обязана быть зелёной СЕГОДНЯ и краснеть на СЛЕДУЮЩЕЙ такой строке.
#
# Строка сюда не дописывается — она чинится:
# `test_the_settings_debt_list_does_not_rot` краснеет, как только пакет
# объявлен или строка снята.
KNOWN_UNDECLARED_IN_SETTINGS = frozenset({"channels_redis"})


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


def _module_paths_named_in_settings():
    """Пары «файл настроек → точечный путь», названные строкой.

    Читается ИСХОДНИК, а не импортированные настройки: `import` подтянул бы
    только тот контур, который выбран переменной окружения, а дефект №804
    живёт ровно в тех двух файлах, которые здесь никто не поднимает
    (`base.py` и `production.py`; `test.py` и `sqlite.py` переопределяют
    `CHANNEL_LAYERS` на `InMemoryChannelLayer`).
    """
    found = set()
    for source in sorted(SETTINGS.glob("*.py")):
        tree = ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
        strings = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id in DOTTED_PATH_SETTINGS
                for target in node.targets
            ):
                strings |= _string_constants(node.value)
            if isinstance(node, ast.Dict):
                for key, value in zip(node.keys, node.values):
                    if isinstance(key, ast.Constant) and key.value in DOTTED_PATH_KEYS:
                        strings |= _string_constants(value)
        for text in strings:
            if DOTTED_PATH.match(text):
                found.add((source.relative_to(ROOT), text))
    return found


def _string_constants(node):
    return {
        inner.value
        for inner in ast.walk(node)
        if isinstance(inner, ast.Constant) and isinstance(inner.value, str)
    }


def _undeclared_in_settings():
    """Модули верхнего уровня из настроек, не объявленные в `base.txt`.

    ПРАВИЛО МЯГЧЕ, ЧЕМ У ИМПОРТОВ, И НАМЕРЕННО. Пакет, названный строкой, может
    быть объявлен и при этом не установлен в этом окружении — тогда
    `packages_distributions` о нём не знает вовсе, и сопоставить модуль с
    дистрибутивом нечем. В таком случае имя модуля сравнивается с объявленными
    напрямую (PEP 503: `django_redis` ↔ `django-redis`). Иначе проба нашла бы
    `django_redis`, объявленный в `base.txt` и просто не поставленный здесь, —
    то есть повторила бы находку соседней карточки №790 и краснела бы не о
    своём предмете.
    """
    base = _declared(ROOT / "requirements" / "base.txt")
    assert "django" in base, "предусловие: base.txt разобран"
    distributions_of = packages_distributions()

    found = set()
    for path, dotted in sorted(_module_paths_named_in_settings()):
        module = dotted.split(".", 1)[0]
        if module in sys.stdlib_module_names or module == "organization_management":
            continue
        owners = {name.lower().replace("_", "-") for name in distributions_of.get(module, [])}
        if owners:
            if owners & base:
                continue
        elif module.lower().replace("_", "-") in base:
            continue
        found.add(module)
    return found


def test_settings_name_only_packages_that_base_requirements_declare():
    """🔴 ПРЕДМЕТ №805: пакет, введённый строкой настроек, а не импортом.

    Django поднимает слой каналов, кэш, базу и приложения по строке. Такой
    пакет не импортируется нигде, поэтому проба импортов о нём молчит, а в бою
    его отсутствие — не деградация функции, а отказ старта.

    Мутация, на которой проба обязана краснеть: вписать в `CACHES` `BACKEND`
    несуществующий пакет.
    """
    offenders = sorted(_undeclared_in_settings() - KNOWN_UNDECLARED_IN_SETTINGS)

    assert offenders == [], (
        "настройки называют пакеты, не объявленные в requirements/base.txt — "
        "в бою Django поднимает их по строке и не стартует вовсе:\n  "
        + "\n  ".join(offenders)
    )


def test_the_settings_debt_list_does_not_rot():
    """Храповик настроек не переживает починку — по тому же доводу, что и
    храповик импортов: мёртвая строка тихо ослабляет пробу."""
    stale = sorted(KNOWN_UNDECLARED_IN_SETTINGS - _undeclared_in_settings())
    assert stale == [], (
        "в списке известного долга настроек остались строки, которые больше не "
        "нарушения (пакет объявлен или строка снята из настроек) — уберите "
        "их:\n  " + "\n  ".join(stale)
    )


def test_the_settings_scan_actually_reads_the_settings():
    """🔴 СТОРОЖ, КОТОРЫЙ НИЧЕГО НЕ НАШЁЛ, ЗЕЛЁН ВСЕГДА.

    Обе проверки выше сравнивают списки с пустыми, и опечатка в пути к
    настройкам или слишком узкий отбор сделали бы их вечнозелёными. Здесь
    названы нижние границы: файлы прочитаны, и в них найдены пути, которые
    там заведомо есть.
    """
    paths = _module_paths_named_in_settings()
    files = {path.name for path, _ in paths}
    assert {"base.py", "production.py"} <= files, files
    dotted = {text for _, text in paths}
    # Голое имя стороннего приложения, точечный путь стороннего пакета и
    # django-путь — три формы, которые разбор обязан увидеть все.
    assert "rest_framework" in dotted, sorted(dotted)
    assert "corsheaders.middleware.CorsMiddleware" in dotted, sorted(dotted)
    assert any(text.startswith("django.") for text in dotted), sorted(dotted)
    # Тот самый пакет, ради которого проба заведена (Plane №804/№805).
    assert "channels_redis.core.RedisChannelLayer" in dotted, sorted(dotted)
    assert len(dotted) > 20, sorted(dotted)


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
