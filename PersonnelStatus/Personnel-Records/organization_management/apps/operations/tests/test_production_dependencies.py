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

#: Файлы БОЕВЫХ контуров: только их значения обязаны быть в `base.txt`.
#: Остальные (`sqlite.py`, `test.py`, `local_postgres.py`) — контуры
#: разработки, и требовать от них `base.txt` значило бы гнать разработчика в
#: тот самый дефект, который проба и предотвращает: первое же
#: `debug_toolbar` в `sqlite.py` пришлось бы либо объявлять в боевых
#: зависимостях, либо вписывать в храповик (найдено ревью, задача №825; до
#: этого под `base.txt` сверялись ВСЕ пять файлов).
PRODUCTION_SETTINGS = frozenset({"base.py", "production.py"})

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

#: Хвосты имён настроек, чьё значение — тоже путь к модулю поставки.
#: Список поимённых настроек рос бы вручную и отставал: замерено ревью
#: (задача №825), что мимо него проходили `EMAIL_BACKEND`, `SESSION_ENGINE`,
#: `STATICFILES_STORAGE` — все боевые ровно так же, как `CHANNEL_LAYERS`.
#: Правило по хвосту растёт само.
DOTTED_PATH_SUFFIXES = re.compile(
    r"(_BACKEND|_BACKENDS|_ENGINE|_STORAGE|_STORAGES|_CLASS|_CLASSES)$"
)

#: Ключи ВНУТРИ словарей настроек, чьё значение — путь к модулю поставки:
#: `CACHES`/`CHANNEL_LAYERS`/`TEMPLATES` → `BACKEND`, `DATABASES` → `ENGINE`.
#: Ищутся в любом словаре на любой глубине: у `CACHES` это второй уровень, у
#: `TEMPLATES` — элемент списка.
#: `class` — строчными: так называется ключ обработчика в `LOGGING`.
#: `NAME` сюда НЕ добавлен намеренно: в `AUTH_PASSWORD_VALIDATORS` он путь к
#: модулю, а в `DATABASES` — имя файла `db.sqlite3`, и различить их по ключу
#: нечем. Правило «`NAME` — это путь» дало бы ложную красноту на sqlite.
DOTTED_PATH_KEYS = frozenset({"BACKEND", "ENGINE", "class"})

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
#
# 06.09.2026 долг ПОГАШЕН (Plane №804): заказчик закрыл вилку «живы ли
# WebSocket-уведомления в бою» ответом «живы», и `channels-redis` объявлен в
# `requirements/base.txt`. (`daphne` вместе с ним объявлен НЕ был: боевым
# ASGI-сервером заказчик выбрал `uvicorn`, а `daphne` живёт в
# `development.txt` как тестовая зависимость — №806.) Список опустел — пустым и обязан
# остаться: `test_the_settings_debt_list_does_not_rot` краснеет на строке,
# которая больше не нарушение, поэтому вернуть сюда починенное молча нельзя.
# Новая строка сюда не дописывается, она чинится.
KNOWN_UNDECLARED_IN_SETTINGS = frozenset()


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


def _is_settings_name(name):
    """Настройка, чьи строки — пути к модулям: поимённо или по хвосту имени."""
    return name in DOTTED_PATH_SETTINGS or DOTTED_PATH_SUFFIXES.search(name) is not None


def _env_lookup(func):
    """`os.getenv(...)` или `os.environ.get(...)` — и ничто другое."""
    if isinstance(func, ast.Attribute) and func.attr == "getenv":
        return True
    if isinstance(func, ast.Attribute) and func.attr == "get":
        value = func.value
        return isinstance(value, ast.Attribute) and value.attr == "environ"
    return False


