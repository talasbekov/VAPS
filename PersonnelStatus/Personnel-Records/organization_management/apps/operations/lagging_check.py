"""Догон отставших сдач (порт apps/operations/submissions/services/
lagging_check.py из Backend/VAPS).

Отстающее подразделение — то, которое обязано сдавать и на деловую дату не
сдало. Узнать об этом должен ответственный, и узнать ОДИН РАЗ за день. Работа
идёт от своего водяного знака, день за днём, и переживает простой: сутки без
запуска означают сутки, о которых никому не сообщили, — их надо пройти, а не
списать.

Зеркало движка догона эффектов (`catch_up`): тот же порядок замок → заведение
знака → остановки → план → транзакция на день. Отличий три, и все существенны.

ПЕРВОЕ: свой ключ знака и свой ключ замка. Общие означали бы, что две работы
двигают один горизонт и блокируют друг друга: у догона эффектов и у поиска
отставших разные темпы, и та, что впереди, съедала бы дни соседней.

ВТОРОЕ: КОНТРОЛЬНЫЙ ЧАС. День проверяется только ПОСЛЕ своего дедлайна —
иначе утренний прогон объявил бы отставшими всех, кто ещё имеет право сдать, и
(хуже) увёл бы знак за сегодня, после чего вечерний прогон этот день уже не
переспросил бы. До дедлайна горизонт — вчера.

ТРЕТЬЕ: здесь уведомление и ЕСТЬ операция. `notify()` глотает
инфраструктурный сбой и возвращает None — это верно для деловых операций, у
которых оповещение побочно, но не здесь: молча проглоченный сбой пустил бы
знак за день, о котором не сообщили, а повторить его уже некому
(идемпотентность держится знаком). Поэтому None превращается в ошибку, день
откатывается, знак остаётся на предыдущем.

Законный обход блокировки завтрашнего дня НЕ отменяет уведомления: обход
снимает ЗАМОК на формирование расхода, а не факт отставания. Ответственный
обязан узнать, что за ним день, даже если завтра открыли без него.

Отличия от источника: Celery не импортируется (обёртку задачи и расписание
кладёт отдельный срез); знак, замок и часы берутся из локальных модулей
раздела; id подразделений в данных уведомления — ЦЕЛЫЕ, не строки (JSON знает
целые, и строка заставила бы каждого читателя разбирать её обратно; в
источнике UUID пришлось стрингифицировать за неимением такого типа в JSON).
"""
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from django.db import transaction

from organization_management.apps.operations import watermark as watermark_gateway
from organization_management.apps.operations.clock import Clock, catchup_plan
from organization_management.apps.operations.locks import advisory_lock
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.notify_service import notify
from organization_management.apps.operations.selectors import (
    NotifyRecipientSelector,
    SubmissionControlSettingsSelector,
)
from organization_management.apps.operations.tomorrow_block import tomorrow_block

logger = logging.getLogger(__name__)

# Ключ строки водяного знака ЭТОЙ работы — не «status_effects».
WATERMARK_KEY = "lagging_submissions"

# Ключ замка этой работы — стабильное целое (b"VAGL" в ASCII), намеренно
# отличное от ключа догона эффектов: две фоновые работы не должны ждать друг
# друга, им нечего делить.
LAGGING_LOCK_KEY = 0x5641474C

# Порция за прогон и порог здравого смысла — как у догона эффектов, но СВОИ:
# политика этой работы принадлежит ей. Хвост длиннее порции проходится
# кусками (следующий прогон продолжит), разрыв больше порога — почти наверняка
# сбитые часы или посев, и его надо показать, а не рассылать за год назад.
MAX_CATCHUP_DAYS = 31
CATCHUP_SANITY_DAYS = 366


class LaggingNotifyError(RuntimeError):
    """Уведомление не записалось посреди догона.

    Поднимается, чтобы транзакция дня откатилась и знак остался на предыдущем
    дне: следующий (идемпотентный) прогон повторит день. Без этого знак уехал
    бы за день, о котором так и не сообщили.
    """


@dataclass
class LaggingCheckResult:
    """Итог одного прохода — для команды, вызывающих и тестов."""

    watermark_before: date | None
    watermark_after: date | None
    processed_days: list[date] = field(default_factory=list)
    # Сколько получателей оповещено за проход. Это НЕ «сколько строк создано»:
    # повторно пройденный день (после отката) найдёт готовую строку и всё
    # равно посчитается — уведомление за этот день существует, а обещать по
    # этому числу новизну значило бы обещать то, чего оно не знает.
    notified_count: int = 0
    halted: bool = False
    halt_reason: str = ""
    skipped: bool = False  # замок держал другой прогон


