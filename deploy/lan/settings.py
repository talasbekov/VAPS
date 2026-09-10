"""LAN deployment with persistent background processing; contour stays unchanged."""
from .contour import *
from .base import CELERY_BEAT_SCHEDULE as STATUS_SCHEDULE

TIME_ZONE = os.getenv('TIME_ZONE', 'Asia/Almaty')
CELERY_TIMEZONE = TIME_ZONE
CELERY_BEAT_SCHEDULE = STATUS_SCHEDULE if os.getenv('ENABLE_BACKGROUND_TASKS', '1') == '1' else {}
# Several processes share the image. Rotate their separate Docker logs, not one file.
LOGGING['handlers'].pop('file', None)
LOGGING['root']['handlers'] = ['console']
for logger in LOGGING['loggers'].values():
    logger['handlers'] = ['console']
# A closed network may provide SMTP later; do not try an external mail service.
EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'

# Swagger/Redoc must work without fetching JavaScript or CSS from a CDN.
INSTALLED_APPS = [*INSTALLED_APPS, 'drf_spectacular_sidecar']
SPECTACULAR_SETTINGS = {**SPECTACULAR_SETTINGS,
    'SWAGGER_UI_DIST': 'SIDECAR', 'SWAGGER_UI_FAVICON_HREF': 'SIDECAR',
    'REDOC_DIST': 'SIDECAR'}
