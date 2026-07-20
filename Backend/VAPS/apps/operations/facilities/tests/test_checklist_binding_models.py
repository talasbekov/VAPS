"""Model/constraint tests for checklist bindings and overrides (14.3a).

Red probes are transactional and assert the constraint NAME (a renamed
constraint silently downgrades the race backstop to a 500). Both sides of
every conditional CHECK are probed — the 14.1 «обе границы» lesson.
"""

import pytest
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError

from apps.operations.facilities.models import (
    ChecklistBinding,
    ChecklistItem,
    ChecklistOverride,
    ChecklistTemplate,
)
from apps.operations.facilities.services import create_facility

pytestmark = pytest.mark.django_db

ACTOR = "user-14"


@pytest.fixture
def facility():
    return create_facility(
        actor=ACTOR, code="OBJ-1", name="Резиденция", address="а"
    )


@pytest.fixture
def template():
    return ChecklistTemplate.objects.create(code="STANDARD", name="Типовой")


def _item(template, **overrides):
    fields = {"template": template, "text": "Проверить периметр"}
    fields.update(overrides)
    return ChecklistItem.objects.create(**fields)


def _binding(facility, template, **overrides):
    fields = {"facility": facility, "template": template}
    fields.update(overrides)
    return ChecklistBinding.objects.create(**fields)


def _override(binding, **overrides):
    fields = {"binding": binding, "override_type": "ADD", "text": "Доп. пункт"}
    fields.update(overrides)
    return ChecklistOverride.objects.create(**fields)


# --- Binding -----------------------------------------------------------------


def test_binding_defaults(facility, template):
    binding = _binding(facility, template)
    assert binding.name is None
    assert binding.is_default is False
    assert binding.is_active is True


def test_binding_blank_name_rejected_null_is_the_empty_state(
    facility, template
):
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _binding(facility, template, name="   ")
    assert "chk_checklist_binding_name_not_blank" in str(excinfo.value)
    assert _binding(facility, template, name="Именованная").pk


def test_binding_duplicate_facility_template_rejected(facility, template):
    _binding(facility, template)
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _binding(facility, template)
    assert "uq_checklist_binding_facility_template" in str(excinfo.value)


def test_binding_unique_is_partial_deactivated_row_releases_pair(
    facility, template
):
    _binding(facility, template, is_active=False)
    assert _binding(facility, template).pk


def test_binding_single_default_per_facility(facility, template):
    other = ChecklistTemplate.objects.create(code="EXTRA", name="Доп")
    _binding(facility, template, is_default=True)
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _binding(facility, other, is_default=True)
    assert "uq_checklist_binding_default_per_facility" in str(excinfo.value)
    # Условие уника включает is_active: неактивный дефолт слот освобождает.
    ChecklistBinding.objects.filter(facility=facility).update(is_active=False)
    assert _binding(facility, other, is_default=True).pk


def test_template_delete_blocked_by_binding(facility, template):
    _binding(facility, template)
    with pytest.raises(ProtectedError):
        template.delete()


def test_facility_delete_cascades_bindings_and_overrides(facility, template):
    binding = _binding(facility, template)
    _override(binding)
    facility.delete()
    assert ChecklistBinding.objects.count() == 0
    assert ChecklistOverride.objects.count() == 0


# --- Override: форма по типу -------------------------------------------------


def test_add_with_source_item_rejected(facility, template):
    binding = _binding(facility, template)
    item = _item(template)
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _override(binding, source_item=item)
    assert "chk_checklist_override_add_shape" in str(excinfo.value)


def test_add_without_text_rejected(facility, template):
    binding = _binding(facility, template)
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _override(binding, text=None)
    assert "chk_checklist_override_add_shape" in str(excinfo.value)


@pytest.mark.parametrize("kind", ["MODIFY", "DISABLE"])
def test_bound_types_require_source_item(facility, template, kind):
    binding = _binding(facility, template)
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _override(
                binding,
                override_type=kind,
                source_item=None,
                text="Правка" if kind == "MODIFY" else None,
            )
    assert "chk_checklist_override_bound_source" in str(excinfo.value)


def test_unknown_override_type_rejected(facility, template):
    binding = _binding(facility, template)
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _override(binding, override_type="PATCH")
    assert "chk_checklist_override_type" in str(excinfo.value)


@pytest.mark.parametrize(
    "payload",
    [
        {"text": "мусор"},
        {"category": "мусор"},
        {"is_required": False},
        {"sort_order": 1},
    ],
)
def test_disable_with_payload_rejected(facility, template, payload):
    # По каждому из 4 payload-полей: общий Q мог бы молча выродиться в
    # проверку одного поля — DB-проба по одному text была бы вакуумна.
    binding = _binding(facility, template)
    item = _item(template)
    fields = {"override_type": "DISABLE", "source_item": item, "text": None}
    fields.update(payload)
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _override(binding, **fields)
    assert "chk_checklist_override_disable_payload" in str(excinfo.value)


