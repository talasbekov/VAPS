"""Сервисные операции, берущие замок строки, обязаны быть в транзакции.

🔴 ЗАЧЕМ ЭТА ПРОБА (Plane №477, разбор живого 500 на стенде). `select_for_update`
вне транзакции — не медленнее, а НЕВОЗМОЖЕН: Django поднимает
`TransactionManagementError`, и ручка отвечает 500.

Поймать это обычной пробой нельзя. `pytest.mark.django_db` заворачивает КАЖДЫЙ
тест в транзакцию, поэтому `select_for_update` в тестах работает всегда, а на
стенде — только у функции, которая транзакцию открыла сама. Ровно так и вышло:
полный прогон 4576 passed был зелёным, а `approval/send/` на стенде отвечал 500.

ПРИЧИНА ОДНА И ОНА МЕХАНИЧЕСКАЯ: помощник, вставленный между декоратором и
функцией, УНОСИТ декоратор себе. Строка `@transaction.atomic` осталась на
месте, глазами дифф выглядит невинно, а функция ниже стала не транзакционной.
Так потерял декоратор `add_journal_entry` (помощник `_incident_moment`, №766) и
так же чуть не уехал `send_for_approval` (№477).

🔴 ПРОБА СТЕРЕГЛА ТОЛЬКО `security_events.py` (Plane №797). Своих `lock_*` и
своих `select_for_update` хватает и у соседей — расход, статусы, дежурства,
рейтинги, отчёты, справочники, техника, — и та же вставка помощника уносит
декоратор там точно так же. Замерено при расширении: 84 функции берут замок
прямо или через помощника, и все они сегодня в транзакции; проба закрепляет
это, а не чинит найденное.

КАК СЧИТАЕТСЯ «В ТРАНЗАКЦИИ» — двумя способами, потому что в коде их два:
`@transaction.atomic` над функцией И `with transaction.atomic():` в теле.
Считать только декоратор значило бы объявить виновными шесть функций рейтингов
и отчётов, которые открывают транзакцию блоком, — проба врала бы, а её вывод
приучали бы пропускать.

ПОМОЩНИК, БЕРУЩИЙ ЗАМОК, СВОЕЙ ТРАНЗАКЦИИ НЕ ОТКРЫВАЕТ — И ЭТО ЗАКОННО:
`lock_event`, `_lock_employee`, `_lock_shift` и им подобные живут внутри
транзакции ВЫЗЫВАЮЩЕГО, и замок обязан пережить их возврат. Поэтому правило
для них другое и оно-то и есть предмет №477: **транзакционным обязан быть
каждый, кто такого помощника зовёт**. Именно это сломалось у
`send_for_approval` — помощник остался прежним, а вызывающий перестал быть
атомарным.

Проба читает ИСХОДНИКИ разбором, а не зовёт функции: список тех, кто берёт
замок, меняется, и перечислять их руками значило бы завести второй список,
который разойдётся с первым.

🔴 КАКИЕ МУТАЦИИ КРАСНЯТ — ЗАМЕРЕНО, А НЕ ОБЕЩАНО (Plane №841, 06.09.2026).
Для сторожа, который сравнивает пустое с пустым, это главная документация:
без неё «зелено» и «ничего не проверено» неразличимы.

  • снять `@transaction.atomic` у `ops/security_events.py::send_for_approval`
    → красная проба 2 (исходный дефект №477);
  • снять его же у `operations/status_service.py::create_status`
    → красная проба 2 («create_status: ['_lock_employee']»);
  • снять его же у `operations/day_submission_service.py::amend_day`
    → красная проба 2 («amend_day: ['latest_for', 'lock_day']»);
  • заменить проверку покрытия на прежнее «есть ли ГДЕ-НИБУДЬ в теле блок
    atomic» → первые две мутации снова ЗЕЛЕНЕЮТ (так и было до №841);
  • убрать разбор классов из `_module_functions` → третья мутация зеленеет;
  • опечатка в `SERVICE_PACKAGES` или в пути → красная проба 3.

🔴 ЧЕГО СТОРОЖ НЕ ЛОВИТ И НЕ ОБЕЩАЕТ. Он читает ИМЕНА вызовов (последний
сегмент), поэтому однофамилец в соседнем модуле считается тем же помощником;
и он ничего не знает о транзакции, открытой ВЫШЕ по стеку в другом модуле, —
для него такой вызывающий виновен. Оба ограничения выбраны сознательно: они
дают ложную тревогу, а не ложную тишину.
"""
import ast
import pathlib

