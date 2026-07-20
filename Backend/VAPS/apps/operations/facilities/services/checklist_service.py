"""Checklist binding/override services (14.3a) — the only writers of the
checklist business layer.

Inherits every 14.1/14.2 service canon: actor kwarg, locked reads inside
atomic, pre-check duplicates (sequential 409) + CONSTRAINT_ERROR_MAP race
backstop, honest noop on updates, structural 409 for state conflicts, frozen-
aggregate guard on EVERY mutation, flat public keys in audit diffs.

Layer-specific contracts:
- ``source_item`` resolves UNDER LOCK inside the mutation's transaction: a
  concurrent admin delete of the item blocks until commit, otherwise the
  INSERT dies on the FK as an unmapped 500 (the 14.2 TOCTOU lesson). The item
  must belong to the BINDING'S template and be globally active.
- ``deactivate_binding`` DELETEs the binding's overrides (service-level
  mirror of the donor's CASCADE-on-DELETE): dead overrides would PROTECT
  their items forever with no service path left to release them.
- ``is_default`` switches in two explicit steps (unset old → set new): an
  auto-unset would silently mutate a row the actor never named.
- BR-CHECKLIST-004 (permission ``object.checklist.override_required`` for
  disabling a required standard item) is a NAMED DEFER to the API story
  (14.11/15.3) + RBAC rows (14.12): services take the flat actor string
  (ARCH-007), enforcement lives at the HTTP layer.
"""

import uuid

from django.db import transaction

from apps.audit.services import record
from apps.core.exceptions import DomainError
from apps.operations.facilities.models import (
    ChecklistBinding,
    ChecklistItem,
    ChecklistOverride,
    ChecklistTemplate,
)
from apps.operations.facilities.selectors import (
    ChecklistBindingSelector,
    FacilitySelector,
    _canonize_pk,
)
from apps.operations.facilities.services.facility_service import (
    _invalid,
    _require_actor,
)
from apps.operations.facilities.services.topology_service import (
    _canonize_bool,
    _canonize_int,
    _check_unknown,
    _require_active_facility,
)

_BINDING_NS = uuid.uuid5(uuid.NAMESPACE_URL, "vaps:checklist_binding")
_OVERRIDE_NS = uuid.uuid5(uuid.NAMESPACE_URL, "vaps:checklist_override")

OVERRIDE_TYPES = frozenset({"ADD", "MODIFY", "DISABLE"})
BINDING_EDITABLE_FIELDS = frozenset({"name", "is_default"})

_OVERRIDE_PAYLOAD_FIELDS = ("text", "category", "is_required", "sort_order")


def _binding_inactive(pk) -> DomainError:
    return DomainError(
        "CHECKLIST_BINDING_ALREADY_INACTIVE",
        409,
        detail={"binding_id": pk},
        message="Привязка чек-листа деактивирована.",
    )


def _require_active_binding(binding):
    if not binding.is_active:
        raise _binding_inactive(binding.pk)


def _canonize_opt_str(value, field, max_len):
    """NULL — единственное пустое состояние (канон item.category): пустую
    строку не коэрсим в NULL молча — это скрыло бы баг вызывающего."""
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise _invalid(
            field, f"Поле {field} — null или непустая строка."
        )
    value = value.strip()
    if len(value) > max_len:
        raise _invalid(field, f"Поле {field} длиннее {max_len} символов.")
    return value


def _canonize_reason(value):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise _invalid("reason", "Поле reason должно быть строкой.")
    return value.strip()


def _resolve_template_locked(code):
    # Under lock: a concurrent admin delete of a binding-less template would
    # otherwise slip between resolve and INSERT (unmapped FK 500).
    if not isinstance(code, str) or not code.strip():
        raise _invalid("template_code", "Поле template_code обязательно.")
    code = code.strip()
    template = (
        ChecklistTemplate.objects.select_for_update()
        .filter(pk=code, is_active=True)
        .first()
    )
    if template is None:
        raise _invalid(
            "template_code",
            f"Неизвестный или неактивный шаблон чек-листа: {code}.",
        )
    return template