def test_disable_clean_accepted(facility, template):
    binding = _binding(facility, template)
    item = _item(template)
    override = _override(
        binding,
        override_type="DISABLE",
        source_item=item,
        text=None,
        reason="не применимо на объекте",
    )
    assert override.pk


def test_modify_without_payload_rejected(facility, template):
    binding = _binding(facility, template)
    item = _item(template)
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _override(
                binding, override_type="MODIFY", source_item=item, text=None
            )
    assert "chk_checklist_override_modify_payload" in str(excinfo.value)


@pytest.mark.parametrize(
    "payload",
    [
        {"text": "Правка"},
        {"category": "Периметр"},
        {"is_required": False},
        {"sort_order": 5},
    ],
)
def test_modify_single_payload_field_accepted(facility, template, payload):
    binding = _binding(facility, template)
    item = _item(template)
    fields = {"override_type": "MODIFY", "source_item": item, "text": None}
    fields.update(payload)
    assert _override(binding, **fields).pk


def test_override_blank_text_rejected(facility, template):
    binding = _binding(facility, template)
    item = _item(template)
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _override(
                binding, override_type="MODIFY", source_item=item, text=" \t "
            )
    assert "chk_checklist_override_text_not_blank" in str(excinfo.value)


def test_override_blank_category_rejected(facility, template):
    binding = _binding(facility, template)
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _override(binding, category="   ")
    assert "chk_checklist_override_category_not_blank" in str(excinfo.value)


def test_override_negative_sort_order_rejected(facility, template):
    binding = _binding(facility, template)
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _override(binding, sort_order=-1)
    assert "chk_checklist_override_sort_order_min" in str(excinfo.value)


def test_override_zero_sort_order_accepted(facility, template):
    binding = _binding(facility, template)
    assert _override(binding, sort_order=0).pk


# --- Override: уникальность и ссылки -----------------------------------------


def test_one_override_per_item_in_binding(facility, template):
    # MODIFY и DISABLE одного пункта одновременно → резолвер недетерминирован;
    # partial-уник держит инвариант на БД (race-бэкстоп сервисного pre-check).
    binding = _binding(facility, template)
    item = _item(template)
    _override(
        binding, override_type="MODIFY", source_item=item, text="Правка"
    )
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _override(
                binding, override_type="DISABLE", source_item=item, text=None
            )
    assert "uq_checklist_override_binding_source" in str(excinfo.value)


def test_multiple_adds_allowed(facility, template):
    # ADD-дубли легитимны (Д4-14.3): partial-уник покрывает только source-bound.
    binding = _binding(facility, template)
    assert _override(binding).pk
    assert _override(binding).pk


def test_same_item_overridable_in_two_bindings(facility, template):
    # Уник скоплен ПРИВЯЗКОЙ: тот же пункт правится независимо на двух объектах.
    other = create_facility(
        actor=ACTOR, code="OBJ-2", name="Объект 2", address="б"
    )
    item = _item(template)
    _override(
        _binding(facility, template),
        override_type="MODIFY",
        source_item=item,
        text="Правка 1",
    )
    assert _override(
        _binding(other, template),
        override_type="MODIFY",
        source_item=item,
        text="Правка 2",
    ).pk


def test_item_delete_blocked_by_override(facility, template):
    # ПИН РЕВЬЮ 14.3: PROTECT вместо донорского SET_NULL — admin-delete пункта
    # с живой ссылкой оверрайда честно отказывает, осиротевший MODIFY невозможен.
    binding = _binding(facility, template)
    item = _item(template)
    _override(
        binding, override_type="MODIFY", source_item=item, text="Правка"
    )
    with pytest.raises(ProtectedError):
        item.delete()


def test_binding_delete_cascades_overrides(facility, template):
    binding = _binding(facility, template)
    _override(binding)
    binding.delete()
    assert ChecklistOverride.objects.count() == 0


# --- Admin boundary ----------------------------------------------------------


def test_business_models_not_in_admin():
    from django.contrib import admin

    admin.autodiscover()
    assert ChecklistBinding not in admin.site._registry
    assert ChecklistOverride not in admin.site._registry


def test_ordering_contracts():
    # Meta.ordering пинуется буквально (поведенческая проба на малых наборах
    # не отличает heap-порядок от tie-breaker'а — урок 14.3).
    assert ChecklistBinding._meta.ordering == ["template_id", "id"]
    assert ChecklistOverride._meta.ordering == ["id"]
