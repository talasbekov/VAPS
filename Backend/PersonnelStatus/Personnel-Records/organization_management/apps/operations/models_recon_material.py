"""Object-owned RECON working material, separate from issued documents."""
from django.db import models, transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models import TimeStampedModel
from organization_management.apps.operations.recon_material_storage import ReconMaterialStorage, is_owned_recon_material_name


class OpsReconMaterial(TimeStampedModel):
    event = models.ForeignKey("operations.OpsSecurityEvent", on_delete=models.CASCADE, related_name="recon_materials")
    visit_object = models.ForeignKey("operations.OpsSecurityEventVisitObject", on_delete=models.CASCADE, related_name="recon_materials")
    checklist_item_id = models.CharField(max_length=100, blank=True, default="")
    file = models.FileField(upload_to="recon-materials/", storage=ReconMaterialStorage(), max_length=255)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size = models.PositiveIntegerField()
    sha256 = models.CharField(max_length=64)

    class Meta:
        db_table = "ops_recon_materials"
        verbose_name = "Материал рекогносцировки"
        verbose_name_plural = "Материалы рекогносцировки"
        ordering = ["created_at", "pk"]
        constraints = [models.CheckConstraint(condition=models.Q(size__gte=1), name="chk_recon_material_size")]


@receiver(post_delete, sender=OpsReconMaterial, dispatch_uid="ops_recon_material_private_cleanup")
def remove_owned_blob_after_commit(sender, instance, using, **kwargs):
    # Django sends post_delete inside the collector's transaction. Reject an
    # unsafe key now, while the deletion can still roll back; defer only the
    # filesystem mutation until that transaction has successfully committed.
    name = instance.file.name
    if not is_owned_recon_material_name(name, instance.event_id, instance.visit_object_id):
        raise DomainError("ENTITY_NOT_FOUND", 404, message="Материал не найден.")
    storage = instance.file.storage
    transaction.on_commit(lambda: storage.delete(name), using=using)
