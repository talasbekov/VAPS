"""Rating analytics cannot infer organizational ownership from rating labels."""
import pytest
from rest_framework_simplejwt.tokens import AccessToken

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import Permission, Role, RolePermission, UserRole
from organization_management.apps.operations.tests.support import client_for
from organization_management.apps.ops.tests.test_ops_ratings_api import policy  # noqa: F401


pytestmark = pytest.mark.django_db
ANALYTICS = "/api/ops/rating-analytics/"


def analyst(scope=None):
    api, user = client_for(
        "rating-scope-reader", "RATING_SCOPE_READER", ("analytics.view",), scope,
    )
    api.force_authenticate(user=None)
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")
    return api, user


def test_scoped_rating_analytics_refuses_unverifiable_group_ownership(policy):
    department = Division.objects.create(name="Scoped rating department", division_type="department")
    api, _ = analyst(department.pk)

    response = api.get(ANALYTICS)

    assert response.status_code == 403, response.data
    assert response.data["error_code"] == "ANALYTICS_SCOPE_UNAVAILABLE"
    assert "figures" not in response.data


def test_global_rating_analytics_preserves_the_existing_report(policy):
    api, _ = analyst()

    response = api.get(ANALYTICS)

    assert response.status_code == 200, response.data
    assert response.data["unpublishedReason"] is None
    assert response.data["capabilities"]["operationalRatings"] is True
    assert response.data["figures"] is not None


def test_unrelated_global_grant_does_not_expand_rating_analytics_scope(policy):
    department = Division.objects.create(name="Scoped rating department", division_type="department")
    api, user = analyst(department.pk)
    Permission.objects.get_or_create(code="rating.view_aggregate", defaults={"name": "Rating summary"})
    role = Role.objects.create(code="GLOBAL_RATING_READER", name="Global rating reader")
    RolePermission.objects.create(role_code=role, permission_code_id="rating.view_aggregate")
    UserRole.objects.create(user_id=str(user.pk), role_code=role, scope_division_id=None)

    response = api.get(ANALYTICS)

    assert response.status_code == 403, response.data
    assert response.data["error_code"] == "ANALYTICS_SCOPE_UNAVAILABLE"
