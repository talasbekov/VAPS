from .base import *

# Use file-based SQLite for local development
DEBUG = True
DEBUG_PROPAGATE_EXCEPTIONS = True

# CORS локального стенда: любой порт на localhost/127.0.0.1.
#
# `CORS_ALLOWED_ORIGINS` в base.py перечисляет порт 3000, а хост фронта на
# стенде поднимается на 3105/3106 (см. .claude/launch.json). Из-за этого
# preflight отвечал 200 БЕЗ `Access-Control-Allow-Origin`, и браузер рубил
# каждый запрос к данным как net::ERR_FAILED: дашборд писал «Ошибка загрузки
# данных: Failed to fetch» при живом бэке.
#
# Перечислять порты по одному — значит ломаться на следующем свободном порту,
# который выберет dev-сервер. Поэтому шаблон, а не список. Послабление живёт
# ТОЛЬКО в dev-настройках: base.py и production.py его не наследуют, наружу
# бэк по-прежнему закрыт. Шаблон заякорен с обеих сторон — иначе он совпал бы
# с `localhost.evil.com`.
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^http://localhost(:\d+)?$",
    r"^http://127\.0\.0\.1(:\d+)?$",
]

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

# Lightweight cache for local dev
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
    }
}

# In-memory channel layer to avoid Redis dependency during local dev
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels.layers.InMemoryChannelLayer',
    },
}

# Полное логирование
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,

    'formatters': {
        'verbose': {
            'format': '[{asctime}] {levelname} {name}: {message}',
            'style': '{',
        },
    },

    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
        'file': {
            'class': 'logging.FileHandler',
            'filename': BASE_DIR / 'django.log',
            'formatter': 'verbose',
        },
    },

    'root': {
        'handlers': ['console', 'file'],
        'level': 'DEBUG',
    },

    'loggers': {
        # propagate=False: у логгера свои обработчики, и те же самые стоят на
        # root — при propagate=True каждая строка (включая КАЖДЫЙ SQL на
        # DEBUG) писалась дважды и в консоль, и в файл. На стенде это давало
        # 238 КБ лога на несколько запросов.
        'django': {
            'handlers': ['console', 'file'],
            'level': 'DEBUG',
            'propagate': False,
        },
        'django.request': {
            'handlers': ['console', 'file'],
            'level': 'ERROR',
            'propagate': False,
        },
    },
}
LOGGING['handlers']['console']['level'] = 'DEBUG'
LOGGING['handlers']['file']['level'] = 'DEBUG'
LOGGING['loggers']['django']['level'] = 'DEBUG'
