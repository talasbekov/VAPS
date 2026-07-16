"""Story 10.1a — bulk-payload сериализаторы (POST /api/operations/statuses/bulk/).

Валидация формы на границе: DRF отклоняет отсутствующие ключи / неверные типы /
пустой rows / превышение cap → 400 VALIDATION_ERROR ДО сервиса 3.8. division_id
в payload НЕТ — scope резолвится из RBAC актора во вьюхе (Решение №2 3.8;
фронт-контракт 9.7 prefill.ts). actor/source из payload игнорируются: полей нет,
DRF их отбросит (ARCH-SEC-030 — identity из auth-контракта).
"""

from rest_framework import serializers

# Верхняя граница payload — утро управления ~40–300 строк; cap с запасом.
# Закрывает 3.8-defer «нет cap на payload → сериализатор E10» на естественной
# границе (param-limit нужен лишь на порядки больших объёмах).
MAX_BULK_ROWS = 1000


class BulkStatusCreateRowSerializer(serializers.Serializer):
    """Одна строка-отклонение. 4 обязательных ключа зеркалят
    ``_REQUIRED_ROW_KEYS`` сервиса 3.8 (отсутствие → 400 ДО сервиса)."""

    employee_id = serializers.UUIDField()
    status_type_code = serializers.CharField(max_length=50)
    date_start = serializers.DateField()
    date_end = serializers.DateField()
    comment = serializers.CharField(required=False, allow_blank=True)
    document_basis = serializers.CharField(required=False, allow_blank=True)
    source_ref = serializers.CharField(required=False, allow_blank=True)


class BulkStatusCreateSerializer(serializers.Serializer):
    """Тело POST-запроса bulk-создания. Без ``division_id`` — scope из RBAC."""

    business_date = serializers.DateField()
    rows = BulkStatusCreateRowSerializer(
        many=True, allow_empty=False, max_length=MAX_BULK_ROWS
    )


# --- Story 10.1b — GET /api/operations/statuses/grid-prefill/ ----------------


class GridPrefillQuerySerializer(serializers.Serializer):
    """Query-параметры префилла: обязательная дата («вчера» считает фронт,
    Решение №6 10.1b). Отсутствие/мусор → DRF 400 VALIDATION_ERROR."""

    business_date = serializers.DateField()


class GridPrefillEmployeeSerializer(serializers.Serializer):
    """Read-only схема строки roster (spectacular): ровно ``EmployeeSeed``
    фронта (prefill.ts 9.7) — id, full_name, rank (имя из справочника,
    fallback сырой код — семантика ``denorm_for``)."""

    id = serializers.UUIDField()
    full_name = serializers.CharField()
    rank = serializers.CharField(allow_null=True)


class GridPrefillStatusSerializer(serializers.Serializer):
    """Read-only схема живого статус-интервала: 4 поля ``overlapping_on``
    как есть (сырые факты; derived IN_SERVICE доклеивает фронт)."""

    employee_id = serializers.UUIDField()
    status_type_code = serializers.CharField()
    date_start = serializers.DateField()
    date_end = serializers.DateField()


class GridPrefillStatusTypeSerializer(serializers.Serializer):
    """Read-only схема строки справочника статусов (story 10.2 AC-1):
    {code, name} — ровно ``StatusOption {code, label}`` фронта. Только
    is_active=True, порядок Meta (priority, code) — кладёт селектор."""

    code = serializers.CharField()
    name = serializers.CharField()


class GridPrefillResponseSerializer(serializers.Serializer):
    """Read-only схема ответа 200 grid-prefill (только для spectacular —
    вьюха отдаёт selector-словарь напрямую, поля 1:1)."""

    business_date = serializers.DateField()
    employees = GridPrefillEmployeeSerializer(many=True)
    statuses = GridPrefillStatusSerializer(many=True)
    status_types = GridPrefillStatusTypeSerializer(many=True)
