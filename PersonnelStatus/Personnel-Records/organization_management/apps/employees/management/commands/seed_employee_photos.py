"""Аватарки сотрудникам стенда (Plane №205, шаг 7 плана №198).

ОТКУДА ФОТО. Папка заказчика `docs/PersonnelStatus/attendee_photos` — 408
снимков, имена вида `100_20241012072112.png`. С людьми они не связаны ничем:
ни имени, ни пола в имени файла нет. Решение заказчика 27.08.2026: раздавать
подряд, кому попало — для тестовых данных соответствие лица имени не требуется.
Людей больше, чем файлов (426 против 408), поэтому файлы идут ПО КРУГУ, и
восемнадцать лиц повторятся. Это принято, а не просмотрено.

ФАЙЛЫ УМЕНЬШАЮТСЯ, А НЕ КОПИРУЮТСЯ КАК ЕСТЬ. Исходники весят 192 МБ на 408
снимков (около 470 КБ каждый) — это фотографии, а не аватарки. В карточке и в
реестре картинка живёт в квадрате около сотни пикселей, и полноразмерный файл
означал бы мегабайты трафика на строку списка. Каждый снимок вписывается в
512×512 и сохраняется JPEG — порядок величины меньше при неотличимом на экране
качестве.

ПОВТОР НЕ ПЕРЕЗАПИСЫВАЕТ. Человек с фотографией пропускается: снимок могли
заменить руками через Admin, и второй запуск сида не имеет права это стереть.
`--force` переписывает всем — это явное «раздать заново».

ГРАНИЦА — ЛЮДИ СИДА (табельный с префиксом `SD`). Четырнадцати старым
сотрудникам стенда фотографии не ставятся: их карточки участвуют в пробах, и
менять там что-либо ради аватарки нельзя.
"""
from __future__ import annotations

import io
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError

from organization_management.apps.employees.models import Employee

PERSONNEL_PREFIX = "SD"
# BASE_DIR — каталог `organization_management`; корень репозитория на четыре
# уровня выше (Personnel-Records → PersonnelStatus → Backend → корень).
DEFAULT_SOURCE = (
    Path(settings.BASE_DIR).parents[3] / "docs" / "PersonnelStatus" / "attendee_photos"
)
AVATAR_BOX = (512, 512)
JPEG_QUALITY = 85
SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")


class Command(BaseCommand):
    help = "Раздаёт аватарки сотрудникам сида (Plane №198/№205)."

    def add_arguments(self, parser):
        parser.add_argument("--source", default=str(DEFAULT_SOURCE), help="Папка со снимками.")
        parser.add_argument("--force", action="store_true", help="Переписать фото и тем, у кого оно есть.")
        parser.add_argument("--wipe", action="store_true", help="Снять фотографии у людей сида.")

    def handle(self, *args, **options):
        if options["wipe"]:
            self._wipe()
            return

        source = Path(options["source"])
        files = sorted(p for p in source.glob("*") if p.suffix.lower() in SUFFIXES)
        if not files:
            raise CommandError(
                f"В папке «{source}» нет снимков ({', '.join(SUFFIXES)}). "
                f"Путь задаётся флагом --source."
            )

        people = list(
            Employee.objects.filter(personnel_number__startswith=PERSONNEL_PREFIX).order_by(
                "personnel_number"
            )
        )
        if not people:
            raise CommandError(
                "Людей сида нет: сперва `manage.py seed_employees`. "
                "Раздавать аватарки некому."
            )

        from PIL import Image  # локально: команда — единственное место, где Pillow нужен

        given = kept = 0
        for number, employee in enumerate(people):
            if employee.photo and not options["force"]:
                kept += 1
                continue
            source_file = files[number % len(files)]
            with Image.open(source_file) as image:
                avatar = image.convert("RGB")
                avatar.thumbnail(AVATAR_BOX)
                buffer = io.BytesIO()
                avatar.save(buffer, format="JPEG", quality=JPEG_QUALITY)
            if employee.photo:
                # Старый файл снимается ЯВНО: `photo.save()` его не удаляет, а
                # Django добавляет к имени случайный хвост — при каждом
                # `--force` в media оставался бы ещё один слой картинок.
                employee.photo.delete(save=False)
            employee.photo.save(
                f"{employee.personnel_number}.jpg", ContentFile(buffer.getvalue()), save=True
            )
            given += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Аватарки: выдано {given}, оставлено как было {kept}; "
                f"снимков в папке {len(files)}, людей {len(people)}."
            )
        )

    def _wipe(self) -> None:
        people = Employee.objects.filter(personnel_number__startswith=PERSONNEL_PREFIX).exclude(photo="")
        count = people.count()
        for employee in people:
            employee.photo.delete(save=True)
        self.stdout.write(self.style.SUCCESS(f"Снято фотографий: {count}."))
