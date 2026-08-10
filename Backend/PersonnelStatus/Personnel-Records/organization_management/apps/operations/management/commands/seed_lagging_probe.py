"""Сид контура «несдача → уведомление» для стенда (порт seed_e2e_lagging из
Backend/VAPS).

ФИКСТУРА, А НЕ ПРОД-КОД. Готовит базу так, чтобы СЛЕДУЮЩИЙ запуск штатного
`check_lagging_submissions` породил РОВНО ОДНО уведомление об отставании. Сама
она ничего не уведомляет — иначе проверялась бы фикстура, а не эмиттер.

ДЕНЬ ВЫБИРАЕТ КОМАНДА, И ВЫБОРА У НЕЁ НЕТ — это СЕГОДНЯ. Задавать его снаружи
нельзя, и это выяснилось прямой пробой, а не рассуждением. Горизонт эмиттера
считается от ЕГО «сегодня», план — полуинтервал (знак, горизонт]; поставь целью
вчерашний день, и план становится из двух дней, то есть два уведомления вместо
обещанного одного. Первый проход команды так и делал (день = вчера, как в
источнике) и выдавал два. Знак ставится на «сегодня минус день», и интервал
схлопывается ровно в один день.

КОНТРОЛЬНЫЙ ЧАС ОБНУЛЯЕТСЯ, и это не косметика, а единственный способ сделать
прогон независимым от времени суток. Горизонт — «сегодня, если уже за контрольным
часом, иначе вчера». При обычных 17:00 прогон ДО 17:00 отодвинул бы горизонт на
вчера и дал бы пустой план. Обнулённый час означает, что сегодняшний день уже
закрыт всегда, — отсюда и право брать целью именно сегодня.

Отличия от источника: подразделение целое (в источнике UUID), и уведомления
чистятся у ops_notifications раздела — старых уведомлений проекта команда не
трогает вовсе.
"""
from datetime import time, timedelta

from django.core.management.base import BaseCommand, CommandError

from organization_management.apps.operations import watermark as watermark_gateway
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.lagging_check import WATERMARK_KEY
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.models_submission import (
    OpsSubmissionControlSettings,
)

# ФИКСИРОВАННОЕ, а не случайное: случайное делало бы прогоны неповторяемыми —
# каждый копил бы в настройках новое «необходимое управление». Строку Division
# заводить не нужно: список необходимых хранит плоские идентификаторы БЕЗ
# внешнего ключа, и отсутствие сдачи по такому идентификатору и ЕСТЬ несдача.
PROBE_DIVISION_ID = 999_000_001

DEFAULT_RECIPIENT = "operator-42"


class Command(BaseCommand):
    help = (
        "Засеять контур несдачи для стенда: настройки контроля, водяной знак и "
        "чистка прежних уведомлений — так, чтобы следующий "
        "check_lagging_submissions выдал ровно одно уведомление."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--recipient",
            default=DEFAULT_RECIPIENT,
            help=(
                "Получатель уведомления. Обязан быть ASCII: значение уезжает в "
                "заголовок и в параметр адреса сокета, где кириллица "
                f"отклоняется ещё до сети. По умолчанию {DEFAULT_RECIPIENT}."
            ),
        )

    def handle(self, *args, **options):
        recipient = options["recipient"]
        if not recipient.strip():
            raise CommandError("--recipient пуст: уведомлять было бы некого")
        if not recipient.isascii():
            # Валимся ГРОМКО и здесь, а не «кадр почему-то не пришёл» позже:
            # кириллица в заголовке отклоняется ещё до сети, и разбирать это
            # потом пришлось бы со стороны браузера.
            raise CommandError(
                f"--recipient {recipient!r} не ASCII: значение уезжает "
                "заголовком и параметром адреса сокета, где кириллица "
                "отклоняется ещё до сети."
            )

        # СЕГОДНЯ, и это не умолчание, а единственно возможный день (см.
        # докстринг): любой другой растягивает план эмиттера и ломает обещание
        # «ровно одно уведомление».
        day = Clock.today_local()

        OpsSubmissionControlSettings.objects.update_or_create(
            singleton_key=1,
            defaults={
                "control_hour": time(0, 0),
                "required_division_ids": [PROBE_DIVISION_ID],
                # Общего получателя достаточно: разрешение адресата падает на
                # него, если у подразделения своего не задано.
                "default_notify_recipient": recipient,
            },
        )

        # Знак на день ДО целевого: полуинтервал (знак, горизонт] даёт ровно
        # один день. Без этой строки первый запуск эмиттера только заводит знак
        # и сразу выходит, никого не уведомив.
        target = day - timedelta(days=1)
        watermark_gateway.get_or_bootstrap(WATERMARK_KEY, default_date=target)
        watermark_gateway.advance(WATERMARK_KEY, to_date=target)

        # Прежние уведомления получателя сносятся ПО ВСЕМ дням, а не только за
        # целевой: «одно на день» — это get_or_create, и строка, оставшаяся от
        # вчерашнего прогона (у которого «вчера» было другим днём), помешала бы
        # не публикации, а СЧЁТУ — непрочитанных оказалось бы два вместо одного.
        removed, _ = OpsNotification.objects.filter(recipient=recipient).delete()

        self.stdout.write(f"PROBE_DAY={day.isoformat()}")
        self.stdout.write(f"PROBE_RECIPIENT={recipient}")
        self.stdout.write(f"PROBE_DIVISION={PROBE_DIVISION_ID}")
        self.stdout.write(
            self.style.SUCCESS(
                f"сид готов: знак {WATERMARK_KEY} → {target.isoformat()}, "
                f"снято прежних уведомлений: {removed}"
            )
        )
