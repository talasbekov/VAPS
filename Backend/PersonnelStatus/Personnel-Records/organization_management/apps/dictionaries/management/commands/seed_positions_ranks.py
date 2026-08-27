"""Должности и звания под структуру стенда (Plane №202, шаг 4 плана №198).

ЗАЧЕМ ОТДЕЛЬНОЙ КОМАНДОЙ, а не правкой `init_dictionaries`. Та наполняет ВСЕ
девять справочников портала демо-значениями на английском («Director»,
«Passport») и держится в паре с миграцией `0002_seed_reference_data`. Трогать
её здесь значило бы одной правкой сменить и состав должностей, и содержимое
справочников, которые по инвентарю №199 идут под архивирование. Здесь — ровно
должности и звания, ровно те, что нужны штатке из №203.

ЗАВОДИТСЯ ЛЕСТНИЦА, А НЕ НАБОР. `level` в обеих моделях означает старшинство
(«чем меньше число, тем выше»), по нему сортируются люди в разрезах и в
расстановке. Поэтому значения идут сплошным рядом без дыр и пересечений: восемь
должностей от начальника департамента до инспектора и десять званий от
полковника до сержанта.

СУЩЕСТВУЮЩИЕ СТРОКИ УСЫНОВЛЯЮТСЯ, А НЕ ДУБЛИРУЮТСЯ. На стенде уже живут
«Начальник отдела», «Инспектор», «майор» и другие — с чужими кодами и с
уровнями, расставленными до появления лестницы (у «Начальника отдела» стоял
level 1, как у первого лица службы). Завести своё рядом значило бы показать в
выпадающем списке двух «Инспекторов», и человек не смог бы выбрать правильного.
Поэтому строка ищется сперва по коду, затем ПО ИМЕНИ — и найденной по имени
правится `level` под лестницу, а её собственный код остаётся: по нему на неё уже
могли сослаться. Это осознанная правка чужих данных, и она названа в
`Decisions.md`.

`--wipe` сносит ТОЛЬКО заведённое этой командой (код с префиксом `SEED-`) и
отказывается это делать, если на должностях висят штатные единицы: у
`StaffUnit.position` стоит `SET_NULL`, то есть слоты не удалились бы, а тихо
остались бы без должности. Усыновлённые чужие строки сносом не трогаются
никогда — они не наши.
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from organization_management.apps.dictionaries.models import Position, Rank

CODE_PREFIX = "SEED-"

# (код, название, уровень). Уровни — сплошной ряд: старшинство читается
# сравнением, и дыра в нём означала бы «здесь кого-то забыли».
POSITIONS = (
    (f"{CODE_PREFIX}POS-DEP-CHIEF", "Начальник департамента", 1),
    (f"{CODE_PREFIX}POS-DEP-DEPUTY", "Заместитель начальника департамента", 2),
    (f"{CODE_PREFIX}POS-DIR-CHIEF", "Начальник управления", 3),
    (f"{CODE_PREFIX}POS-DIR-DEPUTY", "Заместитель начальника управления", 4),
    (f"{CODE_PREFIX}POS-DIV-CHIEF", "Начальник отдела", 5),
    (f"{CODE_PREFIX}POS-DIV-DEPUTY", "Заместитель начальника отдела", 6),
    (f"{CODE_PREFIX}POS-SENIOR", "Старший инспектор", 7),
    (f"{CODE_PREFIX}POS-INSPECTOR", "Инспектор", 8),
    # «Дежурный» на стенде уже есть и на нём стоят люди — он часть лестницы, а
    # не остаток: усыновляется и встаёт под инспектором.
    (f"{CODE_PREFIX}POS-DUTY", "Дежурный", 9),
)

# Куда уезжает всё, чего в лестнице нет. Демо-строки миграции
# `0002_seed_reference_data` («Director», «Manager», «Developer») стоят на
# уровнях 1-3 и делят их с начальниками департамента и управления — а
# одинаковый уровень означает произвольный порядок в сортировке по старшинству.
# Имена и коды у них не трогаются (на них могли сослаться), меняется только
# место: ниже всей лестницы, но в прежнем порядке между собой.
OUTSIDE_LADDER_LEVEL = 90

# Звания пишутся строчными — как уже заведённые на стенде («майор», «капитан»).
# Смешение регистров в одном списке читается как недоделка.
RANKS = (
    (f"{CODE_PREFIX}RANK-COL", "полковник", 1),
    (f"{CODE_PREFIX}RANK-LTCOL", "подполковник", 2),
    (f"{CODE_PREFIX}RANK-MAJ", "майор", 3),
    (f"{CODE_PREFIX}RANK-CPT", "капитан", 4),
    (f"{CODE_PREFIX}RANK-SRLT", "старший лейтенант", 5),
    (f"{CODE_PREFIX}RANK-LT", "лейтенант", 6),
    (f"{CODE_PREFIX}RANK-JRLT", "младший лейтенант", 7),
    (f"{CODE_PREFIX}RANK-WO", "прапорщик", 8),
    (f"{CODE_PREFIX}RANK-SGTMAJ", "старшина", 9),
    (f"{CODE_PREFIX}RANK-SGT", "сержант", 10),
)


class Command(BaseCommand):
    help = "Заводит должности и звания под структуру стенда (Plane №198/№202)."

    def add_arguments(self, parser):
        parser.add_argument("--wipe", action="store_true", help="Снести заведённое этой командой.")
        parser.add_argument(
            "--force",
            action="store_true",
            help="Разрешить снос, даже если на должностях висят штатные единицы.",
        )

    def handle(self, *args, **options):
        if options["wipe"]:
            self._wipe(force=options["force"])
            return

        with transaction.atomic():
            positions = self._fill(Position, POSITIONS)
            ranks = self._fill(Rank, RANKS)
            moved = self._demote_outsiders(Position, POSITIONS) + self._demote_outsiders(Rank, RANKS)
        if moved:
            self.stdout.write(
                self.style.WARNING(
                    f"Вне лестницы найдено строк: {moved} — уровни сдвинуты под неё "
                    f"(с {OUTSIDE_LADDER_LEVEL}), имена и коды не тронуты."
                )
            )

        for title, (created, adopted, kept) in (("Должности", positions), ("Звания", ranks)):
            self.stdout.write(
                self.style.SUCCESS(
                    f"{title}: заведено {created}, усыновлено {adopted}, уже было {kept}."
                )
            )

    def _fill(self, model, rows) -> tuple[int, int, int]:
        created = adopted = kept = 0
        for code, name, level in rows:
            existing = model.objects.filter(code=code).first()
            if existing is not None:
                if existing.level != level:
                    existing.level = level
                    existing.save(update_fields=["level"])
                kept += 1
                continue
            by_name = model.objects.filter(name__iexact=name).first()
            if by_name is not None:
                if by_name.level != level:
                    by_name.level = level
                    by_name.save(update_fields=["level"])
                adopted += 1
                continue
            model.objects.create(code=code, name=name, level=level)
            created += 1
        return created, adopted, kept

    def _demote_outsiders(self, model, rows) -> int:
        """Сдвинуть под лестницу всё, что в неё не входит.

        Иначе «Director» с уровнем 1 стоит вровень с начальником департамента, и
        сортировка по старшинству отдаёт их в произвольном порядке — экран
        каждый раз разный, а причина невидима.
        """
        ladder_names = {name.lower() for _, name, _ in rows}
        ladder_codes = {code for code, _, _ in rows}
        outsiders = [
            row
            for row in model.objects.exclude(code__in=ladder_codes).order_by("level", "id")
            if row.name.lower() not in ladder_names and row.level < OUTSIDE_LADDER_LEVEL
        ]
        for offset, row in enumerate(outsiders):
            row.level = OUTSIDE_LADDER_LEVEL + offset
            row.save(update_fields=["level"])
        return len(outsiders)

    def _wipe(self, *, force: bool) -> None:
        from organization_management.apps.staff_unit.models import StaffUnit

        positions = Position.objects.filter(code__startswith=CODE_PREFIX)
        ranks = Rank.objects.filter(code__startswith=CODE_PREFIX)
        total = positions.count() + ranks.count()
        if not total:
            self.stdout.write("Сносить нечего: строк с префиксом сида нет.")
            return
        slots = StaffUnit.objects.filter(position__in=positions).count()
        if slots and not force:
            raise CommandError(
                f"На должностях сида висит штатных единиц: {slots}. Снос оставил бы их "
                f"без должности (position=SET_NULL). Снимите слоты или повторите с --force."
            )
        if slots:
            self.stdout.write(
                self.style.WARNING(f"Осиротеет штатных единиц: {slots} — снос разрешён флагом --force.")
            )
        with transaction.atomic():
            positions.delete()
            ranks.delete()
        self.stdout.write(self.style.SUCCESS(f"Снесено строк справочников: {total}."))
