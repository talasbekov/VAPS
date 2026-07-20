"""Story 12.6 — регистрация beat-задач (architecture.md: обязательный сквозной тест).

Celery в проекте нет (ARCH-DEFERRED-048): «beat» = systemd-таймеры контура
(deploy/systemd/*), зовущие management-команды в контейнере app. Этот тест —
gate-гвард расписания: переименованная/несуществующая задача в ExecStart
краснит gate, таймер без catch-up семантики (Persistent=true) — тоже.

Парсер переиспользуется smoke-тестом test-full (test_beat_smoke.py): список
задач для smoke извлекается из ЖИВОГО расписания, не хардкодится.
"""

import re
from pathlib import Path

from django.core.management import get_commands, load_command_class

# Команды manage.py в строке ExecStart юнита.
_MANAGE_PY_RE = re.compile(r"manage\.py\s+([A-Za-z_]\w*)")

# Задачи, обязанные быть в расписании (анти-«тихо забыли зарегистрировать»):
# оба catch-up движка beat-ready с 3.12/5.7b2 и ждали именно этой регистрации.
REQUIRED_BEAT_COMMANDS = {"materialize_status_effects", "check_lagging_submissions"}


def systemd_dir():
    """deploy/systemd от корня репо (worktree-safe: ищем вверх от файла)."""
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "deploy" / "systemd"
        if candidate.is_dir():
            return candidate
    raise AssertionError(
        "deploy/systemd не найден ни в одном родителе — сломана структура репо"
    )


def parse_manage_commands(unit_text):
    """Имена manage.py-команд из всех ExecStart*-строк текста юнита.

    Префиксное сравнение (не ``ExecStart=``): задача, спрятанная в
    ``ExecStartPre=``/``ExecStartPost=``, тоже обязана пройти гвард.
    """
    commands = []
    for line in unit_text.splitlines():
        if line.lstrip().startswith("ExecStart"):
            commands.extend(_MANAGE_PY_RE.findall(line))
    return commands


def scheduled_commands():
    """{имя .service файла: [manage.py-команды]} по живым юнитам."""
    return {
        unit.name: parse_manage_commands(unit.read_text(encoding="utf-8"))
        for unit in sorted(systemd_dir().glob("*.service"))
    }


def assert_commands_registered(commands, unit_name):
    """Каждая команда существует в Django И импортируется — иначе AssertionError."""
    known = get_commands()
    for command in commands:
        assert command in known, (
            f"{unit_name}: ExecStart ссылается на несуществующую команду "
            f"manage.py {command!r} — задача умерла бы в проде молча"
        )
        # Существование в реестре ≠ импортируемость: битый модуль падает здесь.
        load_command_class(known[command], command)


def test_every_scheduled_command_exists_and_imports():
    for unit_name, commands in scheduled_commands().items():
        assert_commands_registered(commands, unit_name)


def test_required_beat_commands_are_scheduled():
    scheduled = {cmd for commands in scheduled_commands().values() for cmd in commands}
    missing = REQUIRED_BEAT_COMMANDS - scheduled
    assert not missing, (
        f"catch-up задачи не зарегистрированы ни в одном юните: {sorted(missing)}"
    )


def test_service_timer_pairing():
    units = systemd_dir()
    for service, commands in scheduled_commands().items():
        if commands:
            timer = service.removesuffix(".service") + ".timer"
            assert (units / timer).is_file(), (
                f"{service} зовёт manage.py, но парного {timer} нет — "
                "задача не запустится"
            )
    for timer in units.glob("*.timer"):
        service = timer.name.removesuffix(".timer") + ".service"
        assert (units / service).is_file(), (
            f"{timer.name} без парного {service} — таймер стреляет в пустоту"
        )


def test_every_timer_is_persistent():
    # Catch-up семантика NFR-5: пропуск при выключенном сервере догоняется.
    for timer in systemd_dir().glob("*.timer"):
        text = timer.read_text(encoding="utf-8")
        assert re.search(r"^\s*Persistent\s*=\s*true\s*$", text, re.MULTILINE), (
            f"{timer.name}: нет Persistent=true — пропущенный запуск потеряется"
        )


def test_parser_rejects_unknown_command_fixture():
    # Эпик-AC на фикстуре: расписание с несуществующей задачей → красный ассерт
    # с именем команды и юнита.
    fixture = (
        "ExecStartPre=/bin/bash -c 'manage.py materialize_status_effectz'\n"
        "ExecStart=/bin/true"
    )
    commands = parse_manage_commands(fixture)
    assert commands == ["materialize_status_effectz"]
    try:
        assert_commands_registered(commands, "fixture.service")
    except AssertionError as exc:
        assert "materialize_status_effectz" in str(exc)
        assert "fixture.service" in str(exc)
    else:
        raise AssertionError(
            "несуществующая команда прошла регистрацию — гвард вакуумен"
        )
