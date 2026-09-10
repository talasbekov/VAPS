"""Атомарная выдача уникальной даты для e2e-фикстуры ОМ (Plane №890).

Уникальна бронь теста, а не `OpsSecurityEvent.business_date`: реальный реестр
законно содержит несколько мероприятий на один день. Курсор хранится в БД и
блокируется строкой, поэтому число Playwright workers и число процессов не
участвуют в корректности.
"""
from datetime import date, timedelta

from django.db import IntegrityError, transaction

from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_event import OpsE2EFixtureDateCursor


FIXTURE_DATE_START = date(2027, 2, 1)
MAX_FIXTURE_OFFSET = (date.max - FIXTURE_DATE_START).days
MAX_RESERVATION_COUNT = 3650


@transaction.atomic
def reserve_fixture_business_dates(count=1):
    """Атомарно забронировать последовательный диапазон дат для e2e."""
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= MAX_RESERVATION_COUNT:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            message=f"count должен быть целым числом от 1 до {MAX_RESERVATION_COUNT}.",
        )
    try:
        cursor = OpsE2EFixtureDateCursor.objects.select_for_update().get(
            singleton_key=1
        )
    except OpsE2EFixtureDateCursor.DoesNotExist:
        # Блокировать ещё нечего. Уникальность singleton_key арбитрирует двух
        # первых писателей; savepoint сохраняет внешнюю транзакцию пригодной
        # для повторного SELECT ... FOR UPDATE после IntegrityError.
        try:
            with transaction.atomic():
                cursor = OpsE2EFixtureDateCursor.objects.create(singleton_key=1)
        except IntegrityError:
            cursor = OpsE2EFixtureDateCursor.objects.select_for_update().get(
                singleton_key=1
            )

    if cursor.next_offset + count - 1 > MAX_FIXTURE_OFFSET:
        raise DomainError(
            "FIXTURE_DATE_RANGE_EXHAUSTED",
            409,
            message="Диапазон дат e2e-фикстур исчерпан.",
        )

    business_date = FIXTURE_DATE_START + timedelta(days=cursor.next_offset)
    cursor.next_offset += count
    cursor.save(update_fields=["next_offset", "updated_at"])
    return business_date


def reserve_fixture_business_date():
    """Совместимая однодневная бронь для точечных e2e-подготовок."""
    return reserve_fixture_business_dates()
