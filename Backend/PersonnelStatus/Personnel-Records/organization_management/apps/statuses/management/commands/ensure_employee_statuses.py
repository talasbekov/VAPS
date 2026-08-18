"""Проставить «в строю» работающим сотрудникам без действующего статуса.

Разовая уборка за прошлым: дефолтный статус заводила только одна ручка
(`_directorate_create`), поэтому сотрудники, пришедшие импортом, админкой или
сидом, оставались без статуса вовсе. На будущее их закрывает сигнал
`give_new_employee_a_status`; здесь — те, кто уже заведён.

Команда идемпотентна: повторный запуск ничего не пишет. Её не стыдно поставить
в регламент — она же служит проверкой инварианта («сколько ещё без статуса»).

Уволенных не трогает: у них статусы закрыты намеренно, соседним сигналом
`close_statuses_on_dismissal`.
"""
from django.core.management.base import BaseCommand
from django.core.exceptions import ValidationError

from organization_management.apps.statuses.services import (
    default_status_start,
    employees_without_active_status,
    ensure_active_status,
)


class Command(BaseCommand):
    help = (
        "Завести статус «в строю» работающим сотрудникам, у которых нет "
        "действующего статуса. Идемпотентно; --dry-run только показывает."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Показать, кого коснётся, и ничего не писать.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        # Список забирается ЦЕЛИКОМ до записи: queryset ленивый, и по мере
        # создания статусов он бы сам себя опустошал — половина сотрудников
        # осталась бы необработанной, а команда отрапортовала бы об успехе.
        targets = list(employees_without_active_status())

        if not targets:
            self.stdout.write(self.style.SUCCESS(
                'Все работающие сотрудники имеют действующий статус.'
            ))
            return

        self.stdout.write(
            f'Работающих без действующего статуса: {len(targets)}'
        )

        created = 0
        failed = 0
        for employee in targets:
            start = default_status_start(employee)
            label = (
                f'  {employee.personnel_number} {employee.last_name} '
                f'{employee.first_name} — «в строю» с {start}'
            )
            if dry_run:
                self.stdout.write(label)
                continue
            try:
                status = ensure_active_status(employee)
            except ValidationError as error:
                # Причина называется вслух и по сотруднику: молчаливый пропуск
                # выглядел бы как успешная уборка.
                failed += 1
                self.stderr.write(self.style.ERROR(f'{label} — ОТКАЗ: {error}'))
                continue
            if status is None:
                # Статус появился между выборкой и записью (сигнал, чужая
                # правка) — это не ошибка, но и не наша запись.
                self.stdout.write(f'{label} — пропущен, статус уже есть')
                continue
            created += 1
            self.stdout.write(self.style.SUCCESS(label))

        if dry_run:
            self.stdout.write('Сухой прогон: ничего не записано.')
            return

        self.stdout.write(self.style.SUCCESS(f'Заведено статусов: {created}'))
        if failed:
            self.stderr.write(self.style.ERROR(
                f'Не удалось завести: {failed}. Инвариант НЕ восстановлен '
                f'полностью — разберите причины выше.'
            ))
