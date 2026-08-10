"""Вьюхи documents: чтение вложений в контракте нового бэка.

Гейт — RequirePermissionMixin раздела ОМ, тот же, что у operations и core:
заводить второй механизм прав ради нового префикса значило бы защищать одни и
те же сведения по-разному в зависимости от того, каким адресом их спросили.
"""
from rest_framework import viewsets

from organization_management.apps.documents.api.serializers import (
    AttachmentSerializer,
)
from organization_management.apps.operations.api.permissions import (
    RequirePermissionMixin,
)
from organization_management.apps.operations.api.views import (
    _resolve_division_scope,
)
from organization_management.apps.operations.models_document import (
    OpsAttachment,
    OpsIssuedDocument,
)

# Вложения открываются правом документов — тем же, под которым выдаются их
# байты: метаданные файла и сам файл это одни и те же сведения.
_READ_DOCUMENT_PERMISSION = "document.view"


class AttachmentViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet):
    """GET /api/documents/attachments/ — метаданные вложений.

    СТРОКА ДОНОРСКАЯ, СПИСОК — НОВЫЙ. В схеме донора по этому адресу объявлен
    только POST (загрузка), а рядом GET на {id}/download/; списочного GET у
    него нет. Здесь переносится РЯД полей его проекции Attachment, а сам
    список заводится заново. Загрузка в срез не входит: правка живёт на старой
    стороне (/api/operations/) со своими проверками, и две пишущие поверхности
    над одним хранилищем разошлись бы в инвариантах.

    ОБЛАСТЬ ВЫВОДИТСЯ ИЗ ВЫПУСКА, А НЕ ИЗ ВЛОЖЕНИЯ. Вложение не знает ни
    подразделения, ни дня — оно знает только про файл, — поэтому решать, кому
    его показывать, можно лишь зная, ЧТО в нём; ответ даёт выпуск, который
    несёт и подразделение, и день. Ровно так рассуждает соседний маршрут тех
    же байт (operations.AttachmentViewSet.download), и разойтись двум местам
    нельзя: список отдавал бы держателю document.view имена файлов любого
    управления, то есть протекал бы там, где выдача байт закрыта.

    ВЛОЖЕНИЕ БЕЗ ВЫПУСКА НЕ ПОКАЗЫВАЕТСЯ ВОВСЕ — по тому же доводу, что и не
    отдаётся: байты откатившегося выпуска на диске остаются, это принятый
    мусор, и открывать к нему доступ снаружи было бы дырой ровно там, где мы
    на мусор согласились.
    """

    serializer_class = AttachmentSerializer
    permission_map = {
        "list": _READ_DOCUMENT_PERMISSION,
        "retrieve": _READ_DOCUMENT_PERMISSION,
    }

    def get_queryset(self):
        issues = OpsIssuedDocument.objects.all()
        # None — безскоуповый грант: видно всё дерево. Иначе выборка сужается
        # подразделениями области; отдельного параметра подразделения здесь
        # нет, потому что у донора его нет и у строки вложения тоже.
        scope = _resolve_division_scope(
            self.request, None, _READ_DOCUMENT_PERMISSION
        )
        if scope is not None:
            issues = issues.filter(division_id__in=scope)
        # Порядок фиксируем явно: без него пагинация DRF предупреждает о
        # нестабильной выборке, а страницы могут повторять и терять строки.
        return OpsAttachment.objects.filter(
            pk__in=issues.values("attachment_id")
        ).order_by("-created_at", "id")
