# Submission Deadline Lockout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically block operators from creating NEW attendees in an event once
its submission deadline has passed, per memo item 5. Reopening past the deadline is
an explicit, audited superuser action (Django admin), never self-service.

**Architecture:** Three new nullable fields on `Event` (`submission_deadline`,
`submission_reopened_until`, `submission_reopen_reason`). One pure function
`is_submission_open(event, now=None)` is the single source of truth for the
open/closed decision. It's called from `AttendeeSerializer.validate()` — CREATE only,
never UPDATE — raising `PermissionDenied` when closed. `EventAdmin.save_model` audits
real changes to the reopen fields under the existing `event.submission_reopened`
action (added to the existing `"edit"` `SIGNIFICANT_ACTIONS` category).

**Tech Stack:** Django, DRF, existing test conventions in `eventproject/tests/`.

**Spec:** `docs/superpowers/specs/2026-08-21-submission-deadline-lockout-design.md`

## Global Constraints

- Test command: `.venv/bin/python manage.py test eventproject.tests --settings=eventproject.settings_test` (SQLite; do NOT use `.venv_new`).
- New audit action `event.submission_reopened` goes into the EXISTING `SIGNIFICANT_ACTIONS["edit"]` category, not a new one — `test_audit_action_coverage.py`'s `test_registry_has_exactly_expected_categories` asserts the exact category set. Needs a matching `ACTION_COVERAGE` entry + a real test method in `test_audit_action_coverage.py`'s own module namespace.
- `submission_deadline` defaults to `null` — an event with no deadline set is NEVER blocked (backward compatible; no data migration needed for existing events).
- Enforcement is CREATE-only for `Attendee` (via `AttendeeSerializer.validate()`, `self.instance is None`) — never blocks UPDATE of already-created attendees. Legacy RU/KZ/EN template views are NOT touched (Strangler Fig convention already established in this codebase — see `views/dashboard.py`/`views/pdn_consent.py` docstrings).
- Local commits only, on branch `security-hardening`. No push, no merge.

---

### Task 1: Model fields + `is_submission_open` + admin audit

**Files:**
- Modify: `eventproject/models.py` (add 3 fields to `Event`)
- Create: `eventproject/validators/deadline.py`
- Modify: `eventproject/admin.py` (audit on `EventAdmin.save_model`)
- Modify: `eventproject/audit.py` (registry entry)
- Modify: `eventproject/tests/test_audit_action_coverage.py` (coverage entry + test)
- Create: `eventproject/validators/tests/test_deadline.py`
- Create: `eventproject/migrations/00XX_event_submission_deadline.py` (via `makemigrations`)

**Interfaces:**
- Produces: `Event.submission_deadline` (DateTimeField, null=True, blank=True),
  `Event.submission_reopened_until` (DateTimeField, null=True, blank=True),
  `Event.submission_reopen_reason` (TextField, blank=True, default="").
- Produces: `is_submission_open(event, now=None) -> bool` in `eventproject/validators/deadline.py`.

- [ ] **Step 1: Write the failing model/validator tests**

```python
# eventproject/validators/tests/test_deadline.py
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from eventproject.models import Event
from eventproject.validators.deadline import is_submission_open


class IsSubmissionOpenTests(TestCase):
    def setUp(self):
        self.now = timezone.now()

    def test_no_deadline_is_always_open(self):
        event = Event.objects.create(name_rus="E", submission_deadline=None)
        self.assertTrue(is_submission_open(event, now=self.now))

    def test_deadline_in_future_is_open(self):
        event = Event.objects.create(
            name_rus="E", submission_deadline=self.now + timedelta(days=1)
        )
        self.assertTrue(is_submission_open(event, now=self.now))

    def test_deadline_in_past_is_closed(self):
        event = Event.objects.create(
            name_rus="E", submission_deadline=self.now - timedelta(days=1)
        )
        self.assertFalse(is_submission_open(event, now=self.now))

    def test_expired_deadline_with_future_reopen_window_is_open(self):
        event = Event.objects.create(
            name_rus="E",
            submission_deadline=self.now - timedelta(days=1),
            submission_reopened_until=self.now + timedelta(hours=1),
        )
        self.assertTrue(is_submission_open(event, now=self.now))

    def test_expired_deadline_with_expired_reopen_window_is_closed(self):
        event = Event.objects.create(
            name_rus="E",
            submission_deadline=self.now - timedelta(days=2),
            submission_reopened_until=self.now - timedelta(hours=1),
        )
        self.assertFalse(is_submission_open(event, now=self.now))

    def test_defaults_to_timezone_now_when_now_not_passed(self):
        event = Event.objects.create(
            name_rus="E", submission_deadline=timezone.now() + timedelta(days=1)
        )
        self.assertTrue(is_submission_open(event))
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python manage.py test eventproject.validators.tests.test_deadline --settings=eventproject.settings_test -v 2`
Expected: FAIL/ERROR — `Event.submission_deadline` field and `is_submission_open` don't exist yet.

