#!/usr/bin/env python3
"""Спайк 6.6 — одноразовый измерительный аппарат «асинхронность по необходимости».

Меряет wall-clock генерации Расхода на реалистичном объёме (~5000 сотрудников):
  * «управление» — ЧИСТОЕ ядро build_expense_document -> generate_expense_docx
    (≥30 прогонов, p50/p95/max nearest-rank), + все 4 генератора, + полный
    синхронный issue_expense_document (1 прогон, калибровка «ядро ≈ весь issuance»);
  * «свод» — StrengthReportService.compute по крупнейшему поддереву (РЕАЛЬНАЯ
    стоимость roll-up) + одноразовый N-строчный адаптер -> generate_expense_docx.

Продукт — ЗНАНИЕ (числа для TIMING.md), не код. Аппарат одноразовый: живёт в
spikes/, НЕ в apps/. Импорт моделей/сервисов из apps в spikes-скрипте легален
(AST-гвард изоляции банит импорты ВНУТРИ apps/, не сторонний скрипт).

Детерминизм и чистота БД (Ловушка №4 стори):
  * business_date инъектится через clock.override (ARCH-DATA-022); статус-мешалка
    детерминирована (i % 20), никакого random/wall-clock в доменном пути;
  * ВЕСЬ прогон — в одном треде (footgun deferred-work.md:20: clock.override —
    ContextVar, не проходит в новые треды) и в transaction.atomic() + rollback;
  * единственный побочный файл (attachment полного выпуска пишется на диск ДО
    коммита) удаляется в finally — прод/dev-БД и хранилище остаются чистыми.

Запуск: см. README.md (нужна живая мигрированная Postgres, порт 5433).
"""

import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

# --- Django bootstrap (spikes-скрипт вне Backend/VAPS) --------------------------
BACKEND = Path(__file__).resolve().parents[2] / "Backend" / "VAPS"
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402
from django.db import transaction  # noqa: E402

from apps.core import clock  # noqa: E402
from apps.core.models import (  # noqa: E402
    Division,
    DivisionHistoricalSlot,
    DivisionType,
    Employee,
    Organization,
)
from apps.core.selectors import (  # noqa: E402
    CoreDivisionTreeSelector,
    CoreStaffingSelector,
    local_midnight,
)
from apps.documents.generators import (  # noqa: E402
    ExpenseCell,
    ExpenseDocumentData,
    ExpenseRow,
    ExpenseTotals,
    generate_expense_csv,
    generate_expense_docx,
    generate_expense_pdf,
    generate_expense_xlsx,
)
from apps.operations.statuses.models import EmployeeStatus  # noqa: E402
from apps.operations.statuses.services import StrengthReportService  # noqa: E402
from apps.operations.statuses.services.strength_report import (  # noqa: E402
    REPORT_COLUMNS,
)
from apps.operations.submissions.expense_document import (  # noqa: E402
    build_expense_document,
)
from apps.operations.submissions.models import DailySubmission  # noqa: E402
from apps.operations.submissions.services.document_release_service import (  # noqa: E402
    issue_expense_document,
)
from apps.operations.submissions.services.snapshot import (  # noqa: E402
    build_division_snapshot,
)

# --- Параметры объёма (реалистичное дерево, ~5000 сотрудников) ------------------
BUSINESS_DATE = date(2026, 7, 8)
N_UPRAV = 12  # управлений (эшелон 2, дети штаба)
N_OTDEL = 8  # отделов на управление (эшелон 3, листья)
PER_LEAF = 53  # сотрудников на лист  → 12*8*53 = 5088 (~5000, NFR-4)
RUNS = 50  # прогонов на сценарий статистики (≥30, метод p95 = nearest-rank как 1.10)

