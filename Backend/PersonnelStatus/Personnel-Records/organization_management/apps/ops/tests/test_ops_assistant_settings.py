"""Actual JWT settings lifecycle; only the model transport is replaced."""
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from urllib.error import HTTPError, URLError

import pytest
from django.apps import apps
from django.contrib import admin
from django.db import close_old_connections
from urllib.request import Request
from rest_framework.test import APIClient

from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.ops.assistant import connection, provider
from organization_management.apps.ops.tests.test_ops_assistant_api import jwt_actor
from organization_management.apps.ops.tests.test_ops_forces_gathering import make_department

pytestmark = pytest.mark.django_db
URL = "/api/ops/assistant-settings/"
SECRET = "test-only-secret-token"
PROPOSAL = {"title": None, "businessDate": None, "kind": None, "objectName": None,
            "eventCode": None, "intent": "prepare", "allocations": []}


def connection_model():
    return apps.get_model("operations", "OpsAssistantConnection")


@pytest.fixture
def administrator():
    return jwt_actor("connection_admin", ("settings.manage",))[0]


def draft(api, **extra):
    response = api.get(URL)
    assert response.status_code == 200, response.content
    return {"provider": "openai", "baseUrl": "http://10.1.2.3:8000/v1", "model": "local-model",
            "revision": response.json()["revision"], **extra}


def answer(monkeypatch, value=None, protocol="openai", finish="stop"):
    proposal = PROPOSAL if value is None else value
    envelope = ({"choices": [{"finish_reason": finish, "message": {"role": "assistant", "content": json.dumps(proposal)}}]}
                if protocol == "openai" else {"done": True, "done_reason": finish, "message": {"content": json.dumps(proposal)}})
    monkeypatch.setattr(provider, "urlopen", lambda *_a, **_k: BytesIO(json.dumps(envelope).encode()))


def test_read_does_not_initialize_database_or_return_secret(administrator, settings):
    settings.OPS_ASSISTANT_PROVIDER = "disabled"
    data = administrator.get(URL)
    assert data.status_code == 200, data.content
    assert data.json() == {"provider": "disabled", "baseUrl": "", "model": "", "hasKey": False, "revision": "0"}
    assert connection_model().objects.count() == 0


@pytest.mark.parametrize("permissions,scoped", [((), False), (("event.create",), False), (("settings.manage",), True), (("*",), True)])
def test_department_and_ordinary_roles_cannot_read_save_or_probe(permissions, scoped):
    scope = make_department("Restricted").pk if scoped else None
    api, _ = jwt_actor("restricted", permissions, scope)
    for method, url in (("get", URL), ("put", URL), ("post", URL + "check/")):
        result = getattr(api, method)(url, {} if method != "get" else None, format="json")
        assert result.status_code == 403, result.content


def test_anonymous_is_denied_and_system_wildcard_is_allowed():
    assert APIClient().get(URL).status_code in (401, 403)
    api, _ = jwt_actor("system_admin", ("*",))
    assert api.get(URL).status_code == 200


def test_saved_key_is_write_only_and_updates_are_audited_and_revision_checked(administrator):
    data = draft(administrator, apiKey=SECRET)
    first = administrator.put(URL, data, format="json")
    assert first.status_code == 200, first.content
    assert first.json()["hasKey"] is True
    assert SECRET not in first.content.decode()
    assert set(first.json()) == {"provider", "baseUrl", "model", "hasKey", "revision"}
    assert first.json()["revision"] != data["revision"]
    assert administrator.put(URL, data, format="json").status_code == 409
    saved = connection_model().objects.get()
    assert saved.api_key != SECRET
    assert connection.configuration(saved)["apiKey"] == SECRET
    assert SECRET not in administrator.get(URL).content.decode()
    logs = list(OpsAuditLog.objects.filter(entity_type="assistant_connection").values())
    assert len(logs) == 1
    assert SECRET not in json.dumps(logs, default=str)
    admin_class = admin.site._registry.get(connection_model())
    assert admin_class is None or "api_key" not in admin_class.get_fields(None, saved)


def test_blank_key_preserves_same_origin_clear_removes_and_origin_change_requires_intent(administrator):
    assert administrator.put(URL, draft(administrator, apiKey=SECRET), format="json").status_code == 200
    same = draft(administrator, apiKey="", baseUrl="http://10.1.2.3:8000/v1/")
    assert administrator.put(URL, same, format="json").status_code == 200
    assert connection_model().objects.get().api_key != SECRET
    assert connection.configuration()["apiKey"] == SECRET
    changed = draft(administrator, baseUrl="http://10.9.9.9:8000/v1")
    assert administrator.put(URL, changed, format="json").status_code == 400
    assert administrator.post(URL + "check/", changed, format="json").status_code == 400
    cleared = administrator.put(URL, {**changed, "clearKey": True}, format="json")
    assert cleared.status_code == 200
    assert cleared.json()["hasKey"] is False
    assert connection_model().objects.get().api_key == ""