def _resolve_source_item_locked(binding, source_item_id):
    canonical = _canonize_pk(source_item_id, "source_item_id")
    item = (
        ChecklistItem.objects.select_for_update().filter(pk=canonical).first()
    )
    if item is None:
        raise _invalid(
            "source_item_id", f"Пункт {canonical} не существует."
        )
    if item.template_id != binding.template_id:
        raise _invalid(
            "source_item_id", "Пункт принадлежит другому шаблону."
        )
    if not item.is_active:
        raise _invalid(
            "source_item_id",
            "Пункт глобально выключен — оверрайд бессмыслен.",
        )
    return item


def _default_conflict(facility_pk) -> DomainError:
    return DomainError(
        "CHECKLIST_DEFAULT_ALREADY_SET",
        409,
        detail={"facility_id": facility_pk},
        message=(
            "У объекта уже есть дефолтная привязка — сначала снимите её."
        ),
    )


# --- Binding -----------------------------------------------------------------


def create_binding(
    *, actor, facility_id, template_code, name=None, is_default=False
) -> ChecklistBinding:
    actor = _require_actor(actor)
    name = _canonize_opt_str(name, "name", 255)
    is_default = _canonize_bool(is_default, "is_default")

    with transaction.atomic():
        facility = FacilitySelector.get_for_update(facility_id)
        _require_active_facility(facility)
        template = _resolve_template_locked(template_code)
        if ChecklistBinding.objects.filter(
            facility_id=facility.pk, template_id=template.pk, is_active=True
        ).exists():
            raise DomainError(
                "CHECKLIST_BINDING_ALREADY_EXISTS",
                409,
                detail={
                    "facility_id": facility.pk,
                    "template_code": template.pk,
                },
                message="Шаблон уже привязан к объекту.",
            )
        if is_default and ChecklistBinding.objects.filter(
            facility_id=facility.pk, is_default=True, is_active=True
        ).exists():
            raise _default_conflict(facility.pk)
        binding = ChecklistBinding.objects.create(
            facility=facility,
            template=template,
            name=name,
            is_default=is_default,
            created_by=actor,
        )
        record(
            actor=actor,
            action="CHECKLIST_BINDING_CREATED",
            entity_type="checklist_binding",
            entity_id=uuid.uuid5(_BINDING_NS, str(binding.pk)),
            new_value={
                "id": binding.pk,
                "facility_id": facility.pk,
                "template_code": template.pk,
                "name": binding.name,
                "is_default": binding.is_default,
            },
        )
    return binding


def update_binding(*, actor, binding_id, changes) -> ChecklistBinding:
    actor = _require_actor(actor)
    _check_unknown(changes, BINDING_EDITABLE_FIELDS, "привязки")

    canonized = {}
    if "name" in changes:
        canonized["name"] = _canonize_opt_str(changes["name"], "name", 255)
    if "is_default" in changes:
        canonized["is_default"] = _canonize_bool(
            changes["is_default"], "is_default"
        )

    with transaction.atomic():
        binding = ChecklistBindingSelector.get_for_update(binding_id)
        _require_active_facility(binding.facility)
        _require_active_binding(binding)
        if (
            canonized.get("is_default")
            and not binding.is_default
            and ChecklistBinding.objects.filter(
                facility_id=binding.facility_id,
                is_default=True,
                is_active=True,
            )
            .exclude(pk=binding.pk)
            .exists()
        ):
            raise _default_conflict(binding.facility_id)

        old_diff, new_diff = {}, {}
        for field, new_value in canonized.items():
            current = getattr(binding, field)
            if current != new_value:
                old_diff[field] = current
                new_diff[field] = new_value
                setattr(binding, field, new_value)
        if not new_diff:
            return binding
        binding.save(update_fields=[*new_diff, "updated_at"])
        record(
            actor=actor,
            action="CHECKLIST_BINDING_UPDATED",
            entity_type="checklist_binding",
            entity_id=uuid.uuid5(_BINDING_NS, str(binding.pk)),
            old_value=old_diff,
            new_value=new_diff,
        )
    return binding


