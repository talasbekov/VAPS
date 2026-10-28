"""Explicit probes record redacted evidence, never connectivity of another draft."""
import json
from datetime import datetime, timedelta
from urllib.error import URLError

import pytest
from django.apps import apps
from django.test import override_settings
from django.utils import timezone
from django.views.debug import SafeExceptionReporterFilter

from organization_management.apps.ops.assistant import connection, provider
from organization_management.apps.ops.tests.test_ops_assistant_settings import answer, draft
from organization_management.apps.operations.tests.test_bulk_status_api import client_for

pytestmark = pytest.mark.django_db
URL = "/api/ops/assistant-settings/"
DIAGNOSTICS = "/api/ops/system-diagnostics/"


@pytest.fixture
def api():
    return client_for("probe_history_admin", "PROBE_HISTORY_ADMIN", ("settings.manage",))[0]


def history():
    return apps.get_model("operations", "OpsAssistantConnectionCheck")


def test_draft_probe_records_only_redacted_evidence(api, monkeypatch):
    answer(monkeypatch)
    response = api.post(URL + "check/", draft(api, apiKey="PRIVATE KEY"), format="json")
    assert response.status_code == 200 and response.json()["ok"] is True
    check = history().objects.get()
    assert check.checked_at
    assert check.succeeded is True
    assert check.model == "local-model"
    assert check.checked_saved_revision is None
    assert not {"api_key", "base_url", "error", "payload", "actor"} & {field.name for field in history()._meta.fields}
    result = api.get(DIAGNOSTICS).json()["ai"]["last_check"]
    assert result["configuration_match"] == "draft"
    assert result["succeeded"] is True


def test_saved_config_probe_is_current_until_next_save(api, monkeypatch):
    saved = api.put(URL, draft(api, apiKey="PRIVATE KEY"), format="json")
    assert saved.status_code == 200
    answer(monkeypatch)
    assert api.post(URL + "check/", draft(api), format="json").json()["ok"] is True
    check = history().objects.get()
    assert check.checked_saved_revision == saved.json()["revision"]
    assert api.get(DIAGNOSTICS).json()["ai"]["last_check"]["configuration_match"] == "current"
    assert api.put(URL, draft(api, model="new-model"), format="json").status_code == 200
    assert api.get(DIAGNOSTICS).json()["ai"]["last_check"]["configuration_match"] == "previous"


@pytest.mark.parametrize("change", [{"model": "other-model"}, {"baseUrl": "http://10.1.2.3:8000/other"}, {"apiKey": "OTHER KEY"}, {"clearKey": True}, {"provider": "ollama"}])
def test_draft_difference_never_validates_saved_configuration(api, monkeypatch, change):
    assert api.put(URL, draft(api, apiKey="PRIVATE KEY"), format="json").status_code == 200
    answer(monkeypatch, protocol=change.get("provider", "openai"))
    assert api.post(URL + "check/", draft(api, **change), format="json").json()["ok"] is True
    assert history().objects.get().checked_saved_revision is None
    assert api.get(DIAGNOSTICS).json()["ai"]["last_check"]["configuration_match"] == "draft"


def test_concurrent_save_during_probe_marks_old_check_previous(api, monkeypatch):
    assert api.put(URL, draft(api), format="json").status_code == 200
    before = api.get(URL).json()["revision"]
    def concurrent_change(_draft):
        assert api.put(URL, draft(api, model="changed-during-probe"), format="json").status_code == 200
    monkeypatch.setattr(provider, "check_connection", concurrent_change)
    assert api.post(URL + "check/", draft(api), format="json").json()["ok"] is True
    assert history().objects.get().checked_saved_revision == before
    assert api.get(DIAGNOSTICS).json()["ai"]["last_check"]["configuration_match"] == "previous"


