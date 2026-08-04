import os

from .base import *

# PostgreSQL, как в проде и на локальном стенде (см. local_postgres.py):
# раздел ОМ несёт ограничения, которых в SQLite не существует
# (ExclusionConstraint против пересечения статусов, GiST, генерируемая
# колонка периода). На SQLite такие тесты либо не поднимались бы вовсе,
# либо молча проверяли БД без этих гарантий.
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('PR_DB_NAME', 'personnel_records'),
        'USER': os.environ.get('PR_DB_USER', 'vaps'),
        'PASSWORD': os.environ.get('PR_DB_PASSWORD', 'vaps'),
        'HOST': os.environ.get('PR_DB_HOST', 'localhost'),
        'PORT': os.environ.get('PR_DB_PORT', '5434'),
    }
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
