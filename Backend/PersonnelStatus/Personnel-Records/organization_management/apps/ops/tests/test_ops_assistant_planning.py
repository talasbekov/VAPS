"""Untrusted model text becomes a bounded proposal, never authority."""
import json
from datetime import date
from io import BytesIO
from urllib.error import URLError

import pytest
from django.test import override_settings

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.ops.assistant import planning, provider
from organization_management.apps.ops.tests.test_ops_security_events_api import make_object


def proposal(**kwargs):
    return {
        "title": "Встреча", "businessDate": "2026-10-25", "kind": "INTERNAL",
        "objectName": None, "eventCode": None, "allocations": [],
        "intent": "prepare", **kwargs,
    }


@pytest.mark.parametrize("value", [None, [], {"actor": "admin"}, proposal(url="/admin/"), proposal(objectId=6)])
def test_model_cannot_return_identity_endpoints_or_database_identifiers(value):
    with pytest.raises(planning.ProposalError):
        planning.validate_proposal(value)


@pytest.mark.parametrize("count", [True, 1.5, "2", 0, -1, 100001])
def test_count_is_a_bounded_positive_integer(count):
    with pytest.raises(planning.ProposalError):
        planning.validate_proposal(proposal(allocations=[{"departmentName": "Шестой департамент", "need": count}]))


def test_valid_proposal_keeps_unknown_fields_unknown():
    result = planning.validate_proposal({"intent": "prepare"})
    assert result["businessDate"] is None
    assert result["kind"] is None
    assert result["title"] is None
    assert result["allocations"] == []


@pytest.mark.parametrize("day", ["25.10.26", "2026-02-30", "завтра", "2026-10-25T08:00:00"])
def test_bad_or_unresolved_dates_are_rejected(day):
    with pytest.raises(planning.ProposalError):
        planning.validate_proposal(proposal(businessDate=day))


@pytest.mark.django_db
def test_names_resolve_to_real_records_without_deployment_constants():
    obj = make_object(code="AI-OBJ", name="Аккорда")
    department = Division.objects.create(name="Департамент №6", division_type="department")
    plan = planning.resolve_plan(proposal(objectName="аккорда", allocations=[{"departmentName": "Шестой департамент", "need": 6}]), actor_id="test")
    assert plan["objectId"] == str(obj.pk)
    assert plan["allocations"][0]["departmentId"] == str(department.pk)
    assert plan["allocations"][0]["need"] == 6
    assert plan["questions"] == []


@pytest.mark.django_db
def test_ambiguous_or_absent_names_produce_questions_and_no_chosen_id():
    make_object(code="AI-A", name="Аккорда")
    make_object(code="AI-B", name="Аккорда")
    plan = planning.resolve_plan(proposal(objectName="Аккорда", allocations=[{"departmentName": "Неведомый департамент", "need": 3}]), actor_id="test")
    assert plan["objectId"] is None
    assert not plan["allocations"]
    assert {q["field"] for q in plan["questions"]} == {"objectId", "allocations"}


@pytest.mark.django_db
def test_missing_bulletin_facts_are_questions_not_fabricated_defaults():
    plan = planning.resolve_plan({"intent": "prepare"}, actor_id="test")
    assert {q["field"] for q in plan["questions"]} >= {"title", "businessDate", "kind"}
    assert plan["objectId"] is None


@override_settings(OPS_ASSISTANT_PROVIDER="disabled")
@pytest.mark.django_db
def test_disabled_provider_is_explicit_and_never_calls_network(monkeypatch):
    monkeypatch.setattr(provider, "urlopen", lambda *_a, **_k: pytest.fail("network called"))
    with pytest.raises(provider.ProviderUnavailable):
        provider.interpret("Собери наряд")


@override_settings(OPS_ASSISTANT_PROVIDER="ollama", OPS_ASSISTANT_OLLAMA_URL="http://127.0.0.1:11434", OPS_ASSISTANT_MODEL="qwen2.5:7b")
@pytest.mark.django_db
def test_local_provider_uses_bounded_structured_output_and_business_clock(monkeypatch):
    captured = {}
    def respond(request, timeout):
        captured.update(json.loads(request.data))
        assert 0 < timeout <= 60
        assert request.full_url == "http://127.0.0.1:11434/api/chat"
        return BytesIO(json.dumps({"done": True, "message": {"content": json.dumps(proposal())}}).encode())
    monkeypatch.setattr(provider, "urlopen", respond)
    with clock.override(date(2026, 10, 21)):
        result = provider.interpret("Подготовь внутреннюю встречу25.10.2026")
    assert result["businessDate"] == "2026-10-25"
    assert captured["stream"] is False
    assert captured["format"]["additionalProperties"] is False
    assert "2026-10-21" in captured["messages"][0]["content"]
    assert all("employee" not in message["content"].lower() for message in captured["messages"])


