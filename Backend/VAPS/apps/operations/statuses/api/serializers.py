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
    """Тело POST-запроса bulk-создания. Без ``division_id`` — scope из RBAC.

    Story 10.2a: ``override``/``override_reason`` — ОДНА причина на весь
    ретрай (не per-row), зеркалит ``confirmOverride``'а спред исходного
    тела + два поля протокола (`useApiMutation.ts`). Длина 10-500 (BR-003) —
    ФРОНТ-граница (ConflictDialog), бэк проверяет только непустоту (Решение
    8.5, расхождение зафиксировано намеренно).

    Осознанно БЕЗ ``default=`` (в отличие от очевидного): openapi-typescript
    трактует поле схемы с ``default`` как ВСЕГДА присутствующее в TS-типе
    (не `field?:`), а `comment`/`document_basis`/`source_ref` уже задают
    прецедент «просто `required=False`» → optional-поле в сгенерированном
    типе. Читается через ``.get(..., False)``/``.get(..., "")`` во вьюхе."""

    business_date = serializers.DateField()
    rows = BulkStatusCreateRowSerializer(
        many=True, allow_empty=False, max_length=MAX_BULK_ROWS
    )
    override = serializers.BooleanField(required=False)
    override_reason = serializers.CharField(required=False, allow_blank=True)


class StatusOnDateQuerySerializer(serializers.Serializer):
    """Story 10.1b — query-параметры GET /statuses/on-date/. Оба обязательны:
    без даты/подразделения запрос не имеет смысла (явный 400 лучше
    молчаливого «весь список»)."""

    division_id = serializers.UUIDField()
    business_date = serializers.DateField()


class StatusOnDateRowSerializer(serializers.Serializer):
    """Плоская проекция живого статуса на дату — прямо из ``.values()``-словарей
    ``EmployeeStatusSelector.overlapping_on`` (не ORM-объекты)."""

    employee_id = serializers.UUIDField()
    status_type_code = serializers.CharField()
    date_start = serializers.DateField()
    date_end = serializers.DateField()


class StatusTypeListSerializer(serializers.Serializer):
    """Story 10.1b2 — справочник статус-типов для combobox грида (10.2).
    Прямо из ORM-инстансов ``StatusType`` (read-only, простой набор полей)."""

    code = serializers.CharField()
    name = serializers.CharField()
    color = serializers.CharField()
    is_hard_block = serializers.BooleanField()
    priority = serializers.IntegerField()
