"""Resolver tests — BR-CHECKLIST-003 (14.3a, AC 6).

resolved = активные пункты шаблона + оверрайды привязки: DISABLE исключает,
MODIFY патчит (NULL = «не менять»), ADD добавляет. Порядок детерминирован:
(sort_order, added-флаг, id).
"""

import pytest

from apps.core.exceptions import DomainError
from apps.operations.facilities.models import (
    ChecklistItem,
    ChecklistTemplate,
)
from apps.operations.facilities.selectors import (
    ChecklistBindingSelector,
    resolve_checklist,
)
from apps.operations.facilities.services import checklist_service as svc
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


@pytest.fixture
def binding(facility, template):
    return svc.create_binding(
        actor=ACTOR, facility_id=facility.pk, template_code=template.pk
    )


def _item(template, text="Пункт", **overrides):
    fields = {"template": template, "text": text}
    fields.update(overrides)
    return ChecklistItem.objects.create(**fields)


def test_standard_items_pass_through(template, binding):
    a = _item(template, "А", sort_order=0, category="Периметр")
    b = _item(template, "Б", sort_order=1, is_required=False)
    resolved = resolve_checklist(ACTOR, binding.pk)
    assert [r["text"] for r in resolved] == ["А", "Б"]
    assert resolved[0] == {
        "origin": "STANDARD",
        "source_item_id": a.pk,
        "override_id": None,
        "text": "А",
        "category": "Периметр",
        "is_required": True,
        "sort_order": 0,
    }
    assert resolved[1]["is_required"] is False
    assert resolved[1]["source_item_id"] == b.pk


def test_disable_excludes_item(template, binding):
    kept = _item(template, "Оставить")
    dropped = _item(template, "Убрать")
    svc.add_override(
        actor=ACTOR,
        binding_id=binding.pk,
        override_type="DISABLE",
        source_item_id=dropped.pk,
    )
    resolved = resolve_checklist(ACTOR, binding.pk)
    assert [r["source_item_id"] for r in resolved] == [kept.pk]


@pytest.mark.parametrize(
    ("payload", "field", "expected"),
    [
        ({"text": "Новый текст"}, "text", "Новый текст"),
        ({"category": "Крыша"}, "category", "Крыша"),
        ({"is_required": False}, "is_required", False),
        ({"sort_order": 7}, "sort_order", 7),
    ],
)
def test_modify_patches_only_given_field(
    template, binding, payload, field, expected
):
    # NULL payload-поля = «не менять» (Д3) — по каждому полю независимо.
    item = _item(
        template, "Исходный", category="Периметр", is_required=True,
        sort_order=3,
    )
    override = svc.add_override(
        actor=ACTOR,
        binding_id=binding.pk,
        override_type="MODIFY",
        source_item_id=item.pk,
        **payload,
    )
    (resolved,) = resolve_checklist(ACTOR, binding.pk)
    baseline = {
        "origin": "MODIFIED",
        "source_item_id": item.pk,
        "override_id": override.pk,
        "text": "Исходный",
        "category": "Периметр",
        "is_required": True,
        "sort_order": 3,
    }
    baseline[field] = expected
    assert resolved == baseline


def test_add_appends_with_defaults(template, binding):
    override = svc.add_override(
        actor=ACTOR,
        binding_id=binding.pk,
        override_type="ADD",
        text="Объектовый пункт",
    )
    (resolved,) = resolve_checklist(ACTOR, binding.pk)
    assert resolved == {
        "origin": "ADDED",
        "source_item_id": None,
        "override_id": override.pk,
        "text": "Объектовый пункт",
        "category": None,
        "is_required": True,
        "sort_order": 0,
    }


def test_globally_inactive_item_excluded_even_with_modify(template, binding):
    # is_active пункта = глобальный выключатель (Д6-14.3): его MODIFY
    # игнорируется, пункт не воскресает через оверрайд.
    item = _item(template, "Выключенный")
    svc.add_override(
        actor=ACTOR,
        binding_id=binding.pk,
        override_type="MODIFY",
        source_item_id=item.pk,
        text="Правка",
    )
    ChecklistItem.objects.filter(pk=item.pk).update(is_active=False)
    assert resolve_checklist(ACTOR, binding.pk) == []


