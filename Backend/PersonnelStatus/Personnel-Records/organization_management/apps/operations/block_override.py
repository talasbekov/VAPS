"""Запись законного обхода блокировки завтрашнего дня (порт
apps/operations/submissions/services/block_override.py из Backend/VAPS).

Руководитель снимает замок с конкретной даты, обязательно назвав причину.
Обход — не выключатель, а СЛЕД: строка отвечает на «кто, когда и почему», и
её же видит вывод блокировки. Прав здесь нет (они на слое маршрута) — сервис
знает только актора, которого ему передали.

Мутация и её запись в журнал живут в ОДНОЙ транзакции: обход без записи —
ровно то, ради чего запись и заведена.

Отличия от источника:
- отказы — DomainError с кодом и статусом, а не ValueError, который маршрут
  разбирал бы по `__cause__`, отличая конфликт состояния от ошибки формы по
  типу исключения-причины. Кто отвечает за код отказа — решает сервис, у
  которого есть повод, а не вызывающий, у которого его уже нет;
- в журнал едет ЦЕЛЫЙ pk строки: у источника entity_id — UUID, которого у
  записи нет, и он выводил его uuid5-ом от даты. Здесь ось журнала
  целочисленная, и подменять настоящий идентификатор выведенным незачем.
"""
from datetime import date

from django.db import IntegrityError, transaction

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_submission import (
    OpsTomorrowBlockOverride,
)


@transaction.atomic
def override_tomorrow_block(*, business_date, actor, reason):
    """Записать обход на дату и вернуть строку.

    Причина и ответственный обязательны и непусты (хранятся обрезанными; БД
    держит непустоту последней линией). Повтор на ту же дату — 409, а не 400:
    вход правильный, отказ вызван СОСТОЯНИЕМ, и клиенту нужно знать, что
    решение уже принято кем-то другим, а не искать ошибку в своей форме.

    Повтор берётся из уникальности БД, а не из предварительной проверки: два
    одновременных запроса прошли бы её оба, и одна из вставок всё равно
    упала бы — 500-й вместо внятного отказа. Точку сохранения, с которой
    отказ не отравляет транзакцию вызывающего (у маршрута она общая на
    запрос), даёт декоратор этой функции — своего вложенного atomic вокруг
    вставки здесь НЕТ: он был бы вторым владельцем того же правила, и проба
    со снятым вложенным atomic осталась зелёной.

    Дата принимается ТОЛЬКО чистой (datetime — тоже date по наследованию):
    момент времени доехал бы до колонки усечённым, и обход, записанный «на
    5 августа 14:30», стал бы обходом на 5 августа, о чём никто не просил.
    """
    if type(business_date) is not date:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            message="business_date обязана быть датой без времени.",
        )
    if not actor or not str(actor).strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    if not reason or not reason.strip():
        raise DomainError(
            "VALIDATION_ERROR", 400, message="Обход требует непустой причины."
        )
    actor = str(actor).strip()
    reason = reason.strip()
    try:
        override = OpsTomorrowBlockOverride.objects.create(
            business_date=business_date,
            overridden_by=actor,
            reason=reason,
            created_by=actor,
        )
    except IntegrityError as exc:
        raise DomainError(
            "TOMORROW_BLOCK_ALREADY_OVERRIDDEN",
            409,
            detail={"business_date": business_date.isoformat()},
            message="Обход блокировки на эту дату уже существует.",
        ) from exc
    audit_service.record(
        actor=actor,
        action=audit_service.TOMORROW_BLOCK_OVERRIDDEN,
        entity_type=audit_service.ENTITY_TOMORROW_BLOCK_OVERRIDE,
        entity_id=override.pk,
        old_value=None,
        new_value={
            "override_id": override.pk,
            "business_date": str(business_date),
            "overridden_by": override.overridden_by,
            "reason": override.reason,
        },
        reason=reason,
    )
    return override
