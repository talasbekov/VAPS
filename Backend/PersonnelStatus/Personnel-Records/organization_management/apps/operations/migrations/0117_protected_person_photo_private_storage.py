"""Move protected-person photos out of publicly served MEDIA_ROOT."""

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import migrations, models

from organization_management.apps.operations.protected_person_photo_storage import (
    ProtectedPersonPhotoStorage,
)


PHOTO_PREFIX = "protected-persons/photos/"


def move_public_photos(apps, schema_editor):
    Person = apps.get_model("operations", "OpsProtectedPerson")
    public = FileSystemStorage(location=settings.MEDIA_ROOT)
    private = ProtectedPersonPhotoStorage()
    for person in Person.objects.exclude(photo="").iterator():
        name = person.photo.name
        if not name.startswith(PHOTO_PREFIX) or not public.exists(name):
            continue
        if private.exists(name):
            private_name = name
        else:
            with public.open(name, "rb") as source:
                private_name = private.save(name, source)
        person.photo.name = private_name
        person.save(update_fields=["photo"])
        public.delete(name)


def restore_private_photos(apps, schema_editor):
    Person = apps.get_model("operations", "OpsProtectedPerson")
    public = FileSystemStorage(location=settings.MEDIA_ROOT)
    private = ProtectedPersonPhotoStorage()
    for person in Person.objects.exclude(photo="").iterator():
        name = person.photo.name
        if not name.startswith(PHOTO_PREFIX) or not private.exists(name):
            continue
        with private.open(name, "rb") as source:
            public_name = public.save(name, source)
        person.photo.name = public_name
        person.save(update_fields=["photo"])
        private.delete(name)


class Migration(migrations.Migration):
    dependencies = [("operations", "0116_force_campaign_reserve")]

    operations = [
        migrations.AlterField(
            model_name="opsprotectedperson",
            name="photo",
            field=models.ImageField(
                blank=True,
                null=True,
                storage=ProtectedPersonPhotoStorage(),
                upload_to="protected-persons/photos/",
            ),
        ),
        migrations.RunPython(move_public_photos, restore_private_photos),
    ]
