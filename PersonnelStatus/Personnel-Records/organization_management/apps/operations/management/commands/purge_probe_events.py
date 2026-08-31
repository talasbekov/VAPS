"""Чистка реестра ОМ от строк, заведённых пробами.

Зачем команда, а не «сходить руками в базу»: чистка повторяется (каждый
полный прогон смоука оставляет свои строки), а удаление проходит через ТОТ ЖЕ
сервис, что и кнопка в реестре, — то есть чинит журнал мутаций и соблюдает
запреты (закрытое ОМ и ОМ с работой людей не трогаются). Ручной DELETE в базе
не сделал бы ни того, ни другого.

По умолчанию — СУХОЙ ПРОГОН: команда, которая удаляет с первого запуска и без
спроса, рано или поздно снесёт живое. Удаление требует явного `--yes`.

    python manage.py purge_probe_events                # что будет удалено
    python manage.py purge_probe_events --yes          # удалить
    python manage.py purge_probe_events --marker '(e2e)' --yes
    python manage.py purge_probe_events --orphans-only --yes   # только сироты

УБОРКА ТЕПЕРЬ ПОЛНАЯ (Plane №346). Раньше команда сносила МЕРОПРИЯТИЯ, а
участия на них оставались ссылаться в пустоту: ссылка плоская, каскада нет.
Каждый прогон добавлял партию сирот, и к 31.08.2026 их накопилось 1135 при 14
живых участиях. Теперь после удаления мероприятий команда добирает участия на
них, а `--orphans-only` вычищает накопленное за все прошлые прогоны — в том
числе сирот от мероприятий, удалённых не этой командой (teardown смоука,
кнопка в реестре).
"""

from django.core.management.base import BaseCommand

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops import security_events as event_service
from organization_management.apps.operations.status_cleanup import (
    find_orphan_participations,
    purge_orphan_participations,
)

#: Метка пробной строки. Не «Проба» и не «test»: подстрока «Проба» встречается
#: в осмысленных названиях («Проба сил перед визитом» — живое мероприятие),
#: а «(e2e)» ставят только прогоны, и ставят его ВСЕ спеки раздела.
DEFAULT_MARKER = "(e2e)"


class Command(BaseCommand):
    help = "Удалить из реестра ОМ строки, заведённые e2e-прогонами."

    def add_arguments(self, parser):
        parser.add_argument(
            "--marker",
            default=DEFAULT_MARKER,
            help=f"Подстрока названия пробной строки (по умолчанию «{DEFAULT_MARKER}»).",
        )
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Удалить. Без флага команда только показывает, что удалит.",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help=(
                "Удалять и те пробные строки, которым сервер отказывает "
                "(с расстановкой, записями журнала, закрытые). Метка «(e2e)» "
                "— и есть основание: такая строка не история и не работа людей."
            ),
        )
        parser.add_argument(
            "--actor",
            default="purge_probe_events",
            help="Подпись в журнале мутаций.",
        )
        parser.add_argument(
            "--orphans-only",
            action="store_true",
            help=(
                "Не трогать реестр ОМ вовсе — вычистить только участия, "
                "чьё мероприятие уже удалено (накопленное прошлыми прогонами)."
            ),
        )

    def handle(self, *args, **options):
        if options["orphans_only"]:
            self._orphans(options["yes"], event_ids=None)
            return
        marker = options["marker"]
        rows = list(
            OpsSecurityEvent.objects.filter(title__contains=marker).order_by("pk")
        )
        if not rows:
            self.stdout.write(f"Строк с меткой «{marker}» не найдено.")
            return

        self.stdout.write(f"Найдено строк с меткой «{marker}»: {len(rows)}")
        if not options["yes"]:
            for event in rows[:20]:
                self.stdout.write(f"  {event.code} · {event.stage} · {event.title}")
            if len(rows) > 20:
                self.stdout.write(f"  … и ещё {len(rows) - 20}")
            self.stdout.write(
                "Строки с расстановкой, записями журнала и закрытые сервер "
                "удалять откажется — для них нужен --force."
            )
            self.stdout.write(
                self.style.WARNING(
                    "Сухой прогон. Для удаления повторите команду с --yes."
                )
            )
            return

        deleted = 0
        # Отказы НЕ прерывают чистку и называются поимённо: среди пробных
        # строк попадаются закрытые и проведённые, и падать на первой из них
        # значило бы оставить остальные двести.
        kept = []
        touched = []
        for event in rows:
            try:
                event_service.delete_event(
                    event.pk, actor=options["actor"], force=options["force"]
                )
            except DomainError as refusal:
                kept.append((event.code, refusal.message))
                continue
            deleted += 1
            touched.append(event.pk)
        self.stdout.write(self.style.SUCCESS(f"Удалено: {deleted}"))
        if kept:
            self.stdout.write(f"Оставлено (сервер отказал): {len(kept)}")
            for code, why in kept[:20]:
                self.stdout.write(f"  {code}: {why}")
        # Участия удалённых мероприятий — вторая половина той же уборки, а не
        # «заодно»: без неё команда каждым запуском ПРОИЗВОДИТ сирот.
        if touched:
            self._orphans(True, event_ids=touched)

    def _orphans(self, apply_it: bool, event_ids: list[int] | None) -> None:
        """Сироты: показать либо снести. Область — либо только что удалённые
        мероприятия, либо весь накопленный мусор (`event_ids=None`)."""
        if not apply_it:
            found = find_orphan_participations(event_ids)
            self.stdout.write(f"Участий, чьё мероприятие удалено: {found.count()}")
            self.stdout.write(
                self.style.WARNING(
                    "Сухой прогон. Для удаления повторите команду с --yes."
                )
            )
            return
        result = purge_orphan_participations(event_ids)
        self.stdout.write(
            self.style.SUCCESS(
                f"Снято участий-сирот: {result.participations}; "
                f"статусов, державшихся только ими: {result.statuses}"
            )
        )