def _string_constants(node):
    """Строковые ЗНАЧЕНИЯ настройки — без аргументов вызовов.

    🔴 ЗАЧЕМ РАЗБОР ПО УЗЛАМ, А НЕ `ast.walk` (найдено ревью, задача №825).
    Прежняя версия забирала любую строку из поддерева, включая ПЕРВЫЙ аргумент
    `os.getenv` — имя переменной окружения. Замерено:
    `{"BACKEND": os.getenv("CACHE_BACKEND", "django_redis.cache.RedisCache")}`
    давало `{"CACHE_BACKEND", "django_redis.cache.RedisCache"}`, и
    `CACHE_BACKEND` становился «нарушителем»: пакета с таким именем не
    существует, дистрибутива нет, — сторож краснел бы на ВЫДУМАННОМ имени при
    совершенно правильной правке. В `production.py` через `os.getenv`
    параметризованы уже все значения `DATABASES`.

    От вызова берётся ТОЛЬКО значение по умолчанию у чтения окружения; от
    любого другого вызова — ничего: молчать честнее, чем гадать.
    """
    if isinstance(node, ast.Constant):
        return {node.value} if isinstance(node.value, str) else set()
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        found = set()
        for element in node.elts:
            found |= _string_constants(element)
        return found
    if isinstance(node, ast.Dict):
        found = set()
        for key, value in zip(node.keys, node.values):
            if isinstance(key, ast.Constant) and key.value in DOTTED_PATH_KEYS:
                found |= _string_constants(value)
        return found
    if isinstance(node, ast.BinOp):
        return _string_constants(node.left) | _string_constants(node.right)
    if isinstance(node, ast.IfExp):
        return _string_constants(node.body) | _string_constants(node.orelse)
    if isinstance(node, ast.Call):
        if _env_lookup(node.func) and len(node.args) >= 2:
            return _string_constants(node.args[1])
        return set()
    return set()


def _paths_in_source(source, filename="<строка>"):
    """Точечные пути, названные строками в тексте файла настроек.

    🔴 РАЗБИРАЮТСЯ ТРИ ФОРМЫ, А НЕ ОДНА (найдено ревью, задача №825). Прежняя
    версия знала только присваивание. Замерено, что мимо неё проходили
    `INSTALLED_APPS += ["debug_toolbar"]` и
    `MIDDLEWARE.insert(0, "whitenoise.middleware.WhiteNoiseMiddleware")` —
    а наслоение через `+=` и `.insert()` есть обычная форма `production.py`,
    который надстраивается над `base.py`, и этот файл именно такой. Пакет,
    введённый так, сторож не видел ВОВСЕ: его собственный отказ.
    """
    tree = ast.parse(source, filename=filename)
    strings = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and _is_settings_name(target.id)
            for target in node.targets
        ):
            strings |= _string_constants(node.value)
        elif (
            isinstance(node, ast.AugAssign)
            and isinstance(node.target, ast.Name)
            and _is_settings_name(node.target.id)
        ):
            strings |= _string_constants(node.value)
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in {"insert", "append", "extend"}
            and isinstance(node.func.value, ast.Name)
            and _is_settings_name(node.func.value.id)
        ):
            for argument in node.args:
                strings |= _string_constants(argument)
        elif isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if isinstance(key, ast.Constant) and key.value in DOTTED_PATH_KEYS:
                    strings |= _string_constants(value)
    return {text for text in strings if DOTTED_PATH.match(text)}


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
        text = source.read_text(encoding="utf-8")
        for dotted in _paths_in_source(text, filename=str(source)):
            found.add((source.relative_to(ROOT), dotted))
    return found


