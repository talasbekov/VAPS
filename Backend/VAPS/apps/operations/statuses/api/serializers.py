"""Сериализаторы HTTP-поверхности статусов.

Story 10.1a — bulk-payload (POST /api/operations/statuses/bulk/). Валидация
формы на границе: DRF отклоняет отсутствующие ключи / неверные типы / пустой
rows / превышение cap → 400 VALIDATION_ERROR ДО сервиса 3.8. division_id в
payload НЕТ — scope резолвится из RBAC актора во вьюхе (Решение №2 3.8;
фронт-контракт 9.7 prefill.ts). actor/source из payload игнорируются: полей нет,
DRF их отбросит (ARCH-SEC-030 — identity из auth-контракта).

Story 10.1b — фильтры и форма ответа GET-списка статусов на дату (префилл
«вчера» экрана массового обновления).
"""

from drf_spectacular.utils import extend_schema_serializer
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


class StatusListFilterSerializer(serializers.Serializer):
    """Query-параметры GET-списка. Оба ОБЯЗАТЕЛЬНЫ.

    ``division_id`` обязателен не для удобства: ответ питает предзаполнение
    грида, и объём выборки должен быть ограничен размером подразделения —
    пагинация здесь резала бы префилл молча (сотрудник без строки садится в
    «В строю»). ``business_date`` — операторская дата, НЕ Clock: какую дату
    спрашивать, решает потребитель.
    """

    business_date = serializers.DateField()
    division_id = serializers.UUIDField()


class EmployeeStatusRowSerializer(serializers.Serializer):
    """Одна живая запись на дату — ровно 4 поля.

    Форма зеркалит ``EmployeeStatusSelector.overlapping_on`` и ровно то, что
    потребляет ``YesterdayPlacement`` фронта. ``id``/``source`` НЕ отдаём:
    у снапшота сдачи (``snapshot_facts_on``, 6 полей) другой владелец, а
    расширять контракт вперёд спроса — потом не сузить.
    """

    employee_id = serializers.UUIDField()
    status_type_code = serializers.CharField()
    date_start = serializers.DateField()
    date_end = serializers.DateField()


# many=False обязателен: drf-spectacular решает «список ли это» по ИМЕНИ экшена
# (`action == "list"`), а не по форме ответа, и без override обернул бы объект в
# массив — schema.d.ts соврал бы при верном рантайме. Тот же приём, что у
# _SingleIssuedExpenseReport (submissions/api/views.py).
@extend_schema_serializer(many=False)
class EmployeeStatusListResponseSerializer(serializers.Serializer):
    """Тело 200. Эхо ``business_date``/``division_id`` — дешёвая защита от
    гонки: ответ, приехавший после смены даты на экране, распознаётся как
    чужой. Ключ ``rows`` (не ``results``): ``results`` в этом проекте означает
    пагинационный конверт, которого здесь нет."""

    business_date = serializers.DateField()
    division_id = serializers.UUIDField()
    rows = EmployeeStatusRowSerializer(many=True)
