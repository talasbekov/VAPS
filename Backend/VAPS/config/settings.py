import os
from pathlib import Path

from celery.schedules import crontab
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("VAPS_SECRET_KEY", "dev-insecure-key")
DEBUG = os.environ.get("VAPS_DEBUG", "1") == "1"


# Story 12.1a (review, Blind Hunter): the fail-closed treatment below for
# ALLOWED_HOSTS is worthless as a security posture if SECRET_KEY can boot
# prod on the dev default — that default is public (this repo's source).
def guard_secret_key_configured(secret_key, debug):
    if not debug and secret_key == "dev-insecure-key":
        raise ImproperlyConfigured(
            "VAPS_SECRET_KEY is required in production (DEBUG=False): the "
            "dev default is public (checked into this repository's source)."
        )


guard_secret_key_configured(SECRET_KEY, DEBUG)


# Story 12.1a — mirrors jwt_config_from_env's (env, debug) → value|raises shape
# below. Prod (DEBUG=False) MUST configure explicit hosts — ALLOWED_HOSTS=["*"]
# would accept a forged Host header (password-reset/cache-poisoning vector).
def allowed_hosts_from_env(env, debug):
    hosts = [
        h.strip() for h in env.get("VAPS_ALLOWED_HOSTS", "").split(",") if h.strip()
    ]
    if not debug and not hosts:
        raise ImproperlyConfigured(
            "VAPS_ALLOWED_HOSTS is required in production (DEBUG=False): "
            "ALLOWED_HOSTS=['*'] would accept a forged Host header."
        )
    # Review (Blind Hunter): an explicit "*" in the env var is non-empty, so
    # the guard above would let it through and reintroduce the exact
    # any-Host-header hole this function exists to close.
    if not debug and "*" in hosts:
        raise ImproperlyConfigured(
            "VAPS_ALLOWED_HOSTS must not contain '*' in production: that "
            "accepts any Host header, defeating the guard entirely."
        )
    if not debug:
        # Story 12.3 (live install.sh run): deploy/docker-compose.yml's app
        # healthcheck hits http://127.0.0.1:8000/admin/login/ directly,
        # bypassing nginx — Host: 127.0.0.1, never the real configured host.
        # Without this, `docker compose up --wait` never goes healthy once
        # VAPS_ALLOWED_HOSTS holds a real hostname (400 Bad Request).
        # Loopback-only — unreachable from outside the container itself.
        hosts = list(dict.fromkeys(hosts + ["127.0.0.1", "localhost"]))
    return hosts or ["*"]


ALLOWED_HOSTS = allowed_hosts_from_env(os.environ, DEBUG)

INSTALLED_APPS = [
    # Django Admin (только справочники, стори 2.10/2.11; ARCH#L467) +
    # его зависимости. Бизнес-авторизация остаётся за PermissionService.
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    # Story 11.1: ASGI/WebSocket-транспорт уведомлений (FR-35). `daphne` НЕ
    # добавляем: в Channels 4 он нужен только ради ASGI-варианта `runserver`,
    # а прод-сервер — задача 12.1.
    "channels",
    "rest_framework",
    # Story 8.3: только CLI-генерация схемы (manage.py spectacular) — runtime-роутов
    # /api/schema нет (закрытый контур), urls.py не трогается.
    "drf_spectacular",
    "apps.core",
    "apps.operations",
    "apps.operations.statuses",
    "apps.operations.rbac",
    "apps.operations.submissions",
    "apps.operations.bugreports",
    "apps.operations.facilities",
    "apps.operations.duties",
    "apps.operations.events",
    "apps.audit",
    "apps.notifications",
    "apps.documents",
    "apps.migration_legacy",
    "apps.parallel_run",
]

MIDDLEWARE = [
    # request_id contextvar — ПЕРВЫМ (внешним), чтобы оборачивать весь
    # request/response; reset в finally не даёт ему течь между запросами (4.3).
    "apps.core.middleware.RequestContextMiddleware",
    # Story 12.1a: Django docs recommend SecurityMiddleware first, but
    # RequestContextMiddleware's request_id wrapper must stay outermost — this
    # is the next-best position, still ahead of everything it hardens.
    "django.middleware.security.SecurityMiddleware",
    # Порядок обязателен для admin (system-check admin.E408/E409/E410):
    # Session → ... → Auth → Message; Session ДО Auth.
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                # Обязательны для admin (admin.E402/E403/E404).
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]
WSGI_APPLICATION = None