def _undeclared_in_settings():
    """Модули из настроек, не объявленные там, где положено: модуль → места.

    ПРАВИЛО МЯГЧЕ, ЧЕМ У ИМПОРТОВ, И НАМЕРЕННО. Пакет, названный строкой, может
    быть объявлен и при этом не установлен в этом окружении — тогда
    `packages_distributions` о нём не знает вовсе, и сопоставить модуль с
    дистрибутивом нечем. В таком случае имя модуля сравнивается с объявленными
    напрямую. Иначе проба нашла бы `django_redis`, объявленный в `base.txt` и
    просто не поставленный здесь, — то есть повторила бы находку соседней
    карточки №790 и краснела бы не о своём предмете.

    🔴 У ЭТОГО СМЯГЧЕНИЯ ЕСТЬ ЦЕНА, И ОНА НАЗВАНА (ревью, задача №825).
    Совпадение «имя модуля = имя дистрибутива с дефисами» верно лишь для части
    пакетов: `channels_redis` ↔ `channels-redis` и `django_redis` ↔
    `django-redis` — да, но `corsheaders` ставится `django-cors-headers`,
    `mptt` — `django-mptt`, `rest_framework` — `djangorestframework`. Любой из
    них, объявленный правильно и НЕ УСТАНОВЛЕННЫЙ, пройдёт мимо мягкого
    правила и будет назван нарушителем. Поэтому имя сверяется в двух видах —
    как есть и с приставкой `django-`, — а остаток случаев остаётся известной
    границей: сторож здесь может ошибиться в сторону лишней красноты, но не в
    сторону молчания.

    🔴 БОЕВЫЕ КОНТУРЫ СВЕРЯЮТСЯ С `base.txt`, ОСТАЛЬНЫЕ — С `development.txt`
    (ревью, задача №825). Требовать `base.txt` от `sqlite.py` и `test.py`
    значило бы толкать разработчика объявить инструмент разработки в боевых
    зависимостях — ровно тот дефект, ради которого проба и написана.
    """
    base = _declared(ROOT / "requirements" / "base.txt")
    assert "django" in base, "предусловие: base.txt разобран"
    development = base | _declared(ROOT / "requirements" / "development.txt")
    distributions_of = packages_distributions()

    found = {}
    for path, dotted in sorted(_module_paths_named_in_settings()):
        module = dotted.split(".", 1)[0]
        if module in sys.stdlib_module_names or module == "organization_management":
            continue
        allowed = base if path.name in PRODUCTION_SETTINGS else development
        owners = {name.lower().replace("_", "-") for name in distributions_of.get(module, [])}
        if owners:
            if owners & allowed:
                continue
        else:
            bare = module.lower().replace("_", "-")
            if bare in allowed or f"django-{bare}" in allowed:
                continue
        found.setdefault(module, set()).add(f"{path} → {dotted}")
    return found


def test_settings_name_only_packages_that_base_requirements_declare():
    """🔴 ПРЕДМЕТ №805: пакет, введённый строкой настроек, а не импортом.

    Django поднимает слой каналов, кэш, базу и приложения по строке. Такой
    пакет не импортируется нигде, поэтому проба импортов о нём молчит, а в бою
    его отсутствие — не деградация функции, а отказ старта.

    Мутация, на которой проба обязана краснеть: вписать в `CACHES` `BACKEND`
    несуществующий пакет.
    """
    places = _undeclared_in_settings()
    offenders = sorted(set(places) - KNOWN_UNDECLARED_IN_SETTINGS)

    # 🔴 В СООБЩЕНИИ — ФАЙЛ И ПОЛНЫЙ ПУТЬ, а не голое имя модуля (ревью,
    #    задача №825). Проба импортов рядом печатает «файл → модуль», а эта
    #    печатала `channels_redis` без единой подсказки, где искать.
    assert offenders == [], (
        "настройки называют пакеты, не объявленные в requirements/base.txt — "
        "в бою Django поднимает их по строке и не стартует вовсе:\n  "
        + "\n  ".join(
            f"{module}: " + "; ".join(sorted(places[module])) for module in offenders
        )
    )


def test_the_settings_debt_list_does_not_rot():
    """Храповик настроек не переживает починку — по тому же доводу, что и
    храповик импортов: мёртвая строка тихо ослабляет пробу."""
    stale = sorted(KNOWN_UNDECLARED_IN_SETTINGS - set(_undeclared_in_settings()))
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


