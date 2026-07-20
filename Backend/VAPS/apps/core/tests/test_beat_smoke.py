"""Story 12.6 — test-full smoke исполнения beat-задач (architecture.md:639).

Celery-брокера нет (ARCH-DEFERRED-048) — дымится ИСПОЛНЕНИЕ самих периодических
задач: каждая manage.py-команда из ЖИВОГО расписания (deploy/systemd, парсер
test_beat_registration) прогоняется через call_command на живой PG. Новая
задача, добавленная в юнит, автоматически попадает сюда — хардкода списка нет.

Ассертится исполнение и watermark (движок реально отработал), НЕ доставка
уведомлений: on_commit под django_db не выполняется (память проекта); доставка
дымится WS-тестами E11. Маркер slow → deselected в gate, гоняется в test-full.
"""

import pytest
from django.core.management import call_command

from apps.core.models import Watermark
from apps.core.tests.test_beat_registration import (
    REQUIRED_BEAT_COMMANDS,
    scheduled_commands,
)

pytestmark = [pytest.mark.slow, pytest.mark.django_db]


def test_every_scheduled_command_executes_cleanly():
    """Чистая БД: каждая задача расписания — чистый no-op без исключений."""
    executed = []
    for commands in scheduled_commands().values():
        for command in commands:
            call_command(command)  # исключение = красный smoke с именем задачи
            executed.append(command)
    assert set(executed) >= REQUIRED_BEAT_COMMANDS, (
        f"расписание потеряло обязательные задачи: исполнено только {executed}"
    )


def test_execution_reaches_watermark_engines():
    """Watermark-строки обеих задач существуют после прогона — исполнение дошло
    до движков (не отвалилось на импорте/аргументах)."""
    for commands in scheduled_commands().values():
        for command in commands:
            call_command(command)
    keys = set(Watermark.objects.values_list("key", flat=True))
    assert {"status_effects", "lagging_submissions"} <= keys, (
        f"watermark-строки движков не созданы: есть только {sorted(keys)}"
    )
