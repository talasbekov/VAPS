"""Времена в деле и в приложении печатаются по зоне ПРОЕКТА (Plane №696).

🔴 ПОЧЕМУ ДЕФЕКТ БЫЛО НЕ ВИДНО. `_fmt_dt` звал голый `.astimezone()`, который
берёт зону ОПЕРАЦИОННОЙ СИСТЕМЫ, а не `TIME_ZONE = 'Asia/Almaty'`. На машине
разработки эти зоны совпадают (+05), и всё печаталось верно; на сервере в UTC
каждая отметка в деле и в приложении к расстановке смещена на пять часов — и
узналось бы об этом по уже подписанной бумаге.

🔴 ПОЧЕМУ ПРОБА КРУТИТ `OPS_LOCAL_TIMEZONE`, А НЕ `TIME_ZONE`. Django на
`override_settings(TIME_ZONE=…)` сам делает `os.environ['TZ'] = …` и
`time.tzset()` (`django.test.signals.timezone_changed`) — то есть меняет и
зону ОС тоже. Проба на `TIME_ZONE` зеленела бы и со старым кодом: она
проверяла бы машину, а не код. Проверено запуском — первая версия этих проб
прошла на невыправленном `_fmt_dt`.

`OPS_LOCAL_TIMEZONE` Django не знает и `tzset` на него не зовёт: зона ОС
остаётся +05 (её выставил `TIME_ZONE` при старте), а раздел просят печатать в
UTC. Старый код даст 17:00, новый — 12:00, и разница не зависит от того, в
какой зоне живёт машина проверяющего.
"""
import datetime as dt

import pytest
from django.test import override_settings

from organization_management.apps.operations import clock
from organization_management.apps.operations.clock import Clock
from organization_management.apps.ops import documents_case

pytestmark = pytest.mark.django_db

#: Полдень UTC: в Алматы это 17:00. Расхождение видно глазом.
MOMENT = dt.datetime(2026, 9, 5, 12, 0, tzinfo=dt.timezone.utc)


@override_settings(OPS_LOCAL_TIMEZONE="UTC")
def test_the_stamp_follows_the_project_zone_not_the_machine():
    """Зона раздела UTC — печатается 12:00, хотя у машины +05."""
    assert documents_case._fmt_dt(MOMENT.isoformat()) == "05.09.2026 12:00"


@override_settings(OPS_LOCAL_TIMEZONE="Asia/Almaty")
def test_the_stamp_is_not_simply_printed_in_utc():
    """И обратная половина: зона раздела +05 — печатается 17:00.

    Без неё «починка» вида «печатать всё в UTC» прошла бы: одна проба на одной
    зоне не отличает «идём за настройкой» от «жёстко печатаем UTC».
    """
    assert documents_case._fmt_dt(MOMENT.isoformat()) == "05.09.2026 17:00"


@override_settings(OPS_LOCAL_TIMEZONE="UTC")
def test_the_z_suffix_is_understood_as_utc():
    """Отметки JSON приходят с `Z`; разбор её понимает и до правки, и после."""
    assert documents_case._fmt_dt("2026-09-05T12:00:00Z") == "05.09.2026 12:00"


@override_settings(OPS_LOCAL_TIMEZONE="UTC")
def test_the_naive_stamp_is_printed_as_it_stands():
    """Наивной отметке зону не приписываем: сдвинуть неизвестный момент на
    неизвестную величину хуже, чем напечатать его как записано."""
    assert documents_case._fmt_dt("2026-09-05T12:00:00") == "05.09.2026 12:00"


@override_settings(OPS_LOCAL_TIMEZONE="UTC")
def test_the_assembled_at_line_follows_the_project_zone_too():
    """«Собрано …» в шапке дела — та же отметка и та же ошибка."""
    with clock.override(MOMENT):
        assert Clock.to_local(Clock.now()).strftime("%d.%m.%Y %H:%M") == (
            "05.09.2026 12:00"
        )


def test_a_bad_string_is_returned_as_it_came():
    """Опора: неразбираемое значение по-прежнему печатается как есть, а не
    роняет сборку документа."""
    assert documents_case._fmt_dt("не дата") == "не дата"
    assert documents_case._fmt_dt(None) == "—"
