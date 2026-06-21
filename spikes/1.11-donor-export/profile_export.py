#!/usr/bin/env python3
"""Спайк 1.11 — минимальный профилировщик полной выгрузки донора.

Стдлиб-онли (json, collections, re, sys): должен запускаться ТАМ, где
приземлится дамп — возможно на машине без Django/VAPS-окружения (та же
логика самодостаточности, что у артефакта спайка 1.9).

Вход:  путь к Django dumpdata JSON  ->  [{"model": "app.model", "pk": N,
       "fields": {...}}, ...].
Выход: агрегатный отчёт в stdout — объём по моделям + качество ключевых
       полей (дубли/NULL ИИН и табельных, осиротевшие статусы, вакансии).

PII: сырые ИИН/ФИО НИКОГДА не печатаются. Примеры маскируются как
     '…<последние 4> ×N'. Реальный дамп не коммитится (.gitignore).

ЭТО НЕ профилировщик 7.1 (категории грязи + правило обработки на каждую +
битые даты/кодировки) — спайк меряет МИНИМУМ, доказывающий доступ/формат/
объём/качество ключей. Находки забирает E7 по таблице «находка -> стори»
в EXPORT-RECIPE.md.

Запуск:  python3 profile_export.py <export.json>
"""

import json
import re
import sys
from collections import defaultdict

# ИИН Казахстана — ровно 12 цифр. Невалидным считаем непустое значение,
# не подходящее под этот шаблон (NULL/пустые считаются отдельно).
# Проверяем через fullmatch (НЕ match) + isinstance(str) — ТОЧНО как импортёр
# 1.6 (transform.py:175-177): "$" в match матчит ПЕРЕД завершающим \n и
# пропустил бы "850101300101\n"; не-строковый iin в ручной/SQL-выгрузке — тоже
# грязь. Расхождение профилировщика с импортёром = недосчёт невалидных ИИН.
IIN_RE = re.compile(r"^[0-9]{12}$")

# Точные строки model (app_label.model) — взяты из donor_slice.json и
# import_donor_slice.py (импортёр 1.6), НЕ угаданы. Неверная строка =
# пустая выгрузка/несовпадение формата (MUST стори 1.11).
M_DIVISION = "divisions.division"
M_RANK = "dictionaries.rank"
M_POSITION = "dictionaries.position"
M_EMPLOYEE = "employees.employee"
M_STAFFUNIT = "staff_unit.staffunit"
M_STATUS = "statuses.employeestatus"

# Шесть моделей, которые ест импортёр 1.6 (порядок выгрузки в рецепте).
DONOR_MODELS = (M_DIVISION, M_RANK, M_POSITION, M_EMPLOYEE, M_STAFFUNIT, M_STATUS)

EXAMPLE_LIMIT = 5


def mask(value):
    """PII-маска: показать только последние 4 символа.

    Короткое (<=4 симв.) значение целиком НЕ печатается — иначе это была бы не
    маска, а утечка (напр. короткий табельный «PN7» → весь «PN7»). Для таких
    отдаём только метку длины, без самого значения.
    """
    s = "" if value is None else str(value)
    if not s:
        return "…(пусто)"
    if len(s) <= 4:
        return f"…(скрыто, {len(s)} симв.)"
    return "…" + s[-4:]


def is_blank(value):
    return value is None or (isinstance(value, str) and value.strip() == "")


def load_by_model(path):
    with open(path, encoding="utf-8") as fh:
        rows = json.load(fh)
    if not isinstance(rows, list):
        raise ValueError("ожидался JSON-массив dumpdata [{model, pk, fields}, ...]")
    by_model = defaultdict(list)
    for i, row in enumerate(rows):
        # Валидируем форму строки ЗДЕСЬ (под guard'ом main → exit 1), а не в
        # print_* (они бегут ВНЕ try/except): иначе кривая/частичная строка —
        # не объект, нет model/pk/fields, fields=null — даёт traceback вместо
        # контрактного «exit 1, ошибка формата». А кривые прод-данные — цель спайка.
        if not isinstance(row, dict):
            raise ValueError(f"строка {i}: ожидался объект, получено {type(row).__name__}")
        missing = {"model", "pk", "fields"} - row.keys()
        if missing:
            raise ValueError(f"строка {i}: нет обязательных ключей {sorted(missing)}")
        if not isinstance(row["fields"], dict):
            raise ValueError(f"строка {i} ({row['model']!r}): 'fields' не объект")
        by_model[row["model"]].append(row)
    return by_model


def duplicates(values):
    """{значение: count} только для значений, встретившихся > 1 раза."""
    counts = defaultdict(int)
    for v in values:
        counts[v] += 1
    return {v: c for v, c in counts.items() if c > 1}


def print_volume(by_model):
    print("== ОБЪЁМ ПО МОДЕЛЯМ ==")
    for model in DONOR_MODELS:
        print(f"  {model}: {len(by_model.get(model, []))}")
    extra = sorted(set(by_model) - set(DONOR_MODELS))
    if extra:
        # Полный dumpdata тянет лишние апп (auth/contenttypes/…). Импортёр
        # 1.6 их игнорит; рецепт выгружает явный список 6 моделей, чтобы их
        # вообще не было. Если они здесь — выгрузка была не по рецепту.
        print("  -- лишние модели (НЕ из списка 6; рецепт их не выгружает):")
        for model in extra:
            print(f"     {model}: {len(by_model[model])}")


