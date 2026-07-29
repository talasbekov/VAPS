"""Story 12.6a — broker-execution smoke: a real worker subprocess, a real
Redis broker, one real beat task dispatched via `.delay()` (NOT `.apply()`
— that's synchronous and in-process, doesn't touch the broker at all;
Story 12.6's own live check already covered that half).

`@pytest.mark.slow`: excluded from `make gate` (its own `not slow` filter),
included in `make test-full` — starting a real worker process and waiting
on it is exactly the class of test gate's NFR-8 time budget excludes.

CELERY_RESULT_BACKEND stays `None` in prod (Story 12.6's own review fix —
nothing in production ever reads a beat task's result). This test does NOT
change that global setting in `config/settings.py`; it overrides the
`CELERY_RESULT_BACKEND` env var for the DURATION OF THIS TEST ONLY (restored
in `finally`), reusing the same Redis the broker already needs — not new
infrastructure, just local observability for one smoke run.

Env var, not `celery_app.conf.result_backend = ...`: `conf.result_backend`
is a namespaced key (`CELERY_RESULT_BACKEND`) that Django's settings.py sets
explicitly (`= None`) — Celery's ChainMap-based Settings resolves the
prefixed key before the plain one, so writing `conf.result_backend`
silently lands in a map that's shadowed by that explicit `None` and never
takes effect (proven via `inspect.getsource` + live reproduction). The
`result_backend` property is one of a handful in Celery's `Settings` class
that checks `os.environ["CELERY_RESULT_BACKEND"]` FIRST — the only override
path that reliably works across both this process and the worker
subprocess (which reloads Django settings fresh and would otherwise see
`None` again). `task_ignore_result` has no such env-var escape hatch, so
the dispatched call itself passes `ignore_result=False` — that overrides
the worker-side default per-call, at the message level, without touching
global conf.
"""

import os
import subprocess
import sys

import pytest

from config import celery_app


@pytest.mark.slow
def test_a_real_task_executes_via_a_real_worker_and_broker():
    redis_url = os.environ.get("VAPS_REDIS_URL", "redis://127.0.0.1:6380/0")

    original_env_backend = os.environ.get("CELERY_RESULT_BACKEND")
    os.environ["CELERY_RESULT_BACKEND"] = redis_url
    # Celery caches the resolved backend object separately from
    # conf.result_backend (app._backend_cache / app._local.backend) — it is
    # NOT recomputed automatically when the env var changes after the app's
    # backend has already been accessed once in this process. Without this
    # reset, app.backend stays the stale DisabledBackend and
    # AsyncResult.state blows up with AttributeError even though .get()
    # itself succeeds (it talks to the broker directly, not the backend).
    celery_app._backend_cache = None
    if hasattr(celery_app._local, "backend"):
        celery_app._local.backend = None

    worker = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "celery",
            "-A",
            "config",
            "worker",
            "--loglevel=info",
            "-P",
            "solo",
            "-Q",
            "celery",
        ],
        env=os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        from apps.operations.statuses.tasks import materialize_status_effects_task

        # No pre-dispatch wait needed: the broker (Redis) queues the
        # message regardless of whether the worker subprocess has finished
        # connecting yet — `.get(timeout=...)` blocks until either the
        # worker picks it up and finishes, or the timeout elapses.
        # ignore_result=False: overrides the worker-side global
        # task_ignore_result=True default (config/settings.py, 12.6) for
        # THIS call only — that default has no env-var escape hatch, unlike
        # result_backend, so it must be overridden per-call instead.
        async_result = materialize_status_effects_task.apply_async(
            ignore_result=False
        )
        try:
            async_result.get(timeout=30)
        except Exception as exc:
            if worker.poll() is not None:
                raise RuntimeError(
                    "celery worker subprocess exited early:\n"
                    + (worker.stdout.read() if worker.stdout else "")
                ) from exc
            raise

        assert async_result.state == "SUCCESS", (
            f"task did not succeed via the real broker: state={async_result.state!r}, "
            f"result={async_result.result!r}"
        )
    finally:
        worker.terminate()
        try:
            worker.wait(timeout=10)
        except subprocess.TimeoutExpired:
            worker.kill()
            worker.wait(timeout=5)
        if original_env_backend is None:
            os.environ.pop("CELERY_RESULT_BACKEND", None)
        else:
            os.environ["CELERY_RESULT_BACKEND"] = original_env_backend
        celery_app._backend_cache = None
        if hasattr(celery_app._local, "backend"):
            celery_app._local.backend = None