def test_probe_checks_json_without_saving_settings_or_audit(administrator, monkeypatch):
    answer(monkeypatch)
    result = administrator.post(URL + "check/", draft(administrator, apiKey=SECRET), format="json")
    assert result.status_code == 200, result.content
    assert result.json()["ok"] is True
    assert not connection_model().objects.exists()
    assert not OpsAuditLog.objects.filter(entity_type="assistant_connection").exists()


@pytest.mark.parametrize("address", ["file:///tmp/model", "ftp://10.0.0.1", "http://user:pass@10.0.0.1", "http://10.0.0.1?key=x", "http://10.0.0.1#x", "http://10.0.0.1:wrong", "http://10.0.0.1\n", "http://10.0.0.1/../v1"])
def test_unsafe_addresses_are_rejected_before_transport(administrator, monkeypatch, address):
    monkeypatch.setattr(provider, "urlopen", lambda *_a, **_k: pytest.fail("unsafe transport"))
    data = draft(administrator, baseUrl=address)
    assert administrator.put(URL, data, format="json").status_code == 400
    assert administrator.post(URL + "check/", data, format="json").status_code == 400


@pytest.mark.parametrize("protocol,address,path", [("openai", "http://model.intranet:8000/v1", "/v1/chat/completions"), ("openai", "https://10.1.2.3:8443", "/v1/chat/completions"), ("ollama", "http://10.1.2.3:11434", "/api/chat")])
def test_saved_provider_uses_protocol_authentication_and_grounding(administrator, monkeypatch, protocol, address, path):
    result = administrator.put(URL, draft(administrator, provider=protocol, baseUrl=address, apiKey=SECRET), format="json")
    assert result.status_code == 200, result.content
    captured = {}
    def respond(request, timeout):
        captured.update(json.loads(request.data))
        assert request.full_url == (address[:-3] if address.endswith("/v1") else address) + path
        assert request.get_header("Authorization") == "Bearer " + SECRET
        assert 0 < timeout <= 55
        content = json.dumps({**PROPOSAL, "title": "Invented title", "intent": "send"})
        envelope = ({"choices": [{"finish_reason": "stop", "message": {"content": content}}]} if protocol == "openai"
                    else {"done": True, "done_reason": "stop", "message": {"content": content}})
        return BytesIO(json.dumps(envelope).encode())
    monkeypatch.setattr(provider, "urlopen", respond)
    proposal = provider.interpret("Подготовь мероприятие")
    assert proposal["title"] is None and proposal["intent"] == "prepare"
    assert captured["model"] == "local-model" and captured["stream"] is False
    assert "tools" not in captured
    assert provider.provider_configuration() == {"enabled": True, "provider": protocol, "model": "local-model"}


@pytest.mark.parametrize("content,finish", [({}, "stop"), ([], "stop"), (PROPOSAL, "length"), (PROPOSAL, "tool_calls"), (PROPOSAL, None)])
def test_probe_rejects_missing_invalid_or_truncated_extraction(administrator, monkeypatch, content, finish):
    answer(monkeypatch, content, finish=finish)
    result = administrator.post(URL + "check/", draft(administrator), format="json")
    assert result.status_code == 200
    assert result.json()["ok"] is False
    assert not connection_model().objects.exists()


def test_transport_failure_never_echoes_key_or_response_body(administrator, monkeypatch):
    def broken(*_args, **_kwargs):
        raise URLError(SECRET + " private response body")
    monkeypatch.setattr(provider, "urlopen", broken)
    result = administrator.post(URL + "check/", draft(administrator, apiKey=SECRET), format="json")
    assert result.status_code == 200 and result.json()["ok"] is False
    assert SECRET not in result.content.decode() and "private response" not in result.content.decode()


@pytest.mark.parametrize("payload", [b"x" * 32769, b"{broken json", b'{"choices": [null]}', b'{"choices": [{"finish_reason":"stop","message":null}]}'])
def test_unusable_envelopes_fail_closed(administrator, monkeypatch, payload):
    monkeypatch.setattr(provider, "urlopen", lambda *_a, **_k: BytesIO(payload))
    response = administrator.post(URL + "check/", draft(administrator), format="json")
    assert response.status_code == 200 and response.json()["ok"] is False


