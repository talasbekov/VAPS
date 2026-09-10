"""Контракт ограниченного журнала живого локального backend-а (Plane №1110)."""

from organization_management.config.settings import sqlite


def test_local_file_log_keeps_errors_but_has_a_finite_retention_limit():
    """SQL DEBUG не должен снова заполнить диск, ERROR обязан сохраниться."""
    file_handler = sqlite.LOGGING["handlers"]["file"]

    assert file_handler["class"] == "logging.handlers.RotatingFileHandler"
    assert file_handler["level"] == "INFO"
    assert file_handler["maxBytes"] == 50 * 1024 * 1024
    assert file_handler["backupCount"] == 5
    assert sqlite.LOGGING["root"]["level"] == "INFO"
    assert sqlite.LOGGING["loggers"]["django"]["level"] == "INFO"
    assert sqlite.LOGGING["loggers"]["django.request"]["level"] == "ERROR"
