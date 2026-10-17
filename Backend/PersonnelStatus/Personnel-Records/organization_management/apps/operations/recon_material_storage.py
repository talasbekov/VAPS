"""RECON working files are served only through the authorized material API."""
import re

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.utils.deconstruct import deconstructible
from django.utils.functional import cached_property


def is_owned_recon_material_name(name, event_id, visit_object_id):
    prefix = f"recon-materials/{event_id}/{visit_object_id}/"
    return isinstance(name, str) and re.fullmatch(re.escape(prefix) + r"[0-9a-f]{32}\.(?:jpg|png|webp|pdf)", name) is not None


@deconstructible
class ReconMaterialStorage(FileSystemStorage):
    def __init__(self):
        super().__init__(location=None, base_url=None)

    @cached_property
    def base_location(self):
        return settings.OPS_PRIVATE_STORAGE_ROOT

    @cached_property
    def base_url(self):
        return None
