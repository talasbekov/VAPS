"""Пересчёт эталона печатной формы расхода (порт golden_update из Backend/VAPS).

Единственный законный способ изменить эталон. Правка `numbers.json` или
`document.xml` руками запрещена не из строгости: эталон должен быть тем, что
СЕЙЧАС выдаёт код, а не тем, что человек считает правильным. Руками
подправленный файл разошёлся бы с реальностью и сверка перестала бы что-либо
значить — при этом оставаясь зелёной.

Команда зовёт ТЕ ЖЕ функции, что и сверка (`golden.expected_*`): считай они
по-разному, обновление записывало бы то, чего тест никогда не увидит.

БЕЗ БАЗЫ И БЕЗ ЧАСОВ: все входы заморожены в `input.json`. Поэтому команда
работает на пустом окружении и её результат не зависит от того, что лежит в
базе в момент запуска.
"""
import json
import pathlib

from django.core.management.base import BaseCommand, CommandError

from organization_management.apps.operations import golden

GOLDEN_ROOT = (
    pathlib.Path(__file__).resolve().parents[2] / "tests" / "golden"
)


class Command(BaseCommand):
    help = (
        "Пересчитать эталон печатной формы расхода из input.json каждого "
        "случая. --check ничего не пишет и лишь сообщает, что разошлось."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--case",
            help="Обновить только один случай (имя каталога).",
        )
        parser.add_argument(
            "--check",
            action="store_true",
            help="Не писать, только сообщить о расхождениях (для проверки).",
        )

    def handle(self, *args, **options):
        cases = self._cases(options.get("case"))
        changed = []
        for case in cases:
            if self._update_case(case, check=options["check"]):
                changed.append(case.name)

        if not changed:
            self.stdout.write("Эталон совпадает с текущим выводом; изменений нет.")
            return

        if options["check"]:
            # Ненулевой выход, чтобы проверку можно было поставить в конвейер:
            # «разошлось» обязано отличаться от «всё в порядке» не только
            # текстом, иначе автоматика этого не заметит.
            raise CommandError(
                "Эталон разошёлся с текущим выводом: "
                + ", ".join(changed)
                + ". Если изменение желаемое — перезапустите без --check."
            )
        self.stdout.write(f"Эталон обновлён: {', '.join(changed)}")

    def _cases(self, name):
        if not GOLDEN_ROOT.is_dir():
            raise CommandError(f"каталог эталона не найден: {GOLDEN_ROOT}")
        if name:
            case = GOLDEN_ROOT / name
            if not case.is_dir():
                raise CommandError(f"случай {name!r} не найден в {GOLDEN_ROOT}")
            return [case]
        cases = sorted(path for path in GOLDEN_ROOT.iterdir() if path.is_dir())
        if not cases:
            # Молчаливый успех на пустом наборе означал бы «эталон в порядке»
            # там, где эталона нет вовсе.
            raise CommandError(f"в {GOLDEN_ROOT} нет ни одного случая")
        return cases

    def _update_case(self, case, *, check):
        source = case / golden.INPUT_FILE
        if not source.is_file():
            raise CommandError(f"у случая {case.name} нет {golden.INPUT_FILE}")
        inputs = golden.load_case(
            json.loads(source.read_text(encoding="utf-8"))
        )
        numbers = golden.dumps(golden.expected_numbers(inputs)).encode("utf-8")
        document = golden.expected_document(inputs)

        changed = False
        for path, payload in (
            (case / golden.NUMBERS_FILE, numbers),
            (case / golden.DOCUMENT_FILE, document),
        ):
            # Сравнение ДО записи: файл, переписанный тем же содержимым, всё
            # равно меняет время изменения и попадает в git как «тронут». Тогда
            # каждый прогон команды выглядел бы изменением эталона.
            if path.is_file() and path.read_bytes() == payload:
                continue
            changed = True
            if not check:
                path.write_bytes(payload)
        return changed
