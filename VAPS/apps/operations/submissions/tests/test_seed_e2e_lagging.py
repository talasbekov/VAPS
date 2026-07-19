"""QA-слой Story 11.6 — тесты фикстуры ``seed_e2e_lagging`` (live-e2e контура).

**Зачем этот файл вообще существует.** Дев-проход 11.6 оставил ровно один тест —
``frontend/e2e-live/notifications-live.spec.ts``. Он сильный (красная проба, 8
мутаций), но запускается ТОЛЬКО вручную: ``npm run test:e2e:live`` требует docker,
Postgres, Redis, uvicorn и браузер, не входит ни в ``make gate``, ни в
``npm run gate``, а CI в проекте нет вовсе (Ловушка 18). Стори сама назвала риск
Открытым вопросом №2: «риск, что сьют тихо сгниёт, реален».

Гниёт он не сам по себе, а через ФИКСТУРУ: ``seed_e2e_lagging`` — единственная
предпосылка всего сценария, и она зависит от чужой семантики (``lagging_check``,
``tomorrow_block``, ``resolve_many``, ``watermark``). Любое изменение там ломает
сид молча, и узнают об этом только когда кто-нибудь руками поднимет браузерный
сьют. Эти тесты переносят контракт фикстуры в ``make gate`` (73 с, без браузера,
без uvicorn): сид ломается — краснеет гейт, а не чей-то ручной прогон через месяц.

**Что проверяется — контракт, а не реализация.** Несущее утверждение сида:
«после меня следующий ``check_lagging_submissions`` создаёт РОВНО ОДНО
уведомление ``SUBMISSION_LAGGING`` для ``--recipient``, при любом времени суток и
на любом по счёту прогоне». Всё остальное здесь — ветки, которые сид написал,
чтобы это утверждение держалось.

**Почему pytest, а не второй Playwright-сценарий.** Лимит 5 браузерных сценариев
против живого бэка (architecture.md#L259) жёсткий, 11.6 занимает слот №4 —
шестого сценария заводить нельзя. Да и не нужно: всё ниже — серверная механика,
браузер её не наблюдает.

**Почему обычный ``django_db``, а не ``transaction=True``.** Здесь проверяется
СОЗДАНИЕ строки, а не публикация кадра: ``on_commit`` → ``_publish`` — предмет
11.2 и покрыт там. Поэтому предупреждение ``test_ws_notify.py:37-43`` (мутация
migration-seeded ``SubmissionControlSettings`` закоммитилась бы на всю сессию)
здесь не действует: под rollback-транзакцией мутация синглтона откатывается, ровно
как у соседнего ``test_lagging_check.py``, который делает то же самое.
"""

import re
from datetime import date, datetime, time, timedelta
from io import StringIO
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core import clock
from apps.core.models import Watermark
from apps.notifications.models import Notification
from apps.operations.submissions.models import SubmissionControlSettings
from apps.operations.submissions.services.lagging_check import WATERMARK_KEY

# Константы берутся из самого сида, а не копируются: разъехавшаяся копия UUID
# сделала бы тест зелёным против фикстуры, которой больше нет.
from apps.operations.submissions.management.commands.seed_e2e_lagging import (  # isort: skip
    DEFAULT_RECIPIENT,
    E2E_DIVISION_ID,
)

pytestmark = pytest.mark.django_db

LOCAL = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
DAY = date(2026, 6, 5)  # «сегодня» в тестах; цель сида — вчера, DAY - 1

# Тот же паттерн, которым спека парсит stdout сида
# (notifications-live.spec.ts: /^E2E_DAY=(\d{4}-\d{2}-\d{2})$/m). Разъехались —
# спека падает с «сид не напечатал E2E_DAY», и виноват будет кто угодно, кроме
# автора правки формата.
E2E_DAY_RE = re.compile(r"^E2E_DAY=(\d{4}-\d{2}-\d{2})$", re.MULTILINE)


def at(day, hour):
    """Aware local datetime — время СУТОК, от которого зависит горизонт эмиттера."""
    return datetime(day.year, day.month, day.day, hour, 0, tzinfo=LOCAL)


def run_seed(**kwargs):
    """Запустить сид, вернуть его stdout."""
    out = StringIO()
    args = ["seed_e2e_lagging"]
    for flag, value in kwargs.items():
        args += [f"--{flag.replace('_', '-')}", value]
    call_command(*args, stdout=out)
    return out.getvalue()


def seeded_day(stdout):
    """День, выбранный сидом — ровно так, как его достаёт живая спека."""
    match = E2E_DAY_RE.search(stdout)
    assert match, f"сид не напечатал E2E_DAY машинно-читаемо; stdout:\n{stdout}"
    return date.fromisoformat(match.group(1))


def run_emitter(day):
    """Штатный эмиттер («beat», Решение №3) — как его зовёт спека."""
    out = StringIO()
    call_command("check_lagging_submissions", "--today", day.isoformat(), stdout=out)
    return out.getvalue()


