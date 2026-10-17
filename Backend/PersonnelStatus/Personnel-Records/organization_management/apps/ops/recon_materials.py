"""Private bytes and authorization for object-specific RECON working material."""
import hashlib
import hmac
import re
import warnings
from io import BytesIO
from uuid import uuid4

from django.core.files.base import ContentFile
from django.db import transaction
from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader
from pypdf.errors import PdfReadError
from rest_framework.exceptions import PermissionDenied

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.api.permissions import effective_permissions, require_permission, resolve_actor_id
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_event import OpsSecurityEvent, OpsSecurityEventVisitObject
from organization_management.apps.operations.models_recon_material import OpsReconMaterial
from organization_management.apps.operations.recon_material_storage import is_owned_recon_material_name
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.ops.event_actor_policy import can_manage_recon
from organization_management.apps.ops.security_events import _require_visit_chief, _require_visit_placement_editable, employee_scope_division

MAX_BYTES = 10 * 1024 * 1024
MAX_PER_VISIT = 30
IMAGE_FORMATS = {"JPEG": ("image/jpeg", "jpg"), "PNG": ("image/png", "png"), "WEBP": ("image/webp", "webp")}


def _missing():
    return DomainError("ENTITY_NOT_FOUND", 404, message="Материал или объект посещения не найден.")


def _invalid(field, message):
    return DomainError("VALIDATION_ERROR", 422, detail={"fieldErrors": {field: [message]}}, message=message)


def _target_from_querysets(event_id, visit_id, events, visits):
    if not str(event_id).isdigit() or not str(visit_id).isdigit():
        raise _missing()
    event = events.filter(pk=event_id).first()
    visit = visits.filter(pk=visit_id, event_id=event_id).first()
    if event is None or visit is None:
        raise _missing()
    return event, visit


def target(event_id, visit_id):
    return _target_from_querysets(event_id, visit_id, OpsSecurityEvent.objects, OpsSecurityEventVisitObject.objects)


def _lock_target(event_id, visit_id):
    """The caller's transaction owns both row locks through the whole mutation."""
    return _target_from_querysets(
        event_id, visit_id,
        OpsSecurityEvent.objects.select_for_update(),
        OpsSecurityEventVisitObject.objects.select_for_update(),
    )


def require_reader(request, event, visit):
    require_permission(request, "event.view")
    allowed = PermissionService.visible_division_ids(resolve_actor_id(request), "event.view")
    if allowed is None:
        return
    allocations = event.force_allocation if isinstance(event.force_allocation, list) else []
    for row in allocations:
        if not isinstance(row, dict) or isinstance(row.get("departmentId"), bool):
            continue
        if row.get("visitObjectId") not in (None, "", str(visit.pk), visit.pk):
            continue
        try:
            division_id = int(row.get("departmentId"))
        except (TypeError, ValueError):
            continue
        if division_id in allowed:
            return
    employee = getattr(request.user, "employee", None)
    if employee is not None and employee.is_active and employee_scope_division(employee.pk) in allowed:
        if visit.chief_employee_id == employee.pk:
            return
        post_ids = {
            str(row.get("id")) for row in (event.recon_sector_posts or [])
            if isinstance(row, dict) and str(row.get("visitObjectId") or "") == str(visit.pk)
        }
        if any(
            isinstance(row, dict)
            and str(row.get("employeeId")) == str(employee.pk)
            and str(row.get("postId")) in post_ids
            for row in (event.placement_assignments or [])
        ):
            return
    raise PermissionDenied("PERMISSION_DENIED")


def may_manage(request, event, visit):
    return can_manage_recon(event, visit, getattr(request.user, "employee", None), effective_permissions(request))


def require_manager(request, event, visit):
    require_reader(request, event, visit)
    if not may_manage(request, event, visit):
        raise PermissionDenied("PERMISSION_DENIED")
    _require_visit_chief(visit)
    _require_visit_placement_editable(visit)


def material_view(row):
    return {
        "id": str(row.pk), "eventId": str(row.event_id), "visitObjectId": str(row.visit_object_id),
        "checklistItemId": row.checklist_item_id or None, "name": row.original_name,
        "contentType": row.content_type, "size": row.size,
        "uploadedAt": row.created_at.isoformat(), "uploadedBy": row.created_by,
    }


def _record(request, action, row, *, removed=False):
    values = material_view(row)
    audit_service.record(
        actor=resolve_actor_id(request), action=action,
        entity_type=audit_service.ENTITY_SECURITY_EVENT, entity_id=row.event_id,
        **({"old_value": values} if removed else {"new_value": values}),
    )


def list_materials(request, event_id, visit_id):
    event, visit = target(event_id, visit_id)
    require_reader(request, event, visit)
    return {"results": [material_view(row) for row in OpsReconMaterial.objects.filter(event=event, visit_object=visit)]}


