"""Service tests for the checklist business layer (14.3a, AC 1,2,4,5).

Inherited pins: FOR UPDATE in captured SQL, atomicity red probes via
monkeypatched record(), honest noop (updated_at snapshot), structural 409 for
state conflicts, whitelist drift vs model, flat public keys in audit.
"""

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.audit.models import AuditLog
from apps.core.exceptions import DomainError
from apps.operations.facilities.models import (
    ChecklistBinding,
    ChecklistItem,
    ChecklistOverride,
    ChecklistTemplate,
)
from apps.operations.facilities.services import (
    checklist_service as svc,
)
from apps.operations.facilities.services import (
    create_facility,
    deactivate_facility,
)

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
def item(template):
    return ChecklistItem.objects.create(
        template=template, text="Проверить периметр"
    )


def _binding(facility, template, **overrides):
    fields = {
        "actor": ACTOR,
        "facility_id": facility.pk,
        "template_code": template.pk,
    }
    fields.update(overrides)
    return svc.create_binding(**fields)


# --- create_binding ----------------------------------------------------------


def test_create_binding_audits_flat_keys(facility, template):
    import uuid

    binding = _binding(facility, template)
    assert binding.created_by == ACTOR
    assert binding.name is None and binding.is_default is False
    log = AuditLog.objects.get(action="CHECKLIST_BINDING_CREATED")
    assert log.entity_type == "checklist_binding"
    assert log.new_value["facility_id"] == facility.pk
    assert log.new_value["template_code"] == "STANDARD"
    # Ось сущности: свап неймспейса/соли pk молча рвёт аудит-историю.
    assert log.entity_id == uuid.uuid5(
        uuid.uuid5(uuid.NAMESPACE_URL, "vaps:checklist_binding"),
        str(binding.pk),
    )


def _for_update_sqls(ctx, table):
    return [
        q["sql"]
        for q in ctx.captured_queries
        if "FOR UPDATE" in q["sql"] and table in q["sql"]
    ]


def test_create_binding_locks_facility_and_template(facility, template):
    # Локи ассертятся ПО ТАБЛИЦАМ: any("FOR UPDATE") удовлетворял бы один
    # лок facility, оставляя TOCTOU-гонку по шаблону незапиненной (ревью).
    with CaptureQueriesContext(connection) as ctx:
        _binding(facility, template)
    assert _for_update_sqls(ctx, '"ops_facilities"')
    assert _for_update_sqls(ctx, '"ops_checklist_templates"')


def test_create_binding_duplicate_409(facility, template):
    _binding(facility, template)
    with pytest.raises(DomainError) as excinfo:
        _binding(facility, template)
    assert excinfo.value.code == "CHECKLIST_BINDING_ALREADY_EXISTS"
    assert excinfo.value.http_status == 409


def test_create_binding_after_deactivate_allowed(facility, template):
    first = _binding(facility, template)
    svc.deactivate_binding(actor=ACTOR, binding_id=first.pk)
    assert _binding(facility, template).pk != first.pk