# Детерминированная статус-мешалка: i-й сотрудник листа (i % 20) → код winner-факта
# (или None = «В строю»). Реалистичная норма отсутствия ~20%: большинство личного
# состава «в строю» (для IN_SERVICE билдер СОЗНАТЕЛЬНО не собирает членов, AC-4),
# отсутствия ложатся в 3 самые частые категории (отпуск/больничный/командировка)
# с реальными списками ФИО. Ровно 3 членских колонки: PDF-генератор 6.4 упирается
# в 4-й членской колонке (замер envelope, находка TIMING.md §Findings) — docx
# (первичный официальный формат) рендерит любую форму; здесь берём форму, которую
# рендерят ВСЕ 4 генератора «из одного ExpenseDocumentData» (AC-2).
_STATUS_BY_MOD = {
    0: "VACATION",
    1: "VACATION",
    2: "SICK_LEAVE",
    3: "COMMAND",
}  # 4..19 → None (IN_SERVICE)


def _percentiles(samples):
    """(p50, p95, max) в МИЛЛИСЕКУНДАХ, nearest-rank floor(q*(n-1)) как 1.10."""
    ordered = sorted(samples)
    n = len(ordered)
    p50 = ordered[int(0.50 * (n - 1))]
    p95 = ordered[int(0.95 * (n - 1))]
    return p50 * 1e3, p95 * 1e3, ordered[-1] * 1e3


def _measure(fn, runs=RUNS):
    """Прогреть один раз, затем runs× time.perf_counter. Возвращает (p50,p95,max_ms)."""
    fn()  # warm-up (импорт python-docx/openpyxl/fpdf лениво — вне статистики)
    samples = []
    for _ in range(runs):
        t0 = time.perf_counter()
        fn()
        samples.append(time.perf_counter() - t0)
    return _percentiles(samples)


def seed():
    """Синтез дерева подразделений + штата + статусов прямым ORM bulk_create.

    factory_boy в проекте НЕ установлен (Ловушка №7) — строим по образцу ручных
    хелперов тестов (make_division/make_employee/make_status/make_slot). Анти-паттерн
    донора «INSERT в цикле» не воспроизводим — bulk (architecture.md:61).
    """
    org = Organization.objects.create(name="Орг-бенч 6.6", code="ORG-66-BENCH")
    dtype, _ = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )
    root = Division.objects.create(
        organization=org, type_code=dtype, name="Штаб (бенч)", code="B66-ROOT"
    )
    uprs = [
        Division(
            organization=org,
            type_code=dtype,
            name=f"Управление {u}",
            code=f"B66-U{u}",
            parent=root,
        )
        for u in range(N_UPRAV)
    ]
    Division.objects.bulk_create(uprs)
    leaves = []
    for u, upr in enumerate(uprs):
        for o in range(N_OTDEL):
            leaves.append(
                Division(
                    organization=org,
                    type_code=dtype,
                    name=f"Отдел {u}-{o}",
                    code=f"B66-U{u}-O{o}",
                    parent=upr,
                )
            )
    Division.objects.bulk_create(leaves)

    employees, statuses = [], []
    idx = 0
    d_start = BUSINESS_DATE - timedelta(days=3)  # полуоткрытый [start,end) кроет дату
    d_end = BUSINESS_DATE + timedelta(days=4)
    for leaf in leaves:
        for j in range(PER_LEAF):
            emp = Employee(
                iin=f"{idx:012d}",
                full_name=f"Сотрудник {idx}",
                rank_code="лейтенант",
                position_code="",
                division=leaf,
                employment_status=Employee.EmploymentStatus.WORKING,
                is_active=True,
            )
            employees.append(emp)
            code = _STATUS_BY_MOD.get(j % 20)
            if code is not None:
                statuses.append(
                    EmployeeStatus(
                        employee_id=emp.id,
                        status_type_code=code,
                        date_start=d_start,
                        date_end=d_end,
                    )
                )
            idx += 1
    Employee.objects.bulk_create(employees, batch_size=1000)
    EmployeeStatus.objects.bulk_create(statuses, batch_size=1000)

    # Штат: каждому подразделению слот с allocated_slots >= списочной (без
    # no_staffing_record / staff_lt_list — иначе release-ассерт выпуска откажет).
    leaf_ids = {leaf.id for leaf in leaves}
    vf = local_midnight(BUSINESS_DATE - timedelta(days=30))
    slots = [
        DivisionHistoricalSlot(
            division=d,
            allocated_slots=(PER_LEAF if d.id in leaf_ids else 0) + 5,
            valid_from=vf,
            valid_to=None,
        )
        for d in [root, *uprs, *leaves]
    ]
    DivisionHistoricalSlot.objects.bulk_create(slots)

    return {
        "org": org,
        "root": root,
        "leaves": leaves,
        "n_divisions": 1 + len(uprs) + len(leaves),
        "n_employees": len(employees),
        "n_statuses": len(statuses),
    }


