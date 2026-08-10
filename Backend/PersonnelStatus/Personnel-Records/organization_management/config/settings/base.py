"""
Base Django settings for the organization_management project.
"""
import os
from pathlib import Path
from datetime import timedelta

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/5.0/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = "django-insecure-^18w8^kyktt4q14w%c4tci%w(8po97jj2pd&3(#hv(dyn3hznv"

# Django behavior settings
APPEND_SLASH = False  # Allow URLs without trailing slash for API compatibility

# Application definition
INSTALLED_APPS = [
    'django.contrib.auth',
    'django.contrib.admin',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third party
    'rest_framework',
    'corsheaders',
    'channels',
    'django_celery_beat',
    'django_celery_results',
    'drf_spectacular',
    'mptt',

    # Apps
    'organization_management.apps.common',
    'organization_management.apps.divisions',
    'organization_management.apps.employees',
    'organization_management.apps.statuses',
    'organization_management.apps.secondments',
    'organization_management.apps.reports',
    'organization_management.apps.notifications',
    'organization_management.apps.audit',
    'organization_management.apps.dictionaries',
    'organization_management.apps.staff_unit',
    'organization_management.apps.operations',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'organization_management.apps.common.management.ip_logging_middleware.LogIPMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'organization_management.apps.audit.middleware.AuditMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'organization_management.config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'organization_management.config.wsgi.application'
ASGI_APPLICATION = 'organization_management.config.asgi.application'

# # Database
# # https://docs.djangoproject.com/en/5.0/ref/settings/#databases
# DATABASES = {
#     "default": {
#         "ENGINE": "django.db.backends.postgresql",
#         "NAME": "hr_system",
#         "USER": "hr_user",
#         "PASSWORD": "hr_password",
#         "HOST": "localhost",
#         "PORT": "5432",
#         "CONN_MAX_AGE": 60,
#     }
# }

# Password validation
# https://docs.djangoproject.com/en/5.0/ref/settings/#auth-password-validators
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Internationalization
# https://docs.djangoproject.com/en/5.0/topics/i18n/
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Almaty'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.0/howto/static-files/
STATIC_URL = '/staticfiles/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')

# Media files
MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')

# Приватное хранилище раздела ОМ: байты официальных документов.
#
# КАТАЛОГ УМЫШЛЕННО ВНЕ MEDIA_ROOT, и это несущее решение, а не раскладка.
# Всё, что лежит под MEDIA_ROOT, раздаётся веб-сервером по угадываемому адресу
# — то есть мимо прав, мимо сверки целостности и мимо журнала скачиваний.
# Документ расхода содержит поимённый состав подразделения; «лежит там же, где
# аватарки» означало бы, что он доступен всякому, кто знает адрес.
OPS_PRIVATE_STORAGE_ROOT = os.environ.get(
    'OPS_PRIVATE_STORAGE_ROOT', os.path.join(BASE_DIR, 'private_storage')
)

# Внутренняя локация nginx, через которую отдаются байты (X-Accel-Redirect).
# Django в этом режиме тела не пишет: он проверяет право, сверяет дайджест и
# кладёт заголовок, а файл льёт nginx. Локация обязана быть `internal` —
# снаружи по этому адресу не должно открываться НИЧЕГО.
OPS_XACCEL_LOCATION = os.environ.get('OPS_XACCEL_LOCATION', '/ops-private')

# Дефолт «выключено» — обратный дефолту выключателя WS, и по симметричной
# причине. Там рабочее состояние «включено», и выключение гасит инфраструктуру.
# Здесь включённый флаг на стенде, где internal-локация не настроена, отдал бы
# 200 с ПУСТЫМ телом и заголовком, который некому исполнить: скачанный файл
# оказался бы молча битым, и узнали бы об этом не мы, а тот, кто открыл
# документ. Выключенный флаг лишь заставляет Django отдать файл самому —
# медленнее, но верно. Включает его тот, кто настроил nginx.
OPS_XACCEL_ENABLED = os.environ.get('OPS_XACCEL_ENABLED', '0') == '1'

