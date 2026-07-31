"""Story 14.3 — ChecklistTemplate/ChecklistItem/ChecklistBinding/ChecklistOverride."""

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.operations.facilities.models import (
    ChecklistBinding,
    ChecklistItem,
    ChecklistOverride,
    ChecklistTemplate,
    Object,
)

pytestmark = pytest.mark.django_db


def make_object(code="OBJ-CL-1"):
    return Object.objects.create(code=code, name="Штаб", address="г. Кызылорда, ул. 1")


def make_template(code="STD-1"):
    return ChecklistTemplate.objects.create(code=code, name="Типовой чек-лист")


def test_all_four_models_created():
    obj = make_object()
    template = make_template()
    item = ChecklistItem.objects.create(template=template, text="Проверить освещение")
    binding = ChecklistBinding.objects.create(object=obj, template=template)
    override = ChecklistOverride.objects.create(
        binding=binding,
        override_type=ChecklistOverride.OverrideType.ADD,
        text="Доп. пункт",
    )
    assert item.template == template
    assert binding.object == obj
    assert binding.template == template
    assert override.binding == binding


def test_checklist_item_has_no_object_field():
    # Scope Decision: items belong to a template, not an object — a
    # template (and its items) is shared across every bound object.
    assert not hasattr(ChecklistItem, "object")


def test_template_code_unique():
    make_template("DUP")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            make_template("DUP")


def test_binding_unique_per_object_and_template():
    obj = make_object("OBJ-CL-2")
    template = make_template("STD-2")
    ChecklistBinding.objects.create(object=obj, template=template)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            ChecklistBinding.objects.create(object=obj, template=template)


def test_deleting_template_cascades_to_items():
    template = make_template("STD-3")
    item = ChecklistItem.objects.create(template=template, text="Пункт")

    template.delete()

    assert not ChecklistItem.objects.filter(pk=item.pk).exists()


def test_deleting_binding_cascades_to_overrides():
    obj = make_object("OBJ-CL-3")
    template = make_template("STD-4")
    binding = ChecklistBinding.objects.create(object=obj, template=template)
    override = ChecklistOverride.objects.create(
        binding=binding, override_type=ChecklistOverride.OverrideType.ADD
    )

    binding.delete()

    assert not ChecklistOverride.objects.filter(pk=override.pk).exists()


def test_deleting_checklist_item_sets_override_source_item_null():
    obj = make_object("OBJ-CL-4")
    template = make_template("STD-5")
    item = ChecklistItem.objects.create(template=template, text="Пункт")
    binding = ChecklistBinding.objects.create(object=obj, template=template)
    override = ChecklistOverride.objects.create(
        binding=binding,
        source_item=item,
        override_type=ChecklistOverride.OverrideType.MODIFY,
    )

    item.delete()

    override.refresh_from_db()
    assert override.source_item_id is None
    assert ChecklistOverride.objects.filter(pk=override.pk).exists()


def test_deleting_object_cascades_to_binding_but_not_template_or_items():
    obj = make_object("OBJ-CL-5")
    template = make_template("STD-6")
    item = ChecklistItem.objects.create(template=template, text="Пункт")
    binding = ChecklistBinding.objects.create(object=obj, template=template)

    obj.delete()

    assert not ChecklistBinding.objects.filter(pk=binding.pk).exists()
    # Template and its items are independent of any particular object.
    assert ChecklistTemplate.objects.filter(pk=template.pk).exists()
    assert ChecklistItem.objects.filter(pk=item.pk).exists()


def test_deleting_template_with_live_binding_is_protected():
    obj = make_object("OBJ-CL-6")
    template = make_template("STD-7")
    ChecklistBinding.objects.create(object=obj, template=template)

    from django.db.models import ProtectedError

    with pytest.raises(ProtectedError):
        template.delete()


