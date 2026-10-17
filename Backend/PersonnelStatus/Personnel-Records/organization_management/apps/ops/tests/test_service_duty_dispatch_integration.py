from datetime import datetime, timezone

import pytest

from organization_management.apps.operations.clock import override
from organization_management.apps.operations.models_duty_log import OpsDutyRecordSupplement
from organization_management.apps.ops.tests.test_duty_dispatch import scene, fixed_clock, configure, create, URL
from organization_management.apps.ops.tests.service_duty_support import REGISTER

pytestmark = pytest.mark.django_db


def test_receiver_form_can_save_kind_without_replacing_the_original_assignment(scene):
    configure(scene)
    response = create(scene, service_duty_code="GBR")
    assert response.status_code == 201, response.data
    supplement = OpsDutyRecordSupplement.objects.filter(source_type="DISPATCH", source_id=response.data["id"]).first()
    assert supplement is not None
    assert supplement.service_duty_code == "GBR" and supplement.service_duty_label == "ГБР"
    assert response.data["placement"]["post_id"] == str(scene["post"].pk)
    history = scene["api"].get(REGISTER + f'DISPATCH:{response.data["id"]}/').data["history"]
    assert history[0]["action"] == "DUTY_DISPATCH_CREATED"


def test_queue_retains_the_chosen_kind_after_reload_with_an_exact_journal_key(scene):
    configure(scene)
    created = create(scene, service_duty_code="KUMBEZ")
    assert created.status_code == 201
    queue = scene["api"].get(URL).data
    assert queue["assignments"][0]["service_duty_code"] == "KUMBEZ"
    assert queue["assignments"][0]["service_duty_label"] == "Смена Кумбез"
    assert queue["assignments"][0]["duty_record_id"] == f'DISPATCH:{created.data["id"]}'


def test_invalid_kind_rolls_back_original_assignment_creation(scene):
    configure(scene)
    response = create(scene, service_duty_code="UNKNOWN_KIND")
    assert response.status_code == 422, response.data
    assert scene["api"].get(URL).data["assignments"] == []


def test_legacy_cancel_does_not_bypass_new_execution_facts(scene):
    configure(scene)
    response = create(scene)
    assert response.status_code == 201
    pk = response.data["id"]
    with override(datetime(2026, 10, 10, 12, tzinfo=timezone.utc)):
        key = REGISTER + f"DISPATCH:{pk}/"
        assert scene["api"].post(key + "acknowledge/", {}, format="json").status_code == 200
        assert scene["api"].post(key + "start/", {"at": "2026-10-10T08:00:00+05:00"}, format="json").status_code == 200
        cancel = scene["api"].post(URL + f"{pk}/cancel/", {"reason": "Старый экран"}, format="json")
        assert cancel.status_code == 422
        assert scene["api"].get(key).data["state"] == "ACTIVE"


def test_old_queue_explains_execution_state_and_disallows_removal_after_start(scene):
    configure(scene)
    created = create(scene, service_duty_code="GBR")
    assert created.status_code == 201
    key = REGISTER + f'DISPATCH:{created.data["id"]}/'
    with override(datetime(2026, 10, 10, 12, tzinfo=timezone.utc)):
        def check(state, can_cancel):
            row = scene["api"].get(URL).data["assignments"][0]
            assert row["execution_state"] == state
            assert row["can_cancel"] is can_cancel
            assert row["service_duty_label"] == "ГБР"
        check("PLANNED", True)
        assert scene["api"].post(key + "acknowledge/", {}, format="json").status_code == 200
        check("ACKNOWLEDGED", True)
        assert scene["api"].post(key + "start/", {"at":"2026-10-10T08:00:00+05:00"}, format="json").status_code == 200
        check("ACTIVE", False)
        assert scene["api"].post(key + "complete/", {"at":"2026-10-10T12:00:00+05:00"}, format="json").status_code == 200
        check("COMPLETED", False)


def test_cancelled_assignment_keeps_a_cancelled_execution_state(scene):
    configure(scene)
    created = create(scene)
    assert created.status_code == 201
    assert scene["api"].post(URL + f'{created.data["id"]}/cancel/', {"reason":"Контрольная отмена"}, format="json").status_code == 200
    row = scene["api"].get(URL).data["assignments"][0]
    assert row["execution_state"] == "CANCELLED"
    assert row["can_cancel"] is False
