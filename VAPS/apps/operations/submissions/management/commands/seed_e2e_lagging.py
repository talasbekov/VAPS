"""Story 11.6 — детерминированная фикстура контура «несдача → уведомление».

ТЕСТОВАЯ ФИКСТУРА для live-e2e (``npm run test:e2e:live``), не прод-код: готовит
БД так, чтобы следующий запуск штатного эмиттера ``check_lagging_submissions``
породил РОВНО ОДНО уведомление ``SUBMISSION_LAGGING`` для ``--recipient``, и
печатает выбранный день машинно-читаемо (``E2E_DAY=YYYY-MM-DD``).

Почему день выбирает КОМАНДА, а не спека: браузер в e2e живёт в
``America/Anchorage`` (UTC−9), бизнес-дата считается в ``Asia/Qyzylorda``
(UTC+5) — разрыв 14 часов, поэтому JS-«вчера» регулярно другой день, чем
серверное. Единственный источник даты — серверные часы (``Clock``).

Изоляция (ARCH-004): ``Watermark`` пишется через шлюз ``apps.core.watermark`` —
``apps.operations`` не имеет права импортировать ``apps.core.models`` напрямую
(гвард ``apps/operations/tests/test_isolation.py``), и на фикстуру это правило
распространяется ровно так же, как на прод-модуль.
"""

from datetime import date, time, timedelta
from uuid import UUID

from django.core.management.base import BaseCommand, CommandError

from apps.core import watermark as watermark_gateway
from apps.core.clock import Clock
from apps.notifications.models import Notification
from apps.operations.submissions.models import SubmissionControlSettings
from apps.operations.submissions.services.lagging_check import WATERMARK_KEY

# ФИКСИРОВАННЫЙ, а не случайный: случайный UUID сделал бы прогоны
# неповторяемыми (каждый прогон копил бы новое «необходимое управление»).
# Строки Division заводить не надо — required_division_ids это плоские UUID
# БЕЗ FK (ARCH-003, control_settings.py:32), а отсутствие DailySubmission по
# такому id и ЕСТЬ несдача (tomorrow_block.py:61-68).
E2E_DIVISION_ID = UUID("e2e00000-0000-4000-8000-000000000011")

DEFAULT_RECIPIENT = "operator-42"


class Command(BaseCommand):
    help = (
        "Засеять контур несдачи для live-e2e (11.6): singleton настроек, "
        "watermark и чистка прошлых уведомлений — так, чтобы следующий "
        "check_lagging_submissions выдал ровно одно уведомление. Печатает "
        "E2E_DAY=<день> для передачи в --today."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--recipient",
            default=DEFAULT_RECIPIENT,
            help=(
                "Плоский actor id получателя (обязан быть ASCII — значение "
                "уезжает идентифицирующим заголовком и квери-параметром сокета). "
                f"По умолчанию {DEFAULT_RECIPIENT}."
            ),
        )
        parser.add_argument(
            "--day",
            help="Бизнес-дата несдачи (YYYY-MM-DD); по умолчанию «вчера» по Clock.",
        )

    def handle(self, *args, **options):
        recipient = options["recipient"]
        if not recipient.isascii():
            # Кириллица отклоняется ещё до сети (заголовок/квери сокета) —
            # находка дев-прохода 11.3. Валимся громко, а не «кадр не пришёл».
            raise CommandError(
                f"--recipient {recipient!r} не ASCII: значение уезжает "
                "идентифицирующим заголовком и квери-параметром сокета — "
                "кириллица там отклоняется ещё до сети (находка 11.3). "
                "Кириллица допустима только в телах данных."
            )

        if options.get("day"):
            try:
                day = date.fromisoformat(options["day"])
            except ValueError as exc:
                raise CommandError(
                    f"неверный --day {options['day']!r}: ожидается YYYY-MM-DD"
                ) from exc
        else:
            # ВЧЕРА, а не сегодня: check_lagging_submissions отказывается
            # принимать --today в будущем, а «сегодня» ещё может быть не
            # закрыто контрольным часом.
            day = Clock.today_local() - timedelta(days=1)

        # 1. Singleton настроек контроля.
        #
        # control_hour = 00:00 — НЕ косметика, а единственный способ сделать
        # прогон независимым от времени суток. Эмиттер считает горизонт как
        # `check_through = today if local_now > control_hour else today - 1`
        # (lagging_check.py:158-166), а план — это полуинтервал
        # (watermark, check_through] (clock.py:96-97). При дефолтных 17:00
        # прогон ДО 17:00 дал бы пустой план (0 уведомлений), а ПОСЛЕ — план из
        # двух дней (2 уведомления, счётчик «2» вместо «1»). Обнулённый
        # контрольный час фиксирует check_through = day, то есть РОВНО один
        # день плана при любом времени суток.
        SubmissionControlSettings.objects.update_or_create(
            singleton_key=1,
            defaults={
                "control_hour": time(0, 0),
                "required_division_ids": [E2E_DIVISION_ID],
                # Глобального «дежурного» достаточно: DivisionNotifyRecipient
                # заводить НЕ надо, resolve_many падает на этот фолбэк
                # (selectors.py:208-213).
                "default_notify_recipient": recipient,
            },
        )

        # 2. Watermark на день ДО целевого: полуинтервал (watermark, day] даёт
        # ровно [day]. Без этой строки первый запуск эмиттера только
        # бутстрапит watermark вчерашним днём и СРАЗУ выходит, ничего не
        # уведомив (lagging_check.py:118-124).
        #
        # Через шлюз, а не Watermark.objects: прямой импорт apps.core.models из
        # apps.operations красит гвард изоляции. get_or_bootstrap создаёт строку,
        # если её нет; advance выставляет точное значение, если строка уже была
        # (advance — обычный save, не «только вперёд»: core/watermark.py:29-33).
        target_watermark = day - timedelta(days=1)
        watermark_gateway.get_or_bootstrap(
            WATERMARK_KEY, default_date=target_watermark
        )
        watermark_gateway.advance(WATERMARK_KEY, to_date=target_watermark)

        # 3. Снести прошлые уведомления получателя.
        #
        # По ВСЕМ дням, а не только за day: notify() — это get_or_create, и
        # on_commit(_publish) вешается ТОЛЬКО при created=True
        # (services.py:179). Строка, оставшаяся от вчерашнего прогона (у
        # которого «вчера» было другим днём), не помешала бы публикации, но
        # осталась бы непрочитанной и сделала бы счётчик «2» вместо «1».
        deleted, _ = Notification.objects.filter(recipient=recipient).delete()

        self.stdout.write(f"E2E_DAY={day.isoformat()}")
        self.stdout.write(f"E2E_RECIPIENT={recipient}")
        self.stdout.write(f"E2E_DIVISION={E2E_DIVISION_ID}")
        self.stdout.write(
            self.style.SUCCESS(
                f"сид готов: watermark {WATERMARK_KEY} → "
                f"{target_watermark.isoformat()}, удалено уведомлений: {deleted}"
            )
        )
