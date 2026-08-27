"""Единая точка входа в наполнение стенда (Plane №209, шаг 11 плана №198).

ЗАЧЕМ, ЕСЛИ КОМАНДЫ УЖЕ ЕСТЬ. Порядок между ними несущий: штатка ссылается на
должности, люди — на слоты, аватарки — на людей. Названный вслух порядок в одном
месте дешевле, чем memorized последовательность из пяти строк, которую каждый
раз набирают заново и путают.

ПОЧЕМУ ОРКЕСТРАТОР ПОЯВИЛСЯ ПОСЛЕ ЧАСТЕЙ, А НЕ ВМЕСТО НИХ. Каждая часть
идемпотентна, гоняется отдельно и падает по-своему; собери их в один файл
сразу — и падение на аватарках заставляло бы перезаводить структуру. Здесь
только последовательность и ничего своего: ни одной строки в базу эта команда
не пишет.

ДВА СЛОЯ. «Кадры» — структура, справочник должностей и званий, штатка, люди,
фотографии — заводятся всегда. «Раздел ОМ» — роли и права, типы статусов,
законы — идут следом и снимаются флагом `--skip-ops`: на стенде, где раздел уже
наполнен, повтор ничего не меняет, но занимает минуты.

`--wipe` СНОСИТ ТОЛЬКО КАДРЫ и в обратном порядке (фотографии → люди → штатка →
должности → структура): иначе снос структуры оставил бы слоты без
подразделения. У сидов раздела ОМ сноса нет вовсе, и команда говорит это
вслух, а не делает вид, что убрала всё.
"""
from __future__ import annotations

from django.core.management import call_command
from django.core.management.base import BaseCommand

# Порядок несущий: каждая следующая команда ссылается на то, что завела
# предыдущая. Читать сверху вниз.
PERSONNEL_STEPS = (
    ("seed_org_structure", "дерево подразделений"),
    ("seed_positions_ranks", "должности и звания"),
    ("seed_staffing", "штатные единицы"),
    ("seed_employees", "сотрудники на слотах"),
    ("seed_employee_photos", "аватарки"),
)

OPS_STEPS = (
    ("seed_status_types", "типы статусов раздела ОМ"),
    ("seed_operations", "роли, права и справочники раздела ОМ"),
    ("seed_legal_documents", "законы об ОМ"),
)


class Command(BaseCommand):
    help = "Наполняет стенд целиком: кадры и раздел ОМ (Plane №198/№209)."

    def add_arguments(self, parser):
        parser.add_argument("--skip-ops", action="store_true", help="Только кадры, без раздела ОМ.")
        parser.add_argument("--wipe", action="store_true", help="Снести кадры сида в обратном порядке.")

    def handle(self, *args, **options):
        if options["wipe"]:
            self._wipe()
            return

        steps = list(PERSONNEL_STEPS) + ([] if options["skip_ops"] else list(OPS_STEPS))
        for number, (command, what) in enumerate(steps, start=1):
            self.stdout.write(self.style.MIGRATE_HEADING(f"[{number}/{len(steps)}] {what} — {command}"))
            call_command(command)

        self.stdout.write(self.style.SUCCESS(f"Стенд наполнен: шагов пройдено {len(steps)}."))

    def _wipe(self) -> None:
        for command, what in reversed(PERSONNEL_STEPS):
            self.stdout.write(self.style.MIGRATE_HEADING(f"снос: {what} — {command} --wipe"))
            call_command(command, "--wipe")
        self.stdout.write(
            self.style.WARNING(
                "Данные раздела ОМ (роли, типы статусов, законы, мероприятия) НЕ снесены: "
                "сноса у тех команд нет, и делать вид, что стенд чист, нельзя."
            )
        )
