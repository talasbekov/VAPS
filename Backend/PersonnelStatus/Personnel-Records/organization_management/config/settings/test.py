import hashlib
import os

from .base import *

# PostgreSQL, как в проде и на локальном стенде (см. local_postgres.py):
# раздел ОМ несёт ограничения, которых в SQLite не существует
# (ExclusionConstraint против пересечения статусов, GiST, генерируемая
# колонка периода). На SQLite такие тесты либо не поднимались бы вовсе,
# либо молча проверяли БД без этих гарантий.
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
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('PR_DB_NAME', 'personnel_records'),
        'USER': os.environ.get('PR_DB_USER', 'vaps'),
        'PASSWORD': _db_password(),
        'HOST': os.environ.get('PR_DB_HOST', 'localhost'),
        'PORT': os.environ.get('PR_DB_PORT', '5434'),
    }
}

# Имя тестовой БД — своё у каждого чекаута.
#
# По умолчанию Django зовёт её test_<NAME>, то есть test_personnel_records:
# одно имя на весь сервер. На машине, где проект выложен не один раз
# (второй чекаут, worktree), параллельные прогоны делят одну базу — кто
# закончил первым, тот её и удалил, а соседний посреди прогона получает
# «database does not exist» и следом «relation ... does not exist».
# Если соседний чекаут ещё и на другой версии Django, его миграции
# оставляют в общей базе чужую схему, и падение выглядит дефектом кода:
# так это и проявлялось — IntegrityError на django_content_type.name,
# колонке, которой в Django 5 нет вовсе.
#
# Хэш берётся от пути чекаута, а не от pid: имя должно быть стабильным
# между прогонами, иначе каждый запуск плодил бы новую базу и оставлял
# брошенные после аварийного выхода. Два ОДНОВРЕМЕННЫХ прогона внутри
# ОДНОГО чекаута по-прежнему делят базу — для них есть PR_TEST_DB_NAME.
_CHECKOUT_TAG = hashlib.sha1(str(BASE_DIR).encode()).hexdigest()[:8]
DATABASES['default']['TEST'] = {
    'NAME': os.environ.get(
        'PR_TEST_DB_NAME', f'test_personnel_records_{_CHECKOUT_TAG}'
    ),
}

CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.dummy.DummyCache',
    }
}

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True

# Disable Channels Redis for tests
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels.layers.InMemoryChannelLayer',
    },
}

PASSWORD_HASHERS = [
    'django.contrib.auth.hashers.MD5PasswordHasher',
]

# Миграции в тестах ВКЛЮЧЕНЫ (раньше отключались DisableMigrations):
# таблицы, собранные напрямую из моделей, не несут операций миграций —
# в частности BtreeGistExtension, без которого ExclusionConstraint статусов
# не создаётся. Цена — секунды на прогон, выигрыш — тесты видят ту же схему,
# что и прод.