APPS = pathlib.Path(__file__).resolve().parents[2]

#: Разделы, чьи сервисы читаются. Не весь проект: у моделей, миграций и
#: сериализаторов замков нет, а обход всего дерева стоил бы секунд на каждом
#: прогоне ради тех же файлов.
SERVICE_PACKAGES = ("ops", "operations", "statuses", "employees")

#: Как в коде берут построчный замок. `pg_advisory_xact_lock` — второй способ
#: (`operations/locks.py`), и он тоже живёт ровно до конца транзакции.
LOCK_CALLS = ("select_for_update", "pg_advisory_xact_lock")


def _service_sources():
    for package in SERVICE_PACKAGES:
        root = APPS / package
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*.py")):
            if "tests" in path.parts or "migrations" in path.parts:
                continue
            yield path


def _calls(node):
    return {
        ast.unparse(call.func).split(".")[-1]
        for call in ast.walk(node)
        if isinstance(call, ast.Call)
    }


def _atomic_decorators(node):
    return [ast.unparse(d) for d in node.decorator_list].count("transaction.atomic")


def _has_atomic_decorator(node):
    """Декоратор `@transaction.atomic` накрывает ВСЮ функцию.

    Ровно один: два декоратора подряд — дефект №485/№509, и его стережёт
    `test_no_function_carries_the_atomic_decorator_twice` НИЖЕ В ЭТОМ ФАЙЛЕ.
    🔴 Здесь стояло «его стережёт своя проба» — и такой пробы не существовало
    вовсе (найдено ревью №825): дубль ловился только здесь, побочно, и только
    у функций, берущих замок. Обещание закрыто пробой, а не снято: сторож на
    один класс дешевле, чем разбираться, почему «своя проба» ничего не нашла.
    """
    return _atomic_decorators(node) == 1


def _atomic_block_calls(node):
    """Вызовы, стоящие ВНУТРИ блока `with transaction.atomic():`.

    🔴 ПОЗИЦИЯ, А НЕ ПРИСУТСТВИЕ (Plane №841, ревью №825). Здесь стояло
    «есть ли ГДЕ-НИБУДЬ в теле блок atomic» — и этого хватало, чтобы функция
    считалась атомарной ЦЕЛИКОМ. А замок, взятый ДО блока, транзакцией не
    накрыт: на стенде это `TransactionManagementError` → 500, в тестах молчит
    (`django_db` сам заворачивает тест в транзакцию).
    Так под сторожем оказались невидимы шесть ручек ядра расхода и статусов —
    `create_status` (замок на 400, блок на 449), `update_status`,
    `extend_status`, `resolve_placeholder`, `bulk_create_statuses`,
    `respond_allocation`: у каждой замок берётся РАНЬШЕ первого блока, и снятие
    декоратора не краснило ничего.
    """
    covered = set()
    for inner in ast.walk(node):
        if not isinstance(inner, (ast.With, ast.AsyncWith)):
            continue
        opens = any(
            ast.unparse(item.context_expr) in ("transaction.atomic()", "atomic()")
            for item in inner.items
        )
        if not opens:
            continue
        for deeper in ast.walk(inner):
            if isinstance(deeper, ast.Call):
                covered.add(id(deeper))
    return covered


