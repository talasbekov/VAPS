"""Actual JWT endpoint must bound guessing, including concurrent requests."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

import pytest
from django.contrib.auth.models import User
from django.core.cache import caches
from django.db import close_old_connections
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def login_budgets(settings):
    settings.CACHES = {**settings.CACHES, 'auth_throttle': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache', 'LOCATION': 'jwt-budget-regression'}}
    settings.LOGIN_THROTTLE_ACCOUNT_LIMIT = 2
    settings.LOGIN_THROTTLE_ACCOUNT_WINDOW = 300
    settings.LOGIN_THROTTLE_IP_LIMIT = 4
    settings.LOGIN_THROTTLE_IP_WINDOW = 60
    caches['auth_throttle'].clear()
    yield
    caches['auth_throttle'].clear()


def login(username='missing-user', password='wrong', ip='192.0.2.10', **headers):
    return APIClient().post('/api/token/', {'username': username, 'password': password}, format='json', REMOTE_ADDR=ip, **headers)


def test_account_limit_is_shared_across_client_ips():
    assert login(ip='192.0.2.1').status_code == 401
    assert login(ip='192.0.2.2').status_code == 401
    response = login(ip='192.0.2.3')
    assert response.status_code == 429
    assert 1 <= int(response['Retry-After']) <= 300
    assert 'missing-user' not in str(response.data)


def test_username_case_and_nfkc_forms_share_a_guessing_budget():
    assert login('CaseUser').status_code == 401
    assert login('ＣａｓｅＵｓｅｒ').status_code == 401
    assert login('caseuser').status_code == 429


def test_serializer_trimmed_username_variants_share_account_budget():
    User.objects.create_user('trim-user', password='correct-fixture')
    assert login('trim-user', ip='192.0.2.21').status_code == 401
    assert login(' trim-user', ip='192.0.2.22').status_code == 401
    assert login('trim-user ', ip='192.0.2.23').status_code == 429


def test_ip_limit_prevents_username_spraying_and_ignores_untrusted_forwarded_header():
    for index in range(4):
        assert login(f'unknown-{index}', HTTP_X_FORWARDED_FOR=f'198.51.100.{index+1}').status_code == 401
    assert login('another-unknown', HTTP_X_FORWARDED_FOR='203.0.113.90').status_code == 429


def test_trusted_proxy_separates_real_clients(settings):
    settings.TRUSTED_PROXY_IPS = ('192.0.2.10',)
    for index in range(4):
        assert login(f'client-a-{index}', HTTP_X_FORWARDED_FOR='198.51.100.1').status_code == 401
    assert login('client-a-limit', HTTP_X_FORWARDED_FOR='198.51.100.1').status_code == 429
    assert login('client-b', HTTP_X_FORWARDED_FOR='198.51.100.2').status_code == 401


def test_existing_and_unknown_account_are_limited_identically():
    User.objects.create_user('real-user', password='correct-fixture')
    for username, base in [('real-user', 20), ('absent-user', 40)]:
        assert login(username, ip=f'192.0.2.{base}').status_code == 401
        assert login(username, ip=f'192.0.2.{base+1}').status_code == 401
        assert login(username, ip=f'192.0.2.{base+2}').status_code == 429


def test_valid_login_keeps_existing_token_contract_and_cannot_bypass_budget():
    User.objects.create_user('valid-user', password='correct-fixture')
    response = login('valid-user', 'correct-fixture')
    assert response.status_code == 200
    assert {'access', 'refresh', 'user'} <= response.data.keys()
    assert response.data['user']['username'] == 'valid-user'
    assert login('valid-user').status_code == 401
    assert login('valid-user', 'correct-fixture').status_code == 429


def test_expired_budget_allows_retry_without_permanent_account_lockout():
    with patch('django.core.cache.backends.base.time.time', return_value=1_000):
        assert login().status_code == 401
        assert login().status_code == 401
        assert login().status_code == 429
    with patch('django.core.cache.backends.base.time.time', return_value=1_301):
        assert login().status_code == 401


def test_cache_outage_fails_closed_and_recovers_without_password_exposure():
    with patch.object(caches['auth_throttle'], 'add', side_effect=ConnectionError('private backend details')):
        response = login()
    assert response.status_code == 503
    assert 'private backend details' not in str(response.data)
    assert 'wrong' not in str(response.data)
    assert login().status_code == 401


@pytest.mark.django_db(transaction=True)
def test_simultaneous_clients_cannot_overspend_account_budget(settings):
    settings.LOGIN_THROTTLE_IP_LIMIT = 100
    barrier = Barrier(8)

    def attempt(index):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return login('parallel-missing-user', ip=f'192.0.2.{index+1}').status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(attempt, range(8)))
    assert statuses.count(401) == 2
    assert statuses.count(429) == 6