def _validate_upload(upload, *, photo_only):
    if upload is None:
        raise _invalid("file", "Выберите файл материала.")
    if upload.size > MAX_BYTES:
        raise _invalid("file", "Файл больше 10 МБ.")
    data = bytearray()
    for chunk in upload.chunks():
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise _invalid("file", "Файл больше 10 МБ.")
    if not data:
        raise _invalid("file", "Пустой файл нельзя загрузить.")
    content = bytes(data)
    declared = upload.content_type or ""
    if declared == "application/pdf" and not photo_only:
        try:
            if not content.startswith(b"%PDF-"):
                raise ValueError("PDF header")
            reader = PdfReader(BytesIO(content), strict=True)
            if reader.is_encrypted or not len(reader.pages):
                raise ValueError("Encrypted or empty PDF")
        except (PdfReadError, OSError, ValueError, KeyError, TypeError, RecursionError):
            raise _invalid("file", "Файл не является доступным для чтения PDF.")
        content_type, extension = "application/pdf", "pdf"
    else:
        if declared not in {mime for mime, _extension in IMAGE_FORMATS.values()}:
            raise _invalid("file", "Допустимы JPEG, PNG, WebP; PDF — только для материалов объекта.")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(content)) as image:
                    image_format = image.format
                    image.verify()
                with Image.open(BytesIO(content)) as image:
                    image.load()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise _invalid("file", "Файл не является изображением JPEG, PNG или WebP.")
        if image_format not in IMAGE_FORMATS or IMAGE_FORMATS[image_format][0] != declared:
            raise _invalid("file", "Тип файла не соответствует изображению JPEG, PNG или WebP.")
        content_type, extension = IMAGE_FORMATS[image_format]
    name = re.sub(r"[\x00-\x1f\x7f]", "", str(upload.name or "").replace("\\", "/").rsplit("/", 1)[-1]).strip()
    if not name or len(name) > 255:
        raise _invalid("file", "Имя файла должно содержать от 1 до 255 символов.")
    return content, content_type, extension, name


def create_material(request, event_id, visit_id, upload, checklist_item_id=None):
    row = None
    try:
        with transaction.atomic():
            event, visit = _lock_target(event_id, visit_id)
            require_manager(request, event, visit)
            item_id = str(checklist_item_id or "").strip()
            if item_id and not any(isinstance(item, dict) and str(item.get("id")) == item_id for item in (visit.recon_checklist or [])):
                raise _invalid("checklistItemId", "Такого пункта нет в чек-листе выбранного объекта.")
            if OpsReconMaterial.objects.filter(visit_object=visit).count() >= MAX_PER_VISIT:
                raise _invalid("file", "На объект можно загрузить не больше 30 материалов.")
            content, content_type, extension, name = _validate_upload(upload, photo_only=bool(item_id))
            row = OpsReconMaterial(event=event, visit_object=visit, checklist_item_id=item_id, original_name=name, content_type=content_type, size=len(content), sha256=hashlib.sha256(content).hexdigest(), created_by=resolve_actor_id(request))
            row.file.save(f"{event.pk}/{visit.pk}/{uuid4().hex}.{extension}", ContentFile(content), save=False)
            row.save()
            _record(request, audit_service.RECON_MATERIAL_UPLOADED, row)
            return material_view(row)
    except Exception:
        if row is not None and row.file:
            row.file.storage.delete(row.file.name)
        raise


def _owned_material(event, visit, material_id):
    row = OpsReconMaterial.objects.filter(pk=material_id, event=event, visit_object=visit).first() if str(material_id).isdigit() else None
    if row is None:
        raise _missing()
    # A corrupted database key cannot turn this API into a reader/deleter of
    # another private subsystem's blob.
    if not is_owned_recon_material_name(row.file.name, event.pk, visit.pk):
        raise _missing()
    return row


@transaction.atomic
def remove_material(request, event_id, visit_id, material_id):
    event, visit = _lock_target(event_id, visit_id)
    require_manager(request, event, visit)
    row = _owned_material(event, visit, material_id)
    _record(request, audit_service.RECON_MATERIAL_REMOVED, row, removed=True)
    row.delete()


def download_material(request, event_id, visit_id, material_id):
    event, visit = target(event_id, visit_id)
    require_reader(request, event, visit)
    row = _owned_material(event, visit, material_id)
    try:
        with row.file.open("rb") as source:
            content = source.read(MAX_BYTES + 1)
    except OSError:
        raise _missing()
    if len(content) != row.size or not hmac.compare_digest(hashlib.sha256(content).hexdigest(), row.sha256):
        raise _missing()
    _record(request, audit_service.RECON_MATERIAL_DOWNLOADED, row)
    return row, content
