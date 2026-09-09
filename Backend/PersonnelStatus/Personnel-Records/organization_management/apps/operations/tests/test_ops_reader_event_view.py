"""Plane №1087: legacy observer reads OM without mutation permissions."""
from importlib import import_module

import pytest
from django.apps import apps

from organization_management.apps.operations.models import Permission, Role, RolePermission
from organization_management.apps.operations.tests.test_bulk_status_api import client_for

pytestmark = pytest.mark.django_db
migration = import_module(
    "organization_management.apps.operations.migrations.0117_ops_reader_event_view"
)


def test_existing_observer_reads_registry_but_cannot_create_event():
    client, _ = client_for("observer-1087", "OPS_READER", perms=("object.view", "duty.view"))
    Permission.objects.get_or_create(code="event.view", defaults={"name": "Просмотр ОМ"})
    migration.grant_event_view(apps, None)
    migration.grant_event_view(apps, None)
    response = client.get("/api/ops/security-events/")
    assert response.status_code == 200, response.data
    assert client.post("/api/ops/security-events/", {}, format="json").status_code == 403
    assert set(RolePermission.objects.filter(role_code_id="OPS_READER").values_list(
        "permission_code_id", flat=True
    )) == {"object.view", "duty.view", "event.view"}


def test_migration_does_not_resurrect_removed_observer_role():
    Permission.objects.get_or_create(code="event.view", defaults={"name": "Просмотр ОМ"})
    migration.grant_event_view(apps, None)
    assert not Role.objects.filter(code="OPS_READER").exists()


def test_reverse_migration_removes_only_observer_event_view():
    client_for("observer-reverse-1087", "OPS_READER", perms=("object.view", "duty.view"))
    Permission.objects.get_or_create(code="event.view", defaults={"name": "Просмотр ОМ"})
    migration.grant_event_view(apps, None)

    migration.revoke_event_view(apps, None)

    assert set(RolePermission.objects.filter(role_code_id="OPS_READER").values_list(
        "permission_code_id", flat=True
    )) == {"object.view", "duty.view"}
