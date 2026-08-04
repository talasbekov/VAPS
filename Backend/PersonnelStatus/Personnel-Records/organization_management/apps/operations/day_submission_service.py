"""Сервис сдачи дня (порт apps/operations/submissions/services/
day_submission_service.py из Backend/VAPS).

Первый писатель строк сдачи: окно допустимых дат → повторная сдача → снимок
→ событие diff'ом с предыдущей сдачей → отметка опоздания → создание версии 1.
Устройство то же, что у сервиса статусов: внешняя транзакция плюс вложенный
savepoint вокруг гоночной вставки, актор — строка keyword-only, время — только
через часы раздела, бизнес-дата — ЯВНЫЙ параметр (иначе сдача за вчера тихо
считалась бы на сегодня).

Прав не проверяет: гейт и область — забота API. Пересдача сюда тоже не входит
— это поправка, отдельная операция со своими причиной и санкцией.

ОТЛИЧИЯ ОТ ИСТОЧНИКА:
- контрольный час приходит ПАРАМЕТРОМ с дефолтом-константой: справочника
  настроек контроля в разделе ещё нет (отдельный срез), а молчаливое
  late=False лгало бы, что опозданий не бывает;
- окно по умолчанию считается от часов раздела — как и в источнике, — но
  вычисляется в момент вызова, а не при импорте модуля;
- в журнале entity_id события — pk СТРОКИ СДАЧИ, а не подразделение (в
  источнике осью выбрано подразделение). Здесь работает общее правило
  раздела: событие на каждую записанную строку, и лента конкретной версии
  сдачи читается тем же разрезом entity_type+entity_id, что и лента статуса.
  Подразделение при этом не теряется — оно в снимке события.
"""
from datetime import time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.selectors import (
    DailySubmissionSelector,
    DivisionTreeSelector,
)
from organization_management.apps.operations.snapshot import build_division_snapshot

# Контрольный час по умолчанию: до появления справочника настроек он живёт
# здесь одной константой, а не литералом на месте сравнения.
DEFAULT_CONTROL_HOUR = time(17, 0)


def _require_actor(actor):
    if not actor or not actor.strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")


def _local_tz():
    return ZoneInfo(getattr(settings, "OPS_LOCAL_TIMEZONE", settings.TIME_ZONE))


def _default_window():
    """Сегодня и завтра: основная сдача «на день вперёд» плюс коррекция."""
    today = Clock.today_local()
    return [today, today + timedelta(days=1)]


def _is_late(control_hour):
    """Опоздание = сдача позже контрольного часа по локальному времени.

    Сравнивается ВРЕМЯ СУТОК, а не дата: контрольный час — дедлайн самого
    акта сдачи, и «после 17:00» одинаково поздно в любой день. Граница
    строгая: ровно в 17:00 ещё не поздно.
    """
    local_now = Clock.now().astimezone(_local_tz())
    return local_now.time() > control_hour


def _diff_key(snapshot):
    """Содержимое снимка, ЗНАЧИМОЕ для вывода состояния.

    Сравниваются знаменатель (кто в списке) и интервалы-факты. Намеренно НЕ
    сравниваются денормализованные ФИО/звание, id строк и версия схемы:
    переименование сотрудника или пересоздание идентичного факта — не
    изменение обстановки, и объявлять их изменением значило бы врать в
    событии дня.
    """
    roster = frozenset(row["employee_id"] for row in snapshot.get("roster", []))
    facts = frozenset(
        (
            row["employee_id"],
            row["status_type_code"],
            row["date_start"],
            row["date_end"],
            row["source"],
        )
        for row in snapshot.get("rows", [])
    )
    return roster, facts


def _compute_event(snapshot, previous):
    """Совпало с ПРЕДЫДУЩЕЙ сдачей → «подтверждено без изменений», иначе
    «изменено». Первая сдача подразделения — всегда «изменено»: сравнивать
    не с чем, а «без изменений» относительно пустоты означало бы, что в
    подразделении никого нет."""
    if previous is None:
        return OpsDailySubmission.Event.CHANGED
    if _diff_key(snapshot) == _diff_key(previous.snapshot):
        return OpsDailySubmission.Event.CONFIRMED_NO_CHANGES
    return OpsDailySubmission.Event.CHANGED


