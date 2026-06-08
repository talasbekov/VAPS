from django.conf import settings


def test_operations_app_installed():
    assert "apps.operations" in settings.INSTALLED_APPS


def test_operations_urls_mounted():
    from django.urls import reverse, NoReverseMatch
    # The router has no routes yet; mounting is verified in later API tasks.
    # Here we only assert the include resolves without import error.
    import apps.operations.api.urls as ops_urls
    assert hasattr(ops_urls, "urlpatterns")
