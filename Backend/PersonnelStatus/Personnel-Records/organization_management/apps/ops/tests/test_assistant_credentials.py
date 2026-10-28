"""API and maintenance lifecycle for authenticated credential storage."""
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.operations.models_assistant_connection import OpsAssistantConnection
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.ops.assistant import connection, provider
from organization_management.apps.ops.tests.test_ops_assistant_settings import administrator, draft, URL, SECRET  # noqa: F401

pytestmark = pytest.mark.django_db


def test_new_key_is_encrypted_in_database_and_still_usable(administrator):
    response = administrator.put(URL, draft(administrator, apiKey=SECRET), format='json')
    assert response.status_code == 200
    row = OpsAssistantConnection.objects.get()
    assert row.api_key != SECRET
    assert row.api_key_format == 'fernet-v1'
    assert connection.configuration()['apiKey'] == SECRET
    assert SECRET not in administrator.get(URL).content.decode()


def test_legacy_plaintext_is_read_without_read_side_effect_and_upgraded_on_save(administrator):
    row = OpsAssistantConnection.objects.create(provider='openai', base_url='http://model.local/v1', model='test', api_key=SECRET)
    assert connection.configuration()['apiKey'] == SECRET
    row.refresh_from_db()
    assert row.api_key == SECRET
    response = administrator.put(URL, draft(administrator, baseUrl=row.base_url, apiKey=''), format='json')
    assert response.status_code == 200
    row.refresh_from_db()
    assert row.api_key != SECRET
    assert connection.configuration()['apiKey'] == SECRET


def test_tampered_key_is_not_transmitted_and_can_be_explicitly_replaced(administrator, monkeypatch):
    assert administrator.put(URL, draft(administrator, apiKey=SECRET), format='json').status_code == 200
    OpsAssistantConnection.objects.update(api_key='damaged-ciphertext')
    shown = administrator.get(URL)
    assert shown.status_code == 200 and shown.json()['hasKey']
    assert shown.json()['keyError']
    assert 'damaged-ciphertext' not in shown.content.decode()
    monkeypatch.setattr(provider, 'urlopen', lambda *a, **kw: pytest.fail('Unreadable credentials must not be sent'))
    with pytest.raises(provider.ProviderUnavailable):
        provider.interpret('Подготовь мероприятие')
    unchanged = administrator.put(URL, draft(administrator, apiKey=''), format='json')
    assert unchanged.status_code == 400
    fixed = administrator.put(URL, draft(administrator, apiKey='replacement-test-key'), format='json')
    assert fixed.status_code == 200
    assert connection.configuration()['apiKey'] == 'replacement-test-key'


def test_wrong_key_can_be_cleared_without_decryption(administrator, settings):
    settings.SECRET_KEY = 'first-test-server-secret'
    assert administrator.put(URL, draft(administrator, apiKey=SECRET), format='json').status_code == 200
    settings.SECRET_KEY = 'second-test-server-secret'
    settings.SECRET_KEY_FALLBACKS = []
    response = administrator.put(URL, draft(administrator, clearKey=True), format='json')
    assert response.status_code == 200
    assert not response.json()['hasKey']
    assert OpsAssistantConnection.objects.get().api_key == ''


def test_rotation_dry_run_preserves_bytes_then_apply_preserves_secret_and_revision(administrator, settings):
    settings.SECRET_KEY = 'previous-test-server-secret'
    assert administrator.put(URL, draft(administrator, apiKey=SECRET), format='json').status_code == 200
    row = OpsAssistantConnection.objects.get()
    original, revision = row.api_key, row.revision
    settings.SECRET_KEY = 'next-test-server-secret'
    settings.SECRET_KEY_FALLBACKS = ['previous-test-server-secret']
    assert connection.configuration()['apiKey'] == SECRET
    output = StringIO()
    call_command('rotate_assistant_credentials', stdout=output)
    row.refresh_from_db()
    assert row.api_key == original
    call_command('rotate_assistant_credentials', apply=True, stdout=output)
    row.refresh_from_db()
    assert row.api_key != original and row.revision == revision
    settings.SECRET_KEY_FALLBACKS = []
    assert connection.configuration()['apiKey'] == SECRET
    assert SECRET not in output.getvalue() and original not in output.getvalue()


def test_maintenance_does_not_replace_unreadable_key(administrator, settings):
    assert administrator.put(URL, draft(administrator, apiKey=SECRET), format='json').status_code == 200
    original = OpsAssistantConnection.objects.get().api_key
    settings.SECRET_KEY = 'unrelated-server-secret'
    settings.SECRET_KEY_FALLBACKS = []
    with pytest.raises(CommandError):
        call_command('rotate_assistant_credentials', apply=True, stdout=StringIO())
    assert OpsAssistantConnection.objects.get().api_key == original


def test_dedicated_key_ring_encrypts_with_first_and_rotates_from_old(administrator, settings):
    from cryptography.fernet import Fernet
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    settings.OPS_ASSISTANT_CREDENTIAL_KEYS = old
    assert administrator.put(URL, draft(administrator, apiKey=SECRET), format='json').status_code == 200
    token = OpsAssistantConnection.objects.get().api_key
    assert Fernet(old.encode()).decrypt(token.encode()).decode() == SECRET
    settings.OPS_ASSISTANT_CREDENTIAL_KEYS = new + ',' + old
    call_command('rotate_assistant_credentials', apply=True, stdout=StringIO())
    settings.OPS_ASSISTANT_CREDENTIAL_KEYS = new
    rotated = OpsAssistantConnection.objects.get().api_key
    assert Fernet(new.encode()).decrypt(rotated.encode()).decode() == SECRET


def test_invalid_encryption_configuration_never_saves_plaintext(administrator, settings):
    settings.OPS_ASSISTANT_CREDENTIAL_KEYS = 'invalid-key'
    response = administrator.put(URL, draft(administrator, apiKey=SECRET), format='json')
    assert response.status_code == 400
    assert not OpsAssistantConnection.objects.exists()
    assert SECRET not in response.content.decode() and 'invalid-key' not in response.content.decode()


def test_clearing_unreadable_key_is_audited_as_key_change(administrator):
    assert administrator.put(URL, draft(administrator, apiKey=SECRET), format='json').status_code == 200
    OpsAssistantConnection.objects.update(api_key='damaged-ciphertext')
    response = administrator.put(URL, draft(administrator, clearKey=True), format='json')
    assert response.status_code == 200
    audit = OpsAuditLog.objects.filter(entity_type='assistant_connection').latest('created_at')
    assert audit.new_value['keyChanged'] is True


def test_probe_can_use_explicit_replacement_without_repairing_saved_key(administrator, monkeypatch):
    from organization_management.apps.operations.models_assistant_connection_check import OpsAssistantConnectionCheck
    assert administrator.put(URL, draft(administrator, apiKey=SECRET), format='json').status_code == 200
    OpsAssistantConnection.objects.update(api_key='damaged-ciphertext')
    captured = []
    monkeypatch.setattr(provider, 'check_connection', lambda config: captured.append(config['apiKey']))
    response = administrator.post(URL + 'check/', draft(administrator, apiKey='replacement-test-key'), format='json')
    assert response.status_code == 200 and response.json()['ok']
    assert captured == ['replacement-test-key']
    assert OpsAssistantConnection.objects.get().api_key == 'damaged-ciphertext'
    assert OpsAssistantConnectionCheck.objects.get().checked_saved_revision is None
