"""Story 19.3 — LoadCoefficient: справочник коэффициентов поправок
нагрузки (OQ-6, структура без применения)."""

import inspect
from decimal import Decimal

import pytest
from django.contrib import admin
from django.db import IntegrityError, transaction

from apps.operations.events import services as events_services
from apps.operations.load import selectors as load_selectors
from apps.operations.load.admin import LoadCoefficientAdmin
from apps.operations.load.models import LoadCoefficient

pytestmark = pytest.mark.django_db


def test_code_is_unique():
    LoadCoefficient.objects.create(
        code="WINTER", name="Зима", multiplier=Decimal("1.2")
    )

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            LoadCoefficient.objects.create(
                code="WINTER", name="Зима (дубль)", multiplier=Decimal("1.5")
            )


def test_multiplier_must_be_positive():
    coefficient = LoadCoefficient(code="ZERO", name="Ноль", multiplier=Decimal("0"))

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            coefficient.save()


def test_negative_multiplier_rejected():
    coefficient = LoadCoefficient(
        code="NEG", name="Отрицательный", multiplier=Decimal("-1")
    )

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            coefficient.save()


def test_blank_code_rejected():
    """review (Blind Hunter + Edge Case Hunter): CharField's blank=False
    is a full_clean()-only guard, not enforced by .objects.create() —
    without the DB CheckConstraint, an empty-string code silently
    becomes a valid PK."""
    coefficient = LoadCoefficient(code="", name="Пустой код", multiplier=Decimal("1"))

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            coefficient.save()


def test_registered_in_admin():
    assert admin.site.is_registered(LoadCoefficient)
    assert isinstance(admin.site._registry[LoadCoefficient], LoadCoefficientAdmin)


def test_not_referenced_by_events_services_or_load_selectors():
    """Story 19.3's Scope Decision: применение коэффициента — будущая
    стори. Ни `events/services.py`, ни существующие функции
    `load/selectors.py` не должны импортировать/упоминать
    `LoadCoefficient`."""
    events_services_source = inspect.getsource(events_services)
    load_selectors_source = inspect.getsource(load_selectors)

    assert "LoadCoefficient" not in events_services_source
    assert "LoadCoefficient" not in load_selectors_source
