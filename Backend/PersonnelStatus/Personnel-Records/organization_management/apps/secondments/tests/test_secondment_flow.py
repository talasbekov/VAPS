"""Both former workflows reject mutations while retaining their history."""
import pytest
from rest_framework.test import APIClient

from organization_management.apps.operations.models_status import OpsEmployeeStatus, Secondment
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.secondments.models import SecondmentRequest
from organization_management.apps.secondments.tests.test_secondment_permissions import scene
from organization_management.apps.statuses.models import EmployeeStatus, StatusChangeHistory

pytestmark = pytest.mark.django_db
WRITE_URLS = (
    "/api/secondments/secondment-requests/",
    "/api/secondments/secondment-requests/{pk}/approve/",
    "/api/secondments/secondment-requests/{pk}/reject/",
    "/api/secondments/secondment-requests/{pk}/return_employee/",
    "/api/operations/secondments/",
    "/api/operations/secondments/{pk}/request-return/",
    "/api/operations/secondments/{pk}/confirm-return/",
)


@pytest.mark.parametrize("url", WRITE_URLS)
def test_authorized_write_is_retired_and_does_not_change_history(scene, url):
    api, _ = client_for("retired-secondments-admin", "RETIRED_SECONDMENTS_ADMIN", ["*"])
    models = (SecondmentRequest, Secondment, EmployeeStatus, OpsEmployeeStatus, StatusChangeHistory)
    before = [list(model.objects.order_by("pk").values()) for model in models]
    response = api.post(url.format(pk=scene["request"].pk), {}, format="json")
    assert response.status_code == 410, response.data
    assert response.data["detail"] == "FEATURE_RETIRED"
    assert [list(model.objects.order_by("pk").values()) for model in models] == before


@pytest.mark.parametrize("url", WRITE_URLS)
def test_retirement_does_not_replace_authentication_or_permission_denials(scene, url):
    url = url.format(pk=scene["request"].pk)
    assert APIClient().post(url, {}, format="json").status_code == 401
    reader, _ = client_for("retired-secondments-reader", "RETIRED_SECONDMENTS_READER", ["status.view"])
    denied = reader.post(url, {}, format="json")
    assert denied.status_code == 403
    assert denied.data["detail"] == "PERMISSION_DENIED"
