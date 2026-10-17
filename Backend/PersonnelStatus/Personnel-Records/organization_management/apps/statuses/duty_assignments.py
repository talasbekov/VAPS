"""Validated placement snapshots; dates and lifecycle belong to EmployeeStatus."""
from django.core.exceptions import ValidationError

from organization_management.apps.operations.models_object import OpsSecurityObject, OpsSecurityPost

DUTY_CODES = frozenset({"on_duty", "DUTY"})
DUTY_GROUPS = {
    "duty-group-1": "Группа №1",
    "duty-group-2": "Группа №2",
    "duty-group-3": "Группа №3",
    "duty-group-reserve": "Резервная группа",
}


def assignment_location(assignment):
    """Keep the legacy location consistent without truncating the snapshot."""
    placement = assignment["post_name"] if assignment["kind"] == "POST" else assignment["group_name"]
    return " · ".join(part for part in (assignment["object_name"], placement) if part)[:255]


def identifier(value):
    """String API identifiers are positive database keys, never names."""
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        return None
    text = str(value)
    if len(text) > 19 or not text.isascii() or not text.isdigit() or not 0 < int(text) <= 9223372036854775807:
        return None
    return str(int(text))


def normalize_assignment(raw, *, status_type, start_date, end_date, previous=None):
    """Resolve names on the server; unchanged snapshots survive passport edits."""
    if raw is None:
        return None

    def invalid(message):
        raise ValidationError({"duty_assignment": message})

    if status_type not in DUTY_CODES:
        invalid("Наряд допустим только для статуса «На дежурстве».")
    if not start_date or not end_date or end_date < start_date:
        invalid("Для наряда укажите корректные даты начала и окончания.")
    if not isinstance(raw, dict) or raw.get("kind") not in ("POST", "GROUP"):
        invalid("Выберите постовое или групповое дежурство.")
    kind = raw["kind"]
    object_id = identifier(raw.get("object_id"))
    if object_id is None:
        invalid("Выберите объект из реестра.")
    post_id = identifier(raw.get("post_id")) if kind == "POST" else None
    group_id = raw.get("group_id") if kind == "GROUP" else None
    if kind == "POST" and (post_id is None or raw.get("group_id")):
        invalid("Для постового дежурства выберите только пост.")
    if kind == "GROUP" and (not isinstance(group_id, str) or group_id not in DUTY_GROUPS or raw.get("post_id")):
        invalid("Выберите группу из списка; пост для группы не указывается.")
    identity = {"kind": kind, "object_id": object_id, "post_id": post_id, "group_id": group_id}
    if isinstance(previous, dict) and all(previous.get(key) == value for key, value in identity.items()):
        return previous.copy()
    obj = OpsSecurityObject.objects.filter(pk=object_id).first()
    if obj is None or obj.object_state != OpsSecurityObject.ObjectState.ACTIVE:
        invalid("Объект не найден или находится в архиве.")
    post = None
    if kind == "POST":
        post = OpsSecurityPost.objects.select_related("sector").filter(pk=post_id, sector__security_object_id=obj.pk).first()
        if post is None:
            invalid("Пост не принадлежит выбранному объекту или больше не существует.")
    return {**identity, "object_name": obj.name,
        "post_name": post.name if post else None,
        "sector_name": post.sector.name if post else None,
        "group_name": DUTY_GROUPS[group_id] if group_id else None}


def assignment_for_update(attrs, instance=None):
    """Missing metadata keeps old clients compatible; changing type removes it."""
    status_type = attrs.get("status_type", getattr(instance, "status_type", None))
    previous = getattr(instance, "duty_assignment", None)
    raw = attrs.get("duty_assignment", previous)
    if "duty_assignment" not in attrs and status_type not in DUTY_CODES:
        return None
    return normalize_assignment(raw, status_type=status_type,
        start_date=attrs.get("start_date", getattr(instance, "start_date", None)),
        end_date=attrs.get("end_date", getattr(instance, "end_date", None)), previous=previous)
