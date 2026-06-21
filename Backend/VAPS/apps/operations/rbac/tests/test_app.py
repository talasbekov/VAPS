import pytest
from django.apps import apps
from django.conf import settings
from django.contrib.contenttypes.models import ContentType

from apps.operations.rbac.models import (
    Permission, Role, RolePermission, TemporaryDutyPermission, UserRole,
)

# db_table тождество — прямое доказательство AC-1 «ни одна таблица не переименована».
EXPECTED_DB_TABLES = [
    (Role, "ops_roles"),
    (Permission, "ops_permissions"),
    (UserRole, "ops_user_roles"),
    (RolePermission, "ops_role_permissions"),
    (TemporaryDutyPermission, "ops_temporary_duty_permissions"),
]
RBAC_MODELS = [m for m, _ in EXPECTED_DB_TABLES]
# имена моделей (lowercase) для проверки осиротевших content_type строк
RBAC_MODEL_NAMES = ["role", "permission", "userrole", "rolepermission",
                    "temporarydutypermission"]


def test_ops_rbac_app_installed():
    assert "apps.operations.rbac" in settings.INSTALLED_APPS


def test_ops_rbac_app_config():
    assert apps.get_app_config("ops_rbac").name == "apps.operations.rbac"


@pytest.mark.parametrize("model,table", EXPECTED_DB_TABLES)
def test_rbac_db_table_unchanged(model, table):
    assert model._meta.db_table == table


@pytest.mark.django_db
@pytest.mark.parametrize("model", RBAC_MODELS)
def test_rbac_content_type_app_label(model):
    # AC-1: контент-типы переехали в ops_rbac (id сохранён UPDATE-ом, не пересоздан).
    assert ContentType.objects.get_for_model(model).app_label == "ops_rbac"


@pytest.mark.django_db
def test_no_orphaned_operations_content_types():
    # AC-1: нет осиротевших строк app_label="operations" для перенесённых моделей.
    orphans = ContentType.objects.filter(
        app_label="operations", model__in=RBAC_MODEL_NAMES
    )
    assert not orphans.exists()
