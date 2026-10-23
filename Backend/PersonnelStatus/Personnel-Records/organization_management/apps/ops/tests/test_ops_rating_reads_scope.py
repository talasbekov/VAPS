"""Aggregate reads must not infer scope for historical/collective rating facts."""
import json

import pytest
from rest_framework_simplejwt.tokens import AccessToken

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import Permission, Role, RolePermission, UserRole
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.operations.tests.support import client_for
from organization_management.apps.operations.tests.test_audit_coverage import employee_in
from organization_management.apps.ops import ratings
from organization_management.apps.ops.tests.test_ops_ratings_api import (
    _evaluation, _event, _participant, policy,  # noqa: F401
)


pytestmark = pytest.mark.django_db
AGGREGATE = "rating.view_aggregate"
CASES = [
    ("operational-ratings", {}),
    ("operational-rating-dynamics", {}),
    ("operational-rating-dynamics", {"employee": "outside-rated"}),
    ("operational-rating-employee", {"employee": "outside-rated"}),
    ("evaluation-registry", {}),
    ("evaluation-registry", {"employee": "outside-rated"}),
]


@pytest.fixture
def rating_sources(policy):
    own = Division.objects.create(name="Synthetic own department", division_type="department")
    outside = Division.objects.create(name="Synthetic outside department", division_type="department")
    _participant("own-rated", "Synthetic own participant", employee_id=employee_in(own).pk)
    _participant("outside-rated", "Synthetic outside participant", employee_id=employee_in(outside).pk)
    _participant("historical-rated", "Synthetic historical participant")
    _event()
    _evaluation("own-evaluation", "own-rated", 8, 1)
    _evaluation("outside-evaluation", "outside-rated", 9, 1)
    return own


def reader(scope=None, permission=AGGREGATE):
    api, user = client_for("aggregate-scope-reader", "AGGREGATE_SCOPE_READER", (permission,), scope)
    api.force_authenticate(user=None)
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
    return api, user


def grant(user, permission):
    Permission.objects.get_or_create(code=permission, defaults={"name": permission})
    role = Role.objects.create(code="OTHER_GLOBAL_RATING_PERMISSION", name="Other global grant")
    RolePermission.objects.create(role_code=role, permission_code_id=permission)
    UserRole.objects.create(user_id=str(user.pk), role_code=role, scope_division_id=None)


@pytest.mark.parametrize("endpoint,params", CASES)
@pytest.mark.parametrize("attempt", ["ordinary", "unrelated_global", "spoofed_actor"])
def test_scoped_aggregate_reads_fail_closed_with_incomplete_ownership(rating_sources, endpoint, params, attempt):
    api, user = reader(rating_sources.pk)
    params = dict(params)
    headers = {}
    if attempt == "unrelated_global":
        grant(user, "analytics.view")
    elif attempt == "spoofed_actor":
        _, global_user = client_for("global-spoof-target", "GLOBAL_SPOOF_TARGET", ("*",))
        params.update(actor=str(global_user.pk), actor_id=str(global_user.pk))
        headers["HTTP_X_ACTOR_ID"] = str(global_user.pk)

    response = api.get(f"/api/ops/{endpoint}/", params, **headers)

    assert response.status_code == 403, response.data
    assert response.data["error_code"] == "ANALYTICS_SCOPE_UNAVAILABLE"
    payload = json.dumps(response.data)
    assert "Synthetic outside participant" not in payload
    assert "outside-evaluation" not in payload
    assert not {"results", "options", "points", "employees", "summary"} & response.data.keys()


@pytest.mark.parametrize("endpoint,params", CASES)
@pytest.mark.parametrize("permission", [AGGREGATE, "*"])
def test_global_and_wildcard_aggregate_reads_preserve_contract(rating_sources, endpoint, params, permission):
    api, _ = reader(permission=permission)

    response = api.get(f"/api/ops/{endpoint}/", params)

    assert response.status_code == 200, response.data
    data = response.data
    if endpoint == "operational-ratings":
        assert {"own-rated", "outside-rated", "historical-rated"} <= {row["employeeId"] for row in data["results"]}
    elif endpoint == "operational-rating-dynamics":
        assert {"own-rated", "outside-rated"} <= {row["employeeId"] for row in data["employees"]}
        if params:
            assert data["employeeId"] == "outside-rated"
    elif endpoint == "operational-rating-employee":
        assert data["employeeId"] == "outside-rated"
        assert data["safeLabel"] == "Synthetic outside participant"
    else:
        expected = {"outside-rated"} if params else {"own-rated", "outside-rated"}
        assert {row["employeeId"] for row in data["results"]} == expected
        assert {"own-rated", "outside-rated"} <= {row["value"] for row in data["options"]["employees"]}


def test_successful_grant_scope_shrink_cannot_reuse_global_rating_read(rating_sources):
    api, user = reader()
    assert api.get("/api/ops/operational-ratings/").status_code == 200
    UserRole.objects.filter(user_id=str(user.pk), role_code_id="AGGREGATE_SCOPE_READER").update(scope_division_id=rating_sources.pk)
    assert PermissionService.visible_division_ids(str(user.pk), AGGREGATE) == {rating_sources.pk}

    response = api.get("/api/ops/operational-ratings/")

    assert response.status_code == 403, response.data
    assert response.data["error_code"] == "ANALYTICS_SCOPE_UNAVAILABLE"


@pytest.mark.parametrize("service,args", [
    (ratings.list_operational_ratings, ()),
    (ratings.rating_dynamics, (None,)),
    (ratings.rating_employee_detail, ("outside-rated",)),
    (ratings.evaluation_registry, ({},)),
])
def test_aggregate_service_reads_require_an_explicit_resolved_actor(service, args):
    with pytest.raises(DomainError) as error:
        service(*args, actor=None)

    assert error.value.http_status == 403
    assert error.value.code == "ANALYTICS_SCOPE_UNAVAILABLE"
