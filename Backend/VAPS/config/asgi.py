"""Story 11.1 — ASGI entrypoint: HTTP keeps the full Django stack, WS is routed
to the notifications consumer (FR-35).

Import order is load-bearing. ``get_asgi_application()`` runs ``django.setup()``;
anything that touches models or consumers before that raises
``AppRegistryNotReady``. Hence the routing/middleware imports sit BELOW it with
an explicit ``# noqa: E402`` — the canonical Channels layout, not an oversight.

Middleware asymmetry worth knowing: the HTTP branch runs the whole MIDDLEWARE
chain (``RequestContextMiddleware`` included), the WS branch does not — HTTP
middleware simply is not part of the ASGI websocket path. So the ``request_id``
contextvar is empty inside the consumer (``apps/core/middleware.py:44`` already
returns "" outside a request). A known, accepted logging gap for the transport,
not a bug to work around.

``AllowedHostsOriginValidator`` is deliberately absent (Решение №6): CSWSH
exploits ambient credentials, and identity here arrives as an explicit token or
header that a foreign page cannot obtain; meanwhile the validator checks Origin
against ALLOWED_HOSTS and would break the vite dev proxy (Origin
``http://localhost:5173``) for story 11.3. Origin filtering belongs to nginx in
12.1, alongside the WS upgrade and ``proxy_read_timeout``.
"""

import os

from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# Runs django.setup() — MUST precede the consumer/middleware imports below.
django_asgi_app = get_asgi_application()

from apps.core.auth.ws import ActorIdMiddleware  # noqa: E402
from apps.notifications.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": ActorIdMiddleware(URLRouter(websocket_urlpatterns)),
    }
)