def test_ollama_false_completion_is_rejected_even_with_stop_reason(administrator, monkeypatch):
    envelope = {"done": False, "done_reason": "stop", "message": {"content": json.dumps(PROPOSAL)}}
    monkeypatch.setattr(provider, "urlopen", lambda *_a, **_k: BytesIO(json.dumps(envelope).encode()))
    response = administrator.post(URL + "check/", draft(administrator, provider="ollama"), format="json")
    assert response.status_code == 200 and response.json()["ok"] is False


def test_probe_stale_revision_fails_before_network_and_invalid_save_leaves_no_row(administrator, monkeypatch):
    monkeypatch.setattr(provider, "urlopen", lambda *_a, **_k: pytest.fail("stale transport"))
    invalid = draft(administrator, model="")
    assert administrator.put(URL, invalid, format="json").status_code == 400
    assert not connection_model().objects.exists()
    saved = administrator.put(URL, draft(administrator), format="json")
    assert saved.status_code == 200
    stale = {**invalid, "model": "other"}
    assert administrator.post(URL + "check/", stale, format="json").status_code == 409
    assert connection_model().objects.get().model == "local-model"


def test_real_transport_ignores_proxy_and_does_not_follow_redirects(monkeypatch):
    seen = []
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            seen.append((self.path, self.headers.get("Authorization")))
            self.rfile.read(int(self.headers.get("Content-Length", 0)))
            if self.path == "/redirect":
                self.send_response(307)
                self.send_header("Location", "/should-never-receive-secret")
            else:
                self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{}')

        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        monkeypatch.setenv("http_proxy", "http://127.0.0.1:1")
        monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:1")
        monkeypatch.setenv("no_proxy", "")
        monkeypatch.setenv("NO_PROXY", "")
        base = f"http://127.0.0.1:{server.server_port}"
        with provider.urlopen(Request(base + "/normal", data=b'{}', headers={"Authorization": "Bearer " + SECRET}), timeout=2) as response:
            assert response.read() == b'{}'
        with pytest.raises(URLError):
            provider.urlopen(Request(base + "/redirect", data=b'{}', headers={"Authorization": "Bearer " + SECRET}), timeout=2)
        assert seen == [("/normal", "Bearer " + SECRET), ("/redirect", "Bearer " + SECRET)]
    finally:
        server.shutdown()
        worker.join(timeout=2)
        server.server_close()


@pytest.mark.django_db(transaction=True)
def test_concurrent_initial_saves_have_one_winner(administrator):
    data = draft(administrator)
    barrier = threading.Barrier(2)
    def write(model):
        api = APIClient()
        api.credentials(**administrator._credentials)
        try:
            barrier.wait(timeout=5)
            return api.put(URL, {**data, "model": model}, format="json").status_code
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, ["first", "second"]))
    assert sorted(results) == [200, 409]
    assert connection_model().objects.count() == 1
    assert OpsAuditLog.objects.filter(entity_type="assistant_connection").count() == 1


def test_full_openai_endpoint_and_schema_support_longer_extractions(administrator, monkeypatch):
    endpoint = "http://model.intranet:8000/custom/v1/chat/completions"
    def respond(request, timeout):
        assert request.full_url == endpoint
        body = json.loads(request.data)
        assert body["response_format"]["type"] == "json_schema"
        schema = body["response_format"]["json_schema"]["schema"]
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == set(schema["properties"])
        assert 2000 <= body["max_tokens"] <= 4096
        return BytesIO(json.dumps({"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(PROPOSAL)}}]}).encode())
    monkeypatch.setattr(provider, "urlopen", respond)
    result = administrator.post(URL + "check/", draft(administrator, baseUrl=endpoint), format="json")
    assert result.status_code == 200 and result.json()["ok"] is True


@pytest.mark.parametrize("failure,expected", [(401, "ключ"), (403, "ключ"), (404, "путь"), (429, "повторите"), (302, "перенаправ"), (500, "ошибку"), ("timeout", "время"), ("network", "связаться")])
def test_check_explains_safe_failure_category(administrator, monkeypatch, failure, expected):
    def broken(*_args, **_kwargs):
        if isinstance(failure, int):
            raise HTTPError("http://model.test", failure, SECRET, {}, BytesIO(SECRET.encode()))
        if failure == "timeout":
            raise TimeoutError(SECRET)
        raise URLError(SECRET)
    monkeypatch.setattr(provider, "urlopen", broken)
    response = administrator.post(URL + "check/", draft(administrator, apiKey=SECRET), format="json")
    assert response.status_code == 200 and response.json()["ok"] is False
    assert expected in response.json()["message"].lower()
    assert SECRET not in response.content.decode()
