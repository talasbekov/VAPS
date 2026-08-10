"""CORS локального стенда: хост фронта пускаем, чужой origin — нет.

Зачем тест: `CORS_ALLOWED_ORIGINS` в base.py прибит к порту 3000, а хост
PersonalRecordFront на стенде поднимается на другом порту (3105/3106 —
см. .claude/launch.json). Итог на живом стенде: preflight отвечал 200 без
единого заголовка `Access-Control-Allow-Origin`, и браузер рубил КАЖДЫЙ
запрос к данным как `net::ERR_FAILED` — дашборд показывал «Ошибка загрузки
данных: Failed to fetch», хотя бэк был жив и отвечал.

Правило берём ИЗ САМОГО dev-модуля настроек, а не переписываем константу в
тест: копия разошлась бы с настройками молча, и тест остался бы зелёным на
сломанном стенде.
"""
import re

import pytest
from django.test import override_settings

from organization_management.config.settings import sqlite as dev_settings

DEV_REGEXES = getattr(dev_settings, "CORS_ALLOWED_ORIGIN_REGEXES", [])


def _origin_allowed(client, origin):
    """Отдаёт ли бэк этому origin заголовок ACAO на preflight."""
    response = client.options(
        "/api/staff_unit/staff-units/",
        HTTP_ORIGIN=origin,
        HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization,content-type",
    )
    return response.get("Access-Control-Allow-Origin") == origin


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:3106",  # стенд, на котором дефект и поймали
        "http://localhost:3105",
        "http://127.0.0.1:3106",
        "http://localhost:3000",  # порт из base.py не должен потеряться
    ],
)
@pytest.mark.django_db
def test_dev_cors_admits_local_frontend_ports(client, origin):
    with override_settings(CORS_ALLOWED_ORIGIN_REGEXES=DEV_REGEXES):
        assert _origin_allowed(client, origin), (
            f"origin {origin} не получил Access-Control-Allow-Origin — "
            "браузер срубит запрос как ERR_FAILED"
        )


@pytest.mark.parametrize(
    "origin",
    [
        "http://evil.com",
        "https://localhost.evil.com",  # хвост после localhost — не наш хост
        "http://localhost.evil.com:3106",
        "http://notlocalhost:3106",
    ],
)
@pytest.mark.django_db
def test_dev_cors_rejects_foreign_origins(client, origin):
    """Послабление dev-стенда не должно открывать бэк наружу."""
    with override_settings(CORS_ALLOWED_ORIGIN_REGEXES=DEV_REGEXES):
        assert not _origin_allowed(client, origin), (
            f"чужой origin {origin} получил ACAO — правило слишком широкое"
        )


def test_dev_regexes_are_anchored():
    """Незаякоренный шаблон совпал бы серединой чужого origin."""
    assert DEV_REGEXES, "dev-настройки не задают CORS_ALLOWED_ORIGIN_REGEXES"
    for pattern in DEV_REGEXES:
        assert pattern.startswith("^"), f"{pattern} не заякорен слева"
        assert pattern.endswith("$"), f"{pattern} не заякорен справа"
        re.compile(pattern)  # шаблон должен компилироваться
