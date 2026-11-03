"""Assistant diagnostics are visible without a credential or mutation bypass."""
import pytest
from django.contrib import admin
from django.contrib.auth.models import User
from django.urls import reverse

from organization_management.apps.operations.models_assistant import OpsAssistantMessage, OpsAssistantTask
from organization_management.apps.operations.models_assistant_connection import OpsAssistantConnection
from organization_management.apps.ops.assistant import credentials

pytestmark = pytest.mark.django_db


@pytest.fixture
def assistant_admin_client(client):
    user = User.objects.create_superuser("assistant-admin-review", password="synthetic-password")
    client.force_login(user)
    return client


def admin_url(model, view, *args):
    assert admin.site._registry.get(model) is not None, "Assistant diagnostics must be registered"
    return reverse(f"admin:{model._meta.app_label}_{model._meta.model_name}_{view}", args=args)


def connection_row(key_format="fernet-v1"):
    key = "synthetic-admin-credential"
    stored = credentials.seal(key) if key_format == "fernet-v1" else key
    return OpsAssistantConnection.objects.create(
        provider="ollama", base_url="http://model.local:11434", model="synthetic-admin-model",
        api_key=stored, api_key_format=key_format,
    ), key


def message_row():
    task = OpsAssistantTask.objects.create(
        initiated_by="synthetic-actor", request_key="admin-history", request_hash="a" * 64,
        message="Synthetic request",
    )
    return OpsAssistantMessage.objects.create(task=task, role="user", text="<script>synthetic-history</script>")


@pytest.mark.parametrize("key_format", ["plain", "fernet-v1"])
def test_connection_diagnostics_never_render_stored_or_plain_credentials(assistant_admin_client, key_format):
    row, key = connection_row(key_format)
    for view, args in [("changelist", ()), ("change", (row.pk,))]:
        response = assistant_admin_client.get(admin_url(OpsAssistantConnection, view, *args))
        assert response.status_code == 200
        assert b"synthetic-admin-model" in response.content
        assert key.encode() not in response.content
        assert row.api_key.encode() not in response.content
        assert b"api_key" not in response.content


@pytest.mark.parametrize("model", [OpsAssistantConnection, OpsAssistantMessage])
def test_assistant_diagnostics_refuse_add_change_and_delete(assistant_admin_client, model):
    row = connection_row()[0] if model is OpsAssistantConnection else message_row()
    original = dict(model.objects.filter(pk=row.pk).values().get())
    assert assistant_admin_client.get(admin_url(model, "add")).status_code == 403
    assert assistant_admin_client.post(admin_url(model, "change", row.pk),
                                       {"api_key": "replacement", "text": "overwritten", "model": "other"}).status_code == 403
    assert assistant_admin_client.post(admin_url(model, "delete", row.pk), {"post": "yes"}).status_code == 403
    assert dict(model.objects.filter(pk=row.pk).values().get()) == original


def test_message_history_opens_as_escaped_readonly_content(assistant_admin_client):
    row = message_row()
    response = assistant_admin_client.get(admin_url(OpsAssistantMessage, "change", row.pk))
    assert response.status_code == 200
    assert b"&lt;script&gt;synthetic-history&lt;/script&gt;" in response.content
    assert b"<script>synthetic-history</script>" not in response.content
    assert b'<textarea name="text"' not in response.content
