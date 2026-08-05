"""Догон побочных эффектов статусов (порт apps/operations/statuses/services/
catch_up.py из Backend/VAPS).

Действующий статус раздел ВЫЧИСЛЯЕТ из интервалов и деловой даты — его никто не
«проставляет», и догонять его не нужно. Догонять нужно ПОБОЧНЫЕ эффекты
переходов: записи в журнал, уведомления, автовозврат из прикомандирования. Они
происходят один раз в свой день, и сутки простоя означают сутки несделанного.

Догон — чистая функция водяного знака: хронологически, день за днём, КАЖДЫЙ
день в своей транзакции, под сеансовым замком, чтобы одновременный (или
повторный) прогон не применил эффекты дважды.

Реестр материализаторов EFFECT_MATERIALIZERS сегодня ПУСТ — это шов. Движок
двигает знак и не зажигает ничего. Пустой реестр здесь не заглушка «на потом»,
а рабочее состояние: знак обязан начать двигаться СЕЙЧАС, иначе первый же
подключённый эффект получит на входе годовой разрыв и упрётся в порог здравого
смысла. Каждый будущий материализатор обязан быть идемпотентным и НЕ поднимать
доменных ошибок: это фоновый прогон, а не запрос.

Отличия от источника: Celery не импортируется и в зависимости не добавляется —
обёртку задачи и расписание кладёт отдельный срез; водяной знак и замок берутся
из локальных модулей раздела (в источнике они жили в apps/core).
"""
import logging
from dataclasses import dataclass, field
from datetime import date

from django.db import transaction

from organization_management.apps.operations import watermark as watermark_gateway
from organization_management.apps.operations.clock import Clock, catchup_plan
from organization_management.apps.operations.locks import advisory_lock

logger = logging.getLogger(__name__)

# Ключ строки водяного знака этой работы.
WATERMARK_KEY = "status_effects"

# Ключ замка — стабильное целое (b"VAPS" в ASCII). Именованная константа, а не
# магическое число: у каждой фоновой работы ключ свой, чтобы работы не
# блокировали друг друга.
STATUS_EFFECTS_LOCK_KEY = 0x56415053

# Порция за прогон и порог здравого смысла. Огромный хвост (знак далеко позади
# после долгого простоя или кривого посева) проходится кусками по
# MAX_CATCHUP_DAYS: знак двигается частями, следующий прогон продолжает — так
# один прогон не перемалывает тысячи дней. Разрыв больше CATCHUP_SANITY_DAYS
# почти наверняка не простой, а сбитые часы или посев: такое надо остановить и
# показать, а не материализовать.
MAX_CATCHUP_DAYS = 31
CATCHUP_SANITY_DAYS = 366

# Реестр подённых материализаторов эффектов. Договор записи:
#   mat(*, business_date: date) -> None  — идемпотентна, доменных ошибок не
#   поднимает.
EFFECT_MATERIALIZERS = ()


@dataclass
class CatchUpResult:
    """Итог одного прохода догона — для команды, вызывающих и тестов."""

    watermark_before: date | None
    watermark_after: date | None
    processed_days: list[date] = field(default_factory=list)
    halted: bool = False
    halt_reason: str = ""
    skipped: bool = False  # замок держал другой прогон


def _materialize_day(*, business_date, materializers):
    for mat in materializers:
        mat(business_date=business_date)


def materialize_status_effects(*, today=None, materializers=None):
    """Один идемпотентный проход догона; вернуть CatchUpResult.

    `today` по умолчанию — Clock.today_local(). ОБЯЗАН идти ВНЕ объемлющей
    транзакции: подённая transaction.atomic() должна быть настоящим КОММИТОМ,
    иначе день становится точкой сохранения, и откат снаружи стирает весь
    пройденный путь разом. Команда раздела запускается без объемлющей
    транзакции — так и держать.
    """
    if today is None:
        today = Clock.today_local()
    if type(today) is not date:
        # datetime IS-A date: в план уехал бы неполный день.
        raise TypeError(f"today must be a plain date, got {type(today)!r}")
    if materializers is None:
        materializers = EFFECT_MATERIALIZERS

    with advisory_lock(STATUS_EFFECTS_LOCK_KEY, blocking=False) as acquired:
        if not acquired:
            # Замок держит другой прогон — молча пропускаем, иначе эффекты
            # применились бы дважды.
            logger.info("догон эффектов уже идёт; прогон пропущен")
            return CatchUpResult(
                watermark_before=None, watermark_after=None, skipped=True
            )

        # Заведение знака ПОД ЗАМКОМ (снимает гонку двух первых прогонов за
        # уникальный ключ). Знака нет — «никогда не материализовали» → начинаем
        # с сегодня, БЕЗ отматывания истории: эффекты начинаются с выкатки, а не
        # задним числом за всё время существования данных.
        before, created = watermark_gateway.get_or_bootstrap(
            WATERMARK_KEY, default_date=today
        )
        if created:
            return CatchUpResult(watermark_before=None, watermark_after=today)

        # Часы назад ловим ЯВНЫМ сравнением, а не пустым планом: catchup_plan()
        # отдаёт [] и когда today == знак (обычный холостой проход), и когда
        # today < знак (часы пошли назад). По одному лишь пустому плану второе
        # выглядело бы как первое и прошло бы молча.
        if today < before:
            logger.error(
                "часы позади водяного знака: догон остановлен",
                extra={"watermark": before.isoformat(), "today": today.isoformat()},
            )
            return CatchUpResult(
                watermark_before=before,
                watermark_after=before,
                halted=True,
                halt_reason="clock_behind_watermark",
            )

        gap = (today - before).days
        if gap > CATCHUP_SANITY_DAYS:
            logger.error(
                "разрыв догона больше порога здравого смысла: остановлен",
                extra={
                    "gap_days": gap,
                    "watermark": before.isoformat(),
                    "today": today.isoformat(),
                },
            )
            return CatchUpResult(
                watermark_before=before,
                watermark_after=before,
                halted=True,
                halt_reason="gap_exceeds_sanity",
            )

        plan = catchup_plan(watermark=before, today=today)[:MAX_CATCHUP_DAYS]

        processed = []
        for day in plan:
            # Транзакция НА ДЕНЬ: падение на дне N откатывает только день N и
            # оставляет знак на N-1. Ошибка материализатора идёт наверх (прогон
            # встаёт на этом дне) — следующий прогон повторит день.
            with transaction.atomic():
                _materialize_day(business_date=day, materializers=materializers)
                watermark_gateway.advance(WATERMARK_KEY, to_date=day)
            processed.append(day)

        after = processed[-1] if processed else before
        return CatchUpResult(
            watermark_before=before, watermark_after=after, processed_days=processed
        )
