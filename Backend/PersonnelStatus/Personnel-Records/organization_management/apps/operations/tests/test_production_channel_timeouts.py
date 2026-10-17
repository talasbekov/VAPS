"""Real Redis client defaults must not interrupt Channels' blocking receive."""
import json
import os
import secrets
import subprocess
import sys

import pytest


@pytest.fixture(params=["production", "contour"])
def channel_connection_limits(request):
    code = """
import importlib,json,sys
from channels_redis.core import RedisChannelLayer
from channels_redis.utils import create_pool
settings=importlib.import_module('organization_management.config.settings.'+sys.argv[1])
layer=RedisChannelLayer(**settings.CHANNEL_LAYERS['default']['CONFIG'])
pool=create_pool(layer.hosts[0])
connection=pool.connection_class(**pool.connection_kwargs)
print(json.dumps({'read':connection.socket_timeout,'connect':connection.socket_connect_timeout,'blocking':layer.brpop_timeout}))
"""
    environment = dict(os.environ)
    environment["DJANGO_SECRET_KEY"] = secrets.token_urlsafe(48)
    result = subprocess.run([sys.executable, "-c", code, request.param], env=environment,
                            text=True, capture_output=True, check=True, timeout=15)
    return json.loads(result.stdout)


def test_blocking_receive_is_not_interrupted_by_client_read_timeout(channel_connection_limits):
    limits = channel_connection_limits
    assert limits["read"] is None or limits["read"] > limits["blocking"], limits


def test_channel_connection_setup_keeps_a_finite_timeout(channel_connection_limits):
    assert 0 < channel_connection_limits["connect"] <= 5