@pytest.mark.parametrize("bad_type", ["", "APPROVE", "add", "DELETE"])
def test_override_type_out_of_range_rejected_by_db(bad_type):
    obj = make_object("OBJ-CL-7")
    template = make_template("STD-8")
    binding = ChecklistBinding.objects.create(object=obj, template=template)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            ChecklistOverride.objects.create(binding=binding, override_type=bad_type)


def test_override_source_item_from_a_different_template_rejected_by_clean():
    # Proactive fix (lesson from 14.2's review): source_item and binding
    # are separate FKs — full_clean() is the enforcement layer.
    obj = make_object("OBJ-CL-8")
    template_a = make_template("STD-9A")
    template_b = make_template("STD-9B")
    item_b = ChecklistItem.objects.create(template=template_b, text="Чужой пункт")
    binding = ChecklistBinding.objects.create(object=obj, template=template_a)

    override = ChecklistOverride(
        binding=binding,
        source_item=item_b,
        override_type=ChecklistOverride.OverrideType.MODIFY,
    )
    with pytest.raises(ValidationError):
        override.full_clean()


def test_override_source_item_from_the_same_template_passes_clean():
    obj = make_object("OBJ-CL-9")
    template = make_template("STD-10")
    item = ChecklistItem.objects.create(template=template, text="Пункт")
    binding = ChecklistBinding.objects.create(object=obj, template=template)

    override = ChecklistOverride(
        binding=binding,
        source_item=item,
        override_type=ChecklistOverride.OverrideType.MODIFY,
    )
    override.full_clean()  # must not raise


def test_add_override_with_source_item_rejected_by_clean():
    # Review (Blind Hunter): ADD must not carry a stale source_item.
    obj = make_object("OBJ-CL-10")
    template = make_template("STD-11")
    item = ChecklistItem.objects.create(template=template, text="Пункт")
    binding = ChecklistBinding.objects.create(object=obj, template=template)

    override = ChecklistOverride(
        binding=binding,
        source_item=item,
        override_type=ChecklistOverride.OverrideType.ADD,
    )
    with pytest.raises(ValidationError):
        override.full_clean()


def test_add_override_without_source_item_passes_clean():
    obj = make_object("OBJ-CL-11")
    template = make_template("STD-12")
    binding = ChecklistBinding.objects.create(object=obj, template=template)

    override = ChecklistOverride(
        binding=binding, override_type=ChecklistOverride.OverrideType.ADD
    )
    override.full_clean()  # must not raise


@pytest.mark.parametrize(
    "override_type",
    [ChecklistOverride.OverrideType.MODIFY, ChecklistOverride.OverrideType.DISABLE],
)
def test_modify_or_disable_override_without_source_item_rejected_by_clean(
    override_type,
):
    # Review (Blind Hunter): MODIFY/DISABLE must reference the item they
    # modify/disable — a stray source_item-less MODIFY is meaningless.
    obj = make_object(f"OBJ-CL-12-{override_type}")
    template = make_template(f"STD-13-{override_type}")
    binding = ChecklistBinding.objects.create(object=obj, template=template)

    override = ChecklistOverride(binding=binding, override_type=override_type)
    with pytest.raises(ValidationError):
        override.full_clean()


def test_clean_on_missing_binding_raises_validation_error_not_does_not_exist():
    # Review (Edge Case Hunter): clean() must guard on binding_id BEFORE
    # dereferencing self.binding — source_item IS set here (so the
    # "MODIFY needs source_item" rule doesn't short-circuit first), binding
    # is NOT, forcing the cross-template branch's `self.binding_id` guard
    # to actually matter. Must raise a clean ValidationError (required
    # `binding` field), never an uncaught ObjectDoesNotExist.
    template = make_template("STD-14")
    item = ChecklistItem.objects.create(template=template, text="Пункт")
    override = ChecklistOverride(
        source_item=item, override_type=ChecklistOverride.OverrideType.MODIFY
    )
    with pytest.raises(ValidationError):
        override.full_clean()