def test_the_scan_sees_the_two_shapes_it_used_to_miss():
    """🔴 ДВЕ ФОРМЫ, МИМО КОТОРЫХ СТОРОЖ ПРОХОДИЛ МОЛЧА (ревью, задача №825).

    Обе — обычная запись `production.py`, который надстраивается над `base.py`.
    Проба разбирает СИНТЕТИЧЕСКИЙ текст, а не живые настройки: живой файл
    завтра изменят, и вместе с ним тихо изменится предмет проверки.
    """
    augmented = _paths_in_source("INSTALLED_APPS += ['debug_toolbar']\n")
    assert "debug_toolbar" in augmented, augmented

    inserted = _paths_in_source(
        "MIDDLEWARE.insert(0, 'whitenoise.middleware.WhiteNoiseMiddleware')\n"
    )
    assert "whitenoise.middleware.WhiteNoiseMiddleware" in inserted, inserted

    appended = _paths_in_source("AUTHENTICATION_BACKENDS.append('axes.backends.AxesBackend')\n")
    assert "axes.backends.AxesBackend" in appended, appended


def test_the_scan_does_not_invent_packages_out_of_env_variable_names():
    """🔴 ЛОЖНАЯ КРАСНОТА НА ВЫДУМАННОМ ИМЕНИ (ревью, задача №825).

    Значение, параметризованное через окружение, — правильная правка, и
    сторож обязан промолчать о ней. Прежний разбор забирал ПЕРВЫЙ аргумент
    `os.getenv` (имя переменной окружения) и объявлял его пакетом: такого
    пакета не существует, дистрибутива нет — красная проба на ровном месте.
    """
    parametrized = _paths_in_source(
        "CACHES = {'default': {'BACKEND': os.getenv('CACHE_BACKEND', "
        "'django_redis.cache.RedisCache')}}\n"
    )
    assert "django_redis.cache.RedisCache" in parametrized, parametrized
    assert "CACHE_BACKEND" not in parametrized, parametrized

    through_environ = _paths_in_source(
        "SESSION_ENGINE = os.environ.get('SESSION_ENGINE_PATH', 'redis_sessions.session')\n"
    )
    assert "redis_sessions.session" in through_environ, through_environ
    assert "SESSION_ENGINE_PATH" not in through_environ, through_environ


def test_the_scan_does_not_take_a_database_file_name_for_a_package():
    """`NAME` в `DATABASES` — имя файла, а не путь к модулю.

    Ловушка названа в самой карточке №805: `db.sqlite3` подходит под форму
    точечного пути идеально. Держится она тем, что `NAME` не входит в список
    ключей, — и держаться обязана пробой, а не памятью.
    """
    databases = _paths_in_source(
        "DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', "
        "'NAME': 'db.sqlite3'}}\n"
    )
    assert "django.db.backends.sqlite3" in databases, databases
    assert "db.sqlite3" not in databases, databases


def test_the_scan_reads_settings_named_by_their_suffix():
    """Список поимённых настроек рос бы руками и отставал.

    Замерено ревью (задача №825): мимо него проходили `EMAIL_BACKEND`,
    `SESSION_ENGINE`, `STATICFILES_STORAGE` — все боевые ровно так же, как
    `CHANNEL_LAYERS`, и любой из них поднимает пакет по строке.
    """
    for line, expected in (
        ("EMAIL_BACKEND = 'anymail.backends.mailgun.EmailBackend'", "anymail.backends.mailgun.EmailBackend"),
        ("SESSION_ENGINE = 'redis_sessions.session'", "redis_sessions.session"),
        ("STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'",
         "whitenoise.storage.CompressedManifestStaticFilesStorage"),
    ):
        seen = _paths_in_source(line + "\n")
        assert expected in seen, (line, seen)


