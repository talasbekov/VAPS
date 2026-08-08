"""Сериализаторы documents: контракт нового бэка поверх старых вложений.

Порт полей из Backend/VAPS apps/documents. Модель НЕ переносится: у донора
Attachment лежит в своей таблице documents_attachments с uuid-ключом, здесь та
же сущность уже живёт как operations.OpsAttachment (int-pk, имя файла на диске
отдельным полем storage_key). Наружу отдаём донорскую форму, читаем старую.
"""
from rest_framework import serializers

from organization_management.apps.operations.models_document import OpsAttachment


class AttachmentSerializer(serializers.ModelSerializer):
    """Донорская проекция Attachment: id, original_name, content_type, size,
    sha256, created_at.

    ВСЕ ШЕСТЬ ПОЛЕЙ ЧИТАЮТСЯ НАПРЯМУЮ — полей без источника здесь нет ни
    одного, и подставлять null не приходится (ср. срезы 155–158).

    `id` — целочисленный ключ строки, а НЕ `storage_key`. У донора имя файла
    на диске и есть первичный ключ, поэтому там это одно и то же; здесь они
    разошлись, и выбор между ними несущий: под `id` клиент идёт за байтами на
    /api/operations/attachments/{id}/download/, а тот принимает именно ключ
    строки. Отдай мы сюда storage_key — обе формы выглядели бы одинаково
    правдоподобно (в обоих случаях идентификатор), а скачивание отвечало бы
    404. Заодно раскладка приватного хранилища наружу не выходит.
    """

    class Meta:
        model = OpsAttachment
        fields = [
            "id",
            "original_name",
            "content_type",
            "size",
            "sha256",
            "created_at",
        ]
        read_only_fields = fields
