"""Model/constraint/admin tests for the checklist catalogs (14.3).

Templates+items are admin-managed catalogs (FR-5.5 «типовой единый»), not
business models: no services, no audit — the object-scoped business layer
(bindings/overrides/resolver) is 14.3a.
"""

import pytest
from django.db import IntegrityError, transaction

from apps.operations.facilities.models import ChecklistItem, ChecklistTemplate

pytestmark = pytest.mark.django_db


def _template(**overrides):
    fields = {"code": "STANDARD", "name": "Типовой чек-лист"}
    fields.update(overrides)
    return ChecklistTemplate.objects.create(**fields)


def _item(template, **overrides):
    fields = {"template": template, "text": "Проверить периметр"}
    fields.update(overrides)
    return ChecklistItem.objects.create(**fields)


# --- Template ----------------------------------------------------------------


def test_template_natural_pk_and_defaults():
    template = _template()
    assert template.pk == "STANDARD"
    assert template.is_active is True
    assert template.description == ""


def test_template_blank_name_rejected():
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _template(name="   ")
    assert "chk_checklist_template_name_not_blank" in str(excinfo.value)


def test_template_blank_code_rejected():
    # \S-канон применяется и к ИДЕНТИЧНОСТИ справочника (Facility.code
    # precedent) — data-миграция наполнения не должна суметь создать
    # whitespace-PK, невидимый в admin-списке.
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _template(code="   ")
    assert "chk_checklist_template_code_not_blank" in str(excinfo.value)


def test_duplicate_code_create_rejected():
    # Пин контракта natural PK: objects.create (INSERT) второго шаблона с
    # тем же кодом — IntegrityError; тихая upsert-семантика plain save()
    # заблокирована в admin (_NaturalPkAdmin: code readonly при editing),
    # программные писатели обязаны использовать create()/update_or_create.
    _template()
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            _template(name="Дубль")


# --- Item --------------------------------------------------------------------


def test_item_defaults(db):
    item = _item(_template())
    assert item.is_required is True
    assert item.sort_order == 0
    assert item.is_active is True
    assert item.category is None


def test_item_blank_text_rejected():
    template = _template()
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _item(template, text=" \t ")
    assert "chk_checklist_item_text_not_blank" in str(excinfo.value)


def test_item_negative_sort_order_rejected():
    template = _template()
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _item(template, sort_order=-1)
    assert "chk_checklist_item_sort_order_min" in str(excinfo.value)


def test_item_zero_sort_order_accepted():
    assert _item(_template(), sort_order=0).pk


def test_item_blank_category_rejected_null_is_the_empty_state():
    # '' ≠ NULL распадает «без категории» на две группы у 14.3a-резолвера —
    # единственное пустое состояние = NULL, гард на БД.
    template = _template()
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _item(template, category="   ")
    assert "chk_checklist_item_category_not_blank" in str(excinfo.value)
    assert _item(template, category=None).pk
    assert _item(template, text="Другой", category="Периметр").pk


def test_items_ordered_by_sort_order_then_id():
    template = _template()
    second = _item(template, text="Б", sort_order=1)
    first = _item(template, text="А", sort_order=0)
    tie = _item(template, text="В", sort_order=1)
    assert [i.pk for i in template.items.all()] == [first.pk, second.pk, tie.pk]
    # Поведенческая проба на 3 строках не отличает heap-порядок от
    # tie-breaker'а (Postgres вернёт порядок вставки и без id) — контракт
    # ordering пинуется буквально.
    assert ChecklistItem._meta.ordering == ["sort_order", "id"]


def test_deleting_template_cascades_to_items():
    template = _template()
    _item(template)
    template.delete()
    assert ChecklistItem.objects.count() == 0


# --- Admin catalog contract --------------------------------------------------


def test_checklist_catalogs_registered_in_admin():
    from django.contrib import admin

    from apps.operations.facilities.models import Facility, Post, Sector

    admin.autodiscover()
    assert ChecklistTemplate in admin.site._registry
    # Items are edited ONLY through the template inline — a standalone
    # changelist would invite editing состава мимо контекста шаблона.
    assert ChecklistItem not in admin.site._registry
    assert Facility not in admin.site._registry
    assert Sector not in admin.site._registry
    assert Post not in admin.site._registry


def test_template_admin_has_items_inline():
    from django.contrib import admin

    admin.autodiscover()
    inlines = admin.site._registry[ChecklistTemplate].inlines
    assert any(inline.model is ChecklistItem for inline in inlines)


def test_template_change_form_with_inline_renders():
    # Change-форма — ЕДИНСТВЕННЫЙ путь редактирования пунктов; changelist-
    # тест стража её не открывает, а system checks не ловят runtime-ломки
    # формсета (прецедент SubmissionControlSettings change-view).
    from django.contrib.auth import get_user_model
    from django.test import Client
    from django.urls import reverse

    template = _template()
    _item(template)
    superuser = get_user_model().objects.create_superuser(
        username="admin", password="pw"
    )
    client = Client()
    client.force_login(superuser)
    url = reverse(
        "admin:ops_facilities_checklisttemplate_change", args=[template.pk]
    )
    assert client.get(url).status_code == 200


def test_admin_code_is_readonly_when_editing():
    # Пробой подтверждено: редактируемый natural PK в change-форме молча
    # перезаписывает ЧУЖУЮ строку (UPDATE-or-INSERT семантика save()).
    from django.contrib import admin

    template_admin = admin.site._registry[ChecklistTemplate]
    assert "code" in template_admin.get_readonly_fields(None, obj=_template())
    assert "code" not in template_admin.get_readonly_fields(None, obj=None)