# Default primary key field type
# https://docs.djangoproject.com/en/5.0/ref/settings/#default-auto-field
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],

    # разрешаем доступ к публичным эндпоинтам (например /api/token/)
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',
    ],

    'DEFAULT_PAGINATION_CLASS': 'organization_management.apps.common.pagination.StandardResultsSetPagination',
    'PAGE_SIZE': 50,

    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',

    # Обработчик раздела ОМ: доменные ошибки и известные нарушения
    # ограничений отдаются конвертом, ВСЁ остальное уходит штатному
    # обработчику DRF без изменений формы (старые экраны не затронуты).
    'EXCEPTION_HANDLER':
        'organization_management.apps.operations.api.exception_handler'
        '.ops_exception_handler',
}


SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=8),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': False,
    'BLACKLIST_AFTER_ROTATION': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
    'USER_ID_FIELD': 'id',
    'USER_ID_CLAIM': 'user_id',
    'TOKEN_OBTAIN_SERIALIZER': 'organization_management.apps.common.jwt_serializers.CustomTokenObtainPairSerializer',
}

# DRF Spectacular (Swagger/OpenAPI)
SPECTACULAR_SETTINGS = {
    'TITLE': 'Personnel Records API',
    'DESCRIPTION': 'API для системы управления персоналом и штатным расписанием',
    'VERSION': '1.0.0',
    'SERVE_PERMISSIONS': ['rest_framework.permissions.AllowAny'],
    'SORT_OPERATIONS': False,
    'SWAGGER_UI_SETTINGS': {
            'operationsSorter': None,
            'tagsSorter': None,
        },
    # Имя enum'а светофора закреплено явно: поле называется "status", как и у
    # нескольких старых сериализаторов, и без этого spectacular разрешает
    # коллизию машинным именем вида Status3a8Enum — оно меняется при любой
    # правке соседей, и клиент, сгенерированный по схеме, ломается на ровном
    # месте.
    'ENUM_NAME_OVERRIDES': {
        'TrafficLightStatusEnum':
            'organization_management.apps.operations.traffic_light.'
            'TrafficLightStatus',
    },
}

# Celery Configuration
CELERY_BROKER_URL = 'redis://redis:6379/0'
CELERY_RESULT_BACKEND = 'redis://redis:6379/0'
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE

# Channels Configuration (WebSocket)
ASGI_APPLICATION = 'organization_management.config.asgi.application'
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [('redis', 6379)],
        },
    },
}

# Выключатель WS раздела ОМ. OPS_WS_ENABLED=0 гасит рисковую инфраструктуру
# (Channels + Redis) целиком: потребитель перестаёт принимать соединения,
# notify() перестаёт трогать канальный слой. Уведомления при этом продолжают
# писаться в базу и читаться по REST — истина это строка в базе, сокет лишь
# знак, и лента чтения остаётся запасным путём.
#
# Выключение — это смена переменной окружения и перезапуск, а не редеплой:
# время до восстановления у выключателя обязано быть меньше времени доставки
# релиза, иначе он бесполезен ровно тогда, когда нужен.
#
# Дефолт «1» по двум причинам сразу: рабочее состояние — «включено», и
# выключение обязано быть явным решением администратора; а прогон тестов эту
# переменную не экспортирует, поэтому дефолт здесь — единственное, что задаёт
# состояние всей WS-сюиты. Сравнение с «1» несущее: без него в настройке
# осталась бы СТРОКА, а строка «0» истинна — выключатель молча перестал бы
# что-либо выключать.
OPS_WS_ENABLED = os.environ.get('OPS_WS_ENABLED', '1') == '1'

# Cache
CACHES = {
    'default': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': 'redis://redis:6379/1',
        'OPTIONS': {
            'CLIENT_CLASS': 'django_redis.client.DefaultClient',
        }
    }
}

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'console': {'class': 'logging.StreamHandler'},
    },
    'loggers': {
        # propagate=False у каждого логгера со СВОИМИ обработчиками: иначе
        # запись уходит и в них, и в root, у которого обработчик тот же, —
        # каждая строка печатается ДВАЖДЫ. У 'django.request' ниже это уже
        # было учтено, у остальных нет.
        'django': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
        'django.server': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
        'django.request': {
            'handlers': ['console'],
            'level': 'DEBUG',  # ошибки запросов, включая админку
            'propagate': False,
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'DEBUG',
    },
}

CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://10.115.70.56:3000",
]

CORS_ALLOW_CREDENTIALS = True

CORS_ALLOW_METHODS = [
    'DELETE',
    'GET',
    'OPTIONS',
    'PATCH',
    'POST',
    'PUT',
]

CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
]

# Business Rules Settings
# Максимальная длительность непрерывного отпуска (в днях)
MAX_VACATION_DAYS = 45