def test_inactive_template_still_resolves(template, binding):
    # Д6: гейт активности шаблона стоит на create_binding; выключение шаблона
    # позже не рвёт существующие объекты.
    _item(template, "А")
    ChecklistTemplate.objects.filter(pk=template.pk).update(is_active=False)
    assert [r["text"] for r in resolve_checklist(ACTOR, binding.pk)] == ["А"]


def test_ordering_standard_before_added_on_tie(template, binding):
    # Ключ: (sort_order, added-флаг, id) — при равном sort_order стандартные
    # раньше ADD; MODIFY со sort_order перемещает пункт.
    first = _item(template, "А", sort_order=0)
    second = _item(template, "Б", sort_order=5)
    added = svc.add_override(
        actor=ACTOR,
        binding_id=binding.pk,
        override_type="ADD",
        text="Врезка",
        sort_order=5,
    )
    moved = svc.add_override(
        actor=ACTOR,
        binding_id=binding.pk,
        override_type="MODIFY",
        source_item_id=first.pk,
        sort_order=9,
    )
    resolved = resolve_checklist(ACTOR, binding.pk)
    shape = [
        (r["origin"], r["override_id"] or r["source_item_id"])
        for r in resolved
    ]
    assert shape == [
        ("STANDARD", second.pk),
        ("ADDED", added.pk),
        ("MODIFIED", moved.pk),
    ]


def test_ordering_id_tiebreaker_within_added(template, binding):
    a1 = svc.add_override(
        actor=ACTOR, binding_id=binding.pk, override_type="ADD", text="Один"
    )
    a2 = svc.add_override(
        actor=ACTOR, binding_id=binding.pk, override_type="ADD", text="Два"
    )
    resolved = resolve_checklist(ACTOR, binding.pk)
    assert [r["override_id"] for r in resolved] == [a1.pk, a2.pk]


def test_resolve_inactive_binding_409(template, binding):
    svc.deactivate_binding(actor=ACTOR, binding_id=binding.pk)
    with pytest.raises(DomainError) as excinfo:
        resolve_checklist(ACTOR, binding.pk)
    assert excinfo.value.code == "CHECKLIST_BINDING_ALREADY_INACTIVE"
    assert excinfo.value.http_status == 409


def test_resolve_unknown_binding_404():
    with pytest.raises(DomainError) as excinfo:
        resolve_checklist(ACTOR, 999999)
    assert excinfo.value.code == "ENTITY_NOT_FOUND"


def test_resolve_garbage_pk_404():
    with pytest.raises(DomainError) as excinfo:
        resolve_checklist(ACTOR, "1.9")
    assert excinfo.value.code == "ENTITY_NOT_FOUND"


# --- селектор ----------------------------------------------------------------


def test_selector_list_for_facility_active_only(facility, template):
    other = ChecklistTemplate.objects.create(code="EXTRA", name="Доп")
    b1 = svc.create_binding(
        actor=ACTOR, facility_id=facility.pk, template_code=other.pk
    )
    b2 = svc.create_binding(
        actor=ACTOR, facility_id=facility.pk, template_code=template.pk
    )
    dead = svc.create_binding(
        actor=ACTOR,
        facility_id=create_facility(
            actor=ACTOR, code="OBJ-2", name="Другой", address="б"
        ).pk,
        template_code=template.pk,
    )
    svc.deactivate_binding(actor=ACTOR, binding_id=b1.pk)
    listed = list(
        ChecklistBindingSelector.list_for_facility(ACTOR, facility.pk)
    )
    assert listed == [b2]
    assert dead not in listed


def test_selector_get_for_update_locks(facility, template):
    from django.db import connection, transaction
    from django.test.utils import CaptureQueriesContext

    binding = svc.create_binding(
        actor=ACTOR, facility_id=facility.pk, template_code=template.pk
    )
    with transaction.atomic():
        with CaptureQueriesContext(connection) as ctx:
            ChecklistBindingSelector.get_for_update(binding.pk)
    assert any("FOR UPDATE" in q["sql"] for q in ctx.captured_queries)
