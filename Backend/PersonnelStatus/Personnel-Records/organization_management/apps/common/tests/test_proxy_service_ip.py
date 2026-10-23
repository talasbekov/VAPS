"""Docker service identity is explicit and never trusts a whole client subnet."""
from unittest.mock import patch

import pytest
from django.test import RequestFactory

from organization_management.apps.common.request_ip import client_ip


def request(peer, forwarded):
    return RequestFactory().post('/api/token/', REMOTE_ADDR=peer, HTTP_X_FORWARDED_FOR=forwarded)


@pytest.fixture(autouse=True)
def services(settings):
    settings.TRUSTED_PROXY_IPS = ()
    settings.TRUSTED_PROXY_HOSTS = ('proxy', 'frontend')


def resolve(host, *args, **kwargs):
    addresses = {'proxy': '172.29.0.2', 'frontend': '172.29.0.3'}
    return [(2, 1, 6, '', (addresses[host], 0))]


def test_only_resolved_named_services_may_forward_an_ip():
    with patch('socket.getaddrinfo', side_effect=resolve):
        assert client_ip(request('172.29.0.3', '203.0.113.12')) == '203.0.113.12'
        assert client_ip(request('172.29.0.2', '198.51.100.99, 203.0.113.12')) == '203.0.113.12'
        assert client_ip(request('172.29.0.90', '203.0.113.12')) == '172.29.0.90'


def test_service_dns_failure_does_not_preserve_an_expired_trusted_address(settings):
    settings.TRUSTED_PROXY_HOSTS = ('rotation-proxy',)
    with patch('socket.getaddrinfo', return_value=[(2, 1, 6, '', ('172.29.0.2', 0))]), patch('time.monotonic', return_value=10_000):
        assert client_ip(request('172.29.0.2', '203.0.113.12')) == '203.0.113.12'
    with patch('socket.getaddrinfo', side_effect=OSError('unavailable')), patch('time.monotonic', return_value=10_010):
        assert client_ip(request('172.29.0.2', '203.0.113.12')) == '172.29.0.2'


def test_service_ipv6_and_mapped_ipv4_are_compared_as_addresses(settings):
    settings.TRUSTED_PROXY_HOSTS = ('ipv6-proxy',)
    with patch('socket.getaddrinfo', return_value=[(10, 1, 6, '', ('2001:db8::1', 0, 0, 0)), (2, 1, 6, '', ('172.29.0.2', 0))]):
        assert client_ip(request('2001:0db8:0:0::1', '203.0.113.12')) == '203.0.113.12'
        assert client_ip(request('::ffff:172.29.0.2', '203.0.113.12')) == '203.0.113.12'


def test_no_service_dns_is_consulted_without_explicit_configuration(settings):
    settings.TRUSTED_PROXY_HOSTS = ()
    with patch('socket.getaddrinfo', side_effect=AssertionError('Unexpected DNS')):
        assert client_ip(request('172.29.0.2', '203.0.113.12')) == '172.29.0.2'
