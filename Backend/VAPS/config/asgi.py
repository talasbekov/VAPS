"""ASGI entrypoint (Story 11.1).

Mirrors ``config/urls.py``'s flat, app-includes pattern: the ``websocket``
protocol is routed through ``apps.notifications.routing.websocket_urlpatterns``
(the app owns its own WS routes, this file only aggregates), exactly as
``config/urls.py`` includes ``apps.notifications.api.urls`` under
``api/notifications/``.

``ProtocolTypeRouter`` dispatches by ASGI scope type: ``"http"`` goes to the
standard Django ASGI handler (``get_asgi_application()`` — this wraps the full
existing MIDDLEWARE stack unchanged, including ``RequestContextMiddleware``;
the HTTP path is NOT altered by this file, only additionally reachable over
ASGI instead of WSGI). ``"websocket"`` goes through
``AuthenticatedWSMiddleware`` (Story 11.1 handshake-identity extraction — see
``apps/notifications/ws_auth.py``) → ``URLRouter``.

Prod ASGI server topology (uvicorn --lifespan off behind nginx with Upgrade
headers) is Epic 12 / Story 12.1 — out of scope here; this file is the
application object itself, deployment-agnostic.
"""

import os

from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# get_asgi_application() must be called before importing anything that touches
# Django models/apps (django.setup() happens inside it) — hence the routing
# import below, not at module top, per Channels' own documented pattern.
django_asgi_app = get_asgi_application()

from apps.notifications.routing import websocket_urlpatterns  # noqa: E402
from apps.notifications.ws_auth import AuthenticatedWSMiddleware  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AuthenticatedWSMiddleware(URLRouter(websocket_urlpatterns)),
    }
)
