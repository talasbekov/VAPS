import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("VAPS_SECRET_KEY", "dev-insecure-key")
DEBUG = os.environ.get("VAPS_DEBUG", "1") == "1"
ALLOWED_HOSTS = ["*"]

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
    "rest_framework",
    "apps.core",
    "apps.operations",
    "apps.operations.statuses",
    "apps.operations.rbac",
    "apps.operations.submissions",
    "apps.audit",
    "apps.migration_legacy",
]

MIDDLEWARE = [
    # request_id contextvar — ПЕРВЫМ (внешним), чтобы оборачивать весь
    # request/response; reset в finally не даёт ему течь между запросами (4.3).
    "apps.core.middleware.RequestContextMiddleware",
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

# BR-EMP-005 default
AUTO_GENERATE_PERSONNEL_NUMBER = (
    os.environ.get("AUTO_GENERATE_PERSONNEL_NUMBER", "false") == "true"
)

# Story 5.1 — external-Auth JWT verification (config-driven). None → JWT disabled
# (dev/tests use the X-User-Id path). In prod the issuer's key + algorithms MUST be set
# via env; the algorithms allowlist never includes "none". RS256 default (asymmetric:
# VAPS_JWT_KEY = the issuer's PUBLIC key). The contour's real algorithm/claims come from
# the 5.1 readiness spike (spikes/5.1-auth-contour/RUNBOOK.md).
_VAPS_JWT_KEY = os.environ.get("VAPS_JWT_KEY")
VAPS_JWT = (
    {
        "key": _VAPS_JWT_KEY,
        "algorithms": [
            a.strip()
            for a in os.environ.get("VAPS_JWT_ALGORITHMS", "RS256").split(",")
            if a.strip()
        ],
        "audience": os.environ.get("VAPS_JWT_AUDIENCE") or None,
        "issuer": os.environ.get("VAPS_JWT_ISSUER") or None,
        "leeway": int(os.environ.get("VAPS_JWT_LEEWAY", "0")),
    }
    if _VAPS_JWT_KEY
    else None
)

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        # Order matters (story 5.1): JWT first — a verified Bearer's `sub` →
        # request.actor_id; an absent/non-Bearer request returns None and falls
        # through to XUserId (dev), which sets request.actor_id; then the resolver
        # reads it and attaches request.effective_permissions (story 2.13).
        "apps.core.auth.authentication.JWTAuthentication",
        "apps.core.auth.authentication.XUserIdAuthentication",
        "apps.operations.api.authz.EffectivePermissionsResolver",
    ],
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    # Story 3.1: единая точка формирования ошибок (§36-конверт, DomainError +
    # IntegrityError-по-имени-constraint). Все ошибки DRF-границы — здесь.
    "EXCEPTION_HANDLER": "apps.core.api.exception_handler.domain_exception_handler",
}

# Admin-ассеты под DEBUG/runserver через staticfiles. STATIC_ROOT +
# collectstatic + nginx-alias — прод-статика, отложено в E12 (ARCH#L335).
STATIC_URL = "static/"
