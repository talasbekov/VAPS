"""Story 6.1 — сериализаторы вложений (форма upload + проекция ответа).

Форма upload — ЕДИНСТВЕННОЕ поле ``file`` (multipart): ``original_name`` и
``content_type`` берутся из файл-части (``uploaded_file.name`` /
``.content_type``), отдельных form-полей НЕТ — это контракт, попадающий в
schema.yaml. Форма-валидация (400 VALIDATION_ERROR): whitelist заявленного
content-type (Д4), размер ≤ ``VAPS_MAX_UPLOAD_MB``, непустой файл (Д9).
"""

from django.conf import settings
from rest_framework import serializers

from apps.documents.models import Attachment


class AttachmentUploadSerializer(serializers.Serializer):
    file = serializers.FileField()

    def validate_file(self, uploaded):
        content_type = (uploaded.content_type or "").strip()
        if content_type not in settings.VAPS_ATTACHMENT_CONTENT_TYPES:
            raise serializers.ValidationError(
                f"content-type «{content_type}» вне списка допустимых."
            )
        max_bytes = settings.VAPS_MAX_UPLOAD_MB * 1024 * 1024
        if uploaded.size > max_bytes:
            raise serializers.ValidationError(
                f"файл больше лимита {settings.VAPS_MAX_UPLOAD_MB} МБ."
            )
        if uploaded.size < 1:
            raise serializers.ValidationError("пустой файл.")
        return uploaded


class AttachmentSerializer(serializers.ModelSerializer):
    """Read-only проекция Attachment — ответ upload (201) и retrieve-форм."""

    class Meta:
        model = Attachment
        fields = ["id", "original_name", "content_type", "size", "sha256", "created_at"]
        read_only_fields = fields
