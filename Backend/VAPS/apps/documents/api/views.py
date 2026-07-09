"""Story 6.1 — API вложений: upload (POST) + download (GET, X-Accel).

Гейт — ``RequirePermissionMixin`` (fail-closed, ДО резолва объекта):
``create`` → ``document.upload``, ``download`` → ``document.view``.
Идентичность — ТОЛЬКО ``request.actor_id`` (ARCH-SEC-030), не из payload.

«Django не стримит» (Ловушка №2): легальная отдача — маленький 200 с
``X-Accel-Redirect`` и ПУСТЫМ телом, байты отдаёт nginx internal location;
dev-fallback ``VAPS_XACCEL_ENABLED=0`` → ``FileResponse`` с теми же
Content-*-заголовками (env-флаг, не if DEBUG). Сверка sha256 (байт-в-байт) и
аудит скачивания (``DOCUMENT_DOWNLOADED``) — здесь (Story 6.7), через тонкое
``services.prepare_download`` (verify → audit → путь); порча/пропажа байтов →
500 ``DOCUMENT_INTEGRITY_FAILED``. Ошибки — через единый handler
(никаких try/except + Response во view).
"""

from django.conf import settings
from django.http import FileResponse, HttpResponse
from django.utils.http import content_disposition_header
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from apps.core.api.permissions import RequirePermissionMixin
from apps.documents import selectors, services
from apps.documents.api.serializers import (
    AttachmentSerializer,
    AttachmentUploadSerializer,
)
from apps.documents.models import Attachment


class AttachmentViewSet(RequirePermissionMixin, viewsets.GenericViewSet):
    # queryset — ТОЛЬКО для интроспекции схемы (uuid-тип path-параметра);
    # резолв объекта идёт через selectors.get_attachment (канонизация pk).
    queryset = Attachment.objects.all()
    serializer_class = AttachmentSerializer
    parser_classes = [MultiPartParser]
    permission_map = {"create": "document.upload", "download": "document.view"}
    # post (create) + get (download); прочие глаголы → 405, не мнимый 403.
    http_method_names = ["get", "post", "head", "options"]

    @extend_schema(
        request=AttachmentUploadSerializer,
        responses={201: AttachmentSerializer},
        description="Загрузка вложения (multipart, единственное поле `file`).",
    )
    def create(self, request, *args, **kwargs):
        form = AttachmentUploadSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        uploaded = form.validated_data["file"]
        attachment = services.create_attachment(
            uploaded_file=uploaded,
            original_name=uploaded.name,
            content_type=uploaded.content_type,
            actor=request.actor_id,
        )
        return Response(
            AttachmentSerializer(attachment).data, status=status.HTTP_201_CREATED
        )

    @extend_schema(
        responses={(200, "application/octet-stream"): OpenApiTypes.BINARY},
        description=(
            "Скачивание вложения: 200 с X-Accel-Redirect и пустым телом "
            "(байты отдаёт nginx); при VAPS_XACCEL_ENABLED=0 — FileResponse."
        ),
    )
    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        attachment = selectors.get_attachment(pk)
        # verify sha256 (байт-в-байт) → аудит DOCUMENT_DOWNLOADED → путь на диске;
        # порча/пропажа байтов → 500 до построения ответа (Story 6.7).
        path = services.prepare_download(attachment=attachment, actor=request.actor_id)
        disposition = content_disposition_header(True, attachment.original_name)
        if settings.VAPS_XACCEL_ENABLED:
            response = HttpResponse(content_type=attachment.content_type)
            response["X-Accel-Redirect"] = services.xaccel_redirect_path(attachment)
        else:
            response = FileResponse(
                open(path, "rb"),
                content_type=attachment.content_type,
            )
        response["Content-Disposition"] = disposition
        return response
