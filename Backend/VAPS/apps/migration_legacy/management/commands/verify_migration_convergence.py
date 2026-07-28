"""Story 7.5 — post-migration acceptance gate: формулы сходимости по всем
подразделениям на N дат + опциональная сверка численностей с донором.

AC-1: "любой красный = миграция не принята" — В ОТЛИЧИЕ от
``parallel_run_diff`` (Story 6.9, намеренно non-blocking фоновый
мониторинг, exit 0 всегда), эта команда — разовый ACCEPTANCE-гейт после
прогона импорта: любая находка красного цвета -> ``CommandError``
(ненулевой exit). Это не дубль 6.9, а другой use-case той же
инфраструктуры (``donor_diff.py``).

Формулы сходимости (Штат=Список+Вакансии, Σ columns=Список) уже реализованы
и enforced внутри ``StrengthReportService.compute()`` (Story 1.7/2.4/2.6) —
переиспользуется буквально, не переписывается.
"""

import json
from datetime import date

from django.core.management.base import BaseCommand, CommandError

from apps.core.models import Division
from apps.migration_legacy.donor_diff import (
    GATE_BLOCKING_CATEGORIES,
    diff_day,
    load_baseline,
)
from apps.operations.statuses.services import StrengthReportService


class Command(BaseCommand):
    help = (
        "Post-migration acceptance-гейт (Story 7.5): формулы сходимости "
        "(Штат=Список+Вакансии) по всем подразделениям на --dates + "
        "опциональная сверка численностей с донором (--baseline). Любой "
        "красный -> CommandError (ненулевой exit) — 'миграция не принята'."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dates",
            required=True,
            help="Comma-separated ISO dates, e.g. 2026-06-04,2026-06-05",
        )
        parser.add_argument(
            "--baseline",
            default=None,
            help=(
                "Path to donor DataAggregator baseline JSON "
                "(donor_diff.load_baseline format); optional."
            ),
        )

    def handle(self, *args, **options):
        try:
            parsed = [
                date.fromisoformat(d.strip())
                for d in options["dates"].split(",")
                if d.strip()
            ]
        except ValueError as exc:
            raise CommandError(f"--dates contains an invalid date: {exc}") from exc
        if not parsed:
            raise CommandError("--dates must list at least one date")
        # Dedup + chronological order (review fix): a caller-supplied
        # duplicate/out-of-order list must not double-run checks or produce
        # a transcript that reads out of order.
        dates = sorted(set(parsed))

        baseline_by_day = {}
        if options["baseline"]:
            try:
                with open(options["baseline"], encoding="utf-8") as fh:
                    raw = json.load(fh)
                baseline_by_day = load_baseline(raw)
            except (OSError, ValueError) as exc:
                raise CommandError(f"cannot load --baseline: {exc}") from exc

        code_by_division_id = dict(Division.objects.values_list("id", "code"))

        red_dates = []
        dates_missing_from_baseline = []
        for on_date in dates:
            try:
                date_is_red = self._check_one_date(
                    on_date, baseline_by_day, code_by_division_id, options["baseline"]
                )
            except Exception as exc:  # noqa: BLE001
                # Review fix: an uncaught AssertionError/ValueError/DB error
                # from compute()/diff_day() (e.g. a corrupt division-code
                # collision) used to crash the WHOLE command with a raw
                # traceback — operationally indistinguishable from a real
                # exit-code success to a caller that doesn't read stdout.
                # An inability to even COMPUTE convergence is itself a
                # reason not to accept the migration (AC-1 spirit) — treat
                # it as red, isolated to this one date, and keep checking
                # the rest instead of aborting the whole batch.
                self.stdout.write(
                    self.style.ERROR(
                        f"{on_date.isoformat()}: ОШИБКА при проверке "
                        f"({type(exc).__name__}: {exc}) — считается красным"
                    )
                )
                date_is_red = True

            if on_date not in baseline_by_day and options["baseline"]:
                dates_missing_from_baseline.append(on_date)
            if date_is_red:
                red_dates.append(on_date)

        if red_dates:
            dates_str = ", ".join(d.isoformat() for d in red_dates)
            raise CommandError(
                f"МИГРАЦИЯ НЕ ПРИНЯТА: расхождения на {len(red_dates)} "
                f"дат(у) [{dates_str}] (AC-1)"
            )

        # Review fix: a bare "МИГРАЦИЯ ПРИНЯТА" read the same whether donor
        # reconciliation ran or not — Task 2 is optional, but the verdict
        # text must say so, not silently imply full AC-1 coverage.
        if not options["baseline"]:
            self.stdout.write(
                self.style.SUCCESS(
                    "МИГРАЦИЯ ПРИНЯТА (только формулы сходимости — "
                    "--baseline не передан, сверка с донором не выполнялась)"
                )
            )
        elif dates_missing_from_baseline:
            missing_str = ", ".join(d.isoformat() for d in dates_missing_from_baseline)
            self.stdout.write(
                self.style.SUCCESS(
                    "МИГРАЦИЯ ПРИНЯТА (частичная сверка с донором — "
                    f"нет в baseline: [{missing_str}])"
                )
            )
        else:
            self.stdout.write(
                self.style.SUCCESS("МИГРАЦИЯ ПРИНЯТА (формулы + сверка с донором)")
            )

    def _check_one_date(
        self, on_date, baseline_by_day, code_by_division_id, baseline_option
    ):
        result = StrengthReportService.compute(on_date)
        date_is_red = False

        if result.violations:
            date_is_red = True
            self.stdout.write(
                self.style.WARNING(f"{on_date.isoformat()}: violations:")
            )
            for v in result.violations:
                self.stdout.write(f"  - {v}")
        if result.warnings:
            self.stdout.write(f"{on_date.isoformat()}: warnings:")
            for w in result.warnings:
                self.stdout.write(f"  ~ {w}")

        if on_date in baseline_by_day:
            diff = diff_day(result, baseline_by_day[on_date], code_by_division_id)
            blocking = [
                c for c in diff.cells if c.category in GATE_BLOCKING_CATEGORIES
            ]
            if blocking:
                date_is_red = True
                self.stdout.write(
                    self.style.ERROR(
                        f"{on_date.isoformat()}: {len(blocking)} "
                        "gate-blocking cell(s):"
                    )
                )
                for cell in blocking:
                    self.stdout.write(
                        f"  - {cell.division_code}/{cell.column}: "
                        f"vaps={cell.vaps} donor={cell.donor} "
                        f"delta={cell.delta} ({cell.category})"
                    )
            else:
                self.stdout.write(
                    self.style.SUCCESS(
                        f"{on_date.isoformat()}: baseline OK "
                        f"({len(diff.cells)} cells, 0 blocking)"
                    )
                )
        elif baseline_option:
            self.stdout.write(
                self.style.WARNING(
                    f"{on_date.isoformat()}: нет в --baseline, сверка "
                    "с донором пропущена для этой даты"
                )
            )

        if not date_is_red:
            self.stdout.write(
                self.style.SUCCESS(f"{on_date.isoformat()}: сходимость OK")
            )
        return date_is_red
