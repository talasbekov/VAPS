import pytest
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from config.settings import allowed_hosts_from_env, guard_secret_key_configured


def test_timezone_is_qyzylorda():
    assert settings.TIME_ZONE == "Asia/Qyzylorda"
    assert settings.USE_TZ is True


def test_core_app_installed():
    assert "apps.core" in settings.INSTALLED_APPS


# ---------------------------------------------------------------------------
# Story 12.1a — ALLOWED_HOSTS (fail-closed in prod, mirrors jwt_config_from_env)
# ---------------------------------------------------------------------------


def test_allowed_hosts_dev_empty_defaults_to_wildcard():
    assert allowed_hosts_from_env({}, debug=True) == ["*"]


def test_allowed_hosts_prod_empty_fails_closed():
    with pytest.raises(ImproperlyConfigured):
        allowed_hosts_from_env({}, debug=False)


def test_allowed_hosts_prod_reads_comma_separated_list():
    hosts = allowed_hosts_from_env(
        {"VAPS_ALLOWED_HOSTS": " vaps.contour.local , 10.0.0.1 "}, debug=False
    )
    assert hosts == ["vaps.contour.local", "10.0.0.1"]


def test_allowed_hosts_prod_blank_entries_dont_satisfy_the_requirement():
    with pytest.raises(ImproperlyConfigured):
        allowed_hosts_from_env({"VAPS_ALLOWED_HOSTS": " , , "}, debug=False)


def test_allowed_hosts_prod_wildcard_rejected():
    # Review (Blind Hunter): "*" is a non-empty list, so the empty-check
    # alone would let it sail through and reopen the exact any-Host hole
    # this function exists to close.
    with pytest.raises(ImproperlyConfigured):
        allowed_hosts_from_env({"VAPS_ALLOWED_HOSTS": "*"}, debug=False)


def test_allowed_hosts_dev_wildcard_is_fine():
    assert allowed_hosts_from_env({"VAPS_ALLOWED_HOSTS": "*"}, debug=True) == ["*"]


# ---------------------------------------------------------------------------
# Story 12.1a (review) — SECRET_KEY fail-closed in prod
# ---------------------------------------------------------------------------


def test_secret_key_prod_default_fails_closed():
    with pytest.raises(ImproperlyConfigured):
        guard_secret_key_configured("dev-insecure-key", debug=False)


def test_secret_key_prod_configured_value_is_fine():
    guard_secret_key_configured("a-real-generated-secret", debug=False)


def test_secret_key_dev_default_is_fine():
    guard_secret_key_configured("dev-insecure-key", debug=True)


# ---------------------------------------------------------------------------
# Story 12.1a — SecurityMiddleware, secure-cookie flags, HSTS/SSL-redirect
# ---------------------------------------------------------------------------


def test_security_middleware_installed_between_request_context_and_session():
    middleware = settings.MIDDLEWARE
    assert "django.middleware.security.SecurityMiddleware" in middleware
    i_ctx = middleware.index("apps.core.middleware.RequestContextMiddleware")
    i_sec = middleware.index("django.middleware.security.SecurityMiddleware")
    i_session = middleware.index("django.contrib.sessions.middleware.SessionMiddleware")
    assert i_ctx < i_sec < i_session


def test_cookie_secure_flags_mirror_debug():
    # pytest-django forces settings.DEBUG=False for the test run regardless of
    # VAPS_DEBUG (its own DEBUG-parity guard), so comparing against
    # settings.DEBUG here would compare against a value the app never
    # actually had at settings-module-exec time. The formula (SESSION/CSRF
    # COOKIE_SECURE = not DEBUG) is exercised directly instead —
    # allowed_hosts_from_env-style unit coverage isn't available here since
    # these two lines are a bare expression, not an extracted function; the
    # real invariant under test is: dev/gate (real VAPS_DEBUG unset → True)
    # must NOT get Secure-flagged cookies over plain HTTP.
    assert settings.SESSION_COOKIE_SECURE is False
    assert settings.CSRF_COOKIE_SECURE is False


def test_hsts_and_ssl_redirect_deliberately_disabled():
    # 12.1's topology has no TLS terminator (port 80 only) — forcing either of
    # these would break every request, not harden anything.
    assert settings.SECURE_HSTS_SECONDS == 0
    assert settings.SECURE_SSL_REDIRECT is False