# ── Команда запуска боевого контейнера (Plane №830) ─────────────────────────
#
# 🔴 ТРЕТЬЯ ДВЕРЬ В ТОТ ЖЕ ОТКАЗ. Две проверки выше стерегут импорты боевого
# кода и строки настроек. Но есть ещё одна строка, которая поднимает боевой
# контур и не является ни импортом, ни настройкой, — КОМАНДА ЗАПУСКА
# КОНТЕЙНЕРА. Через неё уже прошли два дефекта разом (№830): образ звал
# `gunicorn`, не объявленный НИ В ОДНОМ файле зависимостей, и звал он
# `config.wsgi:application` — WSGI, который веб-сокет не обслуживает никак,
# сколько бы `channels-redis` и `uvicorn` ни было объявлено рядом.
#
# Ни гейт, ни сборка образа этого не ловят: сборка ставит зависимости и не
# запускает команду, а запуск бывает только в бою.
LAUNCH_FILES = (ROOT / "Dockerfile", ROOT / "docker-compose.yml")

#: Исполняемые имена, которые может звать команда запуска, и дистрибутив,
#: который их приносит. Список короткий намеренно: он перечисляет то, чем
#: контур ЗАПУСКАЕТСЯ, а не всё, что установлено.
LAUNCHERS = {
    "gunicorn": "gunicorn",
    "uvicorn": "uvicorn",
    "daphne": "daphne",
    "celery": "celery",
}


def _launch_commands():
    """Строки запуска из `Dockerfile` (CMD/ENTRYPOINT) и `docker-compose.yml`.

    🔴 ПРОДОЛЖЕНИЕ СТРОКИ СКЛЕИВАЕТСЯ (найдено мутацией, Plane №888). Первая
    редакция брала ровно ту строку, что начинается с `CMD`, — а команда в
    `Dockerfile` перенесена обратным слэшем, и `-k <класс воркера>` стоит на
    ВТОРОЙ строке. Сторож её не видел вовсе: мутация «вернуть устаревший
    `uvicorn.workers` при снятом `uvicorn`» прошла ЗЕЛЁНОЙ, хотя обязана была
    покраснеть. Слепота тихая — сторож при этом «работает» и проверяет
    docker-compose, где команда однострочная.
    """
    for path in LAUNCH_FILES:
        if not path.exists():
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        index = 0
        while index < len(lines):
            start = index
            line = lines[index].strip()
            index += 1
            if line.startswith("#"):
                continue
            if not line.startswith(("CMD", "ENTRYPOINT", "command:")):
                continue
            while line.endswith("\\") and index < len(lines):
                line = line[:-1].rstrip() + " " + lines[index].strip()
                index += 1
            yield f"{path.name}:{start + 1}", line


def test_the_launch_command_names_only_declared_executables():
    """Чем контейнер ЗАПУСКАЕТСЯ, тоже обязано быть объявлено в `base.txt`.

    🔴 КРАСНАЯ ПРОБА: убери `gunicorn` из `requirements/base.txt` — проба
    назовёт файл, строку и имя.
    """
    declared = _declared(ROOT / "requirements" / "base.txt")
    offenders = []
    for where, line in _launch_commands():
        for executable, distribution in LAUNCHERS.items():
            if re.search(rf"(^|[\s\"']){executable}([\s\"']|$)", line):
                if distribution not in declared:
                    offenders.append(f"{where}: {executable} → {distribution}")
    assert offenders == [], (
        "команда запуска боевого контейнера зовёт то, чего нет в "
        f"requirements/base.txt: {offenders}"
    )


