"""Справочник секций бланка расстановки — ИЗ ШАБЛОНА, а не списком в коде.

ЗАЧЕМ КОМАНДА, А НЕ СТРОКИ В `seed_operations` (Plane №242, Ш-2). Роли наряда
(`PLACEMENT_ROLES`) перечислены в сиде руками, и это оправдано: их тринадцать,
подписи у них человеческие, и заказчик их обсуждает. Секций двадцать четыре,
подписи у них казахские и длинные, а главное — они МЕНЯЮТСЯ ВМЕСТЕ С БЛАНКОМ:
каждый новый образец заказчика пересобирает шаблон (`build_placement_template`),
и список, переписанный в код, разошёлся бы с файлом молча. Разойдётся — человек
выберет при назначении секцию, которой в документе нет, и место останется
пустым без объяснения.

ЧТО ДЕЛАЕТ. Читает секции шаблона и приводит справочник к ним:
  • новой секции заводит запись;
  • у существующей обновляет подпись (бланк переверстали — подпись поехала);
  • секцию, которой в шаблоне больше нет, СНИМАЕТ (`is_active=False`), но НЕ
    удаляет: на снятую могут ссылаться назначения уже проведённых мероприятий,
    и удаление стёрло бы их вторую координату задним числом.

ПОЧЕМУ КОМАНДА ЛЕЖИТ В `operations`, А ЧИТАЕТ `ops`. `ops` — служебный пакет,
а не установленное приложение (в `INSTALLED_APPS` его нет), и Django команд в
нём не находит вовсе. Тем же путём устроен `seed_smoke_fixtures`.

По умолчанию — СУХОЙ ПРОГОН: команда, меняющая справочник с первого запуска и
без спроса, рано или поздно сделает это не на том стенде.

    python manage.py sync_placement_sections          # что изменится
    python manage.py sync_placement_sections --yes    # применить
"""
from django.core.management.base import BaseCommand

from organization_management.apps.operations.models_settings import OpsDictionaryEntry
from organization_management.apps.ops.documents_placement_full import template_sections

DICTIONARY = "PLACEMENT_SECTIONS"


class Command(BaseCommand):
    help = "Привести справочник секций бланка расстановки к шаблону."

    def add_arguments(self, parser):
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Применить. Без флага команда только показывает, что изменит.",
        )
        parser.add_argument(
            "--actor",
            default="sync_placement_sections",
            help="Подпись в поле «кем обновлено».",
        )

    def handle(self, *args, **options):
        wanted = {entry["code"]: entry["label"] for entry in template_sections()}
        existing = {
            entry.code: entry
            for entry in OpsDictionaryEntry.objects.filter(dictionary_code=DICTIONARY)
        }

        added = [code for code in wanted if code not in existing]
        renamed = [
            code
            for code, label in wanted.items()
            if code in existing and existing[code].label != label
        ]
        revived = [
            code
            for code in wanted
            if code in existing and not existing[code].is_active
        ]
        retired = [
            code
            for code, entry in existing.items()
            if code not in wanted and entry.is_active
        ]

        self.stdout.write(f"секций в шаблоне: {len(wanted)}")
        self.stdout.write(f"новых: {len(added)}")
        self.stdout.write(f"с изменившейся подписью: {len(renamed)}")
        self.stdout.write(f"возвращаемых в строй: {len(revived)}")
        self.stdout.write(f"снимаемых (в шаблоне больше нет): {len(retired)}")
        for code in added[:10]:
            self.stdout.write(f"  + {code} · {wanted[code]}")
        for code in retired[:10]:
            self.stdout.write(f"  − {code} · {existing[code].label}")

        if not options["yes"]:
            self.stdout.write(
                self.style.WARNING(
                    "Сухой прогон. Для применения повторите команду с --yes."
                )
            )
            return

        actor = options["actor"]
        for code, label in wanted.items():
            OpsDictionaryEntry.objects.update_or_create(
                dictionary_code=DICTIONARY,
                code=code,
                defaults={
                    "label": label,
                    "is_active": True,
                    "updated_by": actor,
                    # `description` и `group_code` не трогаются: описание может
                    # быть дописано человеком в админке, и синхронизация с
                    # файлом не имеет права его затирать — в файле его нет.
                },
            )
        OpsDictionaryEntry.objects.filter(
            dictionary_code=DICTIONARY, is_active=True
        ).exclude(code__in=list(wanted)).update(is_active=False, updated_by=actor)

        self.stdout.write(
            self.style.SUCCESS(
                f"справочник {DICTIONARY} приведён к шаблону: {len(wanted)} секций"
            )
        )