def _uncovered_calls(node, wanted):
    """Имена из `wanted`, которые зовутся БЕЗ покрытия транзакцией.

    Покрывает либо декоратор (всю функцию), либо блок `with atomic` — но
    только те вызовы, что стоят внутри него.
    """
    if _has_atomic_decorator(node):
        return set()
    covered = _atomic_block_calls(node)
    naked = set()
    for call in ast.walk(node):
        if not isinstance(call, ast.Call) or id(call) in covered:
            continue
        name = ast.unparse(call.func).split(".")[-1]
        if name in wanted:
            naked.add(name)
    return naked


def _module_functions(path):
    """Функции модуля — включая МЕТОДЫ КЛАССОВ.

    🔴 ЗАЧЕМ КЛАССЫ (Plane №841, ревью №825). Здесь читался только
    `tree.body`, и замки в методах были невидимы вместе со всей цепочкой их
    вызывающих: `DailySubmissionSelector.lock_day`, `…latest_for`,
    `OpsDocumentSequenceSelector.lock`. Мутации «снять декоратор» у
    `amend_day` и у `issue_expense_document` (цепочка выдачи номера документа)
    были ЗЕЛЁНЫМИ — то есть контракт «зовётся внутри транзакции того, кто
    выпускает документ» не стерёгся ничем.

    Имя берётся простое (без класса): `_calls` тоже берёт последний сегмент
    (`selector.lock_day()` → `lock_day`), и сопоставлять их надо одинаково.
    Путь и класс остаются в отчёте, чтобы виновного было где искать.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found = []

    def walk(container, prefix=""):
        for node in container.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                found.append((prefix + node.name, node.name, node))
            elif isinstance(node, ast.ClassDef):
                walk(node, f"{node.name}.")

    walk(tree)
    return found


#: Имена, которым позволено брать замок без своей транзакции ПО ДОГОВОРУ, а не
#: по форме имени, — с причиной у каждого (Plane №841).
#:
#: 🔴 СПИСОК ИМЕННО ПОИМЁННЫЙ. Как только сторож научился читать методы
#: классов, под правило попали селекторы, чей контракт «замок живёт до коммита
#: ВЫЗЫВАЮЩЕГО» записан в их же докстроках, — но имена у них не служебные.
#: Ослаблять правило до «любой метод класса может опереться на вызывающего»
#: нельзя: тогда жертва кражи декоратора снова стала бы «помощником», то есть
#: сторож перестал бы ловить свой предмет (№477).
LEANS_ON_CALLER_BY_CONTRACT = {
    # «Замок построчный и живёт до коммита ВЫЗЫВАЮЩЕГО: в этом весь смысл
    # нумерации через обычное целое» — докстрока `OpsDocumentSequenceSelector`.
    "OpsDocumentSequenceSelector.lock",
    # `lock=True` берётся ПО ПРОСЬБЕ вызывающего («две одновременные поправки
    # обязаны выстроиться в очередь») — докстрока `latest_for`.
    "DailySubmissionSelector.latest_for",
    # «Зовётся ВНУТРИ транзакции того, кто выпускает документ; своей не
    # открывает. Построчный замок держится до коммита ВЫЗЫВАЮЩЕГО, поэтому
    # откат снимает и инкремент» — докстрока `allocate_number`. 🔴 И запись
    # здесь не поблажка, а НАОБОРОТ: объявив его помощником, мы включаем
    # проверку его ВЫЗЫВАЮЩИХ (вторая проба ниже) — до №841 контракт из этой
    # докстроки не стерёгся ничем, потому что замок лежал в методе класса и
    # сторож его не видел вовсе.
    "allocate_number",
}


def _may_lean_on_the_caller(full_name, name):
    """Кому позволено брать замок без своей транзакции.

    🔴 ЭТО НЕ ПРИДИРКА К ИМЕНАМ, А ЕДИНСТВЕННЫЙ СПОСОБ ОСТАВИТЬ ПРОБУ ЗУБАСТОЙ.
    Если «помощником» считать любую нетранзакционную функцию в цепочке замка,
    то `send_for_approval`, потерявший декоратор, перестанет быть виновным и
    станет… помощником — то есть проба перестанет ловить ровно тот случай,
    ради которого заведена (№477).

    Поэтому опереться на транзакцию вызывающего может ТОЛЬКО служебное имя:
    приватное (`_lock_shift`, `_transition`) или начинающееся с `lock_`
    (`lock_event`). Всё, что названо как операция раздела, обязано открыть
    транзакцию само.
    """
    if full_name in LEANS_ON_CALLER_BY_CONTRACT:
        return True
    return name.startswith("_") or name.startswith("lock_")


def _scan():
    """Разбор всех сервисов: кто берёт замок сам, кто зовёт помощника."""
    functions = {}
    for path in _service_sources():
        for full_name, name, node in _module_functions(path):
            calls = _calls(node)
            functions[(path, full_name)] = {
                "node": node,
                "name": name,
                "calls": calls,
                # Замок БЕЗ покрытия транзакцией — вот что виновно, а не
                # «замок при отсутствующей транзакции где-то в функции».
                "naked_locks": _uncovered_calls(node, set(LOCK_CALLS)),
                "locks_directly": bool(calls & set(LOCK_CALLS)),
            }
    # Помощник — тот, кто берёт замок (сам или через другого помощника),
    # транзакции НЕ открывает и назван служебно: он рассчитывает на
    # вызывающего. Цепочка считается до неподвижной точки — `_transition`
    # зовёт `_lock_shift`, а замок от этого не перестаёт быть замком.
    # Помощник — тот, у кого замок ОСТАЛСЯ НЕПОКРЫТЫМ (он и рассчитывает на
    # транзакцию вызывающего). Функция, открывшая транзакцию блоком `with`,
    # помощником НЕ становится: её замок покрыт, и звать её можно откуда
    # угодно — так устроен, например, `ops/reports.py::_advance_all`.
    helpers = {
        info["name"]
        for full_name, info in ((k[1], v) for k, v in functions.items())
        if info["naked_locks"] and _may_lean_on_the_caller(full_name, info["name"])
    }
    while True:
        grown = {
            info["name"]
            for full_name, info in ((k[1], v) for k, v in functions.items())
            if _uncovered_calls(info["node"], helpers)
            and _may_lean_on_the_caller(full_name, info["name"])
        }
        if grown <= helpers:
            break
        helpers |= grown
    return functions, helpers


def test_every_function_taking_a_row_lock_runs_inside_a_transaction():
    """Замок берётся сам — транзакция обязана быть своя (декоратор или блок)."""
    functions, helpers = _scan()
    guilty = {
        f"{path.relative_to(APPS)}::{full_name}": sorted(info["naked_locks"])
        for (path, full_name), info in functions.items()
        if info["naked_locks"] and info["name"] not in helpers
    }
    assert guilty == {}, (
        "функции берут замок строки вне транзакции: "
        f"{guilty}. Вне транзакции `select_for_update` даёт 500 на стенде, "
        "а в тестах не падает — django_db сам заворачивает тест в транзакцию."
    )


def test_every_caller_of_a_locking_helper_runs_inside_a_transaction():
    """🔴 ПРЕДМЕТ №477 И №797.

    Помощник (`lock_event`, `_lock_employee`, `_lock_shift` …) транзакции не
    открывает намеренно — замок обязан пережить его возврат. Значит открыть её
    обязан ВЫЗЫВАЮЩИЙ. Ровно это и ломает вставленный под декоратор помощник:
    сам он остаётся прежним, а вызывающий перестаёт быть атомарным — и дифф
    выглядит невинно, потому что строка `@transaction.atomic` никуда не делась.
    """
    functions, helpers = _scan()
    guilty = {
        f"{path.relative_to(APPS)}::{full_name}": sorted(
            _uncovered_calls(info["node"], helpers)
        )
        for (path, full_name), info in functions.items()
        if _uncovered_calls(info["node"], helpers) and info["name"] not in helpers
    }
    assert guilty == {}, (
        "функции зовут помощника, берущего замок, вне транзакции: "
        f"{guilty}. Помощник рассчитывает на транзакцию вызывающего; чаще "
        "всего декоратор увёл другой помощник, вставленный сразу под ним."
    )


def test_the_guard_actually_sees_the_services_it_promises_to_read():
    """🔴 СТОРОЖ, КОТОРЫЙ НИЧЕГО НЕ ЧИТАЕТ, ЗЕЛЁН ВСЕГДА.

    Обе пробы выше сравнивают пустой словарь с пустым, и опечатка в пути или
    в имени раздела сделала бы их вечнозелёными, ничего не проверяющими. Здесь
    названы нижние границы того, что разбор ОБЯЗАН найти: сами модули, помощник
    `lock_event` и заметное число его транзакционных вызывающих.
    """
    functions, helpers = _scan()
    modules = {path.name for path, _ in functions}
    assert {"security_events.py", "status_service.py", "ratings.py"} <= modules
    assert "lock_event" in helpers
    callers = [
        full_name
        for (_, full_name), info in functions.items()
        if "lock_event" in info["calls"] and not _uncovered_calls(info["node"], {"lock_event"})
    ]
    assert len(callers) > 30, callers


def test_no_lock_lives_outside_the_packages_the_guard_reads():
    """🔴 СПИСОК РАЗДЕЛОВ ЗАКРЕПЛЁН РУКАМИ — значит его надо стеречь (№841).

    `SERVICE_PACKAGES` перечислен вручную, и первый же `select_for_update` в
    `secondments`, `reports`, `staff_unit` или любом другом приложении был бы
    невидим сторожу МОЛЧА: обе пробы выше сравнивают пустое с пустым и об этом
    не сказали бы ничего. Здесь обходятся ВСЕ приложения, и владельцы замков
    обязаны быть подмножеством того, что сторож читает.
    """
    owners = set()
    for path in sorted((APPS).rglob("*.py")):
        parts = path.relative_to(APPS).parts
        if not parts or "tests" in parts or "migrations" in parts:
            continue
        source = path.read_text(encoding="utf-8")
        if any(call in source for call in LOCK_CALLS):
            owners.add(parts[0])
    assert owners <= set(SERVICE_PACKAGES), (
        "замок берут разделы, которых сторож не читает: "
        f"{sorted(owners - set(SERVICE_PACKAGES))}. Допишите их в "
        "SERVICE_PACKAGES — иначе проверка молча их пропускает."
    )


def test_no_function_carries_the_atomic_decorator_twice():
    """Два `@transaction.atomic` подряд — след склейки (Plane №485, №509).

    🔴 ЧТО ЭТО СТЕРЕЖЁТ. Поведение от дубля не меняется — вложенная транзакция
    становится точкой сохранения, — и потому он живёт незамеченным. Цена не в
    поведении: читатель начинает искать во втором декораторе смысл, и следующая
    правка транзакций делается наугад. Так дубль на `complete_placement` прожил
    от склейки №390/№396 до №479.

    Побочно дубль ловил `_has_atomic_decorator` (`== 1`), но ТОЛЬКО у функций,
    берущих замок, и с сообщением не про то: «зовёт помощника вне транзакции».
    Здесь он назван прямо и ловится у любой функции разделов сторожа.

    КРАСНАЯ НА МУТАЦИИ: поставь второй `@transaction.atomic` над любой функцией
    в `ops`/`operations`/`statuses`/`employees` — проба назовёт её поимённо.
    """
    doubled = []
    for path in _service_sources():
        for full_name, _simple, node in _module_functions(path):
            if _atomic_decorators(node) > 1:
                doubled.append(f"{path.name}:{node.lineno} {full_name}")
    assert doubled == [], (
        "функция несёт `@transaction.atomic` дважды — это след склейки, а не "
        "вложенная транзакция ради точки сохранения: " + ", ".join(sorted(doubled))
    )
