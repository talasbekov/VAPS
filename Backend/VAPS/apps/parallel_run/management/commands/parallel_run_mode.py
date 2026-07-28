"""Story 7.7 — AC-2: явный выключатель режима «без двойного ввода».

Операционный интерфейс над ``apps.core.parallel_run_mode`` (тот же gateway,
что и гейт в ``day_submission_service.submit_day``) — enable/disable
срабатывает и на cutover (Story 7.10, disable — «официальный канал расхода
= VAPS»).

``--actor`` обязателен для мутирующих действий (enable/disable/add-pilot/
remove-pilot) — переключатель гейтит production write-путь, кто именно его
переключил обязан быть в audit_logs (ревью-фикс), не только timestamp на
самой строке.
"""

import datetime
import uuid

from django.core.management.base import BaseCommand, CommandError

from apps.core import parallel_run_mode


class Command(BaseCommand):
    help = (
        "Переключатель режима «без двойного ввода» (Story 7.7/AC-2, "
        "7.8/AC-1 дедлайн): enable/disable/status + управление списком "
        "пилотных подразделений."
    )

    def add_arguments(self, parser):
        sub = parser.add_subparsers(dest="action", required=True)
        enable_p = sub.add_parser("enable")
        enable_p.add_argument("--actor", required=True)
        enable_p.add_argument(
            "--deadline",
            required=True,
            help="YYYY-MM-DD — дедлайн exit-criterion (Story 7.8/AC-1)",
        )
        disable_p = sub.add_parser("disable")
        disable_p.add_argument("--actor", required=True)
        sub.add_parser("status")
        add_pilot = sub.add_parser("add-pilot")
        add_pilot.add_argument("division_id")
        add_pilot.add_argument("--actor", required=True)
        remove_pilot = sub.add_parser("remove-pilot")
        remove_pilot.add_argument("division_id")
        remove_pilot.add_argument("--actor", required=True)

    def handle(self, *args, **options):
        action = options["action"]
        if action == "enable":
            try:
                deadline = datetime.date.fromisoformat(options["deadline"])
            except ValueError as exc:
                raise CommandError(f"невалидный --deadline: {exc}") from exc
            try:
                parallel_run_mode.enable(actor=options["actor"], deadline=deadline)
            except ValueError as exc:
                raise CommandError(str(exc)) from exc
            self.stdout.write(self.style.SUCCESS(f"режим включён, дедлайн={deadline}"))
        elif action == "disable":
            parallel_run_mode.disable(actor=options["actor"])
            self.stdout.write(self.style.SUCCESS("режим выключен"))
        elif action == "status":
            enabled = parallel_run_mode.is_enabled()
            count = parallel_run_mode.pilot_division_count()
            self.stdout.write(
                self.style.SUCCESS(
                    f"enabled={enabled} pilot_divisions={count}"
                )
            )
        elif action == "add-pilot":
            division_id = self._parse_uuid(options["division_id"])
            try:
                parallel_run_mode.add_pilot_division(
                    division_id, actor=options["actor"]
                )
            except ValueError as exc:
                raise CommandError(str(exc)) from exc
            self.stdout.write(self.style.SUCCESS(f"добавлено: {division_id}"))
        elif action == "remove-pilot":
            division_id = self._parse_uuid(options["division_id"])
            parallel_run_mode.remove_pilot_division(
                division_id, actor=options["actor"]
            )
            self.stdout.write(self.style.SUCCESS(f"удалено: {division_id}"))

    def _parse_uuid(self, value):
        try:
            return uuid.UUID(value)
        except ValueError as exc:
            raise CommandError(f"невалидный UUID: {value!r}") from exc
