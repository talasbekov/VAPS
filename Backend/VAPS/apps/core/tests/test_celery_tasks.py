"""Story 12.6 — gate test: every CELERY_BEAT_SCHEDULE entry names a task that
actually exists and imports. STATIC only — no broker, no worker (that's
12.6a's test-full broker-execution smoke, a different tier entirely).

AC: "a beat schedule referencing a non-existent task turns the gate red."
Verified by a real mutation: temporarily rename a schedule entry's ``task``
to a bogus dotted path and confirm this test fails — the mutation is
recorded in the story's Completion Notes, not kept as a permanent test
(there is no clean way to leave a "should be red" case green in the suite).
"""

from django.conf import settings

from config import celery_app


def test_beat_schedule_is_not_empty():
    # Anti-vacuum: an empty CELERY_BEAT_SCHEDULE would make the loop below
    # pass trivially without checking anything.
    assert settings.CELERY_BEAT_SCHEDULE, "CELERY_BEAT_SCHEDULE must not be empty"


def test_every_beat_task_exists_and_imports():
    celery_app.autodiscover_tasks()
    celery_app.loader.import_default_modules()
    registered = set(celery_app.tasks)

    # Review (Blind Hunter): autodiscover_tasks() is lazy — it defers to
    # import_default_modules(), called right above, but that ordering is
    # this test's own responsibility, not guaranteed by Celery itself. A
    # regression that broke the ordering would leave `registered` holding
    # only Celery's OWN builtin tasks (celery.chord, celery.backend_cleanup,
    # ...) and the loop below would find every VAPS task "missing" — loud,
    # not vacuous. But guard the inverse too: a broken assertion order that
    # somehow left `registered` empty must not silently pass either.
    non_builtin = {t for t in registered if not t.startswith("celery.")}
    assert non_builtin, (
        "no non-builtin tasks registered — autodiscover_tasks()/"
        "import_default_modules() ordering may be broken"
    )

    missing = []
    for entry_name, entry in settings.CELERY_BEAT_SCHEDULE.items():
        task_name = entry["task"]
        if task_name not in registered:
            missing.append((entry_name, task_name))
            continue
        task = celery_app.tasks[task_name]
        assert callable(task.run), f"{task_name} is registered but not callable"

    assert missing == [], (
        f"CELERY_BEAT_SCHEDULE references non-existent task(s): {missing} — "
        "a renamed/removed task would otherwise die silently in prod"
    )


def test_all_expected_beat_jobs_are_registered():
    # Names each job directly (not just "the schedule is non-empty") so
    # silently dropping one from CELERY_BEAT_SCHEDULE fails loudly here too.
    task_names = {entry["task"] for entry in settings.CELERY_BEAT_SCHEDULE.values()}
    assert task_names == {
        "apps.operations.statuses.tasks.materialize_status_effects_task",
        "apps.operations.submissions.tasks.check_lagging_submissions_task",
        "apps.operations.submissions.tasks.check_submission_threshold_task",
        "apps.operations.submissions.tasks.pilot_pulse_digest_task",
        "apps.parallel_run.tasks.parallel_run_diff_task",
    }


def test_beat_tasks_do_not_overlap_existing_systemd_timer_hours():
    # Dev Notes: 02:15 (vaps-parallel-run-diff.timer, 7.0) and 03:00
    # (vaps-backup.timer, 12.4) are already taken by systemd — this doesn't
    # re-verify those files (out of this test's reach) but pins the beat
    # schedule's OWN hours so a future edit can't silently collide with the
    # values this story chose deliberately around them.
    hours_minutes = set()
    for entry in settings.CELERY_BEAT_SCHEDULE.values():
        schedule = entry["schedule"]
        for hour in schedule.hour:
            for minute in schedule.minute:
                hours_minutes.add((hour, minute))
    assert (2, 15) not in hours_minutes
    assert (3, 0) not in hours_minutes
