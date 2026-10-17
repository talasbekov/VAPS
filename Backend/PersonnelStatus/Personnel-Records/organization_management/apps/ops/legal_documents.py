"""Normative metadata and append-only private PDF/DOCX file versions."""
import hashlib
import io
import logging
from pathlib import PurePosixPath
import uuid
import zipfile
from xml.etree import ElementTree

from django.core.exceptions import ValidationError as ModelValidationError
from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from pypdf import PdfReader
from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.legal_document_storage import owned_path
from organization_management.apps.operations.models_legal import OpsLegalDocument, OpsLegalDocumentFile
from organization_management.apps.operations.services import PermissionService

logger = logging.getLogger(__name__)
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
DOCX_MAX_EXPANDED_BYTES = 40 * 1024 * 1024
PDF_TYPE = "application/pdf"
DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class MetadataSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=OpsLegalDocument.Kind.choices)
    code = serializers.CharField(max_length=100)
    title = serializers.CharField(max_length=300)
    description = serializers.CharField(required=False, allow_blank=True)
    revision = serializers.CharField(required=False, allow_blank=True, max_length=100)
    status = serializers.ChoiceField(choices=OpsLegalDocument.Status.choices)
    pages = serializers.IntegerField(required=False, allow_null=True, min_value=0)


def can_manage(actor):
    permissions = PermissionService.unscoped_permissions(str(actor)) if actor is not None else set()
    return bool(permissions & {"*", "legal.manage"})


def _require_manager(actor):
    if not can_manage(actor):
        raise PermissionDenied("PERMISSION_DENIED")


def file_view(record):
    return {"id": str(record.pk), "name": record.original_name,
            "contentType": record.content_type, "size": record.size,
            "sha256": record.sha256, "uploadedAt": record.created_at.isoformat(),
            "uploadedBy": record.created_by}


def document_view(document):
    current = next(iter(document.files.all()), None)
    return {"id": str(document.pk), "kind": document.kind, "code": document.code,
            "title": document.title, "description": document.description,
            "revision": document.revision, "status": document.status,
            "pages": document.pages, "fileUrl": document.file_url,
            "version": document.version, "file": file_view(current) if current else None}


def list_documents():
    return [document_view(document) for document in OpsLegalDocument.objects.filter(is_active=True).prefetch_related("files")]


def _metadata(data, *, partial=False):
    unknown = set(data) - set(MetadataSerializer().fields) - {"file", "expectedVersion"}
    if unknown:
        raise ValidationError({name: ["Неизвестное или неизменяемое поле."] for name in sorted(unknown)})
    values = {name: data.get(name) for name in data if name in MetadataSerializer().fields}
    if values.get("pages") == "":
        values["pages"] = None
    serializer = MetadataSerializer(data=values, partial=partial)
    serializer.is_valid(raise_exception=True)
    return dict(serializer.validated_data)


class _NoDTDTreeBuilder(ElementTree.TreeBuilder):
    def doctype(self, name, pubid, system):
        raise ValueError("DTD is forbidden")


def _xml(content):
    # Check parsed declarations, which also covers UTF-16 and other XML encodings.
    return ElementTree.fromstring(content, parser=ElementTree.XMLParser(target=_NoDTDTreeBuilder()))


