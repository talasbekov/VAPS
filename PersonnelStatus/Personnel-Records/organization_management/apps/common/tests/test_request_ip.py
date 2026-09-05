"""Разбор адреса клиента: чему верим и чему нет (Plane №699).

Интеграционная проба подписи (`test_ops_approval_route_settings`) закрывает
рабочий случай стенда — прокси нет, заголовок не значит ничего. Здесь
проверяется ветка С доверенным прокси: она включается только в бою, живой
пробы у неё не будет, а ошибиться в ней легче всего.
"""

import pytest
from django.test import RequestFactory, override_settings

from organization_management.apps.common.request_ip import client_ip

PROXY = "10.0.0.1"
CLIENT = "203.0.113.9"


def _request(remote_addr, forwarded=None):
    extra = {"REMOTE_ADDR": remote_addr}
    if forwarded is not None:
        extra["HTTP_X_FORWARDED_FOR"] = forwarded
    return RequestFactory().post("/api/ops/", **extra)


def test_without_trusted_proxies_the_header_means_nothing():
    """Умолчание системы: список пуст — верим только соединению."""
    assert client_ip(_request(PROXY, f"{CLIENT}, 198.51.100.4")) == PROXY


@override_settings(TRUSTED_PROXY_IPS=(PROXY,))
def test_header_from_a_stranger_is_still_ignored():
    """Список не пуст, но запрос пришёл НЕ от прокси — заголовок не читаем."""
    assert client_ip(_request("198.51.100.77", CLIENT)) == "198.51.100.77"


@override_settings(TRUSTED_PROXY_IPS=(PROXY,))
def test_behind_the_proxy_the_client_is_taken_from_the_header():
    assert client_ip(_request(PROXY, CLIENT)) == CLIENT


@override_settings(TRUSTED_PROXY_IPS=(PROXY,))
def test_prepended_hops_do_not_win():
    """🔴 СТОРОЖ ОБХОДА СПРАВА НАЛЕВО.

    Клиент дописал слева два чужих адреса — прокси добавит настоящий справа.
    Разбор слева направо вернул бы подделку `1.2.3.4`; правильный ответ —
    последний хоп. Мутация «брать первый элемент» краснит именно эту пробу.
    """
    assert client_ip(_request(PROXY, f"1.2.3.4, 5.6.7.8, {CLIENT}")) == CLIENT


@override_settings(TRUSTED_PROXY_IPS=(PROXY, "10.0.0.2"))
def test_own_proxies_are_skipped_through():
    """Два своих прокси в цепочке — пропускаем оба, клиент за ними."""
    assert client_ip(_request(PROXY, f"{CLIENT}, 10.0.0.2")) == CLIENT


@override_settings(TRUSTED_PROXY_IPS=(PROXY,))
@pytest.mark.parametrize("junk", ["вчера", "не-адрес", "999.1.1.1", "10.0.0.1'"])
def test_a_broken_chain_falls_back_to_the_proxy(junk):
    """Мусор вместо адреса — в аудит уходит свой прокси, а не строка."""
    assert client_ip(_request(PROXY, junk)) == PROXY


@override_settings(TRUSTED_PROXY_IPS=(PROXY,))
def test_proxy_without_a_header_reports_itself():
    assert client_ip(_request(PROXY)) == PROXY


def test_missing_remote_addr_gives_an_empty_string():
    """Никогда не `None`: значение уходит в `str(ip or "")` реквизитов."""
    request = RequestFactory().post("/api/ops/")
    request.META.pop("REMOTE_ADDR", None)
    assert client_ip(request) == ""
