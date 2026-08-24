"""Локальный стенд на PostgreSQL.

Зачем отдельно от sqlite.py: раздел ОМ несёт ограничения, которых в SQLite
не существует (ExclusionConstraint против пересечения статусов, GiST-индекс,
генерируемая колонка периода). На SQLite-стенде они молча отсутствовали бы —
и расхождение вылезло бы только в проде, где БД тоже PostgreSQL.

Параметры берутся из окружения (PR_DB_*), дефолты указывают на локальный
контейнер vaps-db-5434, база personnel_records. sqlite.py оставлен как есть:
старый быстрый стенд никуда не делся.
"""
import os

from .sqlite import *  # noqa: F401,F403 — те же DEBUG/CACHES/CHANNEL_LAYERS/LOGGING

def _db_password():
    """Пароль стендовой БД: из окружения, иначе из файла вне репозитория.

    Дефолта-пароля в коде больше нет (был `vaps` — он же стоял у контейнера
    `vaps-db-5434`). Файл `~/.config/vaps/db-password` (права 600) читается
    автоматически, поэтому ни `manage.py`, ни `pytest` не требуют ручного
    экспорта — и секрет при этом не лежит в git. Если нет ни переменной, ни
    файла, отдаётся пусто ОСОЗНАННО: libpq возьмёт `~/.pgpass`, а если нет и
    его — ошибка аутентификации скажет правду вместо тихого входа под
    общеизвестным паролем.
    """
    from pathlib import Path

    value = os.environ.get("PR_DB_PASSWORD")
    if value:
        return value
    stored = Path.home() / ".config" / "vaps" / "db-password"
    try:
        return stored.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("PR_DB_NAME", "personnel_records"),
        "USER": os.environ.get("PR_DB_USER", "vaps"),
        "PASSWORD": _db_password(),
        "HOST": os.environ.get("PR_DB_HOST", "localhost"),
        "PORT": os.environ.get("PR_DB_PORT", "5434"),
        "CONN_MAX_AGE": 60,
    }
}