- [ ] **Step 3: Add the model fields**

In `eventproject/models.py`, inside the `Event` class (add near the other Story-2.2/hd-5.1 fields, keep the existing fields untouched):

```python
    # hd-2-7 (докладная п.5): дедлайн подачи списков + admin-only переоткрытие.
    submission_deadline = models.DateTimeField(
        null=True, blank=True,
        help_text="После этого момента новые участники не принимаются (hd-2-7).",
    )
    submission_reopened_until = models.DateTimeField(
        null=True, blank=True,
        help_text="Ручное переоткрытие приёма после дедлайна — только суперпользователь.",
    )
    submission_reopen_reason = models.TextField(
        blank=True, default="",
        help_text="Основание переоткрытия (напр. номер рапорта) — заполняется вместе с submission_reopened_until.",
    )
```

- [ ] **Step 4: Write `is_submission_open`**

```python
# eventproject/validators/deadline.py
"""hd-2-7 (докладная п.5) — блокировка приёма новых участников по дедлайну.

Единственный источник правды: нет дедлайна → открыто; дедлайн в будущем →
открыто; дедлайн прошёл — открыто ТОЛЬКО если админ явно продлил окно через
`submission_reopened_until` (ручное admin-действие, аудируется отдельно —
см. `EventAdmin.save_model`).
"""

from django.utils import timezone


def is_submission_open(event, now=None):
    if now is None:
        now = timezone.now()
    if event.submission_deadline is None:
        return True
    if now <= event.submission_deadline:
        return True
    if event.submission_reopened_until is not None and now <= event.submission_reopened_until:
        return True
    return False
```

- [ ] **Step 5: Generate the migration**

Check the current latest migration first: `ls eventproject/migrations/ | sort | tail -3`. Then:

Run: `.venv/bin/python manage.py makemigrations eventproject --settings=eventproject.settings_test`
Confirm the generated file only adds the 3 new fields (no alters to existing columns).

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv/bin/python manage.py test eventproject.validators.tests.test_deadline --settings=eventproject.settings_test -v 2`
Expected: PASS (6 tests).

- [ ] **Step 7: Wire admin audit for reopen changes**

Read `eventproject/admin.py`'s current `EventAdmin` class first. Add a `save_model` override:

```python
    def save_model(self, request, obj, form, change):
        reopen_changed = False
        if change and obj.pk:
            try:
                old = Event.objects.get(pk=obj.pk)
                reopen_changed = (
                    old.submission_reopened_until != obj.submission_reopened_until
                    or old.submission_reopen_reason != obj.submission_reopen_reason
                )
            except Event.DoesNotExist:
                pass
        super().save_model(request, obj, form, change)
        if reopen_changed:
            from eventproject.audit import audit_log
            audit_log(
                user=request.user,
                action="event.submission_reopened",
                obj_type="Event",
                obj_id=obj.pk,
                ip=request.META.get("REMOTE_ADDR", ""),
                extra={
                    "reopened_until": str(obj.submission_reopened_until) if obj.submission_reopened_until else None,
                    "reason": obj.submission_reopen_reason,
                },
            )
