"""Story 13.6 — `manage.py tail_errors` command."""

import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.operations.bugreports.models import BugReport

pytestmark = pytest.mark.django_db


def _write_log(path, entries):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(json.dumps(e) for e in entries) + "\n", encoding="utf-8"
    )


def _run(*args):
    out = StringIO()
    call_command("tail_errors", *args, stdout=out)
    return out.getvalue()


def test_missing_log_file_warns_not_crashes(tmp_path):
    with override_settings(VAPS_ERROR_LOG_PATH=str(tmp_path / "does-not-exist.log")):
        output = _run()
    assert "не найден" in output


def test_shows_last_n_entries_in_order(tmp_path):
    log_path = tmp_path / "errors.log"
    entries = [
        {
            "timestamp": f"2026-06-05T10:0{i}:00+05:00",
            "level": "ERROR",
            "logger": "x",
            "message": f"boom-{i}",
            "request_id": f"r{i}",
            "exception": None,
        }
        for i in range(5)
    ]
    _write_log(log_path, entries)
    with override_settings(VAPS_ERROR_LOG_PATH=str(log_path)):
        output = _run("--n", "2")
    assert "boom-3" in output
    assert "boom-4" in output
    assert "boom-0" not in output
    assert "boom-2" not in output


def test_n_zero_shows_nothing_not_the_whole_journal(tmp_path):
    # Review (Blind Hunter): entries[-0:] == entries[0:] (the WHOLE list) is
    # a real Python footgun — --n 0 must print nothing.
    log_path = tmp_path / "errors.log"
    _write_log(
        log_path,
        [
            {
                "timestamp": "t",
                "level": "ERROR",
                "logger": "x",
                "message": "should-not-appear",
                "request_id": "r1",
                "exception": None,
            }
        ],
    )
    with override_settings(VAPS_ERROR_LOG_PATH=str(log_path)):
        output = _run("--n", "0")
    assert "should-not-appear" not in output


def test_filters_by_request_id(tmp_path):
    log_path = tmp_path / "errors.log"
    entries = [
        {
            "timestamp": "t",
            "level": "ERROR",
            "logger": "x",
            "message": "boom-a",
            "request_id": "match-me",
            "exception": None,
        },
        {
            "timestamp": "t",
            "level": "ERROR",
            "logger": "x",
            "message": "boom-b",
            "request_id": "other",
            "exception": None,
        },
    ]
    _write_log(log_path, entries)
    with override_settings(VAPS_ERROR_LOG_PATH=str(log_path)):
        output = _run("--request-id", "match-me")
    assert "boom-a" in output
    assert "boom-b" not in output


def test_request_id_filter_prints_matching_bug_report(tmp_path):
    log_path = tmp_path / "errors.log"
    _write_log(
        log_path,
        [
            {
                "timestamp": "t",
                "level": "ERROR",
                "logger": "x",
                "message": "boom",
                "request_id": "linked-1",
                "exception": None,
            }
        ],
    )
    BugReport.objects.create(
        user_id="op-1",
        screen_path="/daily-expense",
        description="кнопка не работает",
        last_request_ids=["linked-1", "some-other-id"],
    )
    with override_settings(VAPS_ERROR_LOG_PATH=str(log_path)):
        output = _run("--request-id", "linked-1")
    assert "boom" in output
    assert "BugReport id=" in output
    assert "кнопка не работает" in output


def test_request_id_filter_with_no_matching_bug_report_warns(tmp_path):
    log_path = tmp_path / "errors.log"
    _write_log(
        log_path,
        [
            {
                "timestamp": "t",
                "level": "ERROR",
                "logger": "x",
                "message": "boom",
                "request_id": "no-link",
                "exception": None,
            }
        ],
    )
    with override_settings(VAPS_ERROR_LOG_PATH=str(log_path)):
        output = _run("--request-id", "no-link")
    assert "не найдено" in output


def test_corrupt_line_is_skipped_not_fatal(tmp_path):
    log_path = tmp_path / "errors.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    good = json.dumps(
        {
            "timestamp": "t",
            "level": "ERROR",
            "logger": "x",
            "message": "boom-good",
            "request_id": "r1",
            "exception": None,
        }
    )
    log_path.write_text(f"{good}\nnot valid json\n\n", encoding="utf-8")
    with override_settings(VAPS_ERROR_LOG_PATH=str(log_path)):
        output = _run()
    assert "boom-good" in output