def _rollup_to_docdata(report):
    """Одноразовый адаптер: list[DivisionReportRow] -> ExpenseDocumentData(rows=[N]).

    Генератор row-агностичен (заQAлено 6.4). ⚠️ DivisionReportRow несёт ТОЛЬКО
    счётчики, без списков ФИО (strength_report.py:113-120) ⇒ members=() ⇒ этот
    N-строчный замер = НИЖНЯЯ ГРАНИЦА стоимости свода-с-ФИО (оговорка в TIMING.md).
    Живёт в benchmark.py, НЕ в apps/ (прод-генератор свода — зона 6.10).
    """
    rows = []
    for r in report.rows:
        cells = {
            key: ExpenseCell(count=r.columns[key], members=()) for key in REPORT_COLUMNS
        }
        rows.append(
            ExpenseRow(
                name=r.name,
                staff_total=r.staff_total,
                list_total=r.list_total,
                vacancies=r.vacancies,
                cells=cells,
                attached=ExpenseCell(count=r.attached, members=()),
            )
        )
    t = report.totals
    return ExpenseDocumentData(
        division_title="СВОД (бенч)",
        business_date=BUSINESS_DATE,
        rows=rows,
        totals=ExpenseTotals(
            staff_total=t.staff_total,
            list_total=t.list_total,
            vacancies=t.vacancies,
            columns=dict(t.columns),
            attached=t.attached,
        ),
    )


def measure(seeded):
    """Все замеры. Возвращает dict чисел + список файлов-сирот на удаление."""
    out = {"orphans": []}
    root = seeded["root"]
    leaf = seeded["leaves"][0]

    # ORM-обвязка (прод-источники) для «управления».
    staff_map = CoreStaffingSelector.allocated_slots_on(BUSINESS_DATE, [leaf.id])
    division_names = CoreDivisionTreeSelector.divisions_map([leaf.id])
    snapshot = build_division_snapshot(leaf.id, BUSINESS_DATE)
    out["leaf_roster"] = len(snapshot["roster"])
    out["leaf_status_rows"] = len(snapshot["rows"])

    # --- «Управление»: ЧИСТОЕ ядро build -> generate_expense_docx (без коммита) --
    def core():
        data = build_expense_document(
            snapshot,
            BUSINESS_DATE,
            staff_map=staff_map,
            division_names=division_names,
            division_id=leaf.id,
        )
        return generate_expense_docx(data)

    out["mgmt_core"] = _measure(core)
    data_leaf = build_expense_document(
        snapshot,
        BUSINESS_DATE,
        staff_map=staff_map,
        division_names=division_names,
        division_id=leaf.id,
    )
    out["mgmt_docx_size"] = len(generate_expense_docx(data_leaf))

    # --- Все 4 генератора из одного ExpenseDocumentData -------------------------
    gens = {
        "docx": generate_expense_docx,
        "xlsx": generate_expense_xlsx,
        "csv": generate_expense_csv,
        "pdf": generate_expense_pdf,
    }
    out["generators"] = {}
    for name, fn in gens.items():
        out["generators"][name] = {
            "stats": _measure(lambda fn=fn: fn(data_leaf)),
            "size": len(fn(data_leaf)),
        }

    # --- Полный синхронный issue_expense_document (1 прогон, калибровка) --------
    DailySubmission.objects.create(
        division_id=leaf.id,
        business_date=BUSINESS_DATE,
        version=1,
        is_current=True,
        event=DailySubmission.Event.CONFIRMED_NO_CHANGES,
        submitted_by="bench-6.6",
        submitted_at=clock.Clock.now(),
        snapshot=snapshot,
    )
    t0 = time.perf_counter()
    issued = issue_expense_document(
        division_id=leaf.id, business_date=BUSINESS_DATE, actor="bench-6.6"
    )
    out["full_issue_ms"] = (time.perf_counter() - t0) * 1e3
    # attachment пишется на диск ДО коммита внешней транзакции: rollback снимет
    # строку, но НЕ файл — уносим путь на unlink в finally (Ловушка №6 6.5).
    out["orphans"].append(
        Path(settings.VAPS_PRIVATE_STORAGE_ROOT) / str(issued.attachment_id)
    )

    # --- «Свод»: реальный roll-up по крупнейшему поддереву (весь штаб) ----------
    def compute():
        return StrengthReportService.compute(BUSINESS_DATE, root.id)

    report = compute()
    out["rollup_rows"] = len(report.rows)
    out["rollup_compute"] = _measure(compute)

    doc = _rollup_to_docdata(report)
    out["rollup_render"] = _measure(lambda: generate_expense_docx(doc))
    out["rollup_docx_size"] = len(generate_expense_docx(doc))

    return out