```

Add `submission_deadline`, `submission_reopened_until`, `submission_reopen_reason` to
`EventAdmin`'s existing `fields`/`fieldsets` if it defines any explicitly (check first
— if it uses the default `ModelAdmin` field auto-detection with no `fields`/`fieldsets`
attribute, no change is needed there; only add if the class currently restricts which
fields show).

- [ ] **Step 8: Register the audit action and its coverage test**

In `eventproject/audit.py`, change:

```python
    "edit": [
        "attendee.update", "attendee.iin_discarded", "user.change_password",
        "pdn_consent.sign",
    ],
```

to:

```python
    "edit": [
        "attendee.update", "attendee.iin_discarded", "user.change_password",
        "pdn_consent.sign", "event.submission_reopened",
    ],
```

In `eventproject/tests/test_audit_action_coverage.py`, add to `ACTION_COVERAGE`:

```python
    "event.submission_reopened": [
        "EventSubmissionReopenedAuditTests.test_reopen_change_emits_audit",
    ],
```

Add the test class (matching this file's existing style — check imports at the top,
reuse `User.objects.create_superuser`/`Event.objects.create` patterns already used by
neighboring classes like `EventDeleteAuditTests`):

```python
class EventSubmissionReopenedAuditTests(AuditChecklistMixin, TestCase):
    """hd-2-7: переоткрытие приёма после дедлайна аудируется."""

    def setUp(self):
        self.superuser = User.objects.create_superuser(
            username="su_deadline", password=PASSWORD, email=""
        )
        self.event = Event.objects.create(name_rus="E")

    def test_reopen_change_emits_audit(self):
        from django.utils import timezone
        self.client.force_login(self.superuser)
        with self.assertLogs("eventproject", level="INFO") as cm:
            resp = self.client.post(
                f"/embankment/eventproject/event/{self.event.id}/change/",
                {
                    "name_rus": "E",
                    "submission_reopened_until_0": timezone.now().strftime("%Y-%m-%d"),
                    "submission_reopened_until_1": "12:00:00",
                    "submission_reopen_reason": "Рапорт №1",
                    "_save": "Save",
                },
            )
        self.assertIn(resp.status_code, (200, 302))
        self.assertIn("event.submission_reopened", self._actions_of(cm))
