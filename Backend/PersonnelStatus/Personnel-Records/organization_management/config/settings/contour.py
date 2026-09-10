"""Isolated offline deployment. No change to the shared development defaults."""
from .production import *

DEBUG = False
TIME_ZONE = os.getenv('TIME_ZONE', 'Asia/Qyzylorda')
CELERY_TIMEZONE = TIME_ZONE

def env_list(name):
    return [value.strip() for value in os.getenv(name, '').split(',') if value.strip()]

ALLOWED_HOSTS = env_list('ALLOWED_HOSTS')
CORS_ALLOWED_ORIGINS = env_list('CORS_ALLOWED_ORIGINS')
CSRF_TRUSTED_ORIGINS = env_list('CSRF_TRUSTED_ORIGINS')
CORS_ALLOW_ALL_ORIGINS = False
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SESSION_COOKIE_SECURE = os.getenv('COOKIE_SECURE', '0') == '1'
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
STATIC_ROOT = '/data/static'
MEDIA_ROOT = '/data/media'
OPS_PRIVATE_STORAGE_ROOT = '/data/private'
OPS_XACCEL_ENABLED = True

# redis 8 defaults socket reads to 5s, equal to Channels' BZPOPMIN wait.
# Let Redis's blocking-command timeout finish the read; keep connection setup
# bounded. This affects the channel layer only, not the application cache.
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [{
                'host': REDIS_HOST,
                'port': int(REDIS_PORT),
                'socket_timeout': None,
                'socket_connect_timeout': 5,
            }],
        },
    },
}

# No worker/beat service is shipped in this phase. Scheduled status processing
# and deferred reports remain unavailable (documented in the contour runbook).
# Keep the real broker for visibility of queued work; never silently discard it.
CELERY_BEAT_SCHEDULE = {}
CELERY_TASK_ALWAYS_EAGER = False

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'filters': {
        'asgi_path_only': {
            '()': 'organization_management.config.logging_filters.ASGIPathOnlyFilter',
        },
    },
    'formatters': {'standard': {'format': '{asctime} {levelname} {name}: {message}', 'style': '{'}},
    'handlers': {
        'console': {'class': 'logging.StreamHandler', 'formatter': 'standard'},
        'file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': '/var/log/django/django.log',
            'maxBytes': 10 * 1024 * 1024,
            'backupCount': 5,
            'encoding': 'utf-8',
            'formatter': 'standard',
        },
    },
    'root': {'handlers': ['console', 'file'], 'level': 'INFO'},
    'loggers': {
        'django': {'handlers': ['console', 'file'], 'level': 'INFO', 'propagate': False},
        'uvicorn.error': {
            'handlers': ['console', 'file'], 'filters': ['asgi_path_only'],
            'level': 'INFO', 'propagate': False,
        },
        'uvicorn.access': {
            'handlers': ['console', 'file'], 'filters': ['asgi_path_only'],
            'level': 'INFO', 'propagate': False,
        },
    },
}
