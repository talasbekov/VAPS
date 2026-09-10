"""RBAC и область legacy-запросов на прикомандирование (Plane №958)."""

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
)
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.secondments.models import SecondmentRequest
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus


User = get_user_model()


def grant(user, *permission_codes, scope=None):
    role, _ = Role.objects.get_or_create(
        code=f"T958_{user.username.upper()}",
        defaults={"name": f"№958 {user.username}"},
    )
    for code in permission_codes:
        permission, _ = Permission.objects.get_or_create(
            code=code, defaults={"name": code}
        )
        RolePermission.objects.get_or_create(
            role_code=role, permission_code=permission
        )
    RoleAdminService.assign_role(
        str(user.pk),
        role.code,
        scope.pk if scope is not None else None,
        actor="test-958",
    )


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def scene(db):
    departments = [
        Division.objects.create(
            name=f"№958 Department {suffix}",
            code=f"t958-{suffix.lower()}",
            division_type=Division.DivisionType.DEPARTMENT,
        )
        for suffix in ("A", "B", "C")
    ]
    dep_a, dep_b, dep_c = departments
    owner = User.objects.create_user(username="t958-owner")
    no_right = User.objects.create_user(username="t958-no-right")
    sent = Employee.objects.create(
        personnel_number="t958-sent",
        last_name="Sent",
        first_name="Employee",
    )
    host_actor = Employee.objects.create(
        personnel_number="t958-host-actor",
        last_name="Host",
        first_name="Actor",
        user=no_right,
    )
    StaffUnit.objects.create(division=dep_a, employee=sent, index=1)
    StaffUnit.objects.create(division=dep_b, employee=host_actor, index=2)
    today = timezone.localdate()
    request = SecondmentRequest.objects.create(
        employee=sent,
        from_division=dep_a,
        to_division=dep_b,
        start_date=today,
        end_date=today + timedelta(days=5),
        reason="№958 request",
        requested_by=owner,
    )
    foreign = SecondmentRequest.objects.create(
        employee=host_actor,
        from_division=dep_b,
        to_division=dep_c,
        start_date=today,
        end_date=today + timedelta(days=5),
        reason="№958 foreign",
        requested_by=owner,
    )
    return {
        "dep_a": dep_a,
        "dep_b": dep_b,
        "dep_c": dep_c,
        "owner": owner,
        "no_right": no_right,
        "sent": sent,
        "request": request,
        "foreign": foreign,
        "today": today,
    }


def create_payload(scene, **overrides):
    payload = {
        "employee": scene["sent"].pk,
        # Поле намеренно лжёт: сервер обязан вывести источник из StaffUnit.
        "from_division": scene["dep_b"].pk,
        "to_division": scene["dep_b"].pk,
        "start_date": scene["today"].isoformat(),
        "end_date": (scene["today"] + timedelta(days=3)).isoformat(),
        "reason": "№958 create",
        # Остальные поля решения и актора тоже принадлежат серверу.
        "requested_by": scene["owner"].pk,
        "status": SecondmentRequest.ApprovalStatus.APPROVED,
        "approved_by": scene["owner"].pk,
        "approved_at": timezone.now().isoformat(),
        "rejection_reason": "forged",
    }
    payload.update(overrides)
    return payload


@pytest.mark.parametrize(
    ("route_name", "method"),
    [
        ("secondmentrequest-list", "get"),
        ("secondmentrequest-detail", "get"),
        ("secondmentrequest-incoming", "get"),
        ("secondmentrequest-outgoing", "get"),
    ],
)
@pytest.mark.django_db
def test_a_logged_in_user_without_status_view_cannot_read(
    scene, route_name, method
):
    kwargs = (
        {"pk": scene["request"].pk}
        if route_name == "secondmentrequest-detail"
        else {}
    )
    response = getattr(client_for(scene["no_right"]), method)(
        reverse(route_name, kwargs=kwargs)
    )
    assert response.status_code == 403


@pytest.mark.parametrize("action", ["create", "approve", "reject", "return"])
@pytest.mark.django_db
def test_a_logged_in_user_without_status_manage_cannot_mutate(scene, action):
    api = client_for(scene["no_right"])
    if action == "create":
        response = api.post(
            reverse("secondmentrequest-list"),
            create_payload(scene),
            format="json",
        )
    else:
        route = {
            "approve": "secondmentrequest-approve",
            "reject": "secondmentrequest-reject",
            "return": "secondmentrequest-return-employee",
        }[action]
        response = api.post(
            reverse(route, kwargs={"pk": scene["request"].pk}),
            {},
            format="json",
        )
    assert response.status_code == 403