def test_create_binding_unknown_template_400(facility):
    with pytest.raises(DomainError) as excinfo:
        svc.create_binding(
            actor=ACTOR, facility_id=facility.pk, template_code="NOPE"
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_create_binding_inactive_template_400(facility, template):
    ChecklistTemplate.objects.filter(pk=template.pk).update(is_active=False)
    with pytest.raises(DomainError) as excinfo:
        _binding(facility, template)
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_create_binding_frozen_facility_409(facility, template):
    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    with pytest.raises(DomainError) as excinfo:
        _binding(facility, template)
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"


def test_create_binding_blank_name_400(facility, template):
    with pytest.raises(DomainError) as excinfo:
        _binding(facility, template, name="   ")
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_create_binding_second_default_409(facility, template):
    other = ChecklistTemplate.objects.create(code="EXTRA", name="Доп")
    _binding(facility, template, is_default=True)
    with pytest.raises(DomainError) as excinfo:
        _binding(facility, other, is_default=True)
    assert excinfo.value.code == "CHECKLIST_DEFAULT_ALREADY_SET"
    assert excinfo.value.http_status == 409


def test_default_switch_is_two_step(facility, template):
    # Auto-unset был бы молчаливой мутацией чужой строки (Д5): снять → поставить.
    other = ChecklistTemplate.objects.create(code="EXTRA", name="Доп")
    first = _binding(facility, template, is_default=True)
    second = _binding(facility, other)
    svc.update_binding(
        actor=ACTOR, binding_id=first.pk, changes={"is_default": False}
    )
    updated = svc.update_binding(
        actor=ACTOR, binding_id=second.pk, changes={"is_default": True}
    )
    assert updated.is_default is True


# --- update_binding ----------------------------------------------------------


def test_update_binding_diff_audit_and_lock(facility, template):
    binding = _binding(facility, template)
    with CaptureQueriesContext(connection) as ctx:
        svc.update_binding(
            actor=ACTOR,
            binding_id=binding.pk,
            changes={"name": "Именованная"},
        )
    assert any("FOR UPDATE" in q["sql"] for q in ctx.captured_queries)
    log = AuditLog.objects.get(action="CHECKLIST_BINDING_UPDATED")
    assert log.old_value == {"name": None}
    assert log.new_value == {"name": "Именованная"}


def test_update_binding_honest_noop(facility, template):
    binding = _binding(facility, template, name="Имя")
    snapshot = binding.updated_at
    result = svc.update_binding(
        actor=ACTOR, binding_id=binding.pk, changes={"name": "Имя"}
    )
    result.refresh_from_db()
    assert result.updated_at == snapshot
    assert not AuditLog.objects.filter(
        action="CHECKLIST_BINDING_UPDATED"
    ).exists()


def test_update_binding_unknown_field_400(facility, template):
    binding = _binding(facility, template)
    with pytest.raises(DomainError) as excinfo:
        svc.update_binding(
            actor=ACTOR,
            binding_id=binding.pk,
            changes={"template_code": "X", "zzz": 1},
        )
    assert excinfo.value.code == "VALIDATION_ERROR"
    assert excinfo.value.detail["unknown_fields"] == ["template_code", "zzz"]


def test_update_binding_default_self_reassert_is_noop(facility, template):
    # «Уже дефолт» + {"is_default": True} — honest noop, НЕ ложный 409:
    # владелец само-исключения — pre-check (not binding.is_default).
    binding = _binding(facility, template, is_default=True)
    snapshot = binding.updated_at
    result = svc.update_binding(
        actor=ACTOR, binding_id=binding.pk, changes={"is_default": True}
    )
    result.refresh_from_db()
    assert result.is_default is True
    assert result.updated_at == snapshot
    assert not AuditLog.objects.filter(
        action="CHECKLIST_BINDING_UPDATED"
    ).exists()


def test_update_binding_default_conflict_409(facility, template):
    other = ChecklistTemplate.objects.create(code="EXTRA", name="Доп")
    _binding(facility, template, is_default=True)
    second = _binding(facility, other)
    with pytest.raises(DomainError) as excinfo:
        svc.update_binding(
            actor=ACTOR, binding_id=second.pk, changes={"is_default": True}
        )
    assert excinfo.value.code == "CHECKLIST_DEFAULT_ALREADY_SET"


def test_update_binding_inactive_409(facility, template):
    binding = _binding(facility, template)
    svc.deactivate_binding(actor=ACTOR, binding_id=binding.pk)
    with pytest.raises(DomainError) as excinfo:
        svc.update_binding(
            actor=ACTOR, binding_id=binding.pk, changes={"name": "Имя"}
        )
    assert excinfo.value.code == "CHECKLIST_BINDING_ALREADY_INACTIVE"


def test_update_binding_frozen_facility_409(facility, template):
    binding = _binding(facility, template)
    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    with pytest.raises(DomainError) as excinfo:
        svc.update_binding(
            actor=ACTOR, binding_id=binding.pk, changes={"name": "Имя"}
        )
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"


def test_binding_whitelist_mirrors_model():
    excluded = {
        "id",
        "facility",
        "template",
        "is_active",
        "created_at",
        "updated_at",
        "created_by",
        "overrides",
    }
    model_fields = {
        f.name
        for f in ChecklistBinding._meta.get_fields()
        if f.name not in excluded
    }
    assert model_fields == svc.BINDING_EDITABLE_FIELDS


# --- deactivate_binding ------------------------------------------------------


def test_deactivate_binding_wipes_overrides(facility, template, item):
    # Зеркало донорского CASCADE при soft-delete: мёртвые оверрайды через
    # PROTECT навсегда запирали бы удаление пункта в admin (Д1).
    binding = _binding(facility, template)
    o1 = svc.add_override(
        actor=ACTOR,
        binding_id=binding.pk,
        override_type="DISABLE",
        source_item_id=item.pk,
    )
    o2 = svc.add_override(
        actor=ACTOR,
        binding_id=binding.pk,
        override_type="ADD",
        text="Доп. пункт",
    )
    with CaptureQueriesContext(connection) as ctx:
        svc.deactivate_binding(actor=ACTOR, binding_id=binding.pk)
    # Лок ЗАЧИЩАЕМЫХ строк — по таблице: any("FOR UPDATE") удовлетворял бы
    # один лок привязки, оставляя нелокированную зачистку незапиненной.
    assert _for_update_sqls(ctx, '"ops_checklist_overrides"')
    assert _for_update_sqls(ctx, '"ops_checklist_bindings"')
    assert ChecklistOverride.objects.count() == 0
    item.delete()  # PROTECT-замок снят
    log = AuditLog.objects.get(action="CHECKLIST_BINDING_DEACTIVATED")
    assert sorted(log.new_value["removed_override_ids"]) == sorted(
        [o1.pk, o2.pk]
    )
    # Контент hard-DELETE-строк восстановим по аудиту (рационал Д4).
    assert [o["id"] for o in log.old_value["overrides"]] == [o1.pk, o2.pk]
    assert log.old_value["overrides"][1]["text"] == "Доп. пункт"


def test_deactivate_binding_without_overrides_no_removed_key(
    facility, template
):
    binding = _binding(facility, template)
    svc.deactivate_binding(actor=ACTOR, binding_id=binding.pk)
    log = AuditLog.objects.get(action="CHECKLIST_BINDING_DEACTIVATED")
    assert "removed_override_ids" not in log.new_value
    assert "overrides" not in log.old_value


def test_deactivate_facility_cascades_bindings(facility, template, item):
    # Ревью 14.3a: без каскада привязки замороженного объекта недостижимы
    # для cleanup (гвард 409), а их оверрайды через PROTECT навсегда
    # запирали бы удаление пункта шаблона.
    binding = _binding(facility, template)
    svc.add_override(
        actor=ACTOR,
        binding_id=binding.pk,
        override_type="DISABLE",
        source_item_id=item.pk,
    )
    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    binding.refresh_from_db()
    assert binding.is_active is False
    assert ChecklistOverride.objects.count() == 0
    item.delete()  # PROTECT-замок снят
    # Каскад аудируем: своя строка привязки + список в объекте.
    bind_log = AuditLog.objects.get(action="CHECKLIST_BINDING_DEACTIVATED")
    assert bind_log.new_value["removed_override_ids"]
    fac_log = AuditLog.objects.get(action="FACILITY_DEACTIVATED")
    assert fac_log.new_value["deactivated_checklist_binding_ids"] == [
        binding.pk
    ]
    # Резолв после заморозки — структурный 409 (привязка деактивирована).
    from apps.operations.facilities.selectors import resolve_checklist

    with pytest.raises(DomainError) as excinfo:
        resolve_checklist(ACTOR, binding.pk)
    assert excinfo.value.code == "CHECKLIST_BINDING_ALREADY_INACTIVE"


def test_deactivate_facility_without_bindings_no_cascade_key(facility):
    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    log = AuditLog.objects.get(action="FACILITY_DEACTIVATED")
    assert "deactivated_checklist_binding_ids" not in log.new_value


def test_deactivate_binding_twice_409(facility, template):
    binding = _binding(facility, template)
    svc.deactivate_binding(actor=ACTOR, binding_id=binding.pk)
    with pytest.raises(DomainError) as excinfo:
        svc.deactivate_binding(actor=ACTOR, binding_id=binding.pk)
    assert excinfo.value.code == "CHECKLIST_BINDING_ALREADY_INACTIVE"


def test_deactivate_binding_frozen_facility_409(facility, template):
    binding = _binding(facility, template)
    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    with pytest.raises(DomainError) as excinfo:
        svc.deactivate_binding(actor=ACTOR, binding_id=binding.pk)
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"


# --- add_override ------------------------------------------------------------


def test_add_override_modify_audits_flat_keys(facility, template, item):
    import uuid

    binding = _binding(facility, template)
    override = svc.add_override(
        actor=ACTOR,
        binding_id=binding.pk,
        override_type="MODIFY",
        source_item_id=item.pk,
        text="Уточнённый текст",
        reason="специфика объекта",
    )
    assert override.created_by == ACTOR
    log = AuditLog.objects.get(action="CHECKLIST_OVERRIDE_CREATED")
    assert log.entity_type == "checklist_override"
    assert log.new_value["binding_id"] == binding.pk
    assert log.new_value["source_item_id"] == item.pk
    assert log.new_value["override_type"] == "MODIFY"
    assert log.entity_id == uuid.uuid5(
        uuid.uuid5(uuid.NAMESPACE_URL, "vaps:checklist_override"),
        str(override.pk),
    )


def test_add_override_locks_source_item(facility, template, item):
    # Локированный резолв пункта внутри транзакции: конкурентный admin-delete
    # блокируется до коммита (TOCTOU-канон 14.2) — иначе FK-гонка = 500.
    binding = _binding(facility, template)
    with CaptureQueriesContext(connection) as ctx:
        svc.add_override(
            actor=ACTOR,
            binding_id=binding.pk,
            override_type="DISABLE",
            source_item_id=item.pk,
        )
    item_locks = [
        q["sql"]
        for q in ctx.captured_queries
        if "FOR UPDATE" in q["sql"] and "ops_checklist_items" in q["sql"]
    ]
    assert item_locks


def test_add_override_unknown_type_400(facility, template):
    binding = _binding(facility, template)
    with pytest.raises(DomainError) as excinfo:
        svc.add_override(
            actor=ACTOR, binding_id=binding.pk, override_type="PATCH"
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_add_override_add_with_source_400(facility, template, item):
    binding = _binding(facility, template)
    with pytest.raises(DomainError) as excinfo:
        svc.add_override(
            actor=ACTOR,
            binding_id=binding.pk,
            override_type="ADD",
            source_item_id=item.pk,
            text="Доп",
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_add_override_add_without_text_400(facility, template):
    binding = _binding(facility, template)
    with pytest.raises(DomainError) as excinfo:
        svc.add_override(
            actor=ACTOR, binding_id=binding.pk, override_type="ADD"
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_add_override_modify_without_source_400(facility, template):
    binding = _binding(facility, template)
    with pytest.raises(DomainError) as excinfo:
        svc.add_override(
            actor=ACTOR,
            binding_id=binding.pk,
            override_type="MODIFY",
            text="Правка",
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_add_override_modify_empty_payload_400(facility, template, item):
    binding = _binding(facility, template)
    with pytest.raises(DomainError) as excinfo:
        svc.add_override(
            actor=ACTOR,
            binding_id=binding.pk,
            override_type="MODIFY",
            source_item_id=item.pk,
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_add_override_disable_with_payload_400(facility, template, item):
    binding = _binding(facility, template)
    with pytest.raises(DomainError) as excinfo:
        svc.add_override(
            actor=ACTOR,
            binding_id=binding.pk,
            override_type="DISABLE",
            source_item_id=item.pk,
            is_required=False,
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_add_override_blank_text_400(facility, template):
    binding = _binding(facility, template)
    with pytest.raises(DomainError) as excinfo:
        svc.add_override(
            actor=ACTOR,
            binding_id=binding.pk,
            override_type="ADD",
            text="   ",
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_add_override_foreign_template_item_400(facility, template):
    other = ChecklistTemplate.objects.create(code="EXTRA", name="Доп")
    foreign = ChecklistItem.objects.create(template=other, text="Чужой")
    binding = _binding(facility, template)
    with pytest.raises(DomainError) as excinfo:
        svc.add_override(
            actor=ACTOR,
            binding_id=binding.pk,
            override_type="DISABLE",
            source_item_id=foreign.pk,
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


def test_add_override_inactive_item_400(facility, template, item):
    ChecklistItem.objects.filter(pk=item.pk).update(is_active=False)
    binding = _binding(facility, template)
    with pytest.raises(DomainError) as excinfo:
        svc.add_override(
            actor=ACTOR,
            binding_id=binding.pk,
            override_type="DISABLE",
            source_item_id=item.pk,
        )
    assert excinfo.value.code == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    ("bad_pk", "code", "status"),
    [
        # Мусорный pk — общий _canonize_pk (канон 14.1: 404, не коэрсия);
        # None бьётся раньше формой DISABLE (source обязателен) — 400.
        ("abc", "ENTITY_NOT_FOUND", 404),
        (1.5, "ENTITY_NOT_FOUND", 404),
        (True, "ENTITY_NOT_FOUND", 404),
        (None, "VALIDATION_ERROR", 400),
    ],
)
def test_add_override_garbage_source_pk(facility, template, bad_pk, code, status):
    binding = _binding(facility, template)
    with pytest.raises(DomainError) as excinfo:
        svc.add_override(
            actor=ACTOR,
            binding_id=binding.pk,
            override_type="DISABLE",
            source_item_id=bad_pk,
        )
    assert excinfo.value.code == code
    assert excinfo.value.http_status == status


def test_add_override_duplicate_source_409(facility, template, item):
    binding = _binding(facility, template)
    svc.add_override(
        actor=ACTOR,
        binding_id=binding.pk,
        override_type="MODIFY",
        source_item_id=item.pk,
        text="Правка",
    )
    with pytest.raises(DomainError) as excinfo:
        svc.add_override(
            actor=ACTOR,
            binding_id=binding.pk,
            override_type="DISABLE",
            source_item_id=item.pk,
        )
    assert excinfo.value.code == "CHECKLIST_OVERRIDE_ALREADY_EXISTS"
    assert excinfo.value.http_status == 409


def test_add_override_inactive_binding_409(facility, template):
    binding = _binding(facility, template)
    svc.deactivate_binding(actor=ACTOR, binding_id=binding.pk)
    with pytest.raises(DomainError) as excinfo:
        svc.add_override(
            actor=ACTOR, binding_id=binding.pk, override_type="ADD", text="Доп"
        )
    assert excinfo.value.code == "CHECKLIST_BINDING_ALREADY_INACTIVE"


def test_add_override_frozen_facility_409(facility, template):
    binding = _binding(facility, template)
    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    with pytest.raises(DomainError) as excinfo:
        svc.add_override(
            actor=ACTOR, binding_id=binding.pk, override_type="ADD", text="Доп"
        )
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"


# --- remove_override ---------------------------------------------------------


def test_remove_override_full_snapshot_in_audit(facility, template, item):
    binding = _binding(facility, template)
    override = svc.add_override(
        actor=ACTOR,
        binding_id=binding.pk,
        override_type="MODIFY",
        source_item_id=item.pk,
        text="Правка",
        reason="потому",
    )
    with CaptureQueriesContext(connection) as ctx:
        svc.remove_override(actor=ACTOR, override_id=override.pk)
    # Единый порядок локов binding→override (deadlock-канон): привязка
    # лочится ОТДЕЛЬНЫМ запросом без таблицы оверрайдов, затем строка.
    binding_locks = _for_update_sqls(ctx, '"ops_checklist_bindings"')
    assert binding_locks
    assert all(
        '"ops_checklist_overrides"' not in sql for sql in binding_locks
    )
    assert _for_update_sqls(ctx, '"ops_checklist_overrides"')
    assert not ChecklistOverride.objects.filter(pk=override.pk).exists()
    log = AuditLog.objects.get(action="CHECKLIST_OVERRIDE_REMOVED")
    assert log.old_value == {
        "id": override.pk,
        "binding_id": binding.pk,
        "override_type": "MODIFY",
        "source_item_id": item.pk,
        "text": "Правка",
        "category": None,
        "is_required": None,
        "sort_order": None,
        "reason": "потому",
    }


def test_remove_override_unknown_404(facility):
    with pytest.raises(DomainError) as excinfo:
        svc.remove_override(actor=ACTOR, override_id=999999)
    assert excinfo.value.code == "ENTITY_NOT_FOUND"


def test_remove_override_inactive_binding_409(facility, template):
    # Через сервисный путь недостижимо (деактивация зачищает оверрайды) —
    # гвард страхует raw-ORM/донор-импорт состояние.
    binding = _binding(facility, template)
    orphan = ChecklistOverride.objects.create(
        binding_id=binding.pk, override_type="ADD", text="Сырой"
    )
    ChecklistBinding.objects.filter(pk=binding.pk).update(is_active=False)
    with pytest.raises(DomainError) as excinfo:
        svc.remove_override(actor=ACTOR, override_id=orphan.pk)
    assert excinfo.value.code == "CHECKLIST_BINDING_ALREADY_INACTIVE"


def test_remove_override_frozen_facility_409(facility, template):
    # Через сервисный путь недостижимо (каскад deactivate_facility зачищает
    # привязки и оверрайды) — гвард страхует raw-ORM/донор-импорт состояние:
    # замороженный объект с воскрешённой привязкой.
    binding = _binding(facility, template)
    override = svc.add_override(
        actor=ACTOR, binding_id=binding.pk, override_type="ADD", text="Доп"
    )
    deactivate_facility(actor=ACTOR, facility_id=facility.pk)
    ChecklistBinding.objects.filter(pk=binding.pk).update(is_active=True)
    orphan = ChecklistOverride.objects.create(
        binding_id=binding.pk, override_type="ADD", text="Сырой"
    )
    assert not ChecklistOverride.objects.filter(pk=override.pk).exists()
    with pytest.raises(DomainError) as excinfo:
        svc.remove_override(actor=ACTOR, override_id=orphan.pk)
    assert excinfo.value.code == "FACILITY_ALREADY_INACTIVE"


# --- атомарность и карта констрейнтов ---------------------------------------


@pytest.mark.parametrize(
    "mutation",
    [
        "create_binding",
        "update_binding",
        "deactivate_binding",
        "add_override",
        "remove_override",
    ],
)
def test_all_mutations_atomic_when_audit_fails(
    facility, template, item, monkeypatch, mutation
):
    # Каждая мутация живёт и умирает со своей audit-строкой; для
    # deactivate_binding это пиннит и откат зачистки оверрайдов.
    binding = _binding(facility, template)
    override = svc.add_override(
        actor=ACTOR,
        binding_id=binding.pk,
        override_type="MODIFY",
        source_item_id=item.pk,
        text="Правка",
    )

    def _boom(**kwargs):
        raise RuntimeError("audit down")

    monkeypatch.setattr(svc, "record", _boom)
    with pytest.raises(RuntimeError):
        if mutation == "create_binding":
            svc.create_binding(
                actor=ACTOR,
                facility_id=facility.pk,
                template_code=ChecklistTemplate.objects.create(
                    code="EXTRA", name="Доп"
                ).pk,
            )
        elif mutation == "update_binding":
            svc.update_binding(
                actor=ACTOR, binding_id=binding.pk, changes={"name": "Имя"}
            )
        elif mutation == "deactivate_binding":
            svc.deactivate_binding(actor=ACTOR, binding_id=binding.pk)
        elif mutation == "add_override":
            svc.add_override(
                actor=ACTOR,
                binding_id=binding.pk,
                override_type="ADD",
                text="Доп",
            )
        else:
            svc.remove_override(actor=ACTOR, override_id=override.pk)

    binding.refresh_from_db()
    assert binding.is_active is True
    assert binding.name is None
    assert ChecklistBinding.objects.count() == 1
    assert list(
        ChecklistOverride.objects.values_list("pk", flat=True)
    ) == [override.pk]


def test_constraint_map_covers_checklist_uniques():
    # Дрейф-гвард CONSTRAINT_ERROR_MAP: переименование уника превращает
    # race-409 в 500 'Unmapped IntegrityError'. Пиннятся и ЗНАЧЕНИЯ:
    # membership-проверка пропустила бы скопипащенный чужой код/статус.
    from apps.core.api.exception_handler import CONSTRAINT_ERROR_MAP

    real = {
        c.name
        for model in (ChecklistBinding, ChecklistOverride)
        for c in model._meta.constraints
    }
    ours = {
        "uq_checklist_binding_facility_template": (
            "CHECKLIST_BINDING_ALREADY_EXISTS",
            409,
            False,
        ),
        "uq_checklist_binding_default_per_facility": (
            "CHECKLIST_DEFAULT_ALREADY_SET",
            409,
            False,
        ),
        "uq_checklist_override_binding_source": (
            "CHECKLIST_OVERRIDE_ALREADY_EXISTS",
            409,
            False,
        ),
    }
    assert set(ours) <= real
    for name, expected in ours.items():
        assert CONSTRAINT_ERROR_MAP[name] == expected


def test_binding_selector_lock_scope(facility, template):
    # Состав of= пинуется буквально: facility ОБЯЗАН лочиться (frozen-гвард
    # читает его is_active), шаблон — НЕТ (общий справочник; его лок
    # сериализовал бы мутации чек-листов всех объектов).
    from django.db import transaction

    from apps.operations.facilities.selectors import ChecklistBindingSelector

    binding = _binding(facility, template)
    with transaction.atomic():
        with CaptureQueriesContext(connection) as ctx:
            ChecklistBindingSelector.get_for_update(binding.pk)
    (sql,) = [q["sql"] for q in ctx.captured_queries if "FOR UPDATE" in q["sql"]]
    of_clause = sql.split("FOR UPDATE OF", 1)[1]
    assert '"ops_checklist_bindings"' in of_clause
    assert '"ops_facilities"' in of_clause
    assert "template" not in of_clause


def test_full_lifecycle_chain(facility, template):
    # Цепочка целиком (AC-1+5+6): bind → override → resolve → deactivate →
    # re-bind → resolve ЧИСТ (re-binding starts with a clean override set).
    from apps.operations.facilities.models import ChecklistItem
    from apps.operations.facilities.selectors import resolve_checklist

    item = ChecklistItem.objects.create(template=template, text="Типовой")
    first = _binding(facility, template)
    svc.add_override(
        actor=ACTOR,
        binding_id=first.pk,
        override_type="MODIFY",
        source_item_id=item.pk,
        text="Правленый",
    )
    svc.add_override(
        actor=ACTOR, binding_id=first.pk, override_type="ADD", text="Врезка"
    )
    assert [r["text"] for r in resolve_checklist(ACTOR, first.pk)] == [
        "Правленый",
        "Врезка",
    ]
    svc.deactivate_binding(actor=ACTOR, binding_id=first.pk)
    second = _binding(facility, template)
    resolved = resolve_checklist(ACTOR, second.pk)
    assert [(r["origin"], r["text"]) for r in resolved] == [
        ("STANDARD", "Типовой")
    ]