```

Note: Django admin's change-form field names for a `DateTimeField` are typically
`<field>_0` (date) and `<field>_1` (time) with the default `AdminSplitDateTime`
widget — verify against the actual rendered form (check what widget `EventAdmin`
uses, if any is customized) before trusting this exact field-name shape; adjust if
the real form differs. If posting through the full admin change view proves brittle,
an acceptable alternative is a more direct test: build an `Event` instance, call
`EventAdmin(Event, admin.site).save_model(request, obj, form=None, change=True)`
directly after mutating `obj`, with a minimal mock `request.user`/`request.META` —
use whichever approach is more reliable, and explain the choice in your report.

- [ ] **Step 9: Run tests to verify they pass**

Run: `.venv/bin/python manage.py test eventproject.tests.test_audit_action_coverage eventproject.validators.tests.test_deadline --settings=eventproject.settings_test -v 2`
Expected: PASS.

- [ ] **Step 10: Run the full suite**

Run: `.venv/bin/python manage.py test eventproject.tests --settings=eventproject.settings_test`
Expected: PASS, 0 new failures vs. baseline (631, per this session's last full run).

- [ ] **Step 11: Commit**

```bash
git add eventproject/models.py eventproject/validators/deadline.py eventproject/validators/tests/test_deadline.py eventproject/admin.py eventproject/audit.py eventproject/tests/test_audit_action_coverage.py eventproject/migrations/
git commit -m "feat(hd-2-7): submission deadline fields + is_submission_open + admin reopen audit"
```

---

### Task 2: Enforce in `AttendeeSerializer.validate()` (create-only)

**Files:**
- Modify: `eventproject/serializers/attendee.py`
- Test: `eventproject/tests/test_attendee_api.py`

**Interfaces:**
- Consumes: `eventproject.validators.deadline.is_submission_open` (Task 1).

- [ ] **Step 1: Write the failing tests**

Read `eventproject/tests/test_attendee_api.py`'s `AttendeeCreateTests`/`AttendeeApiBase`
first for the real `_payload()`/`setUp()` shape (`self.event1`, `self.request1`, etc.)
before writing these — adjust attribute names to match reality, this brief may not
have them exactly right.

```python
    def test_create_blocked_after_submission_deadline(self):
        from django.utils import timezone
        from datetime import timedelta
        self.event1.submission_deadline = timezone.now() - timedelta(hours=1)
        self.event1.save(update_fields=["submission_deadline"])
        resp = self.client.post("/api/v1/attendees/", self._payload(), format="json")
        self.assertEqual(resp.status_code, 403)

    def test_create_allowed_before_submission_deadline(self):
        from django.utils import timezone
        from datetime import timedelta
        self.event1.submission_deadline = timezone.now() + timedelta(hours=1)
        self.event1.save(update_fields=["submission_deadline"])
        resp = self.client.post("/api/v1/attendees/", self._payload(), format="json")
        self.assertEqual(resp.status_code, 201)

    def test_create_allowed_when_no_deadline_set(self):
        resp = self.client.post("/api/v1/attendees/", self._payload(), format="json")
        self.assertEqual(resp.status_code, 201)

    def test_update_not_blocked_after_deadline(self):
        from django.utils import timezone
        from datetime import timedelta
        attendee = self.attendee1
        self.event1.submission_deadline = timezone.now() - timedelta(hours=1)
        self.event1.save(update_fields=["submission_deadline"])
        resp = self.client.patch(
            f"/api/v1/attendees/{attendee.id}/", {"surname": "Правка"}, format="json"
        )
        self.assertEqual(resp.status_code, 200)

    def test_reopened_window_allows_create_after_deadline(self):
        from django.utils import timezone
        from datetime import timedelta
        self.event1.submission_deadline = timezone.now() - timedelta(days=1)
        self.event1.submission_reopened_until = timezone.now() + timedelta(hours=1)
        self.event1.save(update_fields=["submission_deadline", "submission_reopened_until"])
        resp = self.client.post("/api/v1/attendees/", self._payload(), format="json")
        self.assertEqual(resp.status_code, 201)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python manage.py test eventproject.tests.test_attendee_api.AttendeeCreateTests --settings=eventproject.settings_test -v 2`
Expected: FAIL for the "blocked" case (currently 201, should be 403); others should already pass (no enforcement yet means everything succeeds) — confirm the RED specifically on `test_create_blocked_after_submission_deadline`.

- [ ] **Step 3: Enforce in `validate()`**

In `eventproject/serializers/attendee.py`, import the new helper:

```python
from eventproject.validators.deadline import is_submission_open
```

In `validate(self, attrs)`, right after the existing RBAC check block (after the
`req = current("request")` / RBAC `if request_obj is not None and req is not None:`
block), add — CREATE ONLY:

```python
        if self.instance is None and req is not None:
            event = req.event
            if not is_submission_open(event):
                raise PermissionDenied(
                    "Приём новых участников закрыт: дедлайн подачи списков истёк."
                )
```

Place this so it runs AFTER the RBAC check (so a request to someone else's event
still 403s for the RBAC reason, not a deadline reason — don't leak deadline state
about events the operator can't access) but BEFORE the rest of the field-level
validation logic that follows.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python manage.py test eventproject.tests.test_attendee_api.AttendeeCreateTests --settings=eventproject.settings_test -v 2`
Expected: PASS (all 5 new tests + existing ones in this class).

- [ ] **Step 5: Run the full suite**

Run: `.venv/bin/python manage.py test eventproject.tests --settings=eventproject.settings_test`
Expected: PASS, 0 new failures.

- [ ] **Step 6: Commit**

```bash
git add eventproject/serializers/attendee.py eventproject/tests/test_attendee_api.py
git commit -m "feat(hd-2-7): enforce submission deadline on attendee create (DRF path)"
```

---

## After this plan

Item 5 of the memo is functionally complete for the DRF/React create path. Legacy
RU/KZ/EN template-based attendee creation is NOT enforced (Strangler Fig — consistent
with how this codebase has handled every other new feature this session). Flag this
explicitly in the overnight log, not as an oversight but as a deliberate scope
boundary matching established convention.
