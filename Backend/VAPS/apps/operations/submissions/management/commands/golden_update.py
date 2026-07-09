"""``golden_update`` — ревью-гейтовая регенерация golden-эталона расхода (6.8).

Регенерирует ``expected_values.json`` + ``expected_document.xml`` НА МЕСТЕ из
закоммиченного ``input.json`` (ЧИСТО, без БД, теми же функциями, что и
consumer-тест — анти-дрейф). НЕ трогает ``input.json``. Эталон меняет ЧЕЛОВЕК,
читая ``git diff`` (зеркало ``make schema`` + ``test_schema_drift``, Ловушка №6).
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.operations.submissions.golden import (
    dumps,
    expected_document_xml,
    expected_values,
    load_input,
)

_GOLDEN_DIR = Path(__file__).resolve().parents[2] / "tests" / "golden"


class Command(BaseCommand):
    help = "Регенерировать golden-эталон расхода (числа + document.xml) из input.json."

    def add_arguments(self, parser):
        parser.add_argument(
            "--case",
            help="NNN — обновить только case_NNN (по умолчанию — все кейсы).",
        )

    def handle(self, *args, **options):
        case = options.get("case")
        # Корпус zero-padded (case_NNN): нормализуем «--case 5» → «case_005»,
        # чтобы числовой аргумент не промахивался молча мимо кейса.
        if case and case.isdigit():
            case = case.zfill(3)
        pattern = f"case_{case}" if case else "case_*"
        case_dirs = sorted(_GOLDEN_DIR.glob(pattern))
        if not case_dirs:
            raise CommandError(
                f"golden_update: не найдено кейсов по {pattern!r} в {_GOLDEN_DIR}"
            )
        for case_dir in case_dirs:
            input_path = case_dir / "input.json"
            # Вычисляем ОБА эталона ДО записи: битый input.json → внятный
            # CommandError, а кейс не остаётся полу-обновлённым (values без xml).
            try:
                data = json.loads(input_path.read_text(encoding="utf-8"))
                inputs = load_input(data)
                values_text = dumps(expected_values(inputs))
                xml_bytes = expected_document_xml(inputs)
            except (OSError, ValueError, KeyError) as exc:
                raise CommandError(
                    f"golden_update: {case_dir.name}/input.json — "
                    f"{type(exc).__name__}: {exc}"
                ) from exc
            (case_dir / "expected_values.json").write_text(
                values_text, encoding="utf-8"
            )
            (case_dir / "expected_document.xml").write_bytes(xml_bytes)
            self.stdout.write(f"обновлён {case_dir.name}")
        self.stdout.write(
            "review the diff before committing: "
            "git diff -- apps/operations/submissions/tests/golden"
        )
