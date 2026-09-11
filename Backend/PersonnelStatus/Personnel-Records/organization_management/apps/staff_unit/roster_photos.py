"""Validate IIN-named photos without changing storage or exposing IIN in reports."""

import io
import re
import shutil
import tempfile
import warnings
from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path

from django.core.files.base import ContentFile
from PIL import Image, UnidentifiedImageError

MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 20_000_000
PHOTO_NAME = re.compile(r"([0-9]{12})\.(jpe?g|png)", re.IGNORECASE)


class PhotoError(Exception):
    pass


def read_photo(path):
    try:
        if path.is_symlink() or not path.is_file():
            raise PhotoError("Фото должно быть обычным файлом, не ссылкой.")
        with path.open("rb") as stream:
            data = stream.read(MAX_BYTES + 1)
    except OSError as exc:
        raise PhotoError("Не удалось прочитать фото.") from exc
    if not data or len(data) > MAX_BYTES:
        raise PhotoError("Фото должно быть непустым и не больше 10 МБ.")
    return data


@dataclass(frozen=True)
class Photo:
    path: Path
    digest: str
    size: int
    suffix: str

    def read_verified(self):
        data = read_photo(self.path)
        if sha256(data).hexdigest() != self.digest:
            raise PhotoError("Фото изменилось во время импорта. Повторите проверку.")
        return data

    def matches(self, existing):
        if not existing:
            return False
        try:
            with existing.storage.open(existing.name, "rb") as stream:
                data = stream.read(MAX_BYTES + 1)
            return len(data) == self.size and sha256(data).hexdigest() == self.digest
        except FileNotFoundError:
            return False
        except OSError as exc:
            raise PhotoError("Не удалось сверить сохранённое фото.") from exc


@dataclass
class Photos:
    people: dict = field(default_factory=dict)
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    counts: dict = field(default_factory=dict)


def scan_photos(rows, folder, *, skip_invalid=False):
    result = Photos()
    if folder is None:
        return result
    directory = Path(folder)
    try:
        paths = list(directory.iterdir())
    except OSError:
        result.errors.append("Папка фото отсутствует или недоступна.")
        return result
    by_iin = {}
    for path in paths:
        match = PHOTO_NAME.fullmatch(path.name)
        if match:
            by_iin.setdefault(match[1], []).append(path)
    missing, invalid_iin, skipped = 0, 0, 0

    def reject(message):
        nonlocal skipped
        if skip_invalid:
            skipped += 1
            result.warnings.append(
                message + " Фото пропущено; прежнее фото сохраняется."
            )
        else:
            result.errors.append(message)

    for row in rows:
        if not row["person_id"]:
            continue
        if not row["iin"]:
            invalid_iin += 1
            continue
        matches = by_iin.get(row["iin"], [])
        if not matches:
            missing += 1
            continue
        if len(matches) != 1:
            reject(f"Строка {row['row_number']}: несколько фото для одного ИИН.")
            continue
        path = matches[0]
        try:
            data = read_photo(path)
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(data)) as image:
                    if image.format not in ("JPEG", "PNG"):
                        raise PhotoError("Фото должно быть изображением JPEG или PNG.")
                    if image.width * image.height > MAX_PIXELS:
                        raise PhotoError("Фото превышает 20 миллионов пикселей.")
                    suffix = ".jpg" if image.format == "JPEG" else ".png"
                    image.verify()
                with Image.open(io.BytesIO(data)) as image:
                    image.load()
        except (
            OSError,
            ValueError,
            SyntaxError,
            UnidentifiedImageError,
            Image.DecompressionBombError,
            Image.DecompressionBombWarning,
            PhotoError,
        ):
            reject(
                f"Строка {row['row_number']}: фото недоступно или повреждено; нужен обычный JPEG/PNG до 10 МБ и 20 Мп."
            )
            continue
        result.people[row["person_id"]] = Photo(
            path, sha256(data).hexdigest(), len(data), suffix
        )
    result.counts = {
        "matched": len(result.people),
        "missing": missing,
        "without_iin": invalid_iin,
        "skipped": skipped,
    }
    if missing or invalid_iin:
        result.warnings.append(
            f"Фото: нет файла для {missing} сотрудников; нет корректного ИИН у {invalid_iin}. Прежние фото сохраняются."
        )
    return result


def save_photo(photo, storage):
    """Own a fresh directory so even a failed storage.save can be cleaned up."""
    data = photo.read_verified()
    try:
        parent = Path(storage.path("employees/photos"))
    except NotImplementedError as exc:
        raise PhotoError(
            "Для импорта фото требуется локальное хранилище media."
        ) from exc
    parent.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="roster-", dir=parent))
    try:
        # Same accessibility as the standard media directories for the proxy.
        directory.chmod(storage.directory_permissions_mode or 0o755)
        name = "employees/photos/" + directory.name + "/photo" + photo.suffix
        return storage.save(name, ContentFile(data))
    except BaseException:
        # This directory was exclusively created by this call and contains no
        # previous employee photo, even if save fails before returning a name.
        shutil.rmtree(directory)
        raise