@pytest.mark.django_db
def test_status_view_reads_only_pairs_touching_its_scope(scene):
    reader = User.objects.create_user(username="t958-reader-a")
    grant(reader, "status.view", scope=scene["dep_a"])
    api = client_for(reader)

    response = api.get(reverse("secondmentrequest-list"))
    assert response.status_code == 200
    assert [row["id"] for row in response.data["results"]] == [
        scene["request"].pk
    ]

    assert api.get(
        reverse("secondmentrequest-detail", kwargs={"pk": scene["request"].pk})
    ).status_code == 200
    foreign = api.get(
        reverse("secondmentrequest-detail", kwargs={"pk": scene["foreign"].pk})
    )
    missing = api.get(
        reverse("secondmentrequest-detail", kwargs={"pk": 999999999})
    )
    assert foreign.status_code == missing.status_code == 404
    assert foreign.data == missing.data


@pytest.mark.django_db
def test_outgoing_requires_the_source_side_to_be_in_read_scope(scene):
    reader = User.objects.create_user(username="t958-outgoing-reader")
    grant(reader, "status.view", scope=scene["dep_a"])
    own_source = SecondmentRequest.objects.create(
        employee=scene["sent"],
        from_division=scene["dep_a"],
        to_division=scene["dep_b"],
        start_date=scene["today"],
        end_date=scene["today"] + timedelta(days=2),
        requested_by=reader,
    )
    SecondmentRequest.objects.create(
        employee=scene["sent"],
        from_division=scene["dep_b"],
        to_division=scene["dep_a"],
        start_date=scene["today"],
        end_date=scene["today"] + timedelta(days=2),
        requested_by=reader,
    )

    response = client_for(reader).get(reverse("secondmentrequest-outgoing"))
    assert response.status_code == 200
    assert [row["id"] for row in response.data] == [own_source.pk]


@pytest.mark.django_db
def test_incoming_requires_the_receiving_side_to_be_in_read_scope(scene):
    reader = User.objects.create_user(username="t958-incoming-reader")
    grant(reader, "status.view", scope=scene["dep_a"])
    incoming = SecondmentRequest.objects.create(
        employee=scene["sent"],
        from_division=scene["dep_b"],
        to_division=scene["dep_a"],
        start_date=scene["today"],
        end_date=scene["today"] + timedelta(days=2),
        requested_by=scene["owner"],
    )

    response = client_for(reader).get(reverse("secondmentrequest-incoming"))
    assert response.status_code == 200
    assert [row["id"] for row in response.data] == [incoming.pk]


