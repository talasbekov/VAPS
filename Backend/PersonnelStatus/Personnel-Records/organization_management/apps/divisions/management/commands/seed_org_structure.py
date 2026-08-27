"""Дерево подразделений тестового стенда (Plane №201, шаг 3 плана №198).

ЧТО ЗАВОДИТ. Ровно то, что перечислил заказчик в №198: три департамента, у
каждого шесть управлений, из них четыре с отделами (три по два отдела и одно с
тремя) и два сквозных — без отделов. На департамент это 9 отделов и 2 сквозных
управления, на всю организацию — 3 департамента, 18 управлений, 27 отделов,
6 сквозных. Шестое управление названо вторым сквозным по решению заказчика от
27.08.2026: в исходном описании перечислено пять, и вилка закрыта им, а не
допущением.

КУДА ВЕШАЕТСЯ. Под СУЩЕСТВУЮЩИЙ корень (`division_type='organization'`), а не
под новый. Второй корень раскроил бы портал надвое: сегодняшние сотрудники
стенда висят в дереве «Служба», и рядом с ним появилась бы вторая организация
с тем же смыслом. Корня нет вовсе — заводится один, и это единственный случай,
когда команда создаёт организацию.

СТАРОЕ НЕ ТРОГАЕТСЯ. «Департамент охраны» и его дети на стенде остаются на
месте: расширять, а не подменять. Сид добавляет свои узлы рядом.

ИДЕМПОТЕНТНОСТЬ — ПО КОДУ, а не по имени. Код детерминированный
(`SEED-D1`, `SEED-D1-U4`, `SEED-D1-U4-O3`), поэтому повтор находит свой узел
даже после переименования руками в Admin, а имя при этом не перезаписывается:
переименовал человек — значит хотел так. Имя по уникальности внутри родителя
всё равно проверяется, и столкновение с ЧУЖИМ узлом того же имени команда не
маскирует, а объявляет ошибкой.

`--wipe` СНОСИТ ТОЛЬКО СВОЁ — узлы с префиксом кода `SEED-`. И отказывается
это делать, если на них уже посажены штатные единицы: `StaffUnit.division`
стоит `on_delete=SET_NULL`, то есть снос дерева не уронил бы слоты, а тихо
оставил бы их без подразделения — штатка превратилась бы в мусор, который
никто не заметит. Нужно всё равно — `--wipe --force`, и тогда команда говорит
вслух, сколько слотов осиротеет.
"""
from __future__ import annotations

from dataclasses import dataclass

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from organization_management.apps.divisions.models import Division

CODE_PREFIX = "SEED-"

# Состав департамента. Числа — решение заказчика в №198 и уточнение 27.08.2026
# («шестое — ещё одно сквозное без отделов»).
DEPARTMENTS = ("Первый департамент", "Второй департамент", "Третий департамент")

#: Сколько людей даёт один департамент: 2 своих слота + 6 управлений × 2 +
#: (9 отделов + 2 сквозных) × 12 = 142. Число нужно, чтобы попросить «структуру
#: под пять тысяч» и получить её, а не считать департаменты в уме.
PEOPLE_PER_DEPARTMENT = 142
DIRECTORATES_WITH_DIVISIONS = (2, 2, 2, 3)  # четыре управления с отделами
CROSS_CUTTING = ("Первое сквозное управление", "Второе сквозное управление")

# Два ряда порядковых, а не один: «управление» среднего рода, «отдел» —
# мужского, и общий ряд давал «Первое отдел». Названия видит заказчик на
# экране, и такая строка читается как недоделка, а не как тестовые данные.
ORDINAL_NEUTER = (
    "Первое", "Второе", "Третье", "Четвёртое", "Пятое", "Шестое",
    "Седьмое", "Восьмое", "Девятое", "Десятое",
)
ORDINAL_MASCULINE = (
    "Первый", "Второй", "Третий", "Четвёртый", "Пятый", "Шестой",
    "Седьмой", "Восьмой", "Девятый", "Десятый",
)


@dataclass
class Counters:
    created: int = 0
    kept: int = 0


