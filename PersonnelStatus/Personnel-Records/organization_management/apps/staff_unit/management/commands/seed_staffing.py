"""Штатное расписание тестового стенда: слоты под структуру (Plane №203, шаг 5).

ЧТО ЗАВОДИТ. Пустые штатные единицы под подразделения сида №201 — ровно по
словам заказчика: «каждое подразделение имеет своих начальников подразделения и
заместителей, и у отделов и сквозных управлений есть исполнительский состав
где-то по десять сотрудников».

    департамент            →  начальник + заместитель                 = 2
    управление с отделами  →  начальник + заместитель                 = 2
    сквозное управление    →  начальник + заместитель + 10 исполнителей = 12
    отдел                  →  начальник + заместитель + 10 исполнителей = 12

На департамент это 142 слота, на всю структуру — **426**.

СЛОТЫ ОСТАЮТСЯ ПУСТЫМИ. Людей сажает следующая карточка (№204). Разделено не
для красоты: слот без человека — это вакансия, законное состояние системы, а
человек без слота — нет. Значит штатку можно завести и проверить отдельно, а
людей посадить потом.

ГРАНИЦА ДЕЙСТВИЯ — ПОДРАЗДЕЛЕНИЯ СИДА (код с префиксом `SEED-`). Чужих
подразделений стенда команда не касается вовсе: у «Отдела охраны объектов» своя
штатка на 6 слотов, и досыпать ей исполнителей до десяти значило бы менять
данные, на которые настроены пробы смоука.

ИДЕМПОТЕНТНОСТЬ — по тройке (подразделение, должность, номер слота). Уникального
ключа у `StaffUnit` в модели нет, поэтому повтор ищет ровно ту тройку, которую
сам и создаёт; порядок создания детерминированный, значит второй запуск не
плодит близнецов.

`--wipe` сносит слоты подразделений сида и ОТКАЗЫВАЕТСЯ, если на них уже сидят
люди: удалить слот с человеком — значит потерять его назначение молча. `--force`
разрешает и говорит, сколько назначений будет снято.
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.staff_unit.models import StaffUnit

DIVISION_CODE_PREFIX = "SEED-"

CHIEF_BY_TYPE = {
    Division.DivisionType.DEPARTMENT: ("Начальник департамента", "Заместитель начальника департамента"),
    Division.DivisionType.DIRECTORATE: ("Начальник управления", "Заместитель начальника управления"),
    Division.DivisionType.DIVISION: ("Начальник отдела", "Заместитель начальника отдела"),
}

# Десять исполнителей — состав, а не десять одинаковых строк: реестры и
# расстановка сортируют людей по старшинству должности, и десять инспекторов
# подряд не дали бы проверить эту сортировку вовсе.
EXECUTIVE_STAFF = (
    ("Старший инспектор", 2),
    ("Инспектор", 6),
    ("Дежурный", 2),
)


class Command(BaseCommand):
    help = "Заводит штатные единицы под структуру сида (Plane №198/№203)."

    def add_arguments(self, parser):
        parser.add_argument("--wipe", action="store_true", help="Снести слоты подразделений сида.")
        parser.add_argument(
            "--force", action="store_true", help="Разрешить снос слотов, на которых сидят люди."
        )

    def handle(self, *args, **options):
        if options["wipe"]:
            self._wipe(force=options["force"])
            return

        divisions = list(
            Division.objects.filter(code__startswith=DIVISION_CODE_PREFIX)
            .exclude(division_type=Division.DivisionType.ORGANIZATION)
            .order_by("tree_id", "lft")
        )
        if not divisions:
            raise CommandError(
                "Подразделений сида нет: сперва `manage.py seed_org_structure`. "
                "Штатка без структуры повисла бы в воздухе."
            )

        positions = self._positions()
        created = kept = 0
        with transaction.atomic():
            for division in divisions:
                for index, position_name in enumerate(self._slots_for(division), start=1):
                    _, was_created = self._slot(division, positions[position_name], index)
                    created += int(was_created)
                    kept += int(not was_created)

        total = StaffUnit.objects.filter(division__code__startswith=DIVISION_CODE_PREFIX).count()
        self.stdout.write(
            self.style.SUCCESS(
                f"Штатка готова: заведено {created}, уже было {kept}; "
                f"слотов на подразделениях сида {total}."
            )
        )

    # ── состав ────────────────────────────────────────────────────────────

    def _slots_for(self, division: Division) -> list[str]:
        chief, deputy = CHIEF_BY_TYPE[division.division_type]
        slots = [chief, deputy]
        if self._has_executive_staff(division):
            for position_name, count in EXECUTIVE_STAFF:
                slots.extend([position_name] * count)
        return slots

    @staticmethod
    def _has_executive_staff(division: Division) -> bool:
        """Исполнители живут в отделах и в СКВОЗНЫХ управлениях.

        Сквозное управление узнаётся по отсутствию детей, а не по имени:
        переименование в Admin не должно менять состав штатки.
        """
        if division.division_type == Division.DivisionType.DIVISION:
            return True
        return division.division_type == Division.DivisionType.DIRECTORATE and not division.children.exists()

    def _positions(self) -> dict[str, Position]:
        wanted = {name for pair in CHIEF_BY_TYPE.values() for name in pair}
        wanted |= {name for name, _ in EXECUTIVE_STAFF}
        found = {p.name: p for p in Position.objects.filter(name__in=wanted)}
        missing = sorted(wanted - set(found))
        if missing:
            raise CommandError(
                "В справочнике должностей нет: " + ", ".join(missing) + ". "
                "Сперва `manage.py seed_positions_ranks` — штатка ссылается на должности, "
                "а не заводит их."
            )
        return found

    def _slot(self, division: Division, position: Position, index: int) -> tuple[StaffUnit, bool]:
        existing = StaffUnit.objects.filter(division=division, position=position, index=index).first()
        if existing is not None:
            return existing, False
        return StaffUnit.objects.create(division=division, position=position, index=index), True

    # ── снос ──────────────────────────────────────────────────────────────

    def _wipe(self, *, force: bool) -> None:
        slots = StaffUnit.objects.filter(division__code__startswith=DIVISION_CODE_PREFIX)
        count = slots.count()
        if not count:
            self.stdout.write("Сносить нечего: слотов на подразделениях сида нет.")
            return
        occupied = slots.exclude(employee__isnull=True).count()
        if occupied and not force:
            raise CommandError(
                f"На слотах сида сидят люди: {occupied}. Снос потерял бы их назначения молча. "
                f"Снимите людей или повторите с --force."
            )
        if occupied:
            self.stdout.write(
                self.style.WARNING(f"Снимается назначений: {occupied} — разрешено флагом --force.")
            )
        with transaction.atomic():
            for slot in list(slots):
                slot.delete()
            StaffUnit.objects.rebuild()
        self.stdout.write(self.style.SUCCESS(f"Снесено слотов: {count}."))
