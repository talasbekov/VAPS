"""Настоящий адрес клиента запроса (Plane №699).

🔴 `X-Forwarded-For` — ЭТО ВВОД ПОЛЬЗОВАТЕЛЯ, а не факт о соединении.
Заголовок дописывает кто угодно, и до этого модуля он побеждал `REMOTE_ADDR`
безусловно: подписывающий согласующий одной строкой в запросе назначал себе
любой адрес, а тот уходил в реквизиты его же подписи и в неизменяемую строку
аудита `SECURITY_EVENT_APPROVAL_SIGNED`. Реквизит, которым доказывают, откуда
подписали, диктовал сам подписант.

Достоверен ровно один адрес — `REMOTE_ADDR`, сосед по сокету: его подставляет
ядро, и подделать его, не подделав маршрутизацию, нельзя. Всё остальное —
слова этого соседа. Поэтому заголовок читается ТОЛЬКО когда сосед оказался
нашим прокси из `TRUSTED_PROXY_IPS` (список пуст по умолчанию).

Цепочка разбирается ОТ БЛИЖНЕГО К ДАЛЬНЕМУ, а не слева направо. `X-Forwarded-For`
растёт слева направо по мере прохождения прокси, значит ближайший к нам хоп —
последний, а самый левый элемент пришёл от клиента и подделывается свободно.
Клиент, пославший `X-Forwarded-For: 1.2.3.4`, при разборе слева получил бы
именно `1.2.3.4` — то есть ровно ту дыру, которую модуль закрывает. Идём
справа, пропуская собственные прокси; первый чужой хоп и есть клиент.
"""

import ipaddress
import socket
import time
from functools import lru_cache

from django.conf import settings


def _is_ip(value):
    """Похоже ли значение на адрес. Мусору в аудите делать нечего."""
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


def _normalized_ip(value):
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return value
    return str(getattr(address, 'ipv4_mapped', None) or address)


@lru_cache(maxsize=8)
def _service_proxy_ips(hosts, epoch):
    """Exact service addresses, refreshed every five seconds, never a subnet.

    Service names must be explicitly configured by the closed Docker contour.
    Failed fresh resolution drops old trust instead of keeping a stale address.
    """
    resolved = set()
    for host in hosts:
        try:
            for family, kind, proto, canonical, address in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM):
                if _is_ip(address[0]):
                    resolved.add(_normalized_ip(address[0]))
        except OSError:
            continue
    return frozenset(resolved)


def client_ip(request):
    """Адрес клиента, которому можно верить. Никогда не `None` — пустая строка,
    если адреса нет (внутренний вызов, тестовый клиент без `REMOTE_ADDR`)."""
    remote_addr = _normalized_ip((request.META.get("REMOTE_ADDR") or "").strip())
    trusted = frozenset(_normalized_ip(ip) for ip in (getattr(settings, "TRUSTED_PROXY_IPS", ()) or ()))
    hosts = tuple(getattr(settings, 'TRUSTED_PROXY_HOSTS', ()) or ())
    if hosts:
        trusted |= _service_proxy_ips(hosts, int(time.monotonic() // 5))
    if remote_addr not in trusted:
        # Сосед по сокету — не наш прокси: его заголовки ничего не значат.
        # Это и есть рабочий случай стенда и тестов, где прокси нет вовсе.
        return remote_addr
    hops = (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")
    for hop in (_normalized_ip(h.strip()) for h in reversed(hops)):
        if not hop or hop in trusted:
            continue
        # Первый хоп за нашими прокси. Не адрес — значит цепочку кто-то
        # испортил; верим тогда своему прокси, а не испорченной строке.
        return hop if _is_ip(hop) else remote_addr
    return remote_addr
