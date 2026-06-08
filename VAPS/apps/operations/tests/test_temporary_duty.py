import datetime as dt

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.operations.models import TemporaryDutyPermission

pytestmark = pytest.mark.django_db


def test_create_active_grant_has_integer_pk():
    now = timezone.now()
    grant = TemporaryDutyPermission.objects.create(
        user_id="u1", duty_role_code="OMD",
        starts_at=now, ends_at=now + dt.timedelta(hours=12), created_by="admin-1",
    )
    assert isinstance(grant.pk, int)
    assert grant.is_active is True


def test_invalid_duty_role_code_rejected():
    now = timezone.now()
    grant = TemporaryDutyPermission(
        user_id="u1", duty_role_code="WIZARD",
        starts_at=now, ends_at=now + dt.timedelta(hours=1), created_by="admin-1",
    )
    with pytest.raises(ValidationError):
        grant.full_clean()


def test_starts_after_ends_rejected():
    now = timezone.now()
    grant = TemporaryDutyPermission(
        user_id="u1", duty_role_code="ORGD",
        starts_at=now, ends_at=now - dt.timedelta(hours=1), created_by="admin-1",
    )
    with pytest.raises(ValidationError):
        grant.full_clean()