@pytest.mark.django_db
def test_status_view_does_not_open_decisions(scene):
    reader = User.objects.create_user(username="t958-read-only")
    grant(reader, "status.view", scope=scene["dep_b"])
    response = client_for(reader).post(
        reverse(
            "secondmentrequest-reject", kwargs={"pk": scene["request"].pk}
        ),
        {},
        format="json",
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_status_manage_does_not_open_reads(scene):
    manager = User.objects.create_user(username="t958-manage-only")
    grant(manager, "status.manage", scope=scene["dep_b"])
    response = client_for(manager).get(reverse("secondmentrequest-list"))
    assert response.status_code == 403


@pytest.mark.django_db
def test_receiving_scope_with_status_manage_can_decide(scene):
    manager = User.objects.create_user(username="t958-host-manager")
    grant(manager, "status.manage", scope=scene["dep_b"])
    response = client_for(manager).post(
        reverse(
            "secondmentrequest-reject", kwargs={"pk": scene["request"].pk}
        ),
        {"reason": "Not accepted"},
        format="json",
    )
    assert response.status_code == 200
    scene["request"].refresh_from_db()
    assert scene["request"].status == SecondmentRequest.ApprovalStatus.REJECTED


@pytest.mark.django_db
def test_receiving_scope_with_status_manage_can_approve_and_return(scene):
    manager = User.objects.create_user(username="t958-host-transition-manager")
    grant(manager, "status.manage", scope=scene["dep_b"])
    api = client_for(manager)

    approved = api.post(
        reverse(
            "secondmentrequest-approve", kwargs={"pk": scene["request"].pk}
        ),
        {},
        format="json",
    )
    assert approved.status_code == 200, approved.data
    scene["request"].refresh_from_db()
    assert scene["request"].approved_by_id == manager.pk

    returned = api.post(
        reverse(
            "secondmentrequest-return-employee",
            kwargs={"pk": scene["request"].pk},
        ),
        {"reason": "Back home"},
        format="json",
    )
    assert returned.status_code == 200, returned.data


@pytest.mark.parametrize("action", ["approve", "reject", "return_employee"])
@pytest.mark.django_db
def test_source_only_manage_scope_cannot_decide_for_the_receiver(scene, action):
    manager = User.objects.create_user(username=f"t958-source-only-{action}")
    grant(manager, "status.manage", scope=scene["dep_a"])
    response = client_for(manager).post(
        reverse(
            f"secondmentrequest-{action.replace('_', '-')}",
            kwargs={"pk": scene["request"].pk},
        ),
        {},
        format="json",
    )
    assert response.status_code == 403
    scene["request"].refresh_from_db()
    assert scene["request"].status == SecondmentRequest.ApprovalStatus.PENDING
    assert scene["request"].approved_by_id is None
    assert not EmployeeStatus.objects.filter(
        employee=scene["sent"],
        status_type=EmployeeStatus.StatusType.SECONDED_TO,
    ).exists()


@pytest.mark.django_db
def test_create_uses_manage_scope_and_server_owned_source_and_actor(scene):
    manager = User.objects.create_user(username="t958-source-manager")
    grant(manager, "status.manage", scope=scene["dep_a"])

    response = client_for(manager).post(
        reverse("secondmentrequest-list"),
        create_payload(scene),
        format="json",
    )
    assert response.status_code == 201, response.data
    created = SecondmentRequest.objects.get(pk=response.data["id"])
    assert created.from_division_id == scene["dep_a"].pk
    assert created.requested_by_id == manager.pk
    assert created.status == SecondmentRequest.ApprovalStatus.PENDING
    assert created.approved_by_id is None
    assert created.approved_at is None
    assert created.rejection_reason == ""

    foreign_manager = User.objects.create_user(username="t958-foreign-manager")
    grant(foreign_manager, "status.manage", scope=scene["dep_b"])
    denied = client_for(foreign_manager).post(
        reverse("secondmentrequest-list"),
        create_payload(scene),
        format="json",
    )
    assert denied.status_code == 403


@pytest.mark.django_db
def test_create_rejects_an_employee_without_a_source_division(scene):
    orphan = Employee.objects.create(
        personnel_number="t958-orphan",
        last_name="No",
        first_name="Division",
    )
    manager = User.objects.create_user(username="t958-global-create-manager")
    grant(manager, "status.manage")
    before = SecondmentRequest.objects.count()

    response = client_for(manager).post(
        reverse("secondmentrequest-list"),
        create_payload(scene, employee=orphan.pk),
        format="json",
    )
    assert response.status_code == 400
    assert "employee" in response.data
    assert SecondmentRequest.objects.count() == before


@pytest.mark.django_db
def test_scoped_wildcard_does_not_open_a_foreign_create_source(scene):
    scoped_admin = User.objects.create_user(username="t958-scoped-wildcard")
    grant(scoped_admin, "*", scope=scene["dep_b"])
    before = SecondmentRequest.objects.count()

    response = client_for(scoped_admin).post(
        reverse("secondmentrequest-list"),
        create_payload(scene),
        format="json",
    )
    assert response.status_code == 403
    assert SecondmentRequest.objects.count() == before


@pytest.mark.django_db
def test_generic_rewrite_and_delete_routes_are_closed(scene):
    manager = User.objects.create_user(username="t958-global-manager")
    manager_employee = Employee.objects.create(
        personnel_number="t958-global-manager",
        last_name="Global",
        first_name="Manager",
        user=manager,
    )
    StaffUnit.objects.create(
        division=scene["dep_a"], employee=manager_employee, index=3
    )
    grant(manager, "status.manage")
    api = client_for(manager)
    url = reverse(
        "secondmentrequest-detail", kwargs={"pk": scene["request"].pk}
    )

    assert api.put(url, create_payload(scene), format="json").status_code == 405
    assert api.patch(url, {"status": "approved"}, format="json").status_code == 405
    assert api.delete(url).status_code == 405
    assert SecondmentRequest.objects.filter(pk=scene["request"].pk).exists()
