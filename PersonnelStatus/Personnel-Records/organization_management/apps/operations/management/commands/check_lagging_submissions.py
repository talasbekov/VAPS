"""Запуск поиска отставших сдач (порт check_lagging_submissions из
Backend/VAPS).

Обычная команда, не Celery-задача: она запускается и проверяется без всякого
планировщика, а обёртку задачи и расписание кладёт отдельный срез. Celery
здесь не импортируется намеренно — иначе работу нельзя было бы прогнать руками
на стенде, где брокера нет.

Ответственность команды входная и выходная: перевести аргумент в дату, отсечь
безрассудную дату и НЕ выдать остановку за обычный проход. Сам поиск проверен
у движка.
"""
from datetime import date

from django.core.management.base import BaseCommand, CommandError

from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.lagging_check import (
    check_lagging_submissions,
)


class Command(BaseCommand):
    help = (
        "Найти отставшие подразделения и оповестить ответственных: от водяного "
        "знака, день за днём после контрольного часа, идемпотентно, под "
        "сеансовым замком."
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

        result = check_lagging_submissions(today=today)

        if result.skipped:
            self.stdout.write("поиск отставших пропущен: замок держит другой прогон")
            return
        if result.halted:
            # Остановка — не «ничего не произошло», а требующее человека
            # состояние: ненулевой выход, чтобы оператор и планировщик её
            # увидели, а не приняли за холостой проход.
            raise CommandError(
                f"поиск отставших ОСТАНОВЛЕН ({result.halt_reason}); знак не "
                f"сдвинут, стоит на {result.watermark_before}. Смотрите журнал."
            )
        self.stdout.write(
            self.style.SUCCESS(
                f"поиск отставших прошёл: знак {result.watermark_before} -> "
                f"{result.watermark_after}, дней: {len(result.processed_days)}, "
                # «Охвачено», а не «разослано»: повторно пройденный день найдёт
                # готовое уведомление и всё равно посчитает получателя. Число
                # говорит, у скольких получателей уведомление за пройденные дни
                # ЕСТЬ, — обещать по нему новизну значило бы обещать то, чего
                # оно не знает.
                f"получателей охвачено: {result.notified_count}"
            )
        )