def test_the_worker_class_comes_from_a_declared_package():
    """Класс воркера в команде запуска — из ОБЪЯВЛЕННОГО пакета (Plane №888).

    🔴 ЧТО СТЕРЕЖЁТСЯ И ПОЧЕМУ ЭТОГО НЕ СТЕРЕГЛО НИЧТО. `-k <модуль>.<Класс>`
    — третья строка, поднимающая боевой контур: не импорт кода, не настройка и
    не имя исполняемого файла. Соседние проверки её не видят: одна смотрит
    ИСПОЛНЯЕМЫЕ имена команды, другая — приложение (`asgi`/`wsgi`).

    Так и вышло с №888: команда звала `uvicorn.workers.UvicornWorker`, а этот
    модуль объявлен upstream устаревшим, и `uvicorn>=0.30` разрешает любую
    версию новее — в день удаления модуля контейнер не стартует. Локально это
    не ловится вовсе: образ здесь не собирается, `uvicorn` в `.venv` не стоит.

    Проба спрашивает не «существует ли класс» (нечем — пакета в окружении
    нет), а «объявлен ли пакет, из которого он берётся». Это ровно то, что
    проверяемо на нашей стороне, и ровно то, чего не хватало.

    КРАСНАЯ ПРОБА: верни `-k uvicorn.workers.UvicornWorker` при объявленном
    `uvicorn-worker` — покраснеет, если `uvicorn` не объявлен; убери
    `uvicorn-worker` из `base.txt` — покраснеет на нынешней команде.
    """
    declared = _declared(ROOT / "requirements" / "base.txt")
    offenders = []
    for where, line in _launch_commands():
        # 🔴 РАЗДЕЛИТЕЛЬ — НЕ ТОЛЬКО ПРОБЕЛ (вторая слепота, найденная мутацией).
        # В `Dockerfile` команда записана JSON-массивом: `"-k",
        # "uvicorn_worker.UvicornWorker"`, то есть между флагом и значением
        # стоят кавычка и запятая. Регулярка с `\s+` находила класс ТОЛЬКО в
        # `docker-compose.yml`, и мутация «вернуть устаревший модуль в
        # Dockerfile» проходила зелёной — при уже починенной склейке строк.
        for match in re.finditer(r"-k[\"'\s,]+([A-Za-z0-9_.]+)\.[A-Za-z0-9_]+", line):
            module = match.group(1)
            # Дистрибутив — по ВЕРХНЕМУ модулю: `uvicorn_worker` приносит
            # `uvicorn-worker`, `uvicorn.workers` — `uvicorn`.
            distribution = module.split(".")[0].replace("_", "-").lower()
            if distribution not in declared:
                offenders.append(f"{where}: -k {module} → {distribution}")
    assert offenders == [], (
        "класс воркера взят из пакета, которого нет в requirements/base.txt: "
        f"{offenders}"
    )


def test_the_launch_command_serves_asgi_not_wsgi():
    """Боевой контур поднимает ASGI-приложение (Plane №830).

    🔴 ЧТО СТЕРЕЖЁТСЯ. `config.wsgi:application` веб-сокет не обслуживает
    НИКАК: маршрут `/ws/operations/notifications/`, `ASGI_APPLICATION` и слой
    каналов могут быть настроены и объявлены — до ASGI-приложения запрос всё
    равно не дойдёт. Дефект не виден ни гейтом, ни сборкой образа: он есть
    только в бою, и читается там не как «веб-сокет выключен», а как «сокет
    почему-то не подключается».

    Решение заказчика 06.09.2026: перевести запуск на ASGI. Проба держит это
    решение, а не форму команды: сменить gunicorn на голый uvicorn можно, а
    вернуться к `wsgi:application` — нельзя без нового решения.

    КРАСНАЯ ПРОБА: верни `config.wsgi:application` в `Dockerfile` — покраснеет.
    """
    commands = list(_launch_commands())
    assert commands, "команд запуска не нашлось — проба ничего не проверила"

    serving = [
        (where, line)
        for where, line in commands
        if "config.wsgi:application" in line or "config.asgi:application" in line
    ]
    assert serving, (
        "ни одна команда запуска не называет приложение Django — "
        f"проверять нечего: {[w for w, _ in commands]}"
    )
    wsgi = [where for where, line in serving if "config.wsgi:application" in line]
    assert wsgi == [], (
        "боевой контур поднимает WSGI-приложение — веб-сокет там не "
        f"обслуживается вовсе (Plane №830): {wsgi}"
    )
