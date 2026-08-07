"""Кто читает снимок — читает его ЗАМОРОЖЕННЫМ.

За партию раздел потерял пять утечек живых данных в подписанный день, и каждая
находилась одинаково: кто-то читал снимок и подмешивал к нему сегодняшний
справочник, сегодняшнюю подпись, сегодняшнее название, сегодняшний знаменатель.
Ни одна не была видна в коде — все выглядели как обычный вызов селектора.

Здесь гвард на СЛЕДУЮЩУЮ. Он перечисляет функции, которые читают снимок, и
требует, чтобы каждая была осознанно отнесена к одной из четырёх групп. Новая
функция ни в одной группе не значится — и тест краснеет, называя её и объясняя,
что решить.

Это тот же приём, что у договора раскладки (test_snapshot_contract): таблица
пишется РУКАМИ, и в этом её смысл. Автоматически вывести «правильно ли смешаны
живое и замороженное» нельзя — можно только заставить автора сказать вслух, к
чему он отнёс свою функцию.
"""
import ast
import pathlib

FROZEN_HELPERS = {
    "catalog_of",
    "names_of",
    "title_of",
    "denominator_of",
    "attached_of",
}
# Селекторы ЖИВЫХ данных, из которых и утекало.
LIVE_SOURCES = {"catalog_rows", "names_map", "attached_counts_on"}

APP = pathlib.Path(__file__).resolve().parent.parent

# ── Четыре группы, каждая со своим доводом ───────────────────────────────

# 1. Снимок читается, но живого рядом НЕТ — смешивать нечего.
NO_LIVE_DATA = {
    "day_submission_service._diff_key",
    "day_submission_service._compute_event",
    "day_submission_service.submit_day",
    "day_submission_service.amend_day",
    "expense_document._parsed_facts",
    "golden.load_case",
    "golden.build",
    "personal_export.build_personal_export_xlsx",
    "personal_export_service._assert_snapshot_schema_supported",
    "selectors.list",
    "strength_report.expense_from_snapshot",
    "summary_service._summary_diff_key",
    "summary_service._compute_summary_event",
    "summary_service.assemble_summary",
    "summary_service.summary_freshness",
    "summary_service.rebuild_summary",
}

# 2. Сами помощники: они и ЕСТЬ правило, к себе неприменимы.
THE_HELPERS = {f"strength_report.{name}" for name in FROZEN_HELPERS}

# 3. САМИ МОРОЗЯТ: читают снимок и берут из него всё, что он заморозил.
FREEZE_THEMSELVES = {
    # Единственный владелец разрешения замороженных полей документа (срез 149).
    "expense_document.build_expense_document",
    # Победитель дня выбирается приоритетами ТОГО справочника, под которым день
    # подписан (срез 140).
    "traffic_light._winners_from_snapshot",
}

# 4. Живое подаётся как ЗАПАСНОЕ тому, кто морозит. Каждая строка — обещание,
#    проверенное глазами и закреплённое щитами (test_document_shield,
#    test_summary_shield, test_traffic_light).
LIVE_AS_FALLBACK = {
    # Разрешает всё сам билдер (срез 149) — сюда едет живое на случай
    # снимков младших версий.
    "expense_release.build_submitted_expense_document",
    # То же плюс своя шапка и порядок колонок сводки.
    "expense_release.build_summary_expense_document",
    # Живые подписи подмешиваются ПОД замороженные.
    "personal_export_service.export_submission",
    # Живой каталог уходит запасным в _winners_from_snapshot.
    "traffic_light.division_traffic_light",
    "traffic_light._own_states",
    # Живой каталог — запасной для снимков схем 1 и 2.
    "strength_report.submitted_expense",
}

DECLARED = NO_LIVE_DATA | THE_HELPERS | FREEZE_THEMSELVES | LIVE_AS_FALLBACK


def _snapshot_readers():
    """{«модуль.функция»: (замороженные помощники, живые селекторы)}."""
    found = {}
    paths = (
        list(APP.glob("*.py"))
        + list((APP / "api").glob("*.py"))
        + list((APP / "management" / "commands").glob("*.py"))
    )
    for path in sorted(paths):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef):
                continue
            dumped = ast.dump(node)
            if "'snapshot'" not in dumped and "attr='snapshot'" not in dumped:
                continue
            calls = {
                getattr(call.func, "attr", getattr(call.func, "id", ""))
                for call in ast.walk(node)
                if isinstance(call, ast.Call)
            }
            found[f"{path.stem}.{node.name}"] = (
                calls & FROZEN_HELPERS,
                calls & LIVE_SOURCES,
            )
    return found


READERS = _snapshot_readers()


def test_the_scan_finds_something():
    """Пустой разбор сделал бы весь файл вечнозелёным: гвард, не нашедший ни
    одного читателя, рапортует об успехе, ничего не проверив."""
    assert len(READERS) >= 20


def test_every_snapshot_reader_is_declared():
    """Несущий тест: новая функция, читающая снимок, обязана быть отнесена.

    Четыре группы: живого рядом нет; это сам помощник; функция морозит сама;
    живое подаётся ЗАПАСНЫМ тому, кто морозит. Пятой — «читает снимок и
    подмешивает сегодняшнее» — в разделе быть не должно: именно она и была
    каждой из пяти утечек.
    """
    undeclared = sorted(set(READERS) - DECLARED)

    assert not undeclared, (
        "новые читатели снимка не отнесены ни к одной группе: "
        f"{undeclared}. Решите, что делает каждый: если он смешивает снимок с "
        "живыми данными — берите их через catalog_of/names_of/title_of/"
        "denominator_of/attached_of, иначе подписанный день начнёт меняться "
        "задним числом."
    )


def test_no_declaration_is_stale():
    """Обратная сторона: строка о функции, которой больше нет, — это ложное
    спокойствие. Список должен уменьшаться вместе с кодом."""
    stale = sorted(DECLARED - set(READERS))

    assert not stale, f"объявлены несуществующие читатели снимка: {stale}"


def test_the_no_live_group_really_has_no_live_calls():
    """Группа «живого рядом нет» проверяется, а не берётся на веру: попади
    туда функция с живым селектором — объявление стало бы прикрытием."""
    offenders = sorted(
        name
        for name in NO_LIVE_DATA
        if READERS.get(name, (set(), set()))[1]
    )

    assert not offenders, (
        f"объявлены как «без живых данных», но зовут живые селекторы: {offenders}"
    )


def test_the_fallback_group_really_touches_live_data():
    """И симметрично: функция без единого живого вызова в этой группе не
    нуждается — её место в первой, и держать её здесь значит прятать её от
    первой проверки."""
    idle = sorted(
        name
        for name in LIVE_AS_FALLBACK
        if not READERS.get(name, (set(), set()))[1]
    )

    assert not idle, (
        f"объявлены как «живое запасным», но живых вызовов нет: {idle}"
    )


def test_the_freezing_group_really_calls_a_helper():
    """Функция, объявленная «морозит сама», обязана звать хоть один помощник.

    Иначе объявление превращается в разрешение читать снимок как попало — а
    группа заводилась ровно затем, чтобы такие места были наперечёт.
    """
    idle = sorted(
        name
        for name in FREEZE_THEMSELVES
        if not READERS.get(name, (set(), set()))[0]
    )

    assert not idle, (
        f"объявлены как «морозят сами», но помощников не зовут: {idle}"
    )
