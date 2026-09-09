"""Private filesystem storage for protected-person photographs."""

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.utils.deconstruct import deconstructible
from django.utils.functional import cached_property


@deconstructible(
    path=(
        "organization_management.apps.operations."
        "protected_person_photo_storage.ProtectedPersonPhotoStorage"
    )
)
class ProtectedPersonPhotoStorage(FileSystemStorage):
    """Store bytes outside every directory served as public media."""

    def __init__(self):
        # The location is resolved through the setting below so tests and
        # deployments can replace the private root without recreating the
        # model field's global storage instance.
        super().__init__(location=None, base_url=None)

    @cached_property
    def base_location(self):
        return settings.OPS_PRIVATE_STORAGE_ROOT

    @cached_property
    def base_url(self):
        # There is deliberately no storage URL. Callers must use the API
        # endpoint, where authentication, scope and audit are enforced.
        return None