def _fmt(stats):
    p50, p95, mx = stats
    return f"p50={p50:.1f}ms  p95={p95:.1f}ms  max={mx:.1f}ms"


def report(seeded, out):
    print("\n" + "=" * 72)
    print("СПАЙК 6.6 — ЗАМЕР ГЕНЕРАЦИИ РАСХОДА (measured-dev)")
    print("=" * 72)
    print(
        f"Объём: {seeded['n_divisions']} подразделений "
        f"({N_UPRAV} управлений × {N_OTDEL} отделов + штаб), "
        f"{seeded['n_employees']} сотрудников, {seeded['n_statuses']} статус-фактов; "
        f"business_date={BUSINESS_DATE.isoformat()}; прогонов/сценарий={RUNS}"
    )
    print(
        f"Лист «управление»: roster={out['leaf_roster']}, "
        f"status_rows={out['leaf_status_rows']}"
    )
    print("-" * 72)
    print("СЦЕНАРИЙ                              | ЧИСЛА")
    print("-" * 72)
    print(
        f"mgmt: ЧИСТОЕ ядро build->docx        | {_fmt(out['mgmt_core'])}  "
        f"size={out['mgmt_docx_size']}B"
    )
    print(f"mgmt: полный issue (1 прогон, калибр)| {out['full_issue_ms']:.1f}ms")
    for name, g in out["generators"].items():
        print(
            f"gen  {name:<4} (из одного контракта)   | {_fmt(g['stats'])}  "
            f"size={g['size']}B"
        )
    print("-" * 72)
    print(
        f"свод: compute по поддереву (N={out['rollup_rows']} строк) "
        f"| {_fmt(out['rollup_compute'])}"
    )
    print(
        f"свод: рендер {out['rollup_rows']}-строчного docx (адаптер, members=()) "
        f"| {_fmt(out['rollup_render'])}  size={out['rollup_docx_size']}B"
    )
    print("=" * 72)
    print(
        "PDF = fpdf2 нативно (нет LibreOffice/subprocess); "
        "ветка epics.md:846 НЕ активна."
    )
    print(
        "Свод-рендер = НИЖНЯЯ ГРАНИЦА (строки несут счётчики, не ФИО — оговорка AC-3)."
    )
    print("=" * 72 + "\n")


class _Rollback(Exception):
    """Сентинел отката: сеанс данных живёт только в прогоне (atomic+rollback)."""


def main():
    orphans, seeded_summary, results = [], None, None
    try:
        with transaction.atomic():
            with clock.override(BUSINESS_DATE):
                seeded = seed()
                seeded_summary = {
                    k: v
                    for k, v in seeded.items()
                    if k not in ("org", "root", "leaves")
                }
                results = measure(seeded)
                orphans = results.pop("orphans", [])
            raise _Rollback
    except _Rollback:
        pass
    finally:
        for p in orphans:
            Path(p).unlink(missing_ok=True)

    if seeded_summary is not None and results is not None:
        report(seeded_summary, results)


if __name__ == "__main__":
    main()
