"""Private, document-owned immutable blob names for normative files."""
import re
from pathlib import Path

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.utils.deconstruct import deconstructible
from django.utils.functional import cached_property


@deconstructible
class LegalDocumentStorage(FileSystemStorage):
    def __init__(self):
        super().__init__(location=None, base_url=None)

    @cached_property
    def base_location(self):
        return settings.OPS_PRIVATE_STORAGE_ROOT

    @cached_property
    def base_url(self):
        return None


def owned_path(storage, name, document_id):
    """Reject foreign names and filesystem links escaping the private root."""
    pattern = rf"legal-documents/{int(document_id)}/[0-9a-f]{{32}}\.(?:pdf|docx)"
    if not isinstance(name, str) or re.fullmatch(pattern, name) is None:
        raise ValueError("Foreign legal-document blob")
    root = Path(storage.location).resolve()
    path = Path(storage.path(name))
    if not path.resolve().is_relative_to(root):
        raise ValueError("Legal-document blob outside private root")
    return path