def lagging_notices(recipient=DEFAULT_RECIPIENT):
    return Notification.objects.filter(
        recipient=recipient, kind=Notification.Kind.SUBMISSION_LAGGING
    )


# --- Несущий контракт: сид → эмиттер → ровно одно уведомление -----------------


def test_seed_then_emitter_produce_exactly_one_notification():
    """Предпосылка всего live-сценария, проверенная в гейте.

    Строк ``Division`` не заводится ни одной — и это часть контракта, а не
    экономия: ``required_division_ids`` это плоские UUID БЕЗ FK (ARCH-003), а
    отсутствие ``DailySubmission`` по такому id и ЕСТЬ несдача
    (tomorrow_block.py:61-68). Заведись здесь FK — сид пришлось бы переписывать.
    """
    with clock.override(at(DAY, 8)):
        day = seeded_day(run_seed(recipient=DEFAULT_RECIPIENT))
        assert day == DAY - timedelta(days=1), "цель сида — ВЧЕРА (Ловушка 3)"

        out = run_emitter(day)

    assert "1 notice(s)" in out, f"эмиттер не создал уведомление:\n{out}"
    note = lagging_notices().get()
    assert note.business_date == day
    # Глобальный default_notify_recipient сработал фолбэком: пер-дивизионный
    # DivisionNotifyRecipient сид намеренно НЕ заводит (AC-3, selectors.py:208-213).
    assert note.recipient == DEFAULT_RECIPIENT
    assert note.payload == {"laggard_division_ids": [str(E2E_DIVISION_ID)]}


def test_the_fixture_holds_at_any_hour_of_the_day():
    """Отклонение №1 дев-прохода (``control_hour = 00:00``) — не косметика.

    Горизонт эмиттера — ``check_through = today if local_now > control_hour else
    today - 1`` (lagging_check.py:158-166), а план — полуинтервал
    ``(watermark, check_through]``. При ДЕФОЛТНЫХ 17:00 прогон в 08:00 даёт
    ПУСТОЙ план: ``check_through`` откатывается на ``day - 1``, то есть ровно на
    watermark. Ноль уведомлений — и живой сьют краснеет только до 17:00 по
    Qyzylorda, то есть флейком по времени суток. Этот класс проект уже ловил
    ([[project_tz_flake_vacancies_test]]), и диагностируется он дороже всего.

    Дев-проход проверил это ручной мутацией №8 — здесь оно становится тестом.
    """
    for hour in (8, 23):
        with clock.override(at(DAY, hour)):
            day = seeded_day(run_seed(recipient=DEFAULT_RECIPIENT))
            out = run_emitter(day)

        assert "1 notice(s)" in out, (
            f"в {hour}:00 по {settings.VAPS_LOCAL_TIMEZONE} фикстура не сработала "
            f"— сид не обнулил контрольный час:\n{out}"
        )
        assert lagging_notices().count() == 1
        lagging_notices().delete()  # следующая итерация стартует с чистого листа


def test_a_repeat_run_recreates_the_row_rather_than_finding_it():
    """Ловушка 1: ``notify()`` — это ``get_or_create``, и ``on_commit(_publish)``
    вешается ТОЛЬКО при ``created is True`` (services.py:179).

    Без чистки уведомлений второй прогон нашёл бы строку, кадра бы не отправил, и
    живой сьют упал бы «кадр не пришёл» — на совершенно исправном прод-коде.
    Дев-проход проверял повторяемость двумя зелёными прогонами руками; здесь она
    становится кодом.

    🔴 **Ассертить ``notified_count`` здесь НЕЛЬЗЯ, и это выяснила красная проба.**
    ``notify()`` возвращает строку и созданную, И НАЙДЕННУЮ (services.py:154-162),
    а ``_emit_lagging`` инкрементит счётчик на всякий не-``None`` возврат
    (lagging_check.py:230-233). Поэтому «1 notice(s)» печатается и тогда, когда
    строка просто найдена, кадр не отправлен и живой сьют обречён. Первая
    редакция этого теста судила именно по этой строке и оставалась ЗЕЛЁНОЙ при
    снятой чистке — то есть не проверяла ничего.
    Различают created от found два наблюдаемых факта: пустой стол после сида и
    НОВЫЙ pk после второго эмиттера. Браузерный аналог первого уже есть в живой
    спеке — ассерт «до эмиттера непрочитанных нет».

    Второй цикл заодно проходит ветку, которой в первом нет: watermark уже
    существует (эмиттер сдвинул его на ``day``), поэтому ``get_or_bootstrap``
    ничего не создаёт и работу обязан сделать ``advance``.
    """
    with clock.override(at(DAY, 8)):
        first_day = seeded_day(run_seed(recipient=DEFAULT_RECIPIENT))
        run_emitter(first_day)
        first_pk = lagging_notices().get().pk

        second_day = seeded_day(run_seed(recipient=DEFAULT_RECIPIENT))
        assert not lagging_notices().exists(), (
            "сид не почистил Notification — следующий notify() найдёт строку "
            "вместо создания, on_commit(_publish) не повесится, WS-кадра не "
            "будет (Ловушка 1)"
        )

        out = run_emitter(second_day)

    assert second_day == first_day, "день должен быть тем же — сид детерминирован"
    assert "1 notice(s)" in out, f"повторный прогон не уведомил:\n{out}"
    assert lagging_notices().count() == 1, "ровно одно, а не накопленные два"
    assert lagging_notices().get().pk != first_pk, (
        "уведомление НЕ пересоздано, а найдено старое: publish вешается только "
        "на created=True, значит кадра не будет"
    )