def check_lagging_submissions(*, today=None) -> LaggingCheckResult:
    """Один идемпотентный проход поиска отставших; вернуть результат.

    `today` по умолчанию — Clock.today_local(). ОБЯЗАН идти ВНЕ объемлющей
    транзакции: подённая transaction.atomic() должна быть настоящим КОММИТОМ,
    иначе уведомления дня и сдвиг знака становятся точкой сохранения, и откат
    снаружи стирает весь пройденный путь разом.
    """
    real_today = Clock.today_local() if today is None else today
    if type(real_today) is not date:
        # datetime IS-A date: в план уехал бы неполный день.
        raise TypeError(f"today must be a plain date, got {type(real_today)!r}")

    with advisory_lock(LAGGING_LOCK_KEY, blocking=False) as acquired:
        if not acquired:
            # Замок держит другой прогон — молча пропускаем: иначе один и тот
            # же день разошёлся бы двумя уведомлениями.
            logger.info("поиск отставших уже идёт; прогон пропущен")
            return LaggingCheckResult(
                watermark_before=None, watermark_after=None, skipped=True
            )

        # Заведение знака ПОД ЗАМКОМ (снимает гонку двух первых прогонов за
        # уникальный ключ). Знака нет — «никогда не искали» → начинаем со
        # ВЧЕРА, без рассылки задним числом. Вчера, а не сегодня: сегодняшний
        # день обязан быть проверен после своего контрольного часа, а знак на
        # сегодня проглотил бы его.
        #
        # Опора — НАСТОЯЩИЕ часы, а не параметр `today`: ручной прогон за
        # прошлую дату при ПЕРВОМ запуске завёл бы знак назад, и порог
        # здравого смысла заклинил бы все последующие настоящие прогоны.
        before, created = watermark_gateway.get_or_bootstrap(
            WATERMARK_KEY, default_date=Clock.today_local() - timedelta(days=1)
        )
        if created:
            return LaggingCheckResult(watermark_before=None, watermark_after=before)

        # Часы назад ловим ЯВНЫМ сравнением с настоящей датой (не с горизонтом
        # ниже: он на полдня отстаёт по построению и объявил бы сбитыми часы
        # каждое утро). Пустой план не отличил бы сбой от холостого прохода.
        if real_today < before:
            logger.error(
                "часы позади водяного знака: поиск отставших остановлен",
                extra={
                    "watermark": before.isoformat(),
                    "today": real_today.isoformat(),
                },
            )
            return LaggingCheckResult(
                watermark_before=before,
                watermark_after=before,
                halted=True,
                halt_reason="clock_behind_watermark",
            )

        gap = (real_today - before).days
        if gap > CATCHUP_SANITY_DAYS:
            logger.error(
                "разрыв поиска отставших больше порога здравого смысла: остановлен",
                extra={
                    "gap_days": gap,
                    "watermark": before.isoformat(),
                    "today": real_today.isoformat(),
                },
            )
            return LaggingCheckResult(
                watermark_before=before,
                watermark_after=before,
                halted=True,
                halt_reason="gap_exceeds_sanity",
            )

        # Горизонт: сегодня — только после контрольного часа, иначе вчера.
        # Граница строгая, как и у отметки опоздания: ровно в контрольный час
        # ещё не поздно, значит и отставших ещё нет.
        control_hour = SubmissionControlSettingsSelector.control_hour()
        check_through = (
            real_today
            if Clock.local_now().time() > control_hour
            else real_today - timedelta(days=1)
        )
        if check_through < before:
            # До контрольного часа при уже догнанном знаке: догонять нечего.
            # Выходим ДО catchup_plan(today < watermark) — он записал бы в
            # журнал ложную тревогу про часы позади знака.
            return LaggingCheckResult(watermark_before=before, watermark_after=before)

        plan = catchup_plan(watermark=before, today=check_through)[:MAX_CATCHUP_DAYS]

        processed = []
        notified = 0
        for day in plan:
            # Транзакция НА ДЕНЬ: уведомления дня и сдвиг знака коммитятся
            # вместе — иначе «одно на день» держалось бы на честном слове.
            # Падение на дне N откатывает только день N и оставляет знак на N-1.
            with transaction.atomic():
                notified += _emit_lagging(day)
                watermark_gateway.advance(WATERMARK_KEY, to_date=day)
            processed.append(day)

        after = processed[-1] if processed else before
        return LaggingCheckResult(
            watermark_before=before,
            watermark_after=after,
            processed_days=processed,
            notified_count=notified,
        )


def _emit_lagging(day) -> int:
    """Оповестить ответственных за отставших на `day`; вернуть их число.

    Отстающие приходят пачкой из блокировки завтрашнего дня, получатели —
    одним разрешением, и только потом отстающие ГРУППИРУЮТСЯ по получателю:
    одному человеку за три своих управления уходит одно уведомление, а не три.
    Иначе «одно на день» (ключ по получателю) означало бы, что второе и третье
    просто теряются, — и человек узнавал бы лишь об одном из своих управлений.

    Отставший без разрешённого получателя записывается в журнал процесса и
    пропускается: молчать о нём плохо, но падать нельзя — из-за одного
    незакреплённого подразделения не должны остаться неоповещёнными все
    остальные.
    """
    laggards = tomorrow_block(day).laggards
    if not laggards:
        return 0
    recipients = NotifyRecipientSelector.resolve_many(laggards)
    by_recipient = defaultdict(list)
    for division_id in laggards:
        recipient = recipients.get(division_id)
        if not recipient:
            logger.warning(
                "у отстающего подразделения нет получателя уведомлений",
                extra={"division_id": division_id, "business_date": str(day)},
            )
            continue
        by_recipient[recipient].append(division_id)
    notified = 0
    for recipient, division_ids in by_recipient.items():
        row = notify(
            recipient,
            OpsNotification.Kind.SUBMISSION_LAGGING,
            day,
            payload={"laggard_division_ids": division_ids},
        )
        if row is None:
            # notify() глотает инфраструктурный сбой намеренно — но здесь
            # уведомление и ЕСТЬ операция, и оно в одной транзакции со сдвигом
            # знака. Проглотив сбой, знак уехал бы за день, о котором не
            # сообщили, а идемпотентность держится ровно знаком — повторить
            # день было бы уже некому.
            raise LaggingNotifyError(
                f"notify() не сработал: получатель={recipient!r}, день {day}"
            )
        notified += 1
    return notified
