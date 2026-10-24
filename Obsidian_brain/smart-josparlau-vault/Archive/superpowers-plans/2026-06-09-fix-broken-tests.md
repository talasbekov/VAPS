# Fix Pre-Existing Broken Tests (Story 6.x) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the two pre-existing, independently-broken test modules — `divisions/api/tests.py` and `notifications/tests_api.py` — so the project test suite runs green (excluding the websocket tests, which are a separate follow-up).

**Architecture:** These are **test-only** fixes. The production code is correct; the tests were written against a stale/incorrect API contract. Both modules hit the wrong URL (the DRF viewset lives at `/api/<app>/<app>/`, because each app's `api/urls.py` registers a router prefix equal to the app name under an `api/<app>/` include — the bare `/api/<app>/` path is just the DefaultRouter API-root). The divisions tests additionally use a field name and enum values that never existed; the notifications tests use the wrong action URL and assert a model field that does not exist.

**Tech Stack:** Django 5.x, Django REST Framework, DRF SimpleJWT auth, `PageNumberPagination` (global, `PAGE_SIZE=50`), SQLite `:memory:` for tests.

---

## Environment / How To Run Tests

All commands run from the Django project root:

```
/root/projects/VAPS/Backend/PersonnelStatus/Personnel-Records
```

Activate the virtualenv and set the test settings once per shell:

```bash
source /root/projects/VAPS/Backend/VAPS/.venv/bin/activate
export DJANGO_SETTINGS_MODULE=organization_management.config.settings.test
```

> Note: `python` only exists inside that venv; the system has `python3` without Django. Always activate the venv first.

> Note: The `divisions` package is a namespace package, so `manage.py test organization_management.apps.divisions` fails discovery. Always target the **explicit test module**, e.g. `...apps.divisions.api.tests`.

---

## Established Facts (verified by probing the live endpoints)

These were confirmed by running the real endpoints against a fresh `:memory:` DB. Trust them; do not re-derive.

**Divisions** (`DivisionViewSet`, full CRUD, registered as router prefix `divisions` under the `api/divisions/` include):
- Real list/create endpoint: `GET/POST /api/divisions/divisions/`
- Real detail endpoint: `/api/divisions/divisions/<id>/`
- List response is **paginated**: a dict with keys `count`, `next`, `previous`, `results`.
- `Division.DivisionType` choices (TextChoices) — the **stored values are lowercase**:
  `organization`, `department`, `directorate`, `division`. There is **no** `COMPANY` value.
- The FK to the parent is named **`parent`** (a `TreeForeignKey`). There is **no** `parent_division` field.
- `Division.code` is `unique`; the tests supply explicit codes, so no auto-generation is involved here.

**Notifications** (`NotificationViewSet`, **read-only** + custom actions, registered as router prefix `notifications` under the `api/notifications/` include):
- Real list endpoint: `GET /api/notifications/notifications/`
- Unauthenticated `GET /api/notifications/notifications/` → **401** (viewset sets `permission_classes=[IsAuthenticated]`; JWT auth returns 401 with no credentials).
- Authenticated list → **200**, paginated dict (`count`, `next`, `previous`, `results`); `count == 1` when the user owns one notification.
- The mark-as-read action is named **`mark_read`** → URL `POST /api/notifications/notifications/<id>/mark_read/` → **204**. There is **no** `mark_as_read` action.
- The `Notification` model fields are: `id, recipient, notification_type, title, message, link, is_read, created_at`. There is **no `read_at`** field, and `mark_read` only sets `is_read=True`.

---

## File Structure

- Modify: `Backend/PersonnelStatus/Personnel-Records/organization_management/apps/divisions/api/tests.py` — fix URL, field name, enum values, and the paginated-list assertion.
- Modify: `Backend/PersonnelStatus/Personnel-Records/organization_management/apps/audit/../notifications/tests_api.py`
  (full path: `Backend/PersonnelStatus/Personnel-Records/organization_management/apps/notifications/tests_api.py`) — fix URLs, the mark-read action URL, and drop the non-existent `read_at` assertion.
- Modify: `docs/epics/initial-migrations.md` — mark Story 6.x done and split out the websocket follow-up.

No production source files change. No migrations.

---

## Task 1: Fix `divisions/api/tests.py`

**Files:**
- Modify/Test: `Backend/PersonnelStatus/Personnel-Records/organization_management/apps/divisions/api/tests.py`

The current file (for reference — it errors in `setUp` on the non-existent `parent_division` kwarg):

```python
from rest_framework.test import APITestCase
from django.contrib.auth import get_user_model
from organization_management.apps.divisions.models import Division
DivisionType = Division.DivisionType


class DivisionViewSetTest(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='testuser', is_staff=True)
        self.client.force_authenticate(user=self.user)
        self.company = Division.objects.create(name='Test Company', division_type='COMPANY', code='COMPANY')
        self.division = Division.objects.create(name='Test Division', division_type='DEPARTMENT', parent_division=self.company, code='DEPT')

    def test_list_divisions(self):
        response = self.client.get('/api/divisions/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_create_division(self):
        data = {'name': 'New Division', 'division_type': 'DEPARTMENT', 'parent_division': self.company.id, 'code': 'DEPT2'}
        response = self.client.post('/api/divisions/', data)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Division.objects.count(), 3)
```

- [ ] **Step 1: Run the tests to confirm they currently error**

Run:
```bash
python manage.py test organization_management.apps.divisions.api.tests -v 2
```
Expected: 2 errors. Each `setUp` raises `TypeError: Division() got unexpected keyword arguments: 'parent_division'`.

- [ ] **Step 2: Replace the whole file with the corrected version**

Overwrite `divisions/api/tests.py` with exactly this content:

```python
from rest_framework.test import APITestCase
from django.contrib.auth import get_user_model
from organization_management.apps.divisions.models import Division

DivisionType = Division.DivisionType


class DivisionViewSetTest(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='testuser', is_staff=True)
        self.client.force_authenticate(user=self.user)
        # `parent` is the real FK name; `code` is unique; enum values are lowercase.
        self.company = Division.objects.create(
            name='Test Company',
            division_type=DivisionType.ORGANIZATION,
            code='COMPANY',
        )
        self.division = Division.objects.create(
            name='Test Division',
            division_type=DivisionType.DEPARTMENT,
            parent=self.company,
            code='DEPT',
        )

    def test_list_divisions(self):
        # The viewset lives at /api/divisions/divisions/ and the list is paginated.
        response = self.client.get('/api/divisions/divisions/')
        self.assertEqual(response.status_code, 200)
        # setUp created two divisions (company + child).
        self.assertEqual(response.data['count'], 2)

    def test_create_division(self):
        data = {
            'name': 'New Division',
            'division_type': DivisionType.DEPARTMENT,
            'parent': self.company.id,
            'code': 'DEPT2',
        }
        response = self.client.post('/api/divisions/divisions/', data)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Division.objects.count(), 3)
```

What changed and why:
- `parent_division=` → `parent=` (real FK name).
- `division_type='COMPANY'` → `DivisionType.ORGANIZATION`; `'DEPARTMENT'` → `DivisionType.DEPARTMENT` (the literal `'COMPANY'` is not a valid choice; using the enum guarantees the stored lowercase value).
- URLs `/api/divisions/` → `/api/divisions/divisions/` (the bare path is the router API-root, not the viewset).
- `len(response.data) == 1` → `response.data['count'] == 2` (paginated response; setUp creates two divisions).

- [ ] **Step 3: Run the tests to confirm they pass**

Run:
```bash
python manage.py test organization_management.apps.divisions.api.tests -v 2
```
Expected: `Ran 2 tests ... OK`.

- [ ] **Step 4: Commit**

```bash
git add Backend/PersonnelStatus/Personnel-Records/organization_management/apps/divisions/api/tests.py
git commit -m "test(divisions): fix stale DivisionViewSet tests (Story 6.x)

Correct the URL (/api/divisions/divisions/), FK name (parent, not
parent_division), enum values (lowercase DivisionType), and the
paginated-list assertion. Test-only; no production change."
```

---

## Task 2: Fix `notifications/tests_api.py`

**Files:**
- Modify/Test: `Backend/PersonnelStatus/Personnel-Records/organization_management/apps/notifications/tests_api.py`

The current file (for reference — `read_at` does not exist; URLs/action are wrong):

```python
from rest_framework.test import APITestCase
from django.contrib.auth.models import User

from organization_management.apps.notifications.models import Notification


class NotificationAPITest(APITestCase):

    def setUp(self):
        self.user1 = User.objects.create_user(username='testuser1', password='password')
        self.user2 = User.objects.create_user(username='testuser2', password='password')

        self.notification1 = Notification.objects.create(
            recipient=self.user1,
            notification_type=Notification.NotificationType.SECONDMENT_REQUEST,
            title='Notification 1',
            message='This is for user 1'
        )
        Notification.objects.create(
            recipient=self.user2,
            notification_type=Notification.NotificationType.STATUS_CHANGED,
            title='Notification 2',
            message='This is for user 2'
        )

    def test_list_notifications_for_authenticated_user(self):
        self.client.force_authenticate(user=self.user1)
        url = '/api/notifications/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['title'], 'Notification 1')

    def test_mark_notification_as_read(self):
        self.client.force_authenticate(user=self.user1)
        self.assertFalse(self.notification1.is_read)

        url = f'/api/notifications/{self.notification1.id}/mark_as_read/'
        response = self.client.post(url)

        self.assertEqual(response.status_code, 204)
        self.notification1.refresh_from_db()
        self.assertTrue(self.notification1.is_read)
        self.assertIsNotNone(self.notification1.read_at)

    def test_unauthenticated_user_cannot_access_api(self):
        url = '/api/notifications/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 401)
```

- [ ] **Step 1: Run the tests to confirm they currently fail**

Run:
```bash
python manage.py test organization_management.apps.notifications.tests_api -v 2
```
Expected: 3 problems —
- `test_list_notifications_for_authenticated_user` → `KeyError: 'count'` (hits the API-root dict, not the paginated list).
- `test_mark_notification_as_read` → `AssertionError: 404 != 204` (wrong action URL).
- `test_unauthenticated_user_cannot_access_api` → `AssertionError: 200 != 401` (hits the AllowAny API-root).

- [ ] **Step 2: Replace the whole file with the corrected version**

Overwrite `notifications/tests_api.py` with exactly this content:

```python
from rest_framework.test import APITestCase
from django.contrib.auth.models import User

from organization_management.apps.notifications.models import Notification


class NotificationAPITest(APITestCase):

    def setUp(self):
        self.user1 = User.objects.create_user(username='testuser1', password='password')
        self.user2 = User.objects.create_user(username='testuser2', password='password')

        self.notification1 = Notification.objects.create(
            recipient=self.user1,
            notification_type=Notification.NotificationType.SECONDMENT_REQUEST,
            title='Notification 1',
            message='This is for user 1'
        )
        Notification.objects.create(
            recipient=self.user2,
            notification_type=Notification.NotificationType.STATUS_CHANGED,
            title='Notification 2',
            message='This is for user 2'
        )

    def test_list_notifications_for_authenticated_user(self):
        """The list view returns only the authenticated user's notifications."""
        self.client.force_authenticate(user=self.user1)
        url = '/api/notifications/notifications/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['title'], 'Notification 1')

    def test_mark_notification_as_read(self):
        """A notification can be marked as read via the mark_read action."""
        self.client.force_authenticate(user=self.user1)
        self.assertFalse(self.notification1.is_read)

        url = f'/api/notifications/notifications/{self.notification1.id}/mark_read/'
        response = self.client.post(url)

        self.assertEqual(response.status_code, 204)
        self.notification1.refresh_from_db()
        self.assertTrue(self.notification1.is_read)

    def test_unauthenticated_user_cannot_access_api(self):
        """Unauthenticated users receive 401 Unauthorized."""
        url = '/api/notifications/notifications/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 401)
```

What changed and why:
- URLs `/api/notifications/` → `/api/notifications/notifications/` (the bare path is the AllowAny router API-root; the real viewset is one level deeper).
- Action URL `.../mark_as_read/` → `.../mark_read/` (the action is named `mark_read`).
- Removed `self.assertIsNotNone(self.notification1.read_at)` — the `Notification` model has no `read_at` field and `mark_read` does not set one (decision: test-only fix, no model change).

- [ ] **Step 3: Run the tests to confirm they pass**

Run:
```bash
python manage.py test organization_management.apps.notifications.tests_api -v 2
```
Expected: `Ran 3 tests ... OK`.

- [ ] **Step 4: Commit**

```bash
git add Backend/PersonnelStatus/Personnel-Records/organization_management/apps/notifications/tests_api.py
git commit -m "test(notifications): fix stale NotificationViewSet tests (Story 6.x)

Correct the URL (/api/notifications/notifications/) and mark-read action
(mark_read), and drop the assertion on the non-existent read_at field.
Test-only; no production change."
```

---

## Task 3: Confirm no regressions and update the epic

**Files:**
- Modify: `docs/epics/initial-migrations.md`

- [ ] **Step 1: Run the previously-passing suites to confirm no regressions**

Run:
```bash
python manage.py test organization_management.apps.audit organization_management.apps.divisions.api.tests organization_management.apps.notifications.tests_api -v 1
```
Expected: all pass (15 audit + 2 divisions + 3 notifications = 20), `OK`.

> Do **not** run the whole `organization_management.apps.notifications` package — that triggers discovery of `tests_websockets.py`, which fails to import because `daphne` is not installed. That module is explicitly out of scope (see follow-up below).

- [ ] **Step 2: Verify the migration gate is still clean**

Run:
```bash
python manage.py makemigrations --check --dry-run
```
Expected: `No changes detected` (this story touches no models).

- [ ] **Step 3: Update the epic follow-up section**

In `docs/epics/initial-migrations.md`, find the Story 6.x bullet (added during Story 4.x) and replace it with:

```markdown
- **Story 6.x — DONE** (`feat/fix-broken-tests`): Repaired the pre-existing
  broken tests. `divisions/api/tests.py` used a nonexistent `parent_division`
  field, invalid enum values, the wrong URL, and a non-paginated assertion;
  `notifications/tests_api.py` hit the API-root path instead of the viewset,
  used the wrong action name, and asserted a non-existent `read_at` field.
  Both are now green (test-only changes; no production code touched).
- **Story 7.x (new):** `notifications/tests_websockets.py` fails to import
  because `daphne` is not installed (channels' `WebsocketCommunicator` pulls in
  `daphne.testing`). Decide whether to add `daphne` as a dev dependency and run
  the websocket tests, or guard/skip them. Own story.
```

- [ ] **Step 4: Commit**

```bash
git add docs/epics/initial-migrations.md
git commit -m "docs(epics): mark Story 6.x done, split out websocket follow-up (Story 7.x)"
```

---

## Self-Review

**Spec coverage:**
- `divisions/api/tests.py` broken (`parent_division`, invalid enum) → Task 1. ✓
- `notifications/tests_api.py` broken (`count` KeyError, mark-read 404, unauth 200) → Task 2. ✓
- `tests_websockets` failure → explicitly excluded by decision; logged as Story 7.x in Task 3. ✓
- "Restore a green suite" → Task 3 Step 1 verifies the in-scope modules pass. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every step shows full file content and exact commands with expected output. ✓

**Type/contract consistency:** All URLs use `/api/<app>/<app>/`; divisions uses `parent` and `DivisionType.*` (lowercase values); notifications uses `mark_read` and the paginated `count`/`results` keys. These match the verified facts above and each other. ✓

---

## Notes / Decisions Captured
- **`read_at`** (notifications): decision = drop the assertion (test-only). Not adding a model field/migration in this story.
- **`tests_websockets` / `daphne`**: decision = exclude from this story; logged as Story 7.x. Verification commands target explicit modules to avoid its import error.
- **Divisions list count**: `count == 2` because `setUp` creates a company + one child division; `test_create` then asserts `Division.objects.count() == 3`.
