# Performance Backlog

This document tracks identified performance bottlenecks and optimization tasks based on load testing results.

## Identified Bottlenecks (2026-04-14)

1.  **Rate Limiting on `POST /add_attendee/`**
    *   **Description:** Concurrency testing is blocked by `429 Too Many Requests` when using more than a few concurrent users.
    *   **Impact:** Cannot measure true DB/App performance for the most critical endpoint.
    *   **Task:** Implement a mechanism to bypass or tune rate limits for load testing (e.g., based on IP or header).

2.  **Login Endpoint Latency**
    *   **Description:** `POST /user_login/` response time jumped to p99=3000ms under 100 concurrent users.
    *   **Impact:** Slower user experience during peak login times.
    *   **Task:** Investigate password hashing cost (it's expected to be slow but maybe too slow under load) and session DB performance.

3.  **Full Load Test (3000 users)**
    *   **Description:** Current baseline is a smoke test with 100 users on SQLite.
    *   **Task:** Run the full 3000-user test on a production-like environment (Docker with PostgreSQL and Redis) once rate limits are handled.

## Harness fixes (code review 2026-06-21) and remaining work

The `docs/load_tests/locustfile.py` harness was hardened during code review of Story 1.7:
*   **DONE:** explicit per-request status checks (`catch_response`) — 302-to-login, 403-CSRF, 200-error-pages and 429-ratelimit are now recorded as **failures** instead of silently counting as successful latency.
*   **DONE:** login verification in `on_start` (a 200 from `/user_login/` = failed login → marked failure); CSRF read from the session cookie jar; host/scheme guard.
*   **DONE:** the `2026-04-14` baseline's `nfr5_compliance.compliant` corrected from `true` → `null` (a 100-user SQLite run cannot assert NFR5 at 3000 users).

**Still required before Story 1.7 can be signed off (operational — needs infrastructure, cannot be done in the dev container):**

> **Canonical owner (descope 2026-06-23, correct-course):** As of the Story 1.7 descope, this section is the **single source of truth** for the operational 3000-user run. Story 1.7 is `done` at the harness level; the live run below closes the full AC-1, AC-2 (final NFR5 verdict) and AC-3 (Redis cache-hit). Also the shared blocker for Story 4.2 AC-6. Tracked in `_bmad-output/implementation-artifacts/deferred-work.md`.

1.  Stand up a production-like environment (PostgreSQL + Redis) over **HTTPS** (or a load-test settings override: `SECURE_SSL_REDIRECT=False`, `*_COOKIE_SECURE=False`).
2.  Disable/relax **django-axes** (`AXES_FAILURE_LIMIT=10`) and the `/add_attendee/` **ratelimit** (`20/h`) for the load-test source, or use a pool of accounts/IPs.
3.  Seed `TEST_USER`/`TEST_PASS`, a valid `Event` + `Request` (`TEST_REQUEST_ID`), and FK ids (`SEX_ID`/`COUNTRY_ID`/`DOCTYPE_ID`).
4.  Run `-u 3000 -r 100 --run-time 5m` and capture p50/p95/p99 for all four endpoints with **0% spurious failures**, plus the **Redis** cache hit rate (AC-3).
