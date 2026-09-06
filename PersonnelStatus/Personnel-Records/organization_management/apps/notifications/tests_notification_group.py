"""Издатель и потребитель уведомлений зовут ОДНО имя группы (Plane №824).

🔴 ЧТО ЭТО СТЕРЕЖЁТ. Имя группы канального слоя жило тремя копиями, и одна
разошлась: потребитель слушал `user_<id>`, а `signals.py` слал в
`user_<id>_notifications`. Расхождение НИЧЕГО НЕ РОНЯЕТ — `group_send` в
несуществующую группу законна и молча уходит в пустоту, — поэтому дефект и
прожил незамеченным.

ДВЕ ПРОБЫ, И ОНИ ПРОВЕРЯЮТ РАЗНОЕ, а не одно дважды:
  • первая — что связка работает вообще: сообщение живого издателя доезжает до
    группы, собранной общим договором;
  • вторая — что копий имени больше НЕТ. Именно она ловит дефект №824: первая
    его не поймала бы, потому что зовёт тот же помощник, что и код, — а
    расхождение возникает ровно там, где имя написали РУКАМИ.
"""
import re
from pathlib import Path

import pytest
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.test import override_settings

from organization_management.apps.notifications.groups import (
    NOTIFY_MESSAGE_TYPE,
    group_name_for,
)

IN_MEMORY = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
APP_DIR = Path(__file__).resolve().parent


@pytest.mark.django_db
@override_settings(CHANNEL_LAYERS=IN_MEMORY)
def test_publisher_reaches_the_group_assembled_by_the_contract(django_user_model):
    """Живой издатель кладёт конверт в группу, собранную `group_name_for`."""
    from organization_management.apps.notifications.services.websocket_service import (
        send_report_ready_notification,
    )
    from organization_management.apps.reports.models import Report

    user = django_user_model.objects.create_user(username="n824", password="x")
    report = Report.objects.create(created_by=user, job_id="n824-job")

    layer = get_channel_layer()
    channel = async_to_sync(layer.new_channel)()
    async_to_sync(layer.group_add)(group_name_for(user.pk), channel)

    send_report_ready_notification(report)

    envelope = async_to_sync(layer.receive)(channel)
    # Тип конверта — тоже часть договора: по нему channels выбирает обработчик,
    # и опечатка в нём роняет потребителя уже в бою, а не на импорте.
    assert envelope["type"] == NOTIFY_MESSAGE_TYPE
    assert envelope["message"]["title"] == "Отчет готов"


def _without_comments(text: str) -> str:
    """Комментарии и докстринги выбрасываются ДО разбора.

    🔴 БЕЗ ЭТОГО СТОРОЖ ЛОВИТ ОБЪЯСНЕНИЕ ВМЕСТО КОДА: разбор дефекта №824
    выписан комментарием в `signals.py` и цитирует неверное имя дословно.
    Первый прогон этой пробы так и покраснел — на собственной документации.
    """
    text = re.sub(r'"""[\s\S]*?"""', "", text)
    return re.sub(r"#[^\n]*", "", text)


def _sources():
    """Боевые модули раздела: сам договор и пробы не проверяются."""
    for path in sorted(APP_DIR.rglob("*.py")):
        name = path.name
        if name == "groups.py" or name.startswith(("test_", "tests")):
            continue
        if "__pycache__" in path.parts or name.startswith("__"):
            continue
        yield path


def test_no_module_builds_the_group_name_by_hand():
    """Ни один боевой модуль раздела не собирает имя группы сам.

    Красная мутация — вернуть `f"user_{...}"` куда угодно в разделе: проба
    назовёт файл и строку. Ровно эта мутация и была дефектом №824.
    """
    handmade = re.compile(r"""["'f]?["']user_\{|["']user_["']\s*\+""")
    offenders = [
        f"{path.relative_to(APP_DIR)}:{index}"
        for path in _sources()
        for index, line in enumerate(
            _without_comments(path.read_text(encoding="utf-8")).splitlines(), 1
        )
        if handmade.search(line)
    ]
    assert offenders == [], (
        "имя группы канального слоя собрано руками — зовите `group_name_for` "
        "из `groups.py`, иначе копии разойдутся молча (Plane №824): "
        f"{offenders}"
    )


def test_every_channel_call_takes_its_group_from_the_contract():
    """`group_add` и `group_send` получают имя ТОЛЬКО из общего договора.

    Проверяется первый аргумент вызова, а не наличие импорта: файл целиком не
    бывает «правильным» — у него несколько мест, и договор получает не каждое.
    """
    call = re.compile(r"group_(?:add|send|discard)\)?\(\s*([^,\n]+)", re.M)
    offenders = []
    for path in _sources():
        text = _without_comments(path.read_text(encoding="utf-8"))
        for match in call.finditer(text):
            first = match.group(1).strip()
            if "group_name_for(" in first or first.endswith("user_group"):
                continue
            line = text[: match.start()].count("\n") + 1
            offenders.append(f"{path.relative_to(APP_DIR)}:{line} → {first[:40]}")
    assert offenders == [], (
        "вызов канального слоя получает имя группы не из `group_name_for`: "
        f"{offenders}"
    )
