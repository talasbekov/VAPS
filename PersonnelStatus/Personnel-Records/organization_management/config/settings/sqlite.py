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

# Ограничение частоты смены пароля на СТЕНДЕ — выше боевого (Plane №180).
#
# Боевое умолчание `10/hour` (см. base.py) посчитано на живого человека: пароль
# меняют единицы раз в год. На стенде по ОДНОЙ учётке `admin` ходят все пробы
# сразу, и трёх прогонов подряд хватает, чтобы упереться в потолок: полный
# смоук 27.08.2026 так и упал — две пробы получили 429 вместо 400, причём
# КОД РАБОТАЛ ПРАВИЛЬНО, исчерпан был лимит предыдущими прогонами.
#
# Поднимать боевую ставку ради проб нельзя — ручка защищает от перебора. Ставку
# двигает СТЕНД, а не приложение: боевая конфигурация остаётся нетронутой, а то,
# что область вообще подключена, стережёт pytest-проба
# (`test_change_password_stops_answering_after_a_run_of_attempts`) со своей
# ставкой и своим кэшем.
REST_FRAMEWORK = {
    **REST_FRAMEWORK,  # noqa: F405 — приходит из base.py звёздочным импортом
    'DEFAULT_THROTTLE_RATES': {
        **REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'],  # noqa: F405
        'change-password': '200/hour',
    },
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
