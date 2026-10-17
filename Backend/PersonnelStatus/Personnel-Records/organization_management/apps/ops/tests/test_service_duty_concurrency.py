"""Real PostgreSQL connections exercise requests from two open workspaces."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Barrier, Event, local
import time

import pytest
from django.contrib.auth.models import User
from django.db import connection, connections, transaction
from rest_framework.test import APIClient

from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchConfig
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.ops import duty_dispatch, duty_log
from organization_management.apps.ops.tests.test_duty_dispatch import scene, fixed_clock, configure, create
from organization_management.apps.ops.tests.service_duty_support import REGISTER, duty_log_scene, log_payload

pytestmark = pytest.mark.django_db(transaction=True)


def current_test_database():
    name = connection.settings_dict["NAME"]
    assert name == connection.settings_dict["TEST"]["NAME"]
    return name


def test_conflicting_creation_uuid_from_two_employees_is_409_not_database_error(duty_log_scene, monkeypatch):
    test_database = current_test_database()
    _, user = client_for("concurrent-log-writer", "CONCURRENT_LOG_WRITER", ("duty.manage",))
    first = log_payload(duty_log_scene)
    second = dict(first, employee_id=duty_log_scene["people"][1].pk)
    barrier = Barrier(2)
    original = duty_log._lock_creation_request

    def concurrent_lock(request_id):
        barrier.wait(timeout=15)
        return original(request_id)

    monkeypatch.setattr(duty_log, "_lock_creation_request", concurrent_lock)

    def post(body):
        connections.close_all()
        try:
            assert connection.settings_dict["NAME"] == test_database
            api = APIClient()
            api.force_authenticate(user)
            return api.post(REGISTER, body, format="json").status_code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as workers:
        futures = [workers.submit(post, body) for body in (first, second)]
        results = [future.result(timeout=25) for future in futures]
    assert sorted(results) == [201, 409]
    assert OpsDutyLogEntry.objects.count() == 1


@pytest.mark.parametrize("first_operation", ["create", "close"])
def test_create_and_close_serialize_before_any_business_write(duty_log_scene, monkeypatch, first_operation):
    test_database = current_test_database()
    user = duty_log_scene["user"]
    body = log_payload(duty_log_scene)
    request_url = REGISTER + "requests/" + body["client_request_id"] + "/"
    acquired, release = Event(), Event()
    thread_state = local()
    original = duty_log._lock_creation_request

    def hold_first_lock(nonce):
        original(nonce)
        if getattr(thread_state, "hold", False):
            acquired.set()
            assert release.wait(timeout=20), "First request was never released"

    monkeypatch.setattr(duty_log, "_lock_creation_request", hold_first_lock)

    def perform(operation, hold=False):
        connections.close_all()
        thread_state.hold = hold
        try:
            assert connection.settings_dict["NAME"] == test_database
            with connection.cursor() as cursor:
                cursor.execute("SET application_name = 'duty-creation-closure-race'")
            api = APIClient()
            api.force_authenticate(user)
            response = api.post(REGISTER if operation == "create" else request_url + "close/", body if operation == "create" else {}, format="json")
            return response.status_code, response.data
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as workers:
        first = workers.submit(perform, first_operation, True)
        try:
            assert acquired.wait(timeout=10)
            second = workers.submit(perform, "close" if first_operation == "create" else "create")
            waiting = False
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_stat_clear_snapshot()")
                    cursor.execute("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='duty-creation-closure-race' AND wait_event_type='Lock')")
                    waiting = cursor.fetchone()[0]
                if waiting:
                    break
                if second.done():
                    second.result()
                time.sleep(0.03)
            assert waiting, "The second request must wait for the same transaction lock"
        finally:
            release.set()
        first_result, second_result = first.result(timeout=20), second.result(timeout=20)
    create_result, close_result = (first_result, second_result) if first_operation == "create" else (second_result, first_result)
    assert close_result[0] == 200
    assert create_result[0] == (201 if first_operation == "create" else 409)
    assert close_result[1]["saved"] is (first_operation == "create")
    assert close_result[1]["closed"] is (first_operation == "close")
    assert OpsDutyLogEntry.objects.count() == (1 if first_operation == "create" else 0)
    state = duty_log_scene["manager"].get(request_url).data
    assert state["saved"] is (first_operation == "create")
    assert state["closed"] is (first_operation == "close")
    assert duty_log_scene["manager"].post(REGISTER, body, format="json").status_code == (200 if first_operation == "create" else 409)


def test_new_and_legacy_cancellation_use_compatible_locks(scene):
    test_database = current_test_database()
    configure(scene)
    response = create(scene)
    assert response.status_code == 201
    pk = response.data["id"]
    actor = str(User.objects.get(username="dispatcher").pk)

    def register_cancel():
        connections.close_all()
        try:
            assert connection.settings_dict["NAME"] == test_database
            with connection.cursor() as cursor:
                cursor.execute("SET application_name = 'duty-register-cancel-regression'")
            return duty_log.cancel_record(actor, f"DISPATCH:{pk}", "Новое окно")
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=1) as workers:
        with transaction.atomic():
            # This is the legacy writer's first lock. Wait until the other
            # request waits for it, then finish that real legacy operation.
            OpsDutyDispatchConfig.objects.select_for_update().get(singleton_key=1)
            future = workers.submit(register_cancel)
            waiting = False
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_stat_clear_snapshot()")
                    cursor.execute("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='duty-register-cancel-regression' AND wait_event_type='Lock')")
                    waiting = cursor.fetchone()[0]
                if waiting:
                    break
                if future.done():
                    future.result()
                time.sleep(0.03)
            assert waiting, "The independent request must reach the contested lock"
            legacy = duty_dispatch.cancel_assignment(actor, pk, "Прежнее окно")
            assert legacy["cancelled_at"] is not None
        repeated = future.result(timeout=20)
    assert repeated["state"] == "CANCELLED"
    assert repeated["cancelled_reason"] == "Прежнее окно"
