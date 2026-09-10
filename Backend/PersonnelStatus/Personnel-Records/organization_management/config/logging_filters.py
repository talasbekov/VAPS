"""Log filters enabled only by the offline contour settings."""
import logging


class ASGIPathOnlyFilter(logging.Filter):
    """Remove query strings from Uvicorn's HTTP/WS path arguments.

    Uvicorn passes the path as a separate argument for access and WebSocket
    accepted/rejected messages. Preserve the message, status and exception
    information so errors remain diagnosable without recording query JWTs.
    """

    def filter(self, record):
        if isinstance(record.args, tuple):
            record.args = tuple(
                arg.partition('?')[0]
                if isinstance(arg, str) and arg.startswith('/') else arg
                for arg in record.args
            )
        return True