def _deactivate_binding_row(actor, binding) -> None:
    """Деактивирует УЖЕ залоченную активную привязку: зачистка оверрайдов +
    собственная audit-строка. Общий путь deactivate_binding и каскада
    deactivate_facility (ревью 14.3a: заморозка объекта не должна оставлять
    оверрайды, вечно запирающие пункт через PROTECT)."""
    removed = list(
        ChecklistOverride.objects.select_for_update(of=("self",))
        .filter(binding_id=binding.pk)
        .order_by("id")
    )
    if removed:
        # Зеркало донорского CASCADE при soft-delete: мёртвые оверрайды
        # через PROTECT навсегда запирали бы удаление пункта в admin.
        ChecklistOverride.objects.filter(
            pk__in=[o.pk for o in removed]
        ).delete()
    binding.is_active = False
    binding.save(update_fields=["is_active", "updated_at"])
    # Контент удалённых строк — в old_value (рационал Д4: hard-DELETE без
    # снимка в аудите невосстановим), их id — в new_value (канон
    # untied_post_ids); оба ключа только при непустом списке.
    old_value = {"is_active": True}
    new_value = {"is_active": False}
    if removed:
        old_value["overrides"] = [_override_snapshot(o) for o in removed]
        new_value["removed_override_ids"] = [o.pk for o in removed]
    record(
        actor=actor,
        action="CHECKLIST_BINDING_DEACTIVATED",
        entity_type="checklist_binding",
        entity_id=uuid.uuid5(_BINDING_NS, str(binding.pk)),
        old_value=old_value,
        new_value=new_value,
    )


def deactivate_binding(*, actor, binding_id) -> ChecklistBinding:
    actor = _require_actor(actor)
    with transaction.atomic():
        binding = ChecklistBindingSelector.get_for_update(binding_id)
        _require_active_facility(binding.facility)
        _require_active_binding(binding)
        _deactivate_binding_row(actor, binding)
    return binding


def deactivate_bindings_for_facility(actor, facility) -> list[int]:
    """Каскад deactivate_facility (вызывается ПОД его локом объекта, внутри
    его транзакции): деактивирует активные привязки замороженного объекта —
    каждая со своей audit-строкой. Без каскада привязки замороженного
    объекта недостижимы для cleanup-мутаций (гвард 409), а их оверрайды
    через PROTECT навсегда запирали бы удаление пунктов шаблона."""
    bindings = list(
        ChecklistBinding.objects.select_for_update(of=("self",))
        .filter(facility_id=facility.pk, is_active=True)
        .order_by("id")
    )
    for binding in bindings:
        _deactivate_binding_row(actor, binding)
    return [b.pk for b in bindings]


# --- Override ----------------------------------------------------------------


def _override_snapshot(override) -> dict:
    return {
        "id": override.pk,
        "binding_id": override.binding_id,
        "override_type": override.override_type,
        "source_item_id": override.source_item_id,
        "text": override.text,
        "category": override.category,
        "is_required": override.is_required,
        "sort_order": override.sort_order,
        "reason": override.reason,
    }


