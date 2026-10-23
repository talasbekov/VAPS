"""JWT login budgets shared by application workers, without storing credentials."""
import ipaddress
import logging
import unicodedata

from django.conf import settings
from django.core.cache import caches
from django.core.cache.backends.locmem import LocMemCache
from django.utils.crypto import salted_hmac
from django_redis.cache import RedisCache
from rest_framework.exceptions import APIException
from rest_framework.permissions import AllowAny
from rest_framework.throttling import BaseThrottle
from rest_framework_simplejwt.views import TokenObtainPairView

from organization_management.apps.common.request_ip import client_ip

logger = logging.getLogger(__name__)


class LoginProtectionUnavailable(APIException):
    status_code = 503
    default_detail = 'Проверка входа временно недоступна. Попробуйте позже.'
    default_code = 'login_protection_unavailable'


class AtomicLoginThrottle(BaseThrottle):
    """Fixed-window counters: Redis ADD/INCR are atomic across all workers.

    The IP budget is checked first to bound account-key creation by a spraying
    client. Rejected attempts never extend the original expiry. LocMem is used
    only by the single-process development/test settings, never in production.
    """

    def __init__(self):
        self.retry_after = 1

    @staticmethod
    def _key(kind, identity):
        digest = salted_hmac('smart.login.' + kind, identity, algorithm='sha256').hexdigest()
        return 'login:v1:' + kind + ':' + digest

    @staticmethod
    def _consume(cache, key, window):
        # Expiry can race between ADD and INCR. Retry creation in that case;
        # never use get+set, which admits a burst from concurrent workers.
        for _ in range(3):
            if cache.add(key, 1, timeout=window):
                return 1
            try:
                return cache.incr(key)
            except ValueError:
                continue
        raise RuntimeError('Login budget expired repeatedly')

    def allow_request(self, request, view):
        try:
            cache = caches['auth_throttle']
            if not isinstance(cache, (RedisCache, LocMemCache)):
                raise RuntimeError('Login budgets require an atomic cache backend')
            address = client_ip(request)
            try:
                address = str(ipaddress.ip_address(address))
            except ValueError:
                address = 'unknown'
            account = request.data.get('username', '') if isinstance(request.data, dict) else ''
            # Match DRF's CharField trimming before normalization; otherwise
            # whitespace variants authenticate one account under many budgets.
            account = unicodedata.normalize('NFKC', account.strip()[:512]).casefold() if isinstance(account, str) else ''
            for kind, identity, limit, window in (
                ('ip', address, settings.LOGIN_THROTTLE_IP_LIMIT, settings.LOGIN_THROTTLE_IP_WINDOW),
                ('account', account, settings.LOGIN_THROTTLE_ACCOUNT_LIMIT, settings.LOGIN_THROTTLE_ACCOUNT_WINDOW),
            ):
                limit, window = int(limit), int(window)
                if limit < 1 or window < 1:
                    raise RuntimeError('Invalid login budget configuration')
                if self._consume(cache, self._key(kind, identity), window) > limit:
                    self.retry_after = window
                    return False
            return True
        except APIException:
            raise
        except Exception:
            # Do not log username, password, token, cache URL or exception text.
            logger.error('Login protection is unavailable')
            raise LoginProtectionUnavailable() from None

    def wait(self):
        return self.retry_after


class ProtectedTokenObtainPairView(TokenObtainPairView):
    permission_classes = [AllowAny]
    throttle_classes = [AtomicLoginThrottle]
