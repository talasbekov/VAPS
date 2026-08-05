"""Запуск догона эффектов статусов (порт materialize_status_effects из
Backend/VAPS).

Обычная команда, не Celery-задача: она запускается и проверяется без всякого
планировщика, а обёртку задачи и расписание кладёт отдельный срез. Celery
здесь не импортируется намеренно — иначе движок нельзя было бы прогнать руками
на стенде, где брокера нет.
"""
from datetime import date

from django.core.management.base import BaseCommand, CommandError

from organization_management.apps.operations.catch_up import (
    materialize_status_effects,
)
from organization_management.apps.operations.clock import Clock


class Command(BaseCommand):
    help = (
        "Догнать побочные эффекты переходов статусов: от водяного знака, "
        "хронологически, идемпотентно, под сеансовым замком."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--today",
            help="Деловая дата (ГГГГ-ММ-ДД) для ручного прогона; обычный "
            "запуск берёт её у часов раздела.",
        )

    def handle(self, *args, **options):
        today = None
        if options.get("today"):
            try:
                today = date.fromisoformat(options["today"])
            except ValueError as exc:
                raise CommandError(
                    f"неверный --today {options['today']!r}: ожидается ГГГГ-ММ-ДД"
                ) from exc
            # Дата из БУДУЩЕГО отравила бы знак: он уехал бы вперёд реального
            # времени, и каждый последующий обычный прогон вставал бы на
            # «часы позади знака» — до ручной правки БД. Флаг нужен для
            # догона ПРОШЛОГО, и на будущее его закрываем здесь, а не в
            # движке: движок обязан уметь работать с любой датой, которую ему
            # дали, а вот безрассудную дату отсекает вход.
            real_today = Clock.today_local()
            if today > real_today:
                raise CommandError(
                    f"--today {today.isoformat()} в будущем (сегодня "
                    f"{real_today.isoformat()}) — знак уехал бы вперёд времени; "
                    "флаг только для догона прошлого."
                )

        result = materialize_status_effects(today=today)

        if result.skipped:
            self.stdout.write("догон пропущен: замок держит другой прогон")
            return
        if result.halted:
            # Остановка — не «ничего не произошло», а требующее человека
            # состояние: ненулевой выход, чтобы оператор и планировщик её
            # увидели, а не приняли за холостой проход.
            raise CommandError(
                f"догон ОСТАНОВЛЕН ({result.halt_reason}); знак не сдвинут, "
                f"стоит на {result.watermark_before}. Смотрите журнал."
            )
        self.stdout.write(
            self.style.SUCCESS(
                f"догон прошёл: знак {result.watermark_before} -> "
                f"{result.watermark_after}, дней: {len(result.processed_days)}"
            )
        )