# Story 11.1 — channel layer для WS-транспорта уведомлений (FR-35).
#
# Бэкенд ЗАХАРДКОЖЕН, env выбирает только адрес. Причина (architecture.md#L337):
# in-memory-слой Channels живёт внутри одного интерпретатора, поэтому
# `group_send` из ЛЮБОГО другого процесса (management-команда, beat, будущий
# воркер) уходит в никуда — без ошибки, без лога. Такая деградация неотличима
# от «событий просто не было», поэтому выбор слоя не отдаётся в конфиг вовсе.
# Гвард `apps/notifications/tests/test_ws_guards.py` держит это утверждение.
#
# Скоуп Redis: architecture.md#L311 фиксирует «Redis — только брокер, кэш не
# вводится». Здесь Redis выступает channel layer'ом — это второе назначение,
# третьего (CACHES) не появляется.
def channel_layers_from_env(env):
    """Парсинг VAPS_REDIS_URL с валидацией схемы (паттерн max_upload_mb_from_env):
    пустой или не-redis URL валит старт, а не деградирует молча в нерабочую
    доставку. Возвращает готовый CHANNEL_LAYERS-словарь."""
    url = env.get("VAPS_REDIS_URL")
    if url is None:
        # Не задана вовсе — санкционированный dev-дефолт (AC-2). Задана, но
        # пустая/пробельная — ошибка оператора (пустой секрет), fail-closed:
        # молчаливый откат на loopback в проде хуже падения на старте.
        url = "redis://127.0.0.1:6379/0"
    url = url.strip()
    if not url:
        raise ImproperlyConfigured(
            "VAPS_REDIS_URL must not be blank — the WS channel layer needs a broker."
        )
    if not url.startswith(("redis://", "rediss://")):
        raise ImproperlyConfigured(
            "VAPS_REDIS_URL must start with redis:// or rediss:// "
            f"(got {url.split('://', 1)[0]!r})."
        )
    return {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {"hosts": [url]},
        }
    }


CHANNEL_LAYERS = channel_layers_from_env(os.environ)

ASGI_APPLICATION = "config.asgi.application"