def add_override(
    *,
    actor,
    binding_id,
    override_type,
    source_item_id=None,
    text=None,
    category=None,
    is_required=None,
    sort_order=None,
    reason=None,
) -> ChecklistOverride:
    actor = _require_actor(actor)
    if (
        not isinstance(override_type, str)
        or override_type not in OVERRIDE_TYPES
    ):
        raise _invalid(
            "override_type",
            "override_type — один из ADD, MODIFY, DISABLE.",
        )
    text = None if text is None else _require_override_text(text)
    category = _canonize_opt_str(category, "category", 100)
    if is_required is not None and not isinstance(is_required, bool):
        raise _invalid("is_required", "Поле is_required — булево или null.")
    sort_order = _canonize_int(
        sort_order, "sort_order", 0, nullable=True
    )
    reason = _canonize_reason(reason)

    # Сервисные зеркала conditional-CHECKs формы — 400 с именем поля,
    # а не голый IntegrityError-500.
    payload = {
        "text": text,
        "category": category,
        "is_required": is_required,
        "sort_order": sort_order,
    }
    if override_type == "ADD":
        if source_item_id is not None:
            raise _invalid(
                "source_item_id", "ADD не ссылается на пункт шаблона."
            )
        if text is None:
            raise _invalid("text", "ADD требует текст пункта.")
    else:
        if source_item_id is None:
            raise _invalid(
                "source_item_id",
                f"{override_type} требует пункт шаблона.",
            )
        if override_type == "DISABLE":
            dirty = sorted(k for k, v in payload.items() if v is not None)
            if dirty:
                raise DomainError(
                    "VALIDATION_ERROR",
                    400,
                    detail={"fields": dirty},
                    message="DISABLE не несёт payload-полей.",
                )
        elif all(v is None for v in payload.values()):
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                detail={"fields": sorted(_OVERRIDE_PAYLOAD_FIELDS)},
                message=(
                    "MODIFY требует хотя бы одно из "
                    "text/category/is_required/sort_order."
                ),
            )

    with transaction.atomic():
        binding = ChecklistBindingSelector.get_for_update(binding_id)
        _require_active_facility(binding.facility)
        _require_active_binding(binding)
        source_item = None
        if source_item_id is not None:
            source_item = _resolve_source_item_locked(binding, source_item_id)
            if ChecklistOverride.objects.filter(
                binding_id=binding.pk, source_item_id=source_item.pk
            ).exists():
                raise DomainError(
                    "CHECKLIST_OVERRIDE_ALREADY_EXISTS",
                    409,
                    detail={
                        "binding_id": binding.pk,
                        "source_item_id": source_item.pk,
                    },
                    message="У пункта уже есть оверрайд в этой привязке.",
                )
        override = ChecklistOverride.objects.create(
            binding=binding,
            source_item=source_item,
            override_type=override_type,
            text=text,
            category=category,
            is_required=is_required,
            sort_order=sort_order,
            reason=reason,
            created_by=actor,
        )
        # BR-CHECKLIST-004 (permission object.checklist.override_required для
        # DISABLE required-пункта) — named defer: гейт на API-слое (Д7).
        record(
            actor=actor,
            action="CHECKLIST_OVERRIDE_CREATED",
            entity_type="checklist_override",
            entity_id=uuid.uuid5(_OVERRIDE_NS, str(override.pk)),
            new_value=_override_snapshot(override),
        )
    return override


def _require_override_text(value):
    if not isinstance(value, str) or not value.strip():
        raise _invalid("text", "Поле text — null или непустая строка.")
    return value.strip()


def remove_override(*, actor, override_id) -> None:
    actor = _require_actor(actor)
    canonical = _canonize_pk(override_id, "override_id")
    with transaction.atomic():
        # Единый глобальный порядок локов binding→override (как в
        # deactivate_binding): одно-запросный лок override JOIN binding
        # захватывал бы строки в план-зависимом порядке — deadlock с
        # конкурентной деактивацией привязки. binding_id иммутабелен,
        # поэтому нелокированная проба не устаревает.
        probe = (
            ChecklistOverride.objects.filter(pk=canonical)
            .values_list("binding_id", flat=True)
            .first()
        )
        if probe is None:
            raise DomainError(
                "ENTITY_NOT_FOUND", 404, detail={"override_id": str(canonical)}
            )
        binding = ChecklistBindingSelector.get_for_update(probe)
        _require_active_facility(binding.facility)
        # Через сервисный путь недостижимо (деактивация зачищает оверрайды) —
        # страхует raw-ORM/донор-импорт состояние.
        _require_active_binding(binding)
        override = (
            ChecklistOverride.objects.select_for_update(of=("self",))
            .filter(pk=canonical)
            .first()
        )
        if override is None:
            # Конкурентное удаление между пробой и локом привязки.
            raise DomainError(
                "ENTITY_NOT_FOUND", 404, detail={"override_id": str(canonical)}
            )
        snapshot = _override_snapshot(override)
        override.delete()
        record(
            actor=actor,
            action="CHECKLIST_OVERRIDE_REMOVED",
            entity_type="checklist_override",
            entity_id=uuid.uuid5(_OVERRIDE_NS, str(snapshot["id"])),
            old_value=snapshot,
        )