def _validate_docx(content):
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        infos = archive.infolist()
        if len(infos) > 2048 or sum(info.file_size for info in infos) > DOCX_MAX_EXPANDED_BYTES:
            raise ValueError("Expanded Word archive exceeds limits")
        names = [info.filename for info in infos]
        if len(set(name.casefold() for name in names)) != len(names):
            raise ValueError("Duplicate archive members")
        for info in infos:
            name = info.filename
            path = PurePosixPath(name)
            if (info.flag_bits & 1 or "\\" in name or path.is_absolute()
                    or ".." in path.parts or ":" in name or "vbaproject" in name.casefold()
                    or (info.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError("Unsafe Word archive member")
        required = {"[Content_Types].xml", "_rels/.rels", "word/document.xml"}
        if not required <= set(names):
            raise ValueError("Not a Word package")
        parsed = {}
        for info in infos:
            if info.is_dir():
                continue
            data = archive.read(info)
            if info.filename.casefold().endswith((".xml", ".rels")):
                parsed[info.filename] = _xml(data)
        types = parsed["[Content_Types].xml"]
        namespace = "{http://schemas.openxmlformats.org/package/2006/content-types}"
        if types.tag != namespace + "Types":
            raise ValueError("Invalid content types")
        for entry in types:
            if any(word in entry.attrib.get("ContentType", "").casefold() for word in ("macroenabled", "vbaproject")):
                raise ValueError("Macros are forbidden")
        if not any(entry.tag == namespace + "Override" and entry.attrib.get("PartName") == "/word/document.xml"
                   and entry.attrib.get("ContentType") == DOCX_TYPE + ".main+xml" for entry in types):
            raise ValueError("Missing Word main content type")
        relationships = parsed["_rels/.rels"]
        rel_namespace = "{http://schemas.openxmlformats.org/package/2006/relationships}"
        if relationships.tag != rel_namespace + "Relationships" or not any(
            entry.tag == rel_namespace + "Relationship"
            and entry.attrib.get("Type") == "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
            and entry.attrib.get("Target") in ("word/document.xml", "/word/document.xml")
            and entry.attrib.get("TargetMode", "Internal") == "Internal" for entry in relationships
        ):
            raise ValueError("Missing Word main relationship")
        if parsed["word/document.xml"].tag != "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}document":
            raise ValueError("Invalid Word document")


def _validate_file(upload):
    try:
        upload = serializers.FileField(max_length=255).run_validation(upload)
    except ValidationError as error:
        raise ValidationError({"file": error.detail}) from error
    name = str(upload.name or "").replace("\\", "/").rsplit("/", 1)[-1]
    if not name or len(name) > 255 or any(ord(char) < 32 or ord(char) == 127 for char in name):
        raise ValidationError({"file": ["Недопустимое имя файла."]})
    extension = PurePosixPath(name).suffix.casefold()
    if extension not in (".pdf", ".docx"):
        raise ValidationError({"file": ["Разрешены PDF и DOCX."]})
    if upload.size > MAX_FILE_SIZE_BYTES:
        raise ValidationError({"file": ["Размер файла превышает 10 МиБ."]})
    content = upload.read(MAX_FILE_SIZE_BYTES + 1)
    if not content or len(content) > MAX_FILE_SIZE_BYTES:
        raise ValidationError({"file": ["Файл пуст или превышает 10 МиБ."]})
    pages = None
    try:
        if extension == ".pdf":
            reader = PdfReader(io.BytesIO(content), strict=True)
            if reader.is_encrypted:
                raise ValueError("Encrypted PDF")
            pages = len(reader.pages)
            if not pages:
                raise ValueError("Empty PDF")
            for page in reader.pages:
                _ = page.mediabox
        else:
            _validate_docx(content)
    except Exception as error:
        raise ValidationError({"file": ["Файл повреждён, зашифрован или не соответствует формату."]}) from error
    return {"content": content, "name": name, "extension": extension,
            "content_type": PDF_TYPE if extension == ".pdf" else DOCX_TYPE,
            "pages": pages, "sha256": hashlib.sha256(content).hexdigest()}


def _save_metadata(document):
    try:
        document.full_clean()
        document.save()
    except ModelValidationError as error:
        raise ValidationError(error.message_dict) from error
    except IntegrityError as error:
        constraint = getattr(getattr(error.__cause__, "diag", None), "constraint_name", "") or ""
        if constraint.endswith("_code_key"):
            raise ValidationError({"code": ["Документ с таким кодом уже существует."]}) from error
        raise


def _store_file(document, validated, actor, pending):
    storage = OpsLegalDocumentFile._meta.get_field("file").storage
    name = f"legal-documents/{document.pk}/{uuid.uuid4().hex}{validated['extension']}"
    try:
        owned_path(storage, name, document.pk)
        if storage.exists(name):
            # A collision belongs to an earlier upload. Never register it for cleanup.
            raise DomainError("LEGAL_DOCUMENT_STORAGE_FAILED", 503, message="Не удалось сохранить файл. Повторите попытку.")
        pending.append((storage, name, document.pk))
        stored_name = storage.save(name, ContentFile(validated["content"]))
    except (OSError, ValueError) as error:
        raise DomainError("LEGAL_DOCUMENT_STORAGE_FAILED", 503, message="Не удалось сохранить файл. Повторите попытку.") from error
    pending.append((storage, stored_name, document.pk))
    owned_path(storage, stored_name, document.pk)
    record = OpsLegalDocumentFile.objects.create(
        document=document, file=stored_name, original_name=validated["name"],
        content_type=validated["content_type"], size=len(validated["content"]),
        sha256=validated["sha256"], created_by=str(actor) if actor is not None else None,
    )
    audit_service.record(actor=actor, action=audit_service.LEGAL_DOCUMENT_FILE_UPLOADED,
                         entity_type=audit_service.ENTITY_LEGAL_DOCUMENT, entity_id=document.pk,
                         new_value={"fileId": str(record.pk), "name": record.original_name,
                                    "contentType": record.content_type, "size": record.size,
                                    "sha256": record.sha256, "version": document.version})


def _cleanup(pending):
    for storage, name, document_id in pending:
        try:
            owned_path(storage, name, document_id)
            storage.delete(name)
        except (OSError, ValueError):
            logger.exception("Failed to clean a new unsaved legal-document blob")


def _audit_snapshot(document):
    view = document_view(document)
    return {key: value for key, value in view.items() if key != "file"} | {"fileId": view["file"]["id"] if view["file"] else None}


def create_document(data, *, actor):
    _require_manager(actor)
    values = _metadata(data)
    validated = _validate_file(data["file"]) if data.get("file") is not None else None
    if validated:
        values["pages"] = validated["pages"]
    pending = []
    try:
        with transaction.atomic():
            document = OpsLegalDocument(**values, created_by=str(actor))
            _save_metadata(document)
            if validated:
                _store_file(document, validated, actor, pending)
            audit_service.record(actor=actor, action=audit_service.LEGAL_DOCUMENT_CREATED,
                                 entity_type=audit_service.ENTITY_LEGAL_DOCUMENT, entity_id=document.pk,
                                 new_value=_audit_snapshot(document))
            return document_view(document)
    except Exception:
        _cleanup(pending)
        raise


def update_document(document_id, data, *, actor):
    _require_manager(actor)
    values = _metadata(data, partial=True)
    try:
        version = serializers.IntegerField(min_value=1).run_validation(data.get("expectedVersion")) if "expectedVersion" in data else None
    except ValidationError as error:
        raise ValidationError({"expectedVersion": error.detail}) from error
    if version is None:
        raise ValidationError({"expectedVersion": ["Обязательное поле."]})
    pending = []
    try:
        with transaction.atomic():
            document = OpsLegalDocument.objects.select_for_update().filter(pk=document_id, is_active=True).first()
            if document is None:
                raise NotFound("Документ не найден.")
            if document.version != version:
                raise DomainError("LEGAL_DOCUMENT_STALE", 409, detail={"currentVersion": document.version}, message="Документ изменён. Обновите данные перед сохранением.")
            before = _audit_snapshot(document)
            validated = _validate_file(data["file"]) if data.get("file") is not None else None
            if not validated and before["fileId"] is not None and document.files.first().content_type == PDF_TYPE:
                # PDF pages are derived from its immutable bytes, never form metadata.
                values.pop("pages", None)
            for name, value in values.items():
                setattr(document, name, value)
            if validated:
                document.pages = validated["pages"]
            document.version += 1
            _save_metadata(document)
            if validated:
                _store_file(document, validated, actor, pending)
            audit_service.record(actor=actor, action=audit_service.LEGAL_DOCUMENT_UPDATED,
                                 entity_type=audit_service.ENTITY_LEGAL_DOCUMENT, entity_id=document.pk,
                                 old_value=before, new_value=_audit_snapshot(document))
            return document_view(document)
    except Exception:
        _cleanup(pending)
        raise


def _active_document(document_id):
    document = OpsLegalDocument.objects.filter(pk=document_id, is_active=True).first()
    if document is None:
        raise NotFound("Документ не найден.")
    return document


def list_files(document_id):
    return [file_view(record) for record in _active_document(document_id).files.all()]


def prepare_download(document_id, file_id):
    record = _active_document(document_id).files.filter(pk=file_id).first()
    if record is None:
        raise NotFound("Файл документа не найден.")
    try:
        path = owned_path(record.file.storage, record.file.name, document_id)
        with path.open("rb") as stream:
            content = stream.read(MAX_FILE_SIZE_BYTES + 1)
    except FileNotFoundError as error:
        raise NotFound("Сохранённый файл отсутствует. Обратитесь к администратору.") from error
    except (ValueError, OSError) as error:
        raise DomainError("DOCUMENT_INTEGRITY_FAILED", 500, message="Не удалось проверить сохранённый файл.") from error
    if len(content) != record.size or hashlib.sha256(content).hexdigest() != record.sha256:
        raise DomainError("DOCUMENT_INTEGRITY_FAILED", 500, message="Сохранённый файл повреждён.")
    return record, content
