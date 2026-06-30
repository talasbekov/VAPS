import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

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
    "apps.notifications",
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

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": build_auth_classes(VAPS_JWT),
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    # Story 3.1: единая точка формирования ошибок (§36-конверт, DomainError +
    # IntegrityError-по-имени-constraint). Все ошибки DRF-границы — здесь.
    "EXCEPTION_HANDLER": "apps.core.api.exception_handler.domain_exception_handler",
}

# Admin-ассеты под DEBUG/runserver через staticfiles. STATIC_ROOT +
# collectstatic + nginx-alias — прод-статика, отложено в E12 (ARCH#L335).
STATIC_URL = "static/"