def test_failed_probe_records_fixed_result_without_transport_secret(api, monkeypatch):
    def broken(*args, **kwargs):
        raise URLError("PRIVATE REMOTE TEXT")
    monkeypatch.setattr(provider, "urlopen", broken)
    response = api.post(URL + "check/", draft(api, apiKey="PRIVATE KEY"), format="json")
    assert response.json()["ok"] is False
    check = history().objects.get()
    assert check.succeeded is False
    assert "PRIVATE" not in json.dumps(list(history().objects.values()), default=str)
    result = api.get(DIAGNOSTICS)
    assert b"PRIVATE" not in result.content
    assert result.json()["ai"]["last_check"]["succeeded"] is False


def test_rejected_probe_does_not_create_history(api):
    response = api.post(URL + "check/", draft(api, model=""), format="json")
    assert response.status_code == 400
    assert not history().objects.exists()


def test_probe_evidence_is_timestamped_after_completion_and_latest_failure_wins(api, monkeypatch):
    earlier = timezone.now() - timedelta(minutes=1)
    finished = []
    history().objects.create(checked_at=earlier, succeeded=True, provider="openai", model="previous-success")
    def failed_probe(_config):
        finished.append(timezone.now())
        raise provider.ProviderUnavailable("Проверка завершилась ошибкой.")
    monkeypatch.setattr(provider, "check_connection", failed_probe)
    response = api.post(URL + "check/", draft(api), format="json")
    assert response.json()["ok"] is False
    result = api.get(DIAGNOSTICS).json()["ai"]["last_check"]
    assert finished[0] <= datetime.fromisoformat(result["checked_at"]) <= timezone.now()
    assert result["succeeded"] is False
    assert result["model"] == "local-model"


@override_settings(DEBUG=False)
def test_failed_probe_history_write_redacts_credentials_in_exception_report(api, monkeypatch):
    answer(monkeypatch)
    def unavailable_history(**kwargs):
        raise RuntimeError("SYNTHETIC history store unavailable")
    monkeypatch.setattr(history().objects, "create", unavailable_history)
    with pytest.raises(RuntimeError) as caught:
        api.post(URL + "check/", draft(api, apiKey="SYNTHETIC-PRIVATE-KEY"), format="json")
    traceback = caught.value.__traceback__
    frames = []
    while traceback:
        frame = traceback.tb_frame
        if frame.f_code.co_name == "post" and frame.f_globals.get("__name__", "").endswith("views_assistant_settings"):
            frames.append(frame)
        traceback = traceback.tb_next
    assert frames, "The actual settings check view must be exercised"
    reporter = SafeExceptionReporterFilter()
    for frame in frames:
        request = frame.f_locals["request"]._request
        filtered = dict(reporter.get_traceback_frame_variables(request, frame))
        assert "SYNTHETIC-PRIVATE-KEY" not in repr(filtered)


@override_settings(DEBUG=False)
@pytest.mark.parametrize("operation", ["interpret", "check_connection"])
def test_unexpected_provider_failure_redacts_every_credential_bearing_frame(api, monkeypatch, operation):
    secret = "SYNTHETIC-WRAPPER-PRIVATE-KEY"
    assert api.put(URL, draft(api, apiKey=secret), format="json").status_code == 200
    def unexpected_transport(*args, **kwargs):
        raise RuntimeError("SYNTHETIC unexpected transport failure")
    monkeypatch.setattr(provider, "urlopen", unexpected_transport)
    with pytest.raises(RuntimeError) as caught:
        if operation == "interpret":
            provider.interpret("Подготовь мероприятие")
        else:
            provider.check_connection(connection.configuration())
    traceback = caught.value.__traceback__
    frames = []
    while traceback:
        frame = traceback.tb_frame
        if frame.f_globals.get("__name__", "").startswith("organization_management.apps.ops.assistant."):
            frames.append(frame)
        traceback = traceback.tb_next
    assert operation in {frame.f_code.co_name for frame in frames}
    reporter = SafeExceptionReporterFilter()
    filtered = [(frame.f_code.co_name, dict(reporter.get_traceback_frame_variables(None, frame))) for frame in frames]
    assert secret not in repr(filtered)