@override_settings(OPS_ASSISTANT_PROVIDER="ollama", OPS_ASSISTANT_OLLAMA_URL="http://127.0.0.1:11434")
@pytest.mark.django_db
def test_network_or_malformed_model_response_is_a_safe_provider_error(monkeypatch):
    def broken(*_args, **_kwargs):
        raise URLError("private transport detail")
    monkeypatch.setattr(provider, "urlopen", broken)
    with pytest.raises(provider.ProviderUnavailable) as error:
        provider.interpret("Собери наряд")
    assert "private transport" not in str(error.value)
    monkeypatch.setattr(provider, "urlopen", lambda *_a, **_k: BytesIO(b'{"message":{"content":"not json"}}'))
    with pytest.raises(provider.ProviderUnavailable):
        provider.interpret("Собери наряд")


def test_unmentioned_model_facts_are_not_saved_as_bulletin_truth():
    hallucinated = proposal(title="Сбор наряда", businessDate="2026-10-25", eventCode="OM01", objectName="Аккорда", intent="send", allocations=[{"departmentName": "Второй департамент", "need": 1}])
    result = planning.ground_proposal("Я начальник второго департамента, собери наряд", hallucinated)
    assert result["title"] is None
    assert result["businessDate"] is None
    assert result["kind"] is None
    assert result["objectName"] is None
    assert result["eventCode"] is None
    assert result["intent"] == "prepare"
    assert result["allocations"] == []


def test_explicit_send_and_declined_send_do_not_depend_on_models_intent_guess():
    message = "Подготовь внутреннее мероприятие «Встреча»25.10.2026. Запроси4 человека во втором департаменте"
    result = planning.ground_proposal(message, proposal(intent="prepare"))
    assert result["intent"] == "send"
    assert result["title"] == "Встреча"
    assert result["businessDate"] == "2026-10-25"
    assert result["kind"] == "INTERNAL"
    assert planning.ground_proposal("Подготовь запросы, пока не отправляй", proposal(intent="send"))["intent"] == "prepare"


@pytest.mark.parametrize("name", ["во втором департаменте", "второго департамента", "2-й департамент", "Департамент №2"])
def test_department_ordinal_cases_resolve_to_one_catalog_key(name):
    assert planning.department_name_key(name) == "department:2"


def test_allocation_evidence_keeps_pairs_together_and_rejects_ambiguous_partial_sends():
    second = {"departmentName": "Второй департамент", "need": 4}
    sixth = {"departmentName": "Шестой департамент", "need": 6}
    cases = [
        ("Запроси 4 человека во втором департаменте", [second], True),
        ("Запроси во втором департаменте 4, в шестом 6", [second, sixth], True),
        ("Запроси во втором департаменте4 человека, в шестом6.", [second, sixth], True),
        ("Запроси четыре человека во втором департаменте и шесть в шестом", [second, sixth], True),
        ("Запроси из Департамента №2 — 4, из Департамента №6 — 6", [second, sixth], True),
        ("Запроси 4 из 2-го департамента, 6 из 6-го департамента", [second, sixth], True),
        ("Запроси 4 человека во втором департаменте", [sixth | {"need": 4}], False),
        ("Запроси во втором департаменте 4, в шестом 6", [second | {"need": 6}, sixth | {"need": 4}], False),
        ("Запроси во втором департаменте 4, в шестом 6", [second, {"departmentName": "Девятый департамент", "need": 6}], False),
        ("Запроси во втором департаменте 4, в шестом 6", [second], False),
        ("Я начальник второго департамента. Запроси 6 в шестом департаменте", [sixth], True),
        ("Я начальник второго департамента. Запроси 6 в шестом департаменте", [second | {"need": 6}], False),
        ("Запроси во втором департаменте 4 или 6", [second], False),
        ("Запроси во втором департаменте 4. Во втором департаменте 6", [second], False),
        ("Запроси во втором департаменте на 2026-10-04", [second], False),
        ("Запроси во втором департаменте 4 поста", [second], False),
    ]
    for index, (message, rows, expected) in enumerate(cases):
        ok = bool(planning.ground_proposal(message, {"intent": "send", "allocations": rows})["allocations"])
        assert ok == expected, (index, message, ok, expected)


