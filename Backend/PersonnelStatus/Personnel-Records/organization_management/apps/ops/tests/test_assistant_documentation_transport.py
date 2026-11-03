"""Documentation dialogue uses the saved provider without sending business records."""
import io
import json
from urllib.error import HTTPError

import pytest

from organization_management.apps.ops.assistant import connection, provider


def configured(monkeypatch, kind, origin):
    monkeypatch.setattr(connection, "configuration", lambda **kwargs: {
        "provider": kind, "baseUrl": origin, "model": "synthetic-doc-model",
        "apiKey": "synthetic-doc-key", "environmentOnly": False,
    })


@pytest.mark.parametrize("kind,origin,endpoint", [
    ("ollama", "http://model.intranet:11434", "http://model.intranet:11434/api/chat"),
    ("openai", "https://model.intranet", "https://model.intranet/v1/chat/completions"),
    ("openai", "https://model.intranet/v1", "https://model.intranet/v1/chat/completions"),
    ("openai", "https://model.intranet/v1/chat/completions", "https://model.intranet/v1/chat/completions"),
])
@pytest.mark.parametrize("operation", ["answer", "select"])
def test_saved_provider_routes_documentation_with_its_model_and_key(monkeypatch, kind, origin, endpoint, operation):
    configured(monkeypatch, kind, origin)
    assert callable(getattr(provider, "answer_from_context", None))
    assert callable(getattr(provider, "select_documentation", None))
    result = {"answer": "Справочный ответ", "sourceIds": ["known"], "needsClarification": False} if operation == "answer" else {"excerptIds": ["known"]}
    calls = []

    def transport(request, timeout):
        body = json.loads(request.data)
        calls.append((request, body, timeout))
        envelope = {"message": {"content": json.dumps(result)}, "done": True, "done_reason": "stop"} if kind == "ollama" else {
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(result)}}],
        }
        return io.BytesIO(json.dumps(envelope).encode())

    monkeypatch.setattr(provider, "urlopen", transport)
    docs = [{"id": "known", "title": "Расход", "text": "Инструкция по сдаче дня."}]
    if operation == "answer":
        assert provider.answer_from_context("Как сдать день?", [], docs, {}) == result
    else:
        assert provider.select_documentation("Как сдать день?", [], docs, {}) == ["known"]
    assert len(calls) == 1
    request, body, timeout = calls[0]
    assert request.full_url == endpoint
    assert request.get_header("Authorization") == "Bearer synthetic-doc-key"
    assert body["model"] == "synthetic-doc-model"
    assert timeout <= 55
    assert "Инструкция по сдаче дня" in json.dumps(body, ensure_ascii=False)
    assert "synthetic-doc-key" not in json.dumps(body)


@pytest.mark.parametrize("failure", ["truncated", "foreign_source", "http_secret", "malformed"])
def test_documentation_rejects_unverified_output_and_never_retains_transport_secrets(monkeypatch, failure):
    configured(monkeypatch, "openai", "https://model.intranet/v1")
    assert callable(getattr(provider, "answer_from_context", None))

    def transport(request, timeout):
        if failure == "http_secret":
            raise HTTPError(request.full_url, 401, "synthetic-doc-key", {}, io.BytesIO(b"synthetic-doc-key"))
        if failure == "malformed":
            return io.BytesIO(b"synthetic-doc-key not json")
        content = {"answer": "Ответ", "sourceIds": ["foreign" if failure == "foreign_source" else "known"], "needsClarification": False}
        return io.BytesIO(json.dumps({"choices": [{"finish_reason": "length" if failure == "truncated" else "stop", "message": {"content": json.dumps(content)}}]}).encode())

    monkeypatch.setattr(provider, "urlopen", transport)
    with pytest.raises(provider.ProviderUnavailable) as caught:
        provider.answer_from_context("Как?", [], [{"id": "known", "title": "Тема", "text": "Инструкция"}], {})
    assert "synthetic-doc-key" not in str(caught.value)
    assert caught.value.__cause__ is None
