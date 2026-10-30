"""New protocol is additive; documentation dialogue cannot execute writes."""
import json
import pytest
from organization_management.apps.ops.assistant import provider
from organization_management.apps.ops.tests.test_ops_assistant_answers import ask
from organization_management.apps.ops.tests.test_ops_assistant_api import jwt_actor, URL
from organization_management.apps.operations.models_assistant import OpsAssistantTask, OpsAssistantReceipt
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models import UserRole

pytestmark = pytest.mark.django_db


def generated(message, turns, chunks, context):
    return {"answer": "Откройте свой профиль и проверьте доступные назначения.", "sourceIds": [chunks[0]["id"]], "needsClarification": False}


def test_conversational_answer_is_scoped_and_has_verified_sources(monkeypatch):
    seen = []
    def generate(message, turns, chunks, context):
        seen.append((message, turns, chunks, context))
        assert not any(row["id"] in {"guide_users", "headquarters"} for row in chunks)
        return generated(message, turns, chunks, context)
    monkeypatch.setattr(provider, "answer_from_context", generate, raising=False)
    api, _ = jwt_actor("dialogue-personal", ("profile.view",))
    first = ask(api, "Как открыть профиль?", conversationToken=None)
    assert first.status_code == 200, first.content
    body = first.json()
    assert body["mode"] == "llm" and body["sources"] and body["conversationToken"]
    second = ask(api, "А где назначения?", conversationToken=body["conversationToken"])
    assert second.status_code == 200
    assert seen[1][1] == [{"question": "Как открыть профиль?", "answer": body["answer"]}]
    assert api.get(URL).status_code == 403
    assert not OpsAssistantTask.objects.exists() and not OpsAssistantReceipt.objects.exists() and not OpsSecurityEvent.objects.exists()


@pytest.mark.parametrize("bad", [
    {"answer": "Я создал мероприятие.", "sourceIds": ["guide_profile"], "needsClarification": False},
    {"answer": "Читайте https://external.invalid", "sourceIds": ["guide_profile"], "needsClarification": False},
    {"answer": "Доступ администратора.", "sourceIds": ["guide_users"], "needsClarification": False},
    {"answer": "x" * 8001, "sourceIds": ["guide_profile"], "needsClarification": False},
    {"answer": "Факт без источника", "sourceIds": [], "needsClarification": False},
    {"answer": "ok", "sourceIds": ["guide_profile"], "needsClarification": False, "action": "create"},
    {"answer": "Мероприятие создано. Поручение успешно отправлено.", "sourceIds": ["guide_profile"], "needsClarification": False},
    {"answer": "Сотрудник назначен. Изменения сохранены.", "sourceIds": ["guide_profile"], "needsClarification": False},
    {"answer": "The event has been created and the task sent.", "sourceIds": ["guide_profile"], "needsClarification": False},
], ids=["false-write", "external-url", "forbidden-source", "oversized", "unsourced", "action", "passive-write", "impersonal-write", "english-passive-write"])
def test_untrusted_model_output_falls_back_without_exposing_it(monkeypatch, bad):
    monkeypatch.setattr(provider, "answer_from_context", lambda *args: bad, raising=False)
    api, _ = jwt_actor("dialogue-invalid", ("profile.view",))
    data = ask(api, "Как открыть профиль?", conversationToken=None).json()
    assert data["mode"] == "documentation" and data["notice"]
    assert "external.invalid" not in data["answer"] and "Я создал" not in data["answer"]
    assert all(s["id"] != "guide_users" for s in data["sources"])
    if bad["answer"].startswith(("Мероприятие", "Сотрудник", "The event")):
        assert bad["answer"] not in data["answer"]


def test_inflight_revoked_authority_discards_generated_reply(monkeypatch):
    api, actor = jwt_actor("dialogue-revoked", ("event.view",))
    def generate(*args):
        UserRole.objects.filter(user_id=str(actor.pk)).update(is_active=False)
        return {"answer": "Реестр ОМ доступен.", "sourceIds": ["guide_events"], "needsClarification": False}
    monkeypatch.setattr(provider, "answer_from_context", generate, raising=False)
    assert ask(api, "Где реестр ОМ?", conversationToken=None).status_code == 409


def test_bad_history_resets_without_becoming_instructions(monkeypatch):
    def generate(message, turns, chunks, context):
        assert turns == []
        return generated(message, turns, chunks, context)
    monkeypatch.setattr(provider, "answer_from_context", generate, raising=False)
    api, _ = jwt_actor("dialogue-history", ("profile.view",))
    data = ask(api, "Где профиль?", conversationToken="forged").json()
    assert data["conversationReset"] is True and data["conversationToken"]
    assert ask(api, "Где профиль?", conversationToken=None, role="ADMIN").status_code == 400


def test_real_provider_uses_existing_settings_and_a_bounded_plain_json_request(settings, monkeypatch):
    settings.OPS_ASSISTANT_PROVIDER = "ollama"
    settings.OPS_ASSISTANT_MODEL = "existing-model"
    settings.OPS_ASSISTANT_OLLAMA_URL = "http://127.0.0.1:11434"
    captured = {}
    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self, limit):
            captured["readLimit"] = limit
            return json.dumps({"message": {"content": json.dumps({"answer": "Откройте профиль.", "sourceIds": ["guide_profile"], "needsClarification": False})}}).encode()
    def open_(request, timeout):
        captured.update(body=json.loads(request.data), url=request.full_url, timeout=timeout)
        return Response()
    monkeypatch.setattr(provider, "urlopen", open_)
    result = provider.answer_from_context("Где профиль?", [], [{"id": "guide_profile", "title": "Профиль", "text": "Откройте свой профиль."}], {"roles": [], "scopes": []})
    assert result["answer"] == "Откройте профиль."
    assert captured["url"] == "http://127.0.0.1:11434/api/chat"
    assert captured["body"]["model"] == "existing-model" and captured["body"]["stream"] is False
    assert captured["body"]["format"] == "json"
    assert len(json.dumps(captured["body"]["messages"], ensure_ascii=False).encode()) <= 6000


def test_disabled_provider_is_explicit_documentation_fallback(settings):
    settings.OPS_ASSISTANT_PROVIDER = "disabled"
    api, _ = jwt_actor("dialogue-disabled", ("profile.view",))
    data = ask(api, "Как открыть профиль?", conversationToken=None).json()
    assert data["mode"] == "documentation" and data["notice"]


def test_generation_budget_prioritizes_latest_completed_turn(settings, monkeypatch):
    from organization_management.apps.ops.assistant.knowledge import permitted_chunks
    from organization_management.apps.ops.assistant.retrieval import retrieve
    settings.OPS_ASSISTANT_PROVIDER = "ollama"
    prior = [{"question": "Как работать с рекогносцировкой мероприятия?", "answer": "Выберите объект и этап рекогносцировки."}]
    chunks = [{"id": r.id, "title": r.title, "text": r.text} for r in retrieve("А дальше что?", prior, permitted_chunks({"*"}, {"*"}))]
    captured = {}
    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self, limit): return json.dumps({"message": {"content": json.dumps({"answer": "Уточните задачу.", "sourceIds": [], "needsClarification": True})}}).encode()
    def open_(request, timeout):
        captured.update(json.loads(request.data))
        return Response()
    monkeypatch.setattr(provider, "urlopen", open_)
    provider.answer_from_context("А дальше что?", prior, chunks, {"roles": [], "scopes": []})
    context = json.loads(captured["messages"][1]["content"])
    assert context["conversation"] == prior
    assert len(json.dumps(captured["messages"], ensure_ascii=False).encode()) <= 6000