@transaction.atomic
def submit_day(
    *,
    division_id,
    business_date,
    actor,
    window_dates=None,
    control_hour=None,
):
    """Сдать день: снимок + событие + отметка опоздания + версия 1.

    Отказы: 400 (пустой актор), 404 (нет подразделения), 422 (дата вне окна),
    409 (день уже сдан — пересдача это поправка). Отклонённая сдача не пишет
    в журнал ничего: журнал рассказывает о случившемся.
    """
    _require_actor(actor)

    # Проверка существования — ДО сборки снимка: у несуществующего
    # подразделения снимок вышел бы пустым, и раздел записал бы «сдачу»
    # призрака с пустым списком, ничем не отличимую от честной сдачи
    # расформированного подразделения.
    if not DivisionTreeSelector.exists(division_id):
        raise DomainError(
            "ENTITY_NOT_FOUND",
            404,
            detail={"division_id": str(division_id)},
            message="Подразделение не найдено.",
        )

    window = _default_window() if window_dates is None else list(window_dates)
    if business_date not in window:
        raise DomainError(
            "BUSINESS_DATE_OUT_OF_WINDOW",
            422,
            detail={"allowed": [day.isoformat() for day in window]},
            message="Дата сдачи вне окна.",
        )

    # Предпроверка повторной сдачи — по ЛЮБОЙ версии дня (см. селектор):
    # первичная сдача пишет версию 1 и на дне с историей поправок упёрлась бы
    # в уникальность номера, то есть в 500 вместо внятного отказа.
    if DailySubmissionSelector.exists_for(division_id, business_date):
        raise DomainError(
            "DAY_ALREADY_SUBMITTED",
            409,
            detail={
                "division_id": str(division_id),
                "business_date": business_date.isoformat(),
            },
            message="Подразделение уже сдало этот день (пересдача — поправка).",
        )

    # Сборка снимка и вставка строки коммитятся вместе. ЧЕСТНО: под READ
    # COMMITTED это не изоляция моментального снимка — отдельные выборки
    # билдера могут увидеть разные состояния. Структурная целостность
    # (rows ⊆ roster) при этом держится построением, а секундный зазор между
    # чтением списка и чтением фактов принят осознанно; строгий момент
    # потребовал бы REPEATABLE READ на этой транзакции.
    snapshot = build_division_snapshot(division_id, business_date)
    previous = DailySubmissionSelector.previous_for(division_id, business_date)
    event = _compute_event(snapshot, previous)
    late = _is_late(DEFAULT_CONTROL_HOUR if control_hour is None else control_hour)

    # Вложенный savepoint: параллельная сдача упрётся в частичное
    # ограничение текущей версии; savepoint откатывается чисто, и
    # IntegrityError уходит наверх, не отравляя транзакцию вызывающего.
    with transaction.atomic():
        submission = OpsDailySubmission.objects.create(
            division_id=division_id,
            business_date=business_date,
            # version/is_current совпадают с дефолтами модели, и их снятие
            # не роняет ни одного теста (проверено красной пробой). Оставлены
            # намеренно: это ЗАЯВЛЕНИЕ первичной сдачи о том, что она пишет
            # версию 1 и делает её текущей, — поправка будет решать иначе, и
            # молчаливая опора на дефолт спрятала бы разницу между ними.
            version=1,
            is_current=True,
            event=event,
            submitted_by=actor,
            submitted_at=Clock.now(),
            late=late,
            snapshot=snapshot,
        )
    # Событие журнала — ПОСЛЕ savepoint'а, в объемлющей транзакции: гоночный
    # дубль улетает исключением выше и до записи не доходит, поэтому
    # откатившаяся сдача не оставляет строки о себе.
    audit_service.record(
        actor=actor,
        action=audit_service.DAILY_SUBMISSION_SUBMITTED,
        entity_type=audit_service.ENTITY_SUBMISSION,
        entity_id=submission.pk,
        new_value=audit_service.submission_snapshot(submission),
    )
    return submission

