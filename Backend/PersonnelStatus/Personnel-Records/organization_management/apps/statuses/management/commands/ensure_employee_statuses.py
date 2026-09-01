"""Привести статусы в порядок: закрыть истёкшие и добить оставшихся без статуса.

Инвариант рвётся ТРЕМЯ путями, и команда закрывает все:

1. сотрудник заведён мимо ручки (импортом, админкой, сидом) — статуса нет
   вовсе. На будущее это ловит сигнал `give_new_employee_a_status`;

2. статус ИСТЁК — его закрывает `complete_expired_statuses`, заводя «В строю»
   со следующего дня;

3. статус ЗАПЛАНИРОВАН, срок настал, но он не включился — его активирует
   `apply_planned_statuses`.

Логика (2) и (3) в проекте есть давно и работает. Беда в том, ЧЕМ она
запускается: обе живут только в Celery-задачах, а брокер настроен на
`redis://redis:6379` (докерное имя) — на локальном стенде они не выполняются
НИ РАЗУ. Смоук-обход это и показал: после него 7 работающих из 14 остались без
действующего статуса, а у одного с 16-го числа висел неактивированный отпуск.

Поэтому оба шага выполняются здесь же, обычной командой — как
`check_lagging_submissions` по соседству, которую тоже сознательно сделали
запускаемой без планировщика.

Команда идемпотентна: повторный запуск ничего не пишет. Её не стыдно поставить
в регламент — она же служит проверкой инварианта («сколько ещё без статуса»).

Уволенных не трогает: у них статусы закрыты намеренно, соседним сигналом
`close_statuses_on_dismissal`.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone
from django.core.exceptions import ValidationError

from organization_management.apps.statuses.application.services import (
    StatusApplicationService,
)
from organization_management.apps.statuses.models import EmployeeStatus
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
        parser.add_argument(
            '--skip-expired',
            action='store_true',
            help='Не закрывать истёкшие статусы, только добить безстатусных.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        if not options['skip_expired']:
            # Порядок важен: сначала включаем то, чему пора начаться, потом
            # закрываем то, чему пора кончиться. В обратном порядке
            # запланированный статус, начавшийся вчера и кончающийся сегодня,
            # успел бы получить «В строю» поверх себя.
            self._apply_planned(dry_run)
            self._complete_expired(dry_run)

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
            if start > timezone.localdate():
                # Не создаём вовсе: `save()` сделал бы такую запись `planned`,
                # инвариант она не восстановит, а повторные прогоны наплодили
                # бы её копии — команда перестала бы быть идемпотентной.
                failed += 1
                self.stderr.write(self.style.ERROR(
                    f'{label} — ПРОПУЩЕН: период занят по {start - timedelta(days=1)}, '
                    f'действующий статус сегодня завести нечем'
                ))
                continue
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
            # 🔴 Рапорт по ФАКТУ, а не по числу вызовов. Дату мы уже проверили
            # выше, но состояние пересчитывает `save()`, и полагаться на своё
            # предсказание вместо записи — как раз то, на чём прежняя версия
            # писала «Заведено статусов: 7», не восстановив инвариант.
            if status.state != EmployeeStatus.StatusState.ACTIVE:
                failed += 1
                self.stderr.write(self.style.ERROR(
                    f'{label} — статус создан как «{status.get_state_display()}», '
                    f'а не действующий: период занят до {status.start_date}'
                ))
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

    def _apply_planned(self, dry_run: bool) -> None:
        """Включить запланированные статусы, срок которых настал."""
        today = timezone.localdate()
        planned = EmployeeStatus.objects.filter(
            state=EmployeeStatus.StatusState.PLANNED,
            start_date__lte=today,
        )
        count = planned.count()
        if count == 0:
            self.stdout.write('Запланированных статусов к применению нет.')
            return

        if dry_run:
            self.stdout.write(f'Запланированных к применению: {count} (не применено)')
            for status in planned:
                self.stdout.write(
                    f'  {status.employee} — {status.get_status_type_display()} '
                    f'с {status.start_date}'
                )
            return

        applied = StatusApplicationService().apply_planned_statuses()
        self.stdout.write(self.style.SUCCESS(
            f'Применено запланированных статусов: {len(applied)}'
        ))

    def _complete_expired(self, dry_run: bool) -> None:
        """Закрыть статусы с истёкшим сроком.

        Само закрытие заводит «В строю» со следующего дня — это уже умеет
        `StatusApplicationService.complete_expired_statuses`. Команда лишь даёт
        ему исполнимый путь: в Celery он на стенде не доезжает.
        """
        expired = EmployeeStatus.objects.filter(
            state=EmployeeStatus.StatusState.ACTIVE,
            end_date__lt=timezone.localdate(),
        )
        count = expired.count()
        if count == 0:
            self.stdout.write('Истёкших действующих статусов нет.')
            return

        if dry_run:
            self.stdout.write(f'Истёкших действующих статусов: {count} (не закрыто)')
            for status in expired:
                self.stdout.write(
                    f'  {status.employee} — {status.get_status_type_display()} '
                    f'до {status.end_date}'
                )
            return

        completed = StatusApplicationService().complete_expired_statuses()
        self.stdout.write(self.style.SUCCESS(
            f'Закрыто истёкших статусов: {len(completed)} '
            f'(каждому заведён «В строю» со следующего дня)'
        ))