# Postgres in prod via env. SQLite remains the no-env default, but since
# ops_statuses migrations use Postgres-only features (ExclusionConstraint,
# GeneratedField daterange), the full suite runs only with VAPS_DB=postgres
# (use `make gate`); SQLite is for pure ORM-free units (ARCH-DATA-020).
if os.environ.get("VAPS_DB") == "postgres":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ["VAPS_DB_NAME"],
            "USER": os.environ["VAPS_DB_USER"],
            "PASSWORD": os.environ.get("VAPS_DB_PASSWORD", ""),
            "HOST": os.environ.get("VAPS_DB_HOST", "localhost"),
            "PORT": os.environ.get("VAPS_DB_PORT", "5432"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "core.User"

# TIME-001
TIME_ZONE = "Asia/Qyzylorda"
USE_TZ = True
VAPS_LOCAL_TIMEZONE = "Asia/Qyzylorda"

# Story 12.6 — Celery broker: the SAME VAPS_REDIS_URL as CHANNEL_LAYERS
# above (architecture.md#L311 — one Redis, one broker role, no separate
# cache). Celery's own key namespace (kombu's _kombu.binding.* etc.)
# doesn't collide with channels_redis' group keys — no DB-index split
# needed.
CELERY_BROKER_URL = os.environ.get("VAPS_REDIS_URL", "redis://127.0.0.1:6379/0")
# Review (Blind Hunter): all three beat tasks are fire-and-forget — nothing
# ever calls .get()/AsyncResult() on them. A result backend nobody reads
# would just accumulate celery-task-meta-* keys in the same Redis instance
# forever (no consumer to expire them against). No backend, not "set one
# and hope the default TTL is enough."
CELERY_RESULT_BACKEND = None
CELERY_TASK_IGNORE_RESULT = True
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TIMEZONE = TIME_ZONE

# Story 12.6 — three catch-up jobs, wrapped in @shared_task (each already
# "beat-ready" per its own docstring, 3.12/5.7b2/6.9). Nightly hours chosen
# to NOT overlap the existing systemd timers (vaps-parallel-run-diff.timer
# 02:15, deploy/systemd/vaps-backup.timer 03:00, story 7.0/12.4) —
# parallel-run-diff's own systemd timer stays; registering it here too is
# additive, not a replacement (Dev Notes: dual trigger is safe, each job is
# idempotent under its own advisory lock).
CELERY_BEAT_SCHEDULE = {
    "materialize-status-effects-nightly": {
        "task": "apps.operations.statuses.tasks.materialize_status_effects_task",
        "schedule": crontab(hour=1, minute=30),
    },
    "check-lagging-submissions-nightly": {
        "task": "apps.operations.submissions.tasks.check_lagging_submissions_task",
        "schedule": crontab(hour=1, minute=45),
    },
    "parallel-run-diff-nightly": {
        "task": "apps.parallel_run.tasks.parallel_run_diff_task",
        "schedule": crontab(hour=2, minute=30),
    },
    # Story 13.5b — intraday, NOT nightly: alert_hour (13.5a) is a same-day,
    # configurable threshold ("half not submitted by 15:30"), not a full-day
    # catch-up checked the next morning. A fixed once-a-day crontab entry
    # would silently stop tracking an Admin edit to alert_hour without a
    # redeploy; a periodic run with the service's own internal hour-gate
    # (check_submission_threshold) tracks config changes for free — repeat
    # firings after the first alert are free no-ops (notify()'s own
    # get_or_create idempotency — no dedicated watermark needed here).
    # Hour window is "0-1,4-23", NOT "0-23": review (Blind Hunter) caught
    # that a naive full-day "0-23" would tick at (2,15) and (3,0) — the two
    # hours this file's OWN comment above (L221-227) already reserves for
    # the parallel-run-diff/backup systemd timers. Excluding 02:00-03:59
    # wholesale sidesteps both forbidden ticks while still covering any
    # plausible admin-configured alert_hour (a submission deadline in the
    # middle of the night is not a realistic config).
    "check-submission-threshold-intraday": {
        "task": "apps.operations.submissions.tasks.check_submission_threshold_task",
        "schedule": crontab(minute="*/15", hour="0-1,4-23"),
    },
    # Story 13.5c — once daily (not intraday like 13.5b above): the pulse's
    # own cutoff (PULSE_CUTOFF_HOUR=20 in pilot_pulse.py) is a fixed literal,
    # not an Admin setting, so a single fixed crontab entry (unlike 13.5b's
    # periodic re-check) is enough — no config to silently drift out of sync
    # with. 20:00 doesn't collide with (2,15)/(3,0) (reserved above) or with
    # 13.5b's *-per-15-minutes ticks (different task, same minute is fine).
    "pilot-pulse-digest-daily": {
        "task": "apps.operations.submissions.tasks.pilot_pulse_digest_task",
        "schedule": crontab(hour=20, minute=0),
    },
}

# BR-EMP-005 default
AUTO_GENERATE_PERSONNEL_NUMBER = (
    os.environ.get("AUTO_GENERATE_PERSONNEL_NUMBER", "false") == "true"
)


# Story 5.1 — external-Auth JWT verification (config-driven; review-hardened). The
# issuer's key + algorithms come from env; the algorithms allowlist never includes
# "none" and may not mix HMAC+asymmetric. RS256 default (asymmetric: VAPS_JWT_KEY =
# the issuer's PUBLIC key). Real algorithm/claims come from the 5.1 readiness spike
# (spikes/5.1-auth-contour/RUNBOOK.md). Prod (DEBUG=False) MUST configure JWT + an
# audience — else fail closed (the unsigned X-User-Id header would be trusted).
def jwt_config_from_env(env, debug):
    """Build & validate the JWT verification config from an env mapping (story 5.1,
    review P3/P4/D2). Returns the config dict, or None when JWT is disabled (dev with
    no key). Raises ``ImproperlyConfigured`` so an unsafe/missing prod config fails
    closed at startup, never silently degrading to the unsigned dev-header path."""
    key = env.get("VAPS_JWT_KEY")
    if key and "\n" not in key:
        # Story 12.5: closes the open question deploy/.env.example's own
        # comment left unresolved since 12.1 — operators are told to put a
        # multi-line PEM on one .env line with literal "\n" (docker compose's
        # .env parser has no multi-line syntax), but nothing ever converted
        # those back to real newlines before handing the key to PyJWT/
        # cryptography, which require actual line breaks to parse a PEM.
        # Verified empirically: cryptography.hazmat's PEM loader raises
        # InvalidKeyError on the literal-\n form without this.
        #
        # Review (Blind Hunter): gated on "no real newline present" rather
        # than applied unconditionally — a key that's ALREADY a genuine
        # multi-line PEM (mounted-file env source) is left untouched, not
        # blindly re-processed on the (extremely unlikely, PEM bodies are
        # base64) chance it contains a literal backslash-n substring.
        key = key.replace("\\n", "\n")
    if not key:
        if not debug:
            raise ImproperlyConfigured(
                "VAPS_JWT_KEY is required in production (DEBUG=False): without it the "
                "unsigned dev header would be trusted (fail-open)."
            )
        return None
    algorithms = [
        a.strip()
        for a in env.get("VAPS_JWT_ALGORITHMS", "RS256").split(",")
        if a.strip()
    ]
    if not algorithms:
        raise ImproperlyConfigured(
            "VAPS_JWT_ALGORITHMS must list at least one algorithm."
        )
    if any(a.startswith("HS") for a in algorithms) and any(
        a.startswith(("RS", "ES", "PS")) for a in algorithms
    ):
        raise ImproperlyConfigured(
            "VAPS_JWT_ALGORITHMS must not mix HMAC (HS*) and asymmetric (RS*/ES*/PS*) "
            "under one key — RS/HS algorithm confusion."
        )
    try:
        leeway = int(env.get("VAPS_JWT_LEEWAY", "0"))
    except ValueError as exc:
        raise ImproperlyConfigured(
            "VAPS_JWT_LEEWAY must be an integer (seconds)."
        ) from exc
    if not 0 <= leeway <= 120:
        raise ImproperlyConfigured("VAPS_JWT_LEEWAY must be 0..120 seconds.")
    audience = env.get("VAPS_JWT_AUDIENCE") or None
    if not debug and not audience:
        raise ImproperlyConfigured(
            "VAPS_JWT_AUDIENCE is required in production (audience-confusion guard)."
        )
    return {
        "key": key,
        "algorithms": algorithms,
        "audience": audience,
        "issuer": env.get("VAPS_JWT_ISSUER") or None,
        "leeway": leeway,
    }


def build_auth_classes(vaps_jwt):
    """Compose the DRF auth chain (story 5.1, review D1). JWTAuthentication is always
    first. The dev-header stand-in is included ONLY when JWT is NOT configured —
    when an external-Auth JWT is configured (prod) the unsigned header must not
    overwrite/bypass a verified token. (Prod-without-JWT already fails closed above.)"""
    classes = ["apps.core.auth.authentication.JWTAuthentication"]
    if vaps_jwt is None:
        classes.append("apps.core.auth.authentication.XUserIdAuthentication")
    classes.append("apps.operations.api.authz.EffectivePermissionsResolver")
    return classes


VAPS_JWT = jwt_config_from_env(os.environ, DEBUG)

# Story 12.1a — cookie/transport hardening. Mirrors DEBUG exactly (one flag,
# no separate env var to forget): dev/gate keep working over plain HTTP, prod
# (DEBUG=False) gets Secure-flagged cookies automatically.
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

# HSTS/SSL-redirect deliberately NOT enabled: Story 12.1's topology serves
# plain HTTP on port 80 with no TLS terminator (architecture.md#L321 — HTTPS
# is a later production-hardening epic, not a blocker for the closed-LAN
# first release). Forcing SECURE_SSL_REDIRECT or a nonzero
# SECURE_HSTS_SECONDS with no certificate in front would break every
# request (redirect loop / browsers refusing plain HTTP after HSTS).
# manage.py check --deploy's security.W004/W008 stay open on purpose until a
# TLS terminator exists — same E12 debt, addressed by a future story.
SECURE_HSTS_SECONDS = 0
SECURE_SSL_REDIRECT = False

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": build_auth_classes(VAPS_JWT),
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    # Story 3.1: единая точка формирования ошибок (§36-конверт, DomainError +
    # IntegrityError-по-имени-constraint). Все ошибки DRF-границы — здесь.
    "EXCEPTION_HANDLER": "apps.core.api.exception_handler.domain_exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

# Story 8.3: schema.yaml — контракт для кодогена типов фронта (ARCH-FE-011).
# VERSION статичная, НЕ из pyproject: привязка к версии проекта делала бы каждый
# релизный бамп schema-дрифтом. COMPONENT_SPLIT_REQUEST — раздельные Request/
# Response-компоненты (корректные типы readOnly-полей); включить позже = массовый дифф.
SPECTACULAR_SETTINGS = {
    "TITLE": "VAPS API",
    "VERSION": "0.1.0",
    "COMPONENT_SPLIT_REQUEST": True,
    # Story 10.3c: TrafficLightViewSet.tree ("node.status") и .division
    # ("status") share the SAME TrafficLightStatus choice set — spectacular
    # tried to merge them under an auto-generated hashed name ("Status3a8Enum")
    # instead of the previously-stable "TrafficLightNodeStatusEnum", breaking
    # the pinned schema test. A shared enum for the same underlying choices
    # is correct (not a workaround); this just gives it a deterministic name.
    "ENUM_NAME_OVERRIDES": {
        "TrafficLightStatusEnum": (
            "apps.operations.submissions.traffic_light.TrafficLightStatus.choices"
        ),
    },
}

# Admin-ассеты под DEBUG/runserver — через staticfiles напрямую (STATIC_ROOT
# не требуется). Под прод (12.1) — collectstatic В ОБРАЗ (Dockerfile) в
# STATIC_ROOT, nginx отдаёт alias'ом (ARCH#L335: «static/media — nginx alias,
# ASGI не отдаёт»); ASGI-приложение само эти файлы никогда не сервит.
STATIC_URL = "static/"
STATIC_ROOT = Path(os.environ.get("VAPS_STATIC_ROOT", BASE_DIR / "staticfiles"))


# Story 6.1 — приватное файловое хранилище (Attachment). Файлы живут ВНЕ
# MEDIA_URL (MEDIA_ROOT/MEDIA_URL не вводятся вовсе, Д2) плоско как
# {root}/{uuid}; отдача — X-Accel-Redirect на internal-location nginx.
# Переключение отдачи — env-флаг, НЕ if DEBUG (канон «без веток по окружению»).
def max_upload_mb_from_env(env):
    """Парсинг VAPS_MAX_UPLOAD_MB с range-guard (паттерн VAPS_JWT_LEEWAY):
    кривое значение валит старт, а не молча пропускает гигантский upload."""
    try:
        mb = int(env.get("VAPS_MAX_UPLOAD_MB", "20"))
    except ValueError as exc:
        raise ImproperlyConfigured(
            "VAPS_MAX_UPLOAD_MB must be an integer (megabytes)."
        ) from exc
    if not 1 <= mb <= 1024:
        raise ImproperlyConfigured("VAPS_MAX_UPLOAD_MB must be 1..1024 megabytes.")
    return mb


VAPS_MAX_UPLOAD_MB = max_upload_mb_from_env(os.environ)

# Whitelist заявленных content-type (Д4: форматы расхода FR-17 + фото; сниффинг
# содержимого не делаем — контур закрытый). CSV-переопределение через env.
VAPS_ATTACHMENT_CONTENT_TYPES = [
    ct.strip()
    for ct in os.environ.get(
        "VAPS_ATTACHMENT_CONTENT_TYPES",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document,"
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,"
        "application/pdf,text/csv,image/jpeg,image/png",
    ).split(",")
    if ct.strip()
]

VAPS_PRIVATE_STORAGE_ROOT = Path(
    os.environ.get("VAPS_PRIVATE_STORAGE_ROOT", BASE_DIR / "private_storage")
)

# X-Accel: Django отдаёт заголовки, байты стримит nginx internal location.
# VAPS_XACCEL_ENABLED=0 — dev-fallback без nginx (FileResponse).
VAPS_XACCEL_ENABLED = os.environ.get("VAPS_XACCEL_ENABLED", "1") == "1"
VAPS_XACCEL_LOCATION = os.environ.get("VAPS_XACCEL_LOCATION", "/protected")

# Story 11.5 — kill-switch WebSocket (architecture.md#L56/#L95/#L338).
# VAPS_WS_ENABLED=0 гасит рисковую инфраструктуру (Channels + Redis) целиком:
# consumer перестаёт принимать соединения, notify() перестаёт трогать channel
# layer. Уведомления при этом продолжают писаться в БД и читаться по REST —
# «событие в БД истина, WS сигнал» (architecture.md#L327).
# Выключение = смена env + перезапуск контейнера, НЕ редеплой (в этом контуре
# редеплой означает перенос носителя с новым образом, и MTTR kill-switch'а
# обязан быть меньше времени доставки релиза).
# Дефолт "1" — по двум причинам сразу: прод-состояние фичи «включено», а
# выключение обязано быть явным действием администратора; и make gate
# (Makefile:95-101) НЕ экспортирует эту переменную, поэтому дефолт есть
# единственное, что задаёт состояние всего WS-сьюта — "0" увёл бы его в
# красное. Выключенное состояние проверяется только через override_settings.
# Форма — зеркало VAPS_XACCEL_ENABLED выше и DEBUG (:9); ветвление по if DEBUG
# запрещено каноном «конфиг — env, без веток по окружению» (architecture.md#L339,
# комментарий :256).
VAPS_WS_ENABLED = os.environ.get("VAPS_WS_ENABLED", "1") == "1"

# Story 13.6 — structured JSON errors journal (GlitchTip stays DEFERRED,
# epics.md#L1389-1395). env-driven, same style as VAPS_DB_*/VAPS_REDIS_URL
# above. RotatingFileHandler (stdlib logging.handlers) — no new dependency.
VAPS_ERROR_LOG_PATH = os.environ.get(
    "VAPS_ERROR_LOG_PATH", str(BASE_DIR / "logs" / "errors.log")
)
VAPS_ERROR_LOG_MAX_BYTES = int(
    os.environ.get("VAPS_ERROR_LOG_MAX_BYTES", str(10 * 1024 * 1024))
)
VAPS_ERROR_LOG_BACKUP_COUNT = int(os.environ.get("VAPS_ERROR_LOG_BACKUP_COUNT", "5"))

# RotatingFileHandler does not create its own parent directory (AC-3) — must
# exist before LOGGING is applied at Django startup. Review (Edge Case
# Hunter): this raises PermissionError at import time on an unwritable
# filesystem (breaks even `manage.py --help`) — accepted, not guarded: the
# RotatingFileHandler constructor itself would fail identically the moment
# LOGGING is applied for the same underlying reason (no write access), so
# swallowing the error here would only move the crash a few lines down, not
# prevent it. Deploy must ensure VAPS_ERROR_LOG_PATH's directory is writable,
# same operational requirement as VAPS_DB_*/VAPS_REDIS_URL above.
#
# Review (Blind Hunter/Edge Case Hunter): RotatingFileHandler has no
# cross-process rotation lock. Not a current risk — deploy/Dockerfile runs a
# single uvicorn process (no --workers), and the Celery worker/beat processes
# that also log here are low-volume (ERROR level only). Would need revisiting
# if the web process is ever scaled to multiple workers sharing this path.
Path(VAPS_ERROR_LOG_PATH).parent.mkdir(parents=True, exist_ok=True)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "request_json": {
            "()": "apps.core.logging_json.RequestJsonFormatter",
        },
    },
    "handlers": {
        "errors_journal": {
            "level": "ERROR",
            "class": "logging.handlers.RotatingFileHandler",
            "filename": VAPS_ERROR_LOG_PATH,
            "maxBytes": VAPS_ERROR_LOG_MAX_BYTES,
            "backupCount": VAPS_ERROR_LOG_BACKUP_COUNT,
            "formatter": "request_json",
        },
    },
    "loggers": {
        # Django's own per-500 logger (unhandled view exceptions).
        "django.request": {
            "handlers": ["errors_journal"],
            "level": "ERROR",
            "propagate": True,
        },
        # apps/core/api/exception_handler.py's own logger — already calls
        # logger.exception(...) on every unhandled exception surfaced to the
        # API boundary (L175, story 4.x); this story only wires its OUTPUT,
        # the call site itself is untouched.
        "apps.core.api.exception_handler": {
            "handlers": ["errors_journal"],
            "level": "ERROR",
            "propagate": True,
        },
    },
}

# Story 15.10 (FR-42): days a GroupForceRequest may sit unfulfilled
# (SENT/PARTIALLY_ALLOCATED) before escalation. PROVISIONAL — architecture.md
# (lines 278, 675) marks the real threshold an open question to the customer
# (not blocking), not yet answered by product; env-overridable so it can be
# corrected without a code change once decided.
VAPS_FORCE_REQUEST_ESCALATION_DAYS = int(
    os.environ.get("VAPS_FORCE_REQUEST_ESCALATION_DAYS", "2")
)
