"""Story 7.1 — категоризированный отчёт качества полной выгрузки донора.

Pure module (no ORM, no Django imports) — тот же канон, что ``transform.py``/
``donor_diff.py`` (architecture.md: логика миграции остаётся DB-free).

Прямой преемник ``spikes/1.11-donor-export/profile_export.py`` (тот был
"минимальный доказанный аппарат", НЕ полный профилировщик — см. его
docstring). Здесь: полный каталог категорий грязи + текстовое ПРАВИЛО
обработки на каждую (AC-1).

Employee-уровневые категории переиспользуют ``transform.transform_employee``
буквально (не копию regex) — паритет с реальным импортёром гарантирован
вызовом одной и той же функции; расхождение профилировщика с импортёром
было бы недосчётом (предупреждение спайка 1.11).
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from apps.migration_legacy.transform import Skip, transform_employee

M_DIVISION = "divisions.division"
M_RANK = "dictionaries.rank"
M_POSITION = "dictionaries.position"
M_EMPLOYEE = "employees.employee"
M_STAFFUNIT = "staff_unit.staffunit"
M_STATUS = "statuses.employeestatus"

# Шесть моделей рецепта выгрузки (EXPORT-RECIPE.md) — "объём по модели"
# закрывает пункт "объём" из таблицы «находка → стори» (owner: 7.1).
DONOR_MODELS = (M_DIVISION, M_RANK, M_POSITION, M_EMPLOYEE, M_STAFFUNIT, M_STATUS)

EXAMPLE_LIMIT = 5

# Текстовое правило обработки на каждую категорию (AC-1: "для каждой
# категории записано правило"). Ключи — категории Skip transform.py +
# собственные категории профилировщика (дубли/осиротевшие/кодировка).
RULES = {
    "missing_iin": (
        "skip при импорте (см. transform.transform_employee) — Employee без "
        "ИИН не создаётся, ИИН обязателен для identity-mapping."
    ),
    "invalid_iin": (
        "skip при импорте — формат ИИН должен быть ^[0-9]{12}$; иначе "
        "сломанный ключ идентичности, не переносится как есть."
    ),
    "unknown_employment_status": (
        "skip при импорте — STOP-семантика: неизвестный код employment_status "
        "не изобретается, требует явного маппинга перед переносом."
    ),
    "invalid_dates": (
        "skip при импорте — битая дата (не парсится как ISO) не переносится "
        "молча; требует ручной проверки исходной строки."
    ),
    "duplicate_iin": (
        "кандидат на ручное слияние (Story 7.3) — не автослияние; один "
        "человек с двумя donor_pk идёт в отчёт на санкцию."
    ),
    "duplicate_personnel_number": (
        "предупреждение, не блокирует импорт — табельный не является ключом "
        "идентичности (это ИИН); ручная сверка при подозрении на порчу."
    ),
    "orphaned_status": (
        "статус с employee = NULL или employee вне множества выгруженных "
        "employees — донорский FK SET_NULL, осиротевшие записи реальны; "
        "переносятся как orphan-отчёт, не как связанный статус."
    ),
    "status_invalid_dates": (
        "статус с неразбираемой start_date/end_date/actual_end_date — "
        "skip при импорте интервала, требует ручной проверки исходной строки."
    ),
    "encoding_suspect": (
        "текстовое поле (ФИО) содержит непечатаемые/replacement-символы — "
        "подозрение на битую кодировку исходного дампа; ручная проверка "
        "перед импортом, НЕ авто-исправление (риск исказить настоящее ФИО)."
    ),
    "malformed_row": (
        "строка выгрузки структурно повреждена (нет 'fields', неожиданный "
        "тип поля вызвал сбой при разборе) — профилировщик НЕ падает, "
        "строка идёт отдельной категорией; требует ручного разбора экспорта "
        "до импорта (может означать неполный/битый dumpdata)."
    ),
    "other_skip": (
        "transform_employee вернул причину skip, не входящую в известный "
        "каталог категорий (например, новая причина появилась в transform.py "
        "и ещё не отражена здесь) — считается отдельно, чтобы не потеряться "
        "молча; синхронизировать RULES с transform.py при появлении новой Skip."
    ),
}


@dataclass
class CategoryFinding:
    category: str
    rule: str
    count: int = 0
    examples: list = field(default_factory=list)


@dataclass
class ProfileReport:
    employee_count: int
    status_count: int
    categories: dict  # category -> CategoryFinding
    volume: dict = field(default_factory=dict)  # donor model -> row count


def _mask(value):
    """PII-маска: только последние 4 печатных символа; короткое — скрыто целиком."""
    s = "" if value is None else str(value)
    if not s:
        return "…(пусто)"
    if len(s) <= 4:
        return f"…(скрыто, {len(s)} симв.)"
    tail = "".join(ch if ch.isprintable() else "□" for ch in s[-4:])
    return "…" + tail


def _duplicates(values):
    counts = defaultdict(int)
    for v in values:
        counts[v] += 1
    return {v: c for v, c in counts.items() if c > 1}


def _has_encoding_suspect(text):
    if not text or not isinstance(text, str):
        # Не-строковое truthy значение (malformed dumpdata: int/list/dict в
        # текстовом поле) — не наша забота здесь: это структурная порча,
        # ловится malformed_row, не encoding_suspect.
        return False
    # U+FFFD REPLACEMENT CHARACTER — классический след неверного decode;
    # непечатаемые управляющие символы в человеческом ФИО — тоже подозрение.
    return "�" in text or any(
        not ch.isprintable() and ch not in ("\t",) for ch in text
    )


def _parse_iso_date(value):
    if not value:
        return None
    if not isinstance(value, str):
        raise ValueError(f"non-string date: {value!r}")
    return date.fromisoformat(value)


def _well_formed_rows(rows, findings):
    """Отсеивает структурно повреждённые строки в malformed_row (dict без
    'fields', или где 'fields' — не dict) вместо KeyError/TypeError ниже по
    пайплайну. Профилировщик существует ЧТОБЫ пережить грязный вход — крах
    на первой кривой строке был бы отрицанием собственного назначения."""
    good = []
    for row in rows:
        if (
            isinstance(row, dict)
            and isinstance(row.get("fields"), dict)
        ):
            good.append(row)
        else:
            f = findings["malformed_row"]
            f.count += 1
            if len(f.examples) < EXAMPLE_LIMIT:
                pk = row.get("pk") if isinstance(row, dict) else "?"
                f.examples.append(f"pk={pk}")
    return good


def profile_export(by_model):
    """by_model: {model_label: [dumpdata rows]} -> ProfileReport.

    Тот же вход, что ``load_by_model`` спайка 1.11 (model/pk/fields dicts).
    Никогда не поднимает исключение на грязных данных — это сам предмет
    профилирования; структурно повреждённые строки уходят в malformed_row,
    а не роняют весь прогон.
    """
    findings = {cat: CategoryFinding(cat, rule) for cat, rule in RULES.items()}

    employee_rows = _well_formed_rows(by_model.get(M_EMPLOYEE, []), findings)
    status_rows = _well_formed_rows(by_model.get(M_STATUS, []), findings)

    def record(category, example_value):
        f = findings[category]
        f.count += 1
        if len(f.examples) < EXAMPLE_LIMIT:
            f.examples.append(_mask(example_value))

    def record_labeled(category, label, example_value):
        """Как record(), но с немаскированной меткой (pk/имя поля) перед
        маскированным значением — иначе _mask(f"{label}={value}") обрезает
        метку до хвоста строки и теряет её (было в encoding_suspect)."""
        f = findings[category]
        f.count += 1
        if len(f.examples) < EXAMPLE_LIMIT:
            f.examples.append(f"{label}={_mask(example_value)}")

    def record_plain(category, example_text):
        """Как record(), но БЕЗ маскирования — для примеров без PII (номера
        строк/названия полей/причины skip), где маска только теряет смысл."""
        f = findings[category]
        f.count += 1
        if len(f.examples) < EXAMPLE_LIMIT:
            f.examples.append(example_text)

    # --- employee-уровень: буквальный вызов реального импортёра ---
    valid_employees = []
    for row in employee_rows:
        raw = row["fields"]
        try:
            result = transform_employee(raw)
        except Exception:  # noqa: BLE001 — грязный вход не должен ронять профиль
            record("malformed_row", raw.get("iin", row.get("pk")))
            continue
        if isinstance(result, Skip):
            if result.reason in findings:
                record(result.reason, raw.get("iin", row.get("pk")))
            else:
                # Неизвестная Skip-причина (RULES рассинхронизирован с
                # transform.py) — не теряется молча. reason/pk — не PII, не
                # маскируем (иначе теряем саму причину в хвосте строки).
                record_plain("other_skip", f"{result.reason}:pk={row.get('pk')}")
        else:
            valid_employees.append((row, raw))

    # --- дубли ИИН (только среди валидных — паритет со стори 7.3) ---
    valid_iins = [raw["iin"] for _row, raw in valid_employees]
    for value, cnt in _duplicates(valid_iins).items():
        for _ in range(cnt):
            record("duplicate_iin", value)

    # --- дубли табельного (среди непустых, независимо от валидности ИИН —
    # табельный не ключ идентичности, порча видна и у skip-строк) ---
    pns = [row["fields"].get("personnel_number") for row in employee_rows]
    pns_nonblank = [
        str(v) for v in pns if v is not None and str(v).strip() != ""
    ]
    for value, cnt in _duplicates(pns_nonblank).items():
        for _ in range(cnt):
            record("duplicate_personnel_number", value)

    # --- кодировка ФИО ---
    for row in employee_rows:
        raw = row["fields"]
        for field_name in ("last_name", "first_name", "middle_name"):
            value = raw.get(field_name)
            if _has_encoding_suspect(value):
                record_labeled(
                    "encoding_suspect", f"pk={row.get('pk')}:{field_name}", value
                )

    # --- осиротевшие статусы + битые даты статусов ---
    employee_pks = {str(row["pk"]) for row in employee_rows if "pk" in row}
    for row in status_rows:
        raw = row["fields"]
        emp_fk = raw.get("employee")
        if emp_fk is None or str(emp_fk) not in employee_pks:
            record_plain("orphaned_status", f"pk={row.get('pk')}")
        bad_date_fields = []
        for date_field in ("start_date", "end_date", "actual_end_date"):
            try:
                _parse_iso_date(raw.get(date_field))
            except ValueError:
                bad_date_fields.append(date_field)
        if bad_date_fields:
            record_plain(
                "status_invalid_dates",
                f"pk={row.get('pk')}:{','.join(bad_date_fields)}",
            )

    volume = {model: len(by_model.get(model, [])) for model in DONOR_MODELS}

    return ProfileReport(
        employee_count=len(employee_rows),
        status_count=len(status_rows),
        categories=findings,
        volume=volume,
    )
