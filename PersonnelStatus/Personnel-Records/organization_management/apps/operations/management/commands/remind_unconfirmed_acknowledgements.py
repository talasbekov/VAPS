"""Напомнить начальникам управлений о неподтвердивших заступление за час
до начала ОМ (Plane №427, `[ОЗН-06]`).

Обычная команда, не Celery-задача — те же доводы, что у
`check_lagging_submissions`: прогоняется руками на стенде без брокера, а
расписание кладёт отдельный срез (каждые 15 минут).
"""
import datetime as dt

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from organization_management.apps.ops.acknowledgement_reminders import (
    remind_supervisors_before_start,
)


class Command(BaseCommand):
    help = "Уведомить руководителей о неподтвердивших заступление за час до начала ОМ."

    def add_arguments(self, parser):
        parser.add_argument(
            "--now",
            help="Момент «сейчас» (ГГГГ-ММ-ДДTЧЧ:ММ, местное) для ручного прогона.",
        )

    def handle(self, *args, **options):
        now = None
        if options.get("now"):
            try:
                now = timezone.make_aware(dt.datetime.fromisoformat(options["now"]))
            except ValueError as exc:
                raise CommandError(
                    f"неверный --now {options['now']!r}: ожидается ГГГГ-ММ-ДДTЧЧ:ММ"
                ) from exc
        report = remind_supervisors_before_start(now)
        self.stdout.write(
            "напоминания за час: мероприятий {events}, неподтвердивших {unconfirmed}, "
            "руководителей {supervisors}{codes}".format(
                **report,
                codes=(" — " + ", ".join(report["eventCodes"])) if report["eventCodes"] else "",
            )
        )
