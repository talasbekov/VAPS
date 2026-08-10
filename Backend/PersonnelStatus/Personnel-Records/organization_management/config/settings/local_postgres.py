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

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("PR_DB_NAME", "personnel_records"),
        "USER": os.environ.get("PR_DB_USER", "vaps"),
        "PASSWORD": os.environ.get("PR_DB_PASSWORD", "vaps"),
        "HOST": os.environ.get("PR_DB_HOST", "localhost"),
        "PORT": os.environ.get("PR_DB_PORT", "5434"),
        "CONN_MAX_AGE": 60,
    }
}
