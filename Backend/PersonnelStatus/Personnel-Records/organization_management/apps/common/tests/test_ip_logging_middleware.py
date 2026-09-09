"""Печать входящего запроса верит той же цепочке, что и подпись (доводка
№699 по ревью №825).

`client_ip()` (Plane №699) закрыла подделку заголовка в реквизитах подписи —
но рядом жила ВТОРАЯ, независимая точка чтения `X-Forwarded-For`: строка
лога каждого запроса брала ПЕРВЫЙ (левый, клиентский) хоп без проверки
доверия вовсе. Тот же класс уязвимости, просто в другом месте.
"""
import pytest
from django.test import RequestFactory, override_settings

from organization_management.apps.common.management.ip_logging_middleware import (
    LogIPMiddleware,
)

PROXY = "10.0.0.1"
CLIENT = "203.0.113.9"
FORGED = "6.6.6.6"


def _run(remote_addr, forwarded=None, capsys=None):
    extra = {"REMOTE_ADDR": remote_addr}
    if forwarded is not None:
        extra["HTTP_X_FORWARDED_FOR"] = forwarded
    request = RequestFactory().get("/api/ops/security-events/", **extra)
    middleware = LogIPMiddleware(lambda req: "response")
    middleware(request)
    return capsys.readouterr().out


def test_without_a_trusted_proxy_a_forged_header_does_not_win(capsys):
    """🔴 БЫЛО (найдено ревью №825, доводка №699). `x_forwarded_for.split(',')[0]`
    брал ЛЕВЫЙ хоп без единой проверки — тот самый, который вписывает
    клиент. Мутация «вернуть split(',')[0]» красит эту пробу.
    """
    out = _run(PROXY, forwarded=f"{FORGED}, {CLIENT}", capsys=capsys)
    assert FORGED not in out
    assert PROXY in out


@override_settings(TRUSTED_PROXY_IPS=(PROXY,))
def test_behind_a_trusted_proxy_the_real_client_is_printed(capsys):
    out = _run(PROXY, forwarded=CLIENT, capsys=capsys)
    assert CLIENT in out