class Command(BaseCommand):
    help = "Заводит дерево подразделений тестового стенда (Plane №198/№201)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--departments",
            type=int,
            default=len(DEPARTMENTS),
            help=(
                "Сколько департаментов завести (по умолчанию три — как просил заказчик). "
                "Состав каждого не меняется."
            ),
        )
        parser.add_argument(
            "--people",
            type=int,
            help=(
                "Завести столько департаментов, чтобы штат вышел не меньше указанного "
                f"числа людей (в одном департаменте {PEOPLE_PER_DEPARTMENT}). "
                "Перекрывает --departments."
            ),
        )
        parser.add_argument(
            "--wipe",
            action="store_true",
            help="Снести ранее заведённые сидом подразделения (код с префиксом SEED-).",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Разрешить снос, даже если на подразделениях висят штатные единицы.",
        )

    def handle(self, *args, **options):
        if options["wipe"]:
            self._wipe(force=options["force"])
            return

        count = self._departments_count(options)
        counters = Counters()
        with transaction.atomic():
            root = self._root(counters)
            for department_index, department_name in self._department_names(count):
                department = self._node(
                    code=f"{CODE_PREFIX}D{department_index}",
                    name=department_name,
                    division_type=Division.DivisionType.DEPARTMENT,
                    parent=root,
                    order=department_index,
                    counters=counters,
                )
                self._directorates(department, department_index, counters)

        total = Division.objects.filter(code__startswith=CODE_PREFIX).count()
        self.stdout.write(
            self.style.SUCCESS(
                f"Дерево готово: заведено {counters.created}, уже было {counters.kept}; "
                f"узлов сида всего {total}."
            )
        )

    @staticmethod
    def _departments_count(options) -> int:
        """Сколько департаментов заводить: по числу или по требуемому штату."""
        if options.get("people"):
            return max(1, -(-int(options["people"]) // PEOPLE_PER_DEPARTMENT))
        return max(1, int(options["departments"]))

    @staticmethod
    def _department_names(count: int):
        """(номер, название). Первые три — словами заказчика, дальше — числом.

        Порядковые словами дальше десятого читаются хуже числа («Тридцать пятый
        департамент»), а стенду под пять тысяч человек нужно тридцать пять.
        """
        for index in range(1, count + 1):
            if index <= len(DEPARTMENTS):
                yield index, DEPARTMENTS[index - 1]
            else:
                yield index, f"Департамент №{index}"

    # ── построение ────────────────────────────────────────────────────────

    def _root(self, counters: Counters) -> Division:
        root = (
            Division.objects.filter(division_type=Division.DivisionType.ORGANIZATION, parent__isnull=True)
            .order_by("id")
            .first()
        )
        if root is not None:
            return root
        return self._node(
            code=f"{CODE_PREFIX}ORG",
            name="Служба",
            division_type=Division.DivisionType.ORGANIZATION,
            parent=None,
            order=0,
            counters=counters,
        )

    def _directorates(self, department: Division, department_index: int, counters: Counters) -> None:
        position = 0
        for directorate_index, divisions_count in enumerate(DIRECTORATES_WITH_DIVISIONS, start=1):
            position += 1
            directorate = self._node(
                code=f"{CODE_PREFIX}D{department_index}-U{directorate_index}",
                name=f"{ORDINAL_NEUTER[directorate_index - 1]} управление",
                division_type=Division.DivisionType.DIRECTORATE,
                parent=department,
                order=position,
                counters=counters,
            )
            for division_index in range(1, divisions_count + 1):
                self._node(
                    code=f"{CODE_PREFIX}D{department_index}-U{directorate_index}-O{division_index}",
                    name=f"{ORDINAL_MASCULINE[division_index - 1]} отдел",
                    division_type=Division.DivisionType.DIVISION,
                    parent=directorate,
                    order=division_index,
                    counters=counters,
                )
        for cross_index, cross_name in enumerate(CROSS_CUTTING, start=1):
            position += 1
            self._node(
                code=f"{CODE_PREFIX}D{department_index}-S{cross_index}",
                name=cross_name,
                division_type=Division.DivisionType.DIRECTORATE,
                parent=department,
                order=position,
                counters=counters,
            )

    def _node(self, *, code, name, division_type, parent, order, counters: Counters) -> Division:
        existing = Division.objects.filter(code=code).first()
        if existing is not None:
            counters.kept += 1
            return existing
        clash = Division.objects.filter(parent=parent, name=name).first()
        if clash is not None:
            raise CommandError(
                f"«{name}» под родителем «{parent}» уже занято чужим узлом "
                f"(код {clash.code}, а сид ждёт {code}). Переименуйте чужой узел "
                f"или снесите сид командой --wipe: молча присвоить чужое нельзя."
            )
        node = Division.objects.create(
            code=code,
            name=name,
            division_type=division_type,
            parent=parent,
            order=order,
        )
        counters.created += 1
        return node

    # ── снос ──────────────────────────────────────────────────────────────

    def _wipe(self, *, force: bool) -> None:
        from organization_management.apps.staff_unit.models import StaffUnit

        seeded = Division.objects.filter(code__startswith=CODE_PREFIX)
        count = seeded.count()
        if not count:
            self.stdout.write("Сносить нечего: узлов сида нет.")
            return
        slots = StaffUnit.objects.filter(division__in=seeded).count()
        if slots and not force:
            raise CommandError(
                f"На узлах сида висит штатных единиц: {slots}. Снос оставил бы их "
                f"без подразделения (division=SET_NULL), а не удалил. Снимите слоты "
                f"или повторите с --force."
            )
        if slots:
            self.stdout.write(
                self.style.WARNING(f"Осиротеет штатных единиц: {slots} — снос разрешён флагом --force.")
            )
        # Поштучно и сверху вниз, а НЕ `queryset.delete()`: массовое удаление
        # идёт мимо `Model.delete()`, и MPTT остаётся с разъехавшимися
        # `lft/rght` — дерево на экране после этого показывает узлы не там, где
        # они есть. Дети уезжают каскадом за родителем (`parent` — CASCADE),
        # поэтому к своей очереди часть узлов уже не существует.
        with transaction.atomic():
            for node in list(seeded.order_by("level", "id")):
                if Division.objects.filter(pk=node.pk).exists():
                    node.delete()
            Division.objects.rebuild()
        self.stdout.write(self.style.SUCCESS(f"Снесено узлов сида: {count}."))
