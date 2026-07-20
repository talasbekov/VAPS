"""Seed + admin-catalog tests for PostType (14.2, AC-1)."""

import pytest
from django.core.management import call_command

from apps.operations.facilities.models import PostType

pytestmark = pytest.mark.django_db

EXPECTED = {"FIXED", "MOBILE", "CHECKPOINT", "RESERVE"}


def test_seed_creates_four_types():
    call_command("seed_facilities")
    assert set(PostType.objects.values_list("code", flat=True)) == EXPECTED


def test_seed_is_idempotent_and_restores_name():
    call_command("seed_facilities")
    PostType.objects.filter(code="FIXED").update(name="Испорчено")
    call_command("seed_facilities")
    assert PostType.objects.count() == 4
    assert PostType.objects.get(code="FIXED").name != "Испорчено"


def test_seed_does_not_resurrect_deactivated_type():
    # is_active — operator-owned после посева (канон seed_statuses):
    # повторный прогон не воскрешает списанный админом тип.
    call_command("seed_facilities")
    PostType.objects.filter(code="RESERVE").update(is_active=False)
    call_command("seed_facilities")
    assert PostType.objects.get(code="RESERVE").is_active is False


def test_post_type_registered_in_admin_sector_post_not():
    from django.contrib import admin

    from apps.operations.facilities.models import Post, Sector

    admin.autodiscover()
    assert PostType in admin.site._registry
    assert Sector not in admin.site._registry
    assert Post not in admin.site._registry