def test_seed_pulls_a_stale_watermark_back():
    """Ловушка 2 + повторяемость: ``get_or_bootstrap`` НЕ трогает существующую
    строку, поэтому вернуть watermark на ``day - 1`` обязан ``advance``.

    Мутация «оставить только ``get_or_bootstrap``» прошла бы первый прогон на
    чистой БД и молча ломала бы каждый следующий — самый неприятный вид поломки
    фикстуры.
    """
    Watermark.objects.create(
        key=WATERMARK_KEY, last_materialized_date=DAY + timedelta(days=5)
    )

    with clock.override(at(DAY, 8)):
        day = seeded_day(run_seed(recipient=DEFAULT_RECIPIENT))

    assert Watermark.objects.get(
        key=WATERMARK_KEY
    ).last_materialized_date == day - timedelta(days=1)


def test_seed_is_deterministic_across_runs():
    """Фиксированный UUID и фиксированный получатель: случайные сделали бы
    прогоны неповторяемыми (каждый копил бы новое «необходимое управление»)."""
    with clock.override(at(DAY, 8)):
        run_seed(recipient=DEFAULT_RECIPIENT)
        first = SubmissionControlSettings.objects.get(singleton_key=1)
        first_ids = list(first.required_division_ids)

        run_seed(recipient=DEFAULT_RECIPIENT)
        second = SubmissionControlSettings.objects.get(singleton_key=1)

    assert first_ids == [E2E_DIVISION_ID] == list(second.required_division_ids)
    assert second.default_notify_recipient == DEFAULT_RECIPIENT
    assert second.control_hour == time(0, 0)
    assert SubmissionControlSettings.objects.count() == 1, "синглтон остался один"


# --- Контракт с живой спекой --------------------------------------------------


def test_seed_prints_the_day_machine_readably():
    """Межфайловый контракт: спека достаёт день ИЗ STDOUT сида и передаёт его в
    ``check_lagging_submissions --today``.

    Дату нельзя считать в JS (Ловушка 19): браузер живёт в ``America/Anchorage``
    (UTC−9), бизнес-дата считается в ``Asia/Qyzylorda`` (UTC+5) — разрыв 14 часов,
    и JS-«вчера» регулярно другой день. Единственный источник даты — серверные
    часы, а канал передачи — эта строка. Сменится её формат — живая спека упадёт
    с «сид не напечатал E2E_DAY», и связь с причиной будет неочевидной.
    """
    with clock.override(at(DAY, 8)):
        out = run_seed(recipient=DEFAULT_RECIPIENT)

    assert seeded_day(out) == DAY - timedelta(days=1)
    # Получатель и дивизион печатаются для отладки живого прогона.
    assert f"E2E_RECIPIENT={DEFAULT_RECIPIENT}" in out
    assert f"E2E_DIVISION={E2E_DIVISION_ID}" in out


def test_explicit_day_is_honoured():
    """``--day`` — единственный способ нацелить фикстуру на конкретную дату
    (догон, отладка); без него сид всегда берёт «вчера» по ``Clock``."""
    target = DAY - timedelta(days=3)

    with clock.override(at(DAY, 8)):
        day = seeded_day(run_seed(recipient=DEFAULT_RECIPIENT, day=target.isoformat()))
        out = run_emitter(day)

    assert day == target
    assert "1 notice(s)" in out, f"фикстура не сработала на явном --day:\n{out}"
    assert lagging_notices().get().business_date == target


# --- Гварды входа: валиться громко, а не «кадром, который не пришёл» ----------


def test_non_ascii_recipient_is_refused_loudly():
    """AC-4: ``recipient`` уезжает идентифицирующим заголовком и квери-параметром
    сокета, кириллица там отклоняется ещё до сети (находка дев-прохода 11.3, 11
    падений).

    Без этого гварда сид отработал бы «успешно», а живая спека упала бы на
    «счётчик не появился» — с диагностикой, уводящей в прод-код транспорта.
    """
    with pytest.raises(CommandError, match="не ASCII"):
        with clock.override(at(DAY, 8)):
            run_seed(recipient="оператор-42")

    assert not lagging_notices(recipient="оператор-42").exists()


def test_malformed_day_is_refused_loudly():
    with pytest.raises(CommandError, match="ожидается YYYY-MM-DD"):
        with clock.override(at(DAY, 8)):
            run_seed(recipient=DEFAULT_RECIPIENT, day="19-07-2026")