@pytest.mark.parametrize("message,code,expected", [
    ("По ОМ-2028-12 запроси людей", "ОМ-2028-12", "ОМ-2028-12"),
    ("По ОМ-2028-12 запроси людей", "ОМ-2028-1", None),
    ("Подготовь мероприятие «ОМ-2028-12»", "ОМ-2028-12", None),
    ("Запроси людей по мероприятию LEGACY", "LEGACY", "LEGACY"),
    ("Код OM01, запроси людей", "OM01", "OM01"),
    ("На объекте OM01 подготовь наряд", "OM01", None),
    ("Подготовь мероприятие «Учебная проверка initial»", "initial", None),
])
def test_event_reference_requires_a_complete_code_outside_the_document_title(message, code, expected):
    assert planning.ground_proposal(message, {"eventCode": code})["eventCode"] == expected


def test_explicit_task_facts_survive_a_short_model_object_and_missing_model_fields():
    name = "Стенд: объект с готовым паспортом"
    message = f"собери наряд на объект {name} на 23 число 200 человек\n"
    with clock.override(date(2026, 10, 22)):
        result = planning.complete_explicit_proposal(message, {"objectName": "Стенд"}, object_names=["Стенд", name])
        result = planning.ground_proposal(message, result)
    assert result["objectName"] == name
    assert result["businessDate"] == "2026-10-23"
    assert result["personnelTotal"] == 200
    assert result["allocations"] == [] and result["title"] is None and result["kind"] is None
    assert result["intent"] == "prepare"


@pytest.mark.parametrize("value", [True, False, 1.5, "200", "", 0, -1, 100001])
def test_personnel_total_requires_a_bounded_integer_or_null(value):
    with pytest.raises(planning.ProposalError):
        planning.validate_proposal({"personnelTotal": value})


@pytest.mark.parametrize("value", [None, 1, 200, 100000])
def test_personnel_total_is_optional_and_independent_of_department_allocations(value):
    result = planning.validate_proposal({"personnelTotal": value})
    assert result["personnelTotal"] == value and result["allocations"] == []


@pytest.mark.parametrize("message,expected", [
    ("на 23 число", "2026-10-23"),
    ("на 21 число", None),
    ("на 32 число", None),
    ("на 23 или 24 число", None),
    ("на 23 число или на 24 число", None),
    ("не на 23 число", None),
    ("на 23 число, дата 2026-10-24", None),
    ("на 23 число, дата 23.10.2026", "2026-10-23"),
])
def test_day_of_month_never_rolls_or_silently_selects_conflicting_dates(message, expected):
    with clock.override(date(2026, 10, 22)):
        result = planning.complete_explicit_proposal(message, {"businessDate": "2026-10-23"}, object_names=[])
        assert planning.ground_proposal(message, result)["businessDate"] == expected


def test_day_of_month_rejects_a_day_not_present_in_the_current_month():
    with clock.override(date(2026, 2, 20)):
        assert planning.complete_explicit_proposal("на 30 число", {}, object_names=[])["businessDate"] is None


@pytest.mark.parametrize("message,expected", [
    ("Нужно 200 человек", 200),
    ("Нужно 200 сотрудников", 200),
    ("Всего 200 человек, во втором департаменте 4 человека", 200),
    ("На 23 число 200 человек", 200),
    ("200 постов по 3 часа", None),
    ("200 часов, 3 смены", None),
    ("не 200 человек", None),
    ("200 или 300 человек", None),
    ("200 человек или 300 человек", None),
    ("200 человек, нужно 300 человек", None),
    ("во втором департаменте 4 человека", None),
    ("4 человека из второго департамента", None),
    ("4 человека из второго, 6 из шестого", None),
    ("-200 человек", None),
    ("1.5 человека", None),
    ("100001 человек", None),
])
def test_only_an_unambiguous_standalone_people_total_is_completed(message, expected):
    result = planning.complete_explicit_proposal(message, {"personnelTotal": 200}, object_names=[])
    assert result["personnelTotal"] == expected and result["allocations"] == []


@pytest.mark.django_db
@pytest.mark.parametrize("message", ["не на объекте Альфа", "на объекте Альфа или Бета"])
def test_negated_or_alternative_catalog_names_require_manual_object_choice(message):
    make_object(code="AI-TEXT-A", name="Альфа")
    make_object(code="AI-TEXT-B", name="Бета")
    result = planning.complete_explicit_proposal(message, {"objectName": "Альфа"}, object_names=["Альфа", "Бета"])
    plan = planning.resolve_plan(result, actor_id="test")
    assert plan["objectId"] is None
    assert any(row["field"] == "objectId" for row in plan["questions"])


def test_unmentioned_model_total_and_catalog_prefix_do_not_become_explicit_facts():
    result = planning.complete_explicit_proposal("Собери наряд на объекте Альфа-2", {"objectName": "Альфа", "personnelTotal": 200}, object_names=["Альфа"])
    assert result["objectName"] != "Альфа" and result["personnelTotal"] is None