def print_employees(rows):
    print("\n== employees.employee (ключи: iin, personnel_number) ==")
    print(f"  всего: {len(rows)}")
    pk_dups = duplicates([str(r["pk"]) for r in rows])
    if pk_dups:
        # Множество employee_pks в print_statuses молча схлопнуло бы дубль pk —
        # а одинаковый pk у >1 строки это порча мастер-данных (причина смерти
        # донора). Сигналим явно: объём != число различимых личностей.
        print(f"  ⚠ дубли pk (одинаковый pk у >1 строки — порча): {len(pk_dups)}")

    iins = [r["fields"].get("iin") for r in rows]
    # ПАРИТЕТ С ИМПОРТЁРОМ 1.6 (transform.py:170-178) — эталон стори:
    #   missing = `not iin` (ловит None/""/0/[]/{} — буквально импортёрский
    #             `if not iin`), затем invalid = значение truthy, но НЕ str ИЛИ
    #             НЕ fullmatch (ИИН с пробелом/`\n`, не-строковый тип, мусор).
    # Импортёр скипает ОБА класса ДО identity-логики → дубли считаем ТОЛЬКО по
    # ВАЛИДНЫМ ИИН. Иначе невалидные значения и пары int↔str ("12345678901" vs
    # 12345678901) завышали бы «ИИН дубли» — merge-релевантное число, питающее
    # 7.3, разошлось бы с тем, что реально увидит импортёр. strip() НЕ делаем:
    # импортёр его тоже не делает (padded-ИИН = invalid, не «восстановленный дубль»).
    iin_null = sum(1 for v in iins if not v)
    iin_bad = [v for v in iins if v and not (isinstance(v, str) and IIN_RE.fullmatch(v))]
    iin_valid = [v for v in iins if isinstance(v, str) and IIN_RE.fullmatch(v)]
    iin_dups = duplicates(iin_valid)

    print(f"  ИИН NULL/пустой: {iin_null}")
    print(f"  ИИН невалидный формат (не ^[0-9]{{12}}$): {len(iin_bad)}", end="")
    if iin_bad:
        ex = ", ".join(mask(v) for v in iin_bad[:EXAMPLE_LIMIT])
        print(f"  (примеры: {ex})", end="")
    print()
    print(f"  ИИН дубли (значений >1): {len(iin_dups)}", end="")
    if iin_dups:
        ex = ", ".join(
            f"{mask(v)} ×{c}"
            for v, c in sorted(iin_dups.items(), key=lambda kv: -kv[1])[:EXAMPLE_LIMIT]
        )
        print(f"  (примеры: {ex})", end="")
    print()

    pns = [r["fields"].get("personnel_number") for r in rows]
    pn_null = sum(1 for v in pns if is_blank(v))
    pn_dups = duplicates([str(v) for v in pns if not is_blank(v)])
    print(f"  Табельный NULL/пустой: {pn_null}")
    print(f"  Табельный дубли (значений >1): {len(pn_dups)}", end="")
    if pn_dups:
        ex = ", ".join(
            f"{mask(v)} ×{c}"
            for v, c in sorted(pn_dups.items(), key=lambda kv: -kv[1])[:EXAMPLE_LIMIT]
        )
        print(f"  (примеры: {ex})", end="")
    print()


def print_statuses(status_rows, employee_rows):
    print("\n== statuses.employeestatus (ключ: employee FK) ==")
    print(f"  всего: {len(status_rows)}")
    # str()-нормализация pk и FK: dumpdata по рецепту даёт int с обеих сторон,
    # но SQL-дамп/--natural-foreign/ручная правка дали бы "1" против 1 — тогда
    # строгое сравнение пометило бы ВСЕ статусы осиротевшими (false orphan-storm,
    # неверный продукт-число). На int-ключах результат идентичен.
    employee_pks = {str(r["pk"]) for r in employee_rows}
    fk_null = sum(1 for r in status_rows if r["fields"].get("employee") is None)
    fk_missing = sum(
        1
        for r in status_rows
        if r["fields"].get("employee") is not None
        and str(r["fields"]["employee"]) not in employee_pks
    )
    print(f"  осиротевшие: employee = NULL: {fk_null}")
    print(f"  осиротевшие: employee pk вне множества employees: {fk_missing}")
    print(f"  осиротевшие всего: {fk_null + fk_missing}")


def print_staffunits(rows):
    print("\n== staff_unit.staffunit ==")
    print(f"  всего: {len(rows)}")
    vacant = sum(1 for r in rows if r["fields"].get("employee") is None)
    print(f"  вакантных (employee = NULL): {vacant}")


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        print("ОШИБКА: укажите ровно один путь к dumpdata JSON.", file=sys.stderr)
        return 2
    path = argv[1]
    try:
        by_model = load_by_model(path)
    except (OSError, ValueError, KeyError) as exc:
        print(f"ОШИБКА чтения выгрузки {path!r}: {exc}", file=sys.stderr)
        return 1

    print(f"# Профиль выгрузки: {path}")
    print("# (агрегатный отчёт, PII маскирован — сырые ИИН/ФИО не выводятся)\n")
    print_volume(by_model)
    print_employees(by_model.get(M_EMPLOYEE, []))
    print_statuses(by_model.get(M_STATUS, []), by_model.get(M_EMPLOYEE, []))
    print_staffunits(by_model.get(M_STAFFUNIT, []))
    print(
        "\n# Перенос находок в E7 — таблица «находка -> стори» в EXPORT-RECIPE.md.\n"
        "# Образец донор-формата != прод: реальные объём/дубли/кодировка прода —\n"
        "# PENDING-prod-access до пути A (реальной выгрузки)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
