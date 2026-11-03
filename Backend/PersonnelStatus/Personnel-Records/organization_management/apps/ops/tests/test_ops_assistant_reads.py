"""Explicit reads reuse the existing scoped directory, never expose private fields."""
import pytest
from organization_management.apps.core.tests.test_service_employees_api import people
from organization_management.apps.ops.tests.test_ops_assistant_api import jwt_actor
from organization_management.apps.ops.tests.test_ops_assistant_answers import ask
from organization_management.apps.ops.assistant import provider

pytestmark = pytest.mark.django_db


def test_directory_read_filters_before_count_and_pagination(people, monkeypatch):
    root, child, foreign, rows = people
    api, _ = jwt_actor("read-directory", ("personnel.view",), root.pk)
    monkeypatch.setattr(provider, "answer_from_context", lambda *a: pytest.fail("Personal records reached LLM"), raising=False)
    data = ask(api, "Покажи доступных сотрудников", conversationToken=None).json()
    assert data["mode"] == "data" and data["readOnly"]["count"] == 2
    assert len(data["readOnly"]["rows"]) == 2
    assert all(row["id"] in {rows[0].pk, rows[1].pk} for row in data["readOnly"]["rows"])
    assert "PRIVATE" not in str(data) and "personal_phone" not in str(data)
    assert "current_status" not in str(data) and "iin" not in str(data)


def test_own_profile_and_plain_employee_cannot_read_foreign_records(people):
    root, child, foreign, rows = people
    api, actor = jwt_actor("read-own", ("profile.view",))
    rows[0].user = actor; rows[0].save(update_fields=["user"])
    data = ask(api, "Покажи мой профиль", conversationToken=None).json()
    assert data["mode"] == "data" and data["readOnly"]["rows"][0]["id"] == rows[0].pk
    directory = ask(api, "Покажи доступных сотрудников", conversationToken=None).json()
    assert directory["readOnly"]["count"] == 1
    assert directory["readOnly"]["rows"][0]["id"] == rows[0].pk
    _, new_actor = jwt_actor("read-own-absent", ("profile.view",))
    no_link, _ = jwt_actor("read-own-none", ("profile.view",))
    absent = ask(no_link, "Покажи мой профиль", conversationToken=None).json()
    assert absent["readOnly"]["rows"] == [] and "не найдена" in absent["answer"]


def test_read_commands_do_not_accept_arbitrary_id_or_division(people, monkeypatch):
    from organization_management.apps.ops.assistant.reads import resolve_read
    assert resolve_read("Покажи доступных сотрудников") == ("directory", 1)
    assert resolve_read("Покажи доступных сотрудников страница 2") == ("directory", 2)
    for text in ["Покажи доступных сотрудников division=999", "Покажи мой профиль 999", "SELECT * FROM employees", "Покажи доступных сотрудников страница 1001"]:
        assert resolve_read(text) is None


def test_reading_does_not_put_personal_records_into_model_history(people, monkeypatch):
    root, child, foreign, rows = people
    api, actor = jwt_actor("read-history", ("profile.view",))
    rows[0].user = actor; rows[0].save(update_fields=["user"])
    first = ask(api, "Покажи мой профиль", conversationToken=None).json()
    def generate(message, turns, chunks, context):
        assert turns == []
        return {"answer": "Откройте профиль.", "sourceIds": [chunks[0]["id"]], "needsClarification": False}
    monkeypatch.setattr(provider, "answer_from_context", generate, raising=False)
    assert ask(api, "Как открыть профиль?", conversationToken=first["conversationToken"]).status_code == 200