@pytest.mark.django_db
@pytest.mark.parametrize("message,model_name", [("Наряд на объекте Альфа-2", "Альфа"), ("Наряд на объекте Неизвестный", None)])
def test_a_missing_full_catalog_label_keeps_an_explicit_object_question(message, model_name):
    make_object(code="AI-TEXT-PREFIX", name="Альфа")
    result = planning.complete_explicit_proposal(message, {"objectName": model_name}, object_names=["Альфа"])
    plan = planning.resolve_plan(result, actor_id="test")
    assert plan["objectId"] is None
    assert any(row["field"] == "objectId" for row in plan["questions"])


def test_full_catalog_literal_preserves_existing_punctuation_equivalence():
    name = "Стенд: объект с готовым паспортом"
    message = "собери наряд на объект Стенд объект с готовым паспортом на 23 число 200 человек"
    result = planning.complete_explicit_proposal(message, {"objectName": "Стенд объект с готовым паспортом"}, object_names=["Стенд", name])
    assert result["objectName"] == name


def test_chief_context_is_not_a_department_recipient_for_the_standalone_total():
    message = "Я начальник второго департамента собери наряд на объект Аккорда на 23 число 200 человек"
    result = planning.complete_explicit_proposal(message, {}, object_names=["Аккорда"])
    assert result["personnelTotal"] == 200 and result["allocations"] == []
    assert not planning.personnel_total_requires_review(message)


def test_unknown_trailing_object_alternative_cannot_select_the_only_known_name():
    message = "Наряд на объект Альфа или Бета"
    result = planning.complete_explicit_proposal(message, {"objectName": "Альфа"}, object_names=["Альфа"])
    assert result["objectName"] and planning.normalized_name(result["objectName"]) != planning.normalized_name("Альфа")


def test_trailing_day_alternative_without_repeated_number_word_is_unresolved():
    message = "на 23 число или 24"
    with clock.override(date(2026, 10, 22)):
        result = planning.complete_explicit_proposal(message, {"businessDate": "2026-10-23"}, object_names=[])
        assert planning.ground_proposal(message, result)["businessDate"] is None


@pytest.mark.parametrize("message,expected", [
    ("на 23 октября", "2026-10-23"),
    ("на 23 ОКТЯБРЯ 2026 года", "2026-10-23"),
    ("на 2 ноября", "2026-11-02"),
    ("на 2 января 2027", "2027-01-02"),
    ("на 21 октября", None),
    ("на 2 января", None),
    ("на 31 ноября", None),
    ("не на 23 октября", None),
    ("на 23 или 24 октября", None),
    ("на 23 октября или 24", None),
    ("на 23 октября или на 24 октября", None),
    ("на 23 октября, дата 24.10.2026", None),
    ("на 23 октября, дата 23.10.2026", "2026-10-23"),
    ("на 23 октября, на 24 число", None),
    ("на 23 октября, завтра", "2026-10-23"),
    ("на 23 октября, сегодня", None),
])
def test_named_month_is_completed_without_a_model_and_conflicts_require_review(message, expected):
    with clock.override(date(2026, 10, 22)):
        result = planning.complete_explicit_proposal(message, {}, object_names=[])
        assert result["businessDate"] == expected
        assert planning.ground_proposal(message, result)["businessDate"] == expected


@pytest.mark.parametrize("phrase", ["на Аккорду", "на объект Аккорду", "в Аккорду"])
def test_accusative_object_name_is_resolved_to_its_full_catalog_label(phrase):
    message = f"наряд {phrase} на 23 октября 200 человек\n"
    with clock.override(date(2026, 10, 22)):
        result = planning.complete_explicit_proposal(message, {}, object_names=["Аккорда"])
        assert result["objectName"] == "Аккорда"
        assert planning.ground_proposal(message, result)["objectName"] == "Аккорда"


@pytest.mark.django_db
@pytest.mark.parametrize("phrase", ["не на Аккорду", "на Аккорду или Бету", "на Аккорду вместо Беты"])
def test_inflected_object_alternatives_are_never_silently_selected(phrase):
    make_object(code="AI-DECLINED", name="Аккорда")
    result = planning.complete_explicit_proposal(phrase, {}, object_names=["Аккорда"])
    plan = planning.resolve_plan(result, actor_id="test")
    assert plan["objectId"] is None
    assert any(row["field"] == "objectId" for row in plan["questions"])


@pytest.mark.django_db
def test_inflected_catalog_collision_requires_a_choice():
    make_object(code="AI-CASE-A", name="Аккорда")
    make_object(code="AI-CASE-U", name="Аккорду")
    result = planning.complete_explicit_proposal("наряд на Аккорду", {}, object_names=["Аккорда", "Аккорду"])
    plan = planning.resolve_plan(result, actor_id="test")
    assert plan["objectId"] is None
    assert any(row["field"] == "objectId" for row in plan["questions"])
